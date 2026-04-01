mod auth;
mod chat;
mod config;
mod game;
mod matchmaking_ws;
mod server_registry;
mod server_ws;
mod social;
mod state;
mod voice;
mod ws_auth;

use axum::{
    routing::get,
    Router,
};
use zelqor_django::{DjangoClient, DjangoClientConfig};
use zelqor_matchmaking::MatchmakingManager;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};

async fn shutdown_signal(state: crate::state::AppState) {
    use tokio::signal::unix::{signal, SignalKind};

    let mut sigterm = signal(SignalKind::terminate()).expect("Failed to install SIGTERM handler");

    tokio::select! {
        _ = sigterm.recv() => {
            info!("Received SIGTERM");
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Received SIGINT (Ctrl+C)");
        }
    }

    info!("Received shutdown signal, draining connections...");
    state.shutting_down.store(true, Ordering::SeqCst);
}

use crate::chat::new_chat_connections;
use crate::config::AppConfig;
use crate::game::new_game_connections;
use crate::server_registry::ServerRegistry;
use crate::social::new_social_connections;
use crate::state::AppState;
use dashmap::DashMap;

async fn recover_active_matches(state: &AppState) {
    info!("Checking for active matches to recover...");

    let match_ids = match state.django.list_active_matches().await {
        Ok(ids) => ids,
        Err(e) => {
            error!("Failed to fetch active matches from Django: {e}");
            return;
        }
    };

    if match_ids.is_empty() {
        info!("No active matches to recover.");
        return;
    }

    info!(
        "Found {} active match(es), checking recovery...",
        match_ids.len()
    );

    for match_id in &match_ids {
        let meta_key = format!("game:{match_id}:meta");
        let players_key = format!("game:{match_id}:players");

        let mut conn = state.redis.clone();

        let has_meta: bool = redis::cmd("EXISTS")
            .arg(&meta_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(false);

        let has_players: bool = redis::cmd("EXISTS")
            .arg(&players_key)
            .query_async(&mut conn)
            .await
            .unwrap_or(false);

        if has_meta && has_players {
            // State exists — clear stale locks so the game can resume when players reconnect.
            let loop_lock = format!("game:{match_id}:loop_lock");
            let init_lock = format!("game:{match_id}:init_lock");
            let capital_timer_lock = format!("game:{match_id}:capital_timer_lock");
            let capital_finalize_lock = format!("game:{match_id}:capital_finalize_lock");

            let _: Result<(), _> = redis::cmd("DEL")
                .arg(&loop_lock)
                .arg(&init_lock)
                .arg(&capital_timer_lock)
                .arg(&capital_finalize_lock)
                .query_async(&mut conn)
                .await;

            info!(
                "Match {match_id}: Redis state found, cleared stale locks — ready to resume on reconnect"
            );
        } else {
            // No Redis state — cancel the match in Django so it is not left dangling.
            info!("Match {match_id}: No Redis state found, cancelling...");

            if let Err(e) = state.django.update_match_status(match_id, "cancelled").await {
                error!("Failed to cancel match {match_id}: {e}");
            } else {
                info!("Match {match_id}: Cancelled successfully");
            }

            // Trigger cleanup to remove any partial Redis data.
            let _ = state.django.cleanup_match(match_id).await;
        }
    }

    info!("Match recovery complete.");
}

#[tokio::main]
async fn main() {
    // Load .env
    let _ = dotenvy::dotenv();

    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,zelqor_gateway=debug".into()),
        )
        .init();

    let config = AppConfig::from_env();
    config.validate();
    info!("Starting Zelqor Gateway on port {}", config.gateway_port);

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis_url())
        .expect("Failed to create Redis client");
    let redis_conn = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Failed to connect to Redis");

    // Create Django client with circuit breaker + retry config
    let django = DjangoClient::new_with_config(
        config.django_internal_url.clone(),
        config.internal_secret.clone(),
        DjangoClientConfig {
            request_timeout_ms: config.django_request_timeout_ms,
            retry_count: config.django_retry_count,
            circuit_failure_threshold: config.circuit_breaker_failure_threshold,
            circuit_reset_timeout_secs: config.circuit_breaker_reset_timeout_secs,
        },
    );

    // Create server registry and matchmaking manager
    let server_registry = Arc::new(ServerRegistry::new());

    let mut matchmaking_mgr = MatchmakingManager::new(django.clone(), redis_conn.clone());

    // Wire up the dispatch callback: when a match starts, route it to the
    // best available gamenode via the ServerRegistry.
    {
        let registry = Arc::clone(&server_registry);
        let django_dispatch = django.clone();

        let dispatch_fn: zelqor_matchmaking::DispatchFn = Arc::new(move |match_id: String, community_server_id: Option<String>| {
            let registry = Arc::clone(&registry);
            let django = django_dispatch.clone();
            Box::pin(async move {
                // 1. Pick the right server:
                //    - Community match: route to the specific community gamenode
                //    - Official match: pick the best official gamenode only
                let server_id = if let Some(ref cs_id) = community_server_id {
                    // Community match — the community server IS the gamenode
                    if registry.is_connected(cs_id) {
                        cs_id.clone()
                    } else {
                        return Err(format!("Community server {cs_id} is not connected"));
                    }
                } else {
                    // Official match — only pick official gamenodes
                    registry
                        .get_best_server(None, Some(true))
                        .ok_or_else(|| "No official gamenode with available capacity".to_string())?
                };

                // 2. Get the sender channel for that server.
                let sender = registry
                    .get_server_sender(&server_id)
                    .ok_or_else(|| format!("Server {server_id} disappeared from registry"))?;

                // 3. Fetch match data from Django to forward to the gamenode.
                let match_data = django
                    .get_match_data(&match_id)
                    .await
                    .map_err(|e| format!("Failed to fetch match data: {e}"))?;

                let match_data_json = serde_json::to_value(&match_data)
                    .map_err(|e| format!("Failed to serialise match data: {e}"))?;

                // 4. Send StartMatch to the gamenode.
                sender
                    .send(zelqor_protocol::GatewayToNode::StartMatch {
                        match_id: match_id.clone(),
                        match_data: match_data_json,
                    })
                    .map_err(|e| format!("Failed to send StartMatch to gamenode: {e}"))?;

                // 5. Track the match on the server.
                registry.increment_matches(&server_id);
                registry.assign_match(&match_id, &server_id);

                // 6. Persist the server assignment in Django (fire-and-forget).
                let django_bg = django.clone();
                let mid = match_id.clone();
                let sid = server_id.clone();
                tokio::spawn(async move {
                    if let Err(e) = django_bg.assign_server_to_match(&mid, &sid).await {
                        tracing::warn!(
                            match_id = %mid,
                            server_id = %sid,
                            "Failed to assign server in Django: {e}"
                        );
                    }
                });

                Ok(zelqor_matchmaking::DispatchResult { server_id })
            })
        });

        matchmaking_mgr.set_dispatch_fn(dispatch_fn);
    }

    let matchmaking = Arc::new(matchmaking_mgr);

    // Create game connections registry
    let game_connections = new_game_connections();

    // Create chat state
    let chat_connections = new_chat_connections();
    let social_connections = new_social_connections();
    let username_cache = Arc::new(DashMap::new());
    let chat_rate_limits = Arc::new(DashMap::new());
    let action_rate_limits = Arc::new(DashMap::new());

    let app_state = AppState {
        config: config.clone(),
        redis: redis_conn,
        django,
        matchmaking,
        game_connections,
        chat_connections,
        social_connections,
        username_cache,
        chat_rate_limits,
        action_rate_limits,
        shutting_down: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        server_registry,
    };

    // Start lobby pub/sub listener (Django/Celery → Gateway events)
    app_state.matchmaking.spawn_pubsub_listener(&config.redis_url());

    // Start social pub/sub listener (Django → Gateway social events)
    social::spawn_social_pubsub(
        config.redis_url(),
        app_state.social_connections.clone(),
    );

    recover_active_matches(&app_state).await;

    let app = Router::new()
        // Health check
        .route("/health", get(|| async { "OK" }))
        // Matchmaking WebSocket routes
        .route(
            "/ws/matchmaking/",
            get(|ws, state, headers, query| {
                matchmaking_ws::ws_matchmaking_handler(ws, None, state, headers, query)
            }),
        )
        .route(
            "/ws/matchmaking/{game_mode}/",
            get(|ws, path: axum::extract::Path<String>, state, headers, query| {
                matchmaking_ws::ws_matchmaking_handler(
                    ws,
                    Some(axum::extract::Path(path.0)),
                    state,
                    headers,
                    query,
                )
            }),
        )
        // Game WebSocket routes
        .route("/ws/game/{match_id}/", get(game::ws_game_handler))
        .route("/ws/game/{match_id}/spectate/", get(game::ws_spectate_handler))
        // Global chat WebSocket route
        .route("/ws/chat/", get(chat::ws_chat_handler))
        // Social notifications / DM WebSocket route
        .route("/ws/social/", get(social::ws_social_handler))
        // Gamenode server WebSocket route
        .route("/ws/server/", get(server_ws::ws_server_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(app_state.clone());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.gateway_port))
        .await
        .expect("Failed to bind");

    info!("Listening on 0.0.0.0:{}", config.gateway_port);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(app_state))
        .await
        .expect("Server failed");
}
