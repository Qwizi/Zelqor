mod auth;
mod chat;
mod config;
mod game;
mod matchmaking_ws;
mod state;
mod voice;

use axum::{
    routing::get,
    Router,
};
use maplord_django::DjangoClient;
use maplord_matchmaking::MatchmakingManager;
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing::{error, info};

use crate::chat::new_chat_connections;
use crate::config::AppConfig;
use crate::game::new_game_connections;
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
                .unwrap_or_else(|_| "info,maplord_gateway=debug".into()),
        )
        .init();

    let config = AppConfig::from_env();
    info!("Starting MapLord Gateway on port {}", config.gateway_port);

    // Connect to Redis
    let redis_client = redis::Client::open(config.redis_url())
        .expect("Failed to create Redis client");
    let redis_conn = redis::aio::ConnectionManager::new(redis_client)
        .await
        .expect("Failed to connect to Redis");

    // Create Django client
    let django = DjangoClient::new(
        config.django_internal_url.clone(),
        config.internal_secret.clone(),
    );

    // Create matchmaking manager
    let matchmaking = Arc::new(MatchmakingManager::new(django.clone(), redis_conn.clone()));

    // Create game connections registry
    let game_connections = new_game_connections();

    // Create chat state
    let chat_connections = new_chat_connections();
    let username_cache = Arc::new(DashMap::new());
    let chat_rate_limits = Arc::new(DashMap::new());

    let app_state = AppState {
        config: config.clone(),
        redis: redis_conn,
        django,
        matchmaking,
        game_connections,
        chat_connections,
        username_cache,
        chat_rate_limits,
    };

    // Start lobby pub/sub listener (Django/Celery → Gateway events)
    app_state.matchmaking.spawn_pubsub_listener(&config.redis_url());

    recover_active_matches(&app_state).await;

    let app = Router::new()
        // Health check
        .route("/health", get(|| async { "OK" }))
        // Matchmaking WebSocket routes
        .route(
            "/ws/matchmaking/",
            get(|ws, state, query| {
                matchmaking_ws::ws_matchmaking_handler(ws, None, state, query)
            }),
        )
        .route(
            "/ws/matchmaking/{game_mode}/",
            get(|ws, path: axum::extract::Path<String>, state, query| {
                matchmaking_ws::ws_matchmaking_handler(
                    ws,
                    Some(axum::extract::Path(path.0)),
                    state,
                    query,
                )
            }),
        )
        // Game WebSocket route
        .route("/ws/game/{match_id}/", get(game::ws_game_handler))
        // Global chat WebSocket route
        .route("/ws/chat/", get(chat::ws_chat_handler))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(app_state);

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{}", config.gateway_port))
        .await
        .expect("Failed to bind");

    info!("Listening on 0.0.0.0:{}", config.gateway_port);
    axum::serve(listener, app).await.expect("Server failed");
}
