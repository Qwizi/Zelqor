use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use dashmap::DashMap;
use maplord_ai::{BotBrain, BotStrategy, TutorialBotBrain};
use maplord_engine::{Action, ActiveBoost, Event, GameEngine, GameSettings, Player, Region};
use maplord_state::{FullGameState, GameStateManager};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use serde::Deserialize;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use maplord_anticheat::{AnticheatEngine, AnticheatVerdict};
use tracing::{error, info, warn};

/// Channel buffer size per WebSocket connection — provides backpressure for slow clients.
const WS_CHANNEL_BUFFER: usize = 256;

/// Per-match connection registry: match_id -> (player_id -> Vec<sender>)
pub type GameConnections =
    Arc<DashMap<String, DashMap<String, Vec<mpsc::Sender<Message>>>>>;

pub fn new_game_connections() -> GameConnections {
    Arc::new(DashMap::new())
}

/// Read weather/day-night flags from match meta and compute weather.
async fn compute_weather_from_meta(state_mgr: &GameStateManager, now_secs: i64) -> maplord_engine::WeatherState {
    let meta = state_mgr.get_meta().await.unwrap_or_default();
    let weather_enabled = meta.get("weather_enabled").map(|v| v != "0").unwrap_or(true);
    let day_night_enabled = meta.get("day_night_enabled").map(|v| v != "0").unwrap_or(true);
    maplord_engine::compute_weather_with_flags(now_secs, weather_enabled, day_night_enabled)
}

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
    pub ticket: Option<String>,
    pub nonce: Option<String>,
}

pub async fn ws_game_handler(
    ws: WebSocketUpgrade,
    Path(match_id): Path<String>,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
    if let Err(resp) = auth::check_origin(&headers, &state.config.allowed_ws_origins) {
        return resp;
    }

    let token = match query.token {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(401)
                .body("Missing token".into())
                .unwrap();
        }
    };

    let user_id = match auth::validate_token(&token, &state.config.secret_key) {
        Ok(id) => id,
        Err(_) => {
            return Response::builder()
                .status(401)
                .body("Invalid token".into())
                .unwrap();
        }
    };

    if let Some(ticket) = query.ticket {
        match auth::validate_ticket(&ticket, query.nonce.as_deref(), &mut state.redis.clone()).await {
            Ok(ticket_user_id) if ticket_user_id != user_id => {
                return Response::builder()
                    .status(401)
                    .body("Ticket user mismatch".into())
                    .unwrap();
            }
            Err(_) => {
                return Response::builder()
                    .status(401)
                    .body("Invalid or expired ticket".into())
                    .unwrap();
            }
            Ok(_) => {}
        }
    }

    ws.on_upgrade(move |socket| handle_game_socket(socket, match_id, user_id, state))
}

pub async fn ws_spectate_handler(
    ws: WebSocketUpgrade,
    Path(match_id): Path<String>,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
    if let Err(resp) = auth::check_origin(&headers, &state.config.allowed_ws_origins) {
        return resp;
    }

    let token = match query.token {
        Some(t) => t,
        None => {
            return Response::builder()
                .status(401)
                .body("Missing token".into())
                .unwrap();
        }
    };

    let user_id = match auth::validate_token(&token, &state.config.secret_key) {
        Ok(id) => id,
        Err(_) => {
            return Response::builder()
                .status(401)
                .body("Invalid token".into())
                .unwrap();
        }
    };

    if let Some(ticket) = query.ticket {
        match auth::validate_ticket(&ticket, query.nonce.as_deref(), &mut state.redis.clone()).await {
            Ok(ticket_user_id) if ticket_user_id != user_id => {
                return Response::builder()
                    .status(401)
                    .body("Ticket user mismatch".into())
                    .unwrap();
            }
            Err(_) => {
                return Response::builder()
                    .status(401)
                    .body("Invalid or expired ticket".into())
                    .unwrap();
            }
            Ok(_) => {}
        }
    }

    ws.on_upgrade(move |socket| handle_spectate_socket(socket, match_id, user_id, state))
}

async fn handle_spectate_socket(
    socket: WebSocket,
    match_id: String,
    user_id: String,
    state: AppState,
) {
    use futures::SinkExt;
    use futures::StreamExt;

    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Verify spectator permission via Django
    match state.django.verify_spectator(&match_id, &user_id).await {
        Ok(result) if result.is_member && result.is_active => {}
        Ok(result) if !result.is_active => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Account banned".into(),
                })))
                .await;
            return;
        }
        _ => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Spectating not permitted".into(),
                })))
                .await;
            return;
        }
    }

    info!("Spectator {user_id} joined match {match_id}");

    // Create bounded channel for outgoing messages
    let (tx, mut rx) = mpsc::channel::<Message>(WS_CHANNEL_BUFFER);

    // Register as spectator — key is prefixed to avoid collision with player UUIDs
    let spectator_key = format!("spectator_{user_id}");
    state
        .game_connections
        .entry(match_id.clone())
        .or_insert_with(DashMap::new)
        .entry(spectator_key.clone())
        .or_default()
        .push(tx.clone());

    // Send the current game state immediately so the spectator does not have
    // to wait for the next tick broadcast.
    let state_mgr = GameStateManager::new(match_id.clone(), state.redis.clone());
    if let Ok(full_state) = state_mgr.get_full_state().await {
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let current_weather = compute_weather_from_meta(&state_mgr, now_secs).await;
        let msg = json!({"type": "game_state", "state": full_state, "weather": current_weather});
        let _ = tx.try_send(Message::Text(msg.to_string().into()));
    }

    // Outgoing message forwarder
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Receive loop — spectators are read-only; just watch for close/ping frames
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Close(_) => break,
                // Ping is handled automatically by axum; nothing else to do
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Cleanup: remove this spectator's sender from the match connections
    if let Some(match_conns) = state.game_connections.get(&match_id) {
        if let Some(mut senders) = match_conns.get_mut(&spectator_key) {
            senders.retain(|s| !s.is_closed());
            if senders.is_empty() {
                drop(senders);
                match_conns.remove(&spectator_key);
            }
        }
    }

    info!("Spectator {user_id} left match {match_id}");
}

async fn handle_game_socket(socket: WebSocket, match_id: String, user_id: String, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Verify player membership and account status
    match state.django.verify_player(&match_id, &user_id).await {
        Ok(result) if result.is_member && result.is_active => {}
        Ok(result) if !result.is_active => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Account banned".into(),
                })))
                .await;
            return;
        }
        _ => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Not a match player".into(),
                })))
                .await;
            return;
        }
    }

    let state_mgr = GameStateManager::new(match_id.clone(), state.redis.clone());

    // Ensure game is initialized
    if let Err(e) = ensure_game_initialized(&state_mgr, &match_id, &state).await {
        error!("Failed to initialize game {match_id}: {e}");

        // Cancel the match and inform the player
        let error_msg = format!("Błąd inicjalizacji meczu: {e}");
        let _ = state.django.update_match_status(&match_id, "cancelled").await;
        let _ = state.django.cleanup_match(&match_id).await;
        info!("Match {match_id} cancelled due to init error");

        use futures::SinkExt;
        let _ = ws_sender
            .send(Message::Text(
                serde_json::json!({
                    "type": "error",
                    "message": error_msg,
                    "fatal": true,
                })
                .to_string()
                .into(),
            ))
            .await;
        let _ = ws_sender
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 4002,
                reason: "Match cancelled due to initialization error".into(),
            })))
            .await;
        return;
    }

    // Mark player connected
    if let Err(e) = mark_player_connected(&state_mgr, &user_id).await {
        error!("Failed to mark player connected: {e}");
        use futures::SinkExt;
        let _ = ws_sender
            .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 4001,
                reason: e.to_string().into(),
            })))
            .await;
        return;
    }

    {
        let meta = state_mgr.get_meta().await.unwrap_or_default();
        let max_players = meta
            .get("max_players")
            .and_then(|v| v.parse::<u32>().ok())
            .unwrap_or(0);
        let players_connected = state
            .game_connections
            .get(&match_id)
            .map(|m| m.len() as u32)
            .unwrap_or(0);
        let started_at = meta.get("started_at").cloned().unwrap_or_default();
        crate::social::set_player_status(
            &mut state.redis.clone(),
            &user_id,
            &serde_json::json!({
                "status": "in_game",
                "match_id": &match_id,
                "max_players": max_players,
                "players_connected": players_connected,
                "started_at": started_at,
            }),
        )
        .await;
    }

    // Create channel for outgoing messages with backpressure
    let (tx, mut rx) = mpsc::channel::<Message>(WS_CHANNEL_BUFFER);

    // Register connection
    state
        .game_connections
        .entry(match_id.clone())
        .or_insert_with(DashMap::new)
        .entry(user_id.clone())
        .or_default()
        .push(tx.clone());

    // Check game status and handle accordingly
    let meta = state_mgr.get_meta().await.unwrap_or_default();
    let status = meta.get("status").cloned().unwrap_or_default();

    if status == "selecting" {
        finalize_expired_disconnects(&state_mgr, &match_id, &state).await;
        finalize_capital_selection_if_expired(&state_mgr, &match_id, &state).await;
        try_schedule_capital_selection_timeout(&state_mgr, &match_id, &state).await;
    } else if status == "in_progress" {
        finalize_expired_disconnects(&state_mgr, &match_id, &state).await;
        try_start_game_loop(&state_mgr, &match_id, &state).await;
    }

    // Send initial state
    if let Ok(full_state) = state_mgr.get_full_state().await {
        let now_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let current_weather = compute_weather_from_meta(&state_mgr, now_secs).await;
        let msg = json!({"type": "game_state", "state": full_state, "weather": current_weather});
        let _ = tx.try_send(Message::Text(msg.to_string().into()));
    }

    // Send match chat history
    {
        let django = state.django.clone();
        let mid = match_id.clone();
        let tx_hist = tx.clone();
        tokio::spawn(async move {
            if let Ok(messages) = django.get_match_chat_messages(&mid, 50).await {
                let msg = json!({"type": "chat_history", "messages": messages});
                let _ = tx_hist.try_send(Message::Text(msg.to_string().into()));
            }
        });
    }

    // Send LiveKit voice chat token (only if voice-chat module enabled)
    // Note: settings are not yet loaded at this point, so check via Django API
    let voice_chat_enabled = state.django.get_system_modules().await
        .map(|m| m.get("voice-chat").map(|v| v.enabled).unwrap_or(true))
        .unwrap_or(true);
    if voice_chat_enabled {
        let config = state.config.clone();
        let mid = match_id.clone();
        let uid = user_id.clone();
        let tx_voice = tx.clone();
        let state_voice = state.clone();
        tokio::spawn(async move {
            tracing::info!("Generating voice token for user {uid} in match {mid}");
            let username = crate::chat::resolve_username(&state_voice, &uid).await;
            tracing::info!("Resolved username '{username}' for voice token");
            match crate::voice::generate_voice_token(
                &config.livekit_api_key,
                &config.livekit_api_secret,
                &mid,
                &uid,
                &username,
            ) {
                Ok(token) => {
                    tracing::info!("Voice token generated successfully for {uid}");
                    let msg = json!({
                        "type": "voice_token",
                        "token": token,
                        "url": config.livekit_public_url,
                    });
                    let _ = tx_voice.send(Message::Text(msg.to_string().into())).await;
                }
                Err(e) => {
                    tracing::error!("Failed to generate voice token for {uid}: {e}");
                }
            }
        });
    }

    use futures::SinkExt;
    use futures::StreamExt;

    // Spawn outgoing message forwarder
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    let state_mgr_clone = state_mgr.clone();
    let user_id_clone = user_id.clone();
    let match_id_clone = match_id.clone();
    let state_clone = state.clone();
    let tx_clone = tx.clone();

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(content) = serde_json::from_str::<serde_json::Value>(&text) {
                        handle_game_message(
                            &content,
                            &state_mgr_clone,
                            &user_id_clone,
                            &match_id_clone,
                            &state_clone,
                            &tx_clone,
                        )
                        .await;
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // Wait for either task to finish
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Disconnect cleanup
    mark_player_disconnected(&state_mgr, &user_id, &match_id, &state).await;

    crate::social::clear_player_status(&mut state.redis.clone(), &user_id).await;

    // Unregister connection
    if let Some(match_conns) = state.game_connections.get(&match_id) {
        if let Some(mut player_conns) = match_conns.get_mut(&user_id) {
            player_conns.retain(|s| !s.is_closed());
        }
    }
}

/// Returns true if the action should be rate-limited (i.e., rejected).
fn check_action_rate_limit(state: &AppState, user_id: &str) -> bool {
    const MAX_ACTIONS_PER_SECOND: u32 = 30;
    let now = std::time::Instant::now();

    let mut entry = state
        .action_rate_limits
        .entry(user_id.to_string())
        .or_insert((0, now));
    let (ref mut count, ref mut window_start) = *entry;

    if now.duration_since(*window_start).as_secs_f64() >= 1.0 {
        *count = 1;
        *window_start = now;
        false
    } else if *count >= MAX_ACTIONS_PER_SECOND {
        true
    } else {
        *count += 1;
        false
    }
}

async fn handle_game_message(
    content: &serde_json::Value,
    state_mgr: &GameStateManager,
    user_id: &str,
    match_id: &str,
    state: &AppState,
    tx: &mpsc::Sender<Message>,
) {
    let action = content.get("action").and_then(|v| v.as_str()).unwrap_or("");
    if action != "ping" {
        eprintln!("[WS] Received action='{}' from user={}", action, user_id);
    }

    // Rate limit game actions (not chat/leave_match/set_tick_multiplier)
    if matches!(
        action,
        "attack" | "move" | "build" | "produce_unit" | "use_ability" | "intercept" | "bombard" | "activate_boost" | "select_capital"
        | "propose_pact" | "respond_pact" | "propose_peace" | "respond_peace" | "break_pact" | "declare_war"
    ) {
        if check_action_rate_limit(state, user_id) {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": "Too many actions, slow down"})
                    .to_string()
                    .into(),
            ));
            return;
        }
    }

    match action {
        "select_capital" => {
            handle_select_capital(content, state_mgr, user_id, match_id, state, tx).await;
        }
        "leave_match" => {
            eliminate_player(state_mgr, user_id, "left_match", match_id, state).await;
            let _ = tx.try_send(Message::Text(
                json!({"type": "match_left"}).to_string().into(),
            ));
            let _ = tx.try_send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 4000,
                reason: "Left match".into(),
            })));
        }
        "set_tick_multiplier" => {
            let multiplier = content
                .get("multiplier")
                .and_then(|v| v.as_u64())
                .unwrap_or(1)
                .clamp(1, 10);
            // Only allow in tutorial matches
            let meta = state_mgr.get_meta().await.unwrap_or_default();
            if meta.get("is_tutorial").map(|v| v == "1").unwrap_or(false) {
                let _ = state_mgr.set_meta_field("tick_multiplier", &multiplier.to_string()).await;
            }
        }
        "attack" | "move" | "build" | "produce_unit" | "use_ability" | "intercept" | "bombard" | "activate_boost"
        | "propose_pact" | "respond_pact" | "propose_peace" | "respond_peace" | "break_pact" | "declare_war" => {
            let mut action_data: serde_json::Map<String, serde_json::Value> =
                content.as_object().cloned().unwrap_or_default();
            action_data.remove("action");
            action_data.insert(
                "action_type".to_string(),
                serde_json::Value::String(action.to_string()),
            );
            action_data.insert(
                "player_id".to_string(),
                serde_json::Value::String(user_id.to_string()),
            );

            if let Ok(action) = serde_json::from_value::<Action>(serde_json::Value::Object(action_data))
            {
                let _ = state_mgr.push_action(&action).await;
            }
        }
        "chat" => {
            handle_match_chat(content, user_id, match_id, state, tx).await;
        }
        "ping" => {
            let ts = content.get("ts").cloned().unwrap_or(serde_json::Value::Null);
            let _ = tx.try_send(Message::Text(
                json!({"type": "pong", "ts": ts}).to_string().into(),
            ));
        }
        "player_ready" => {
            broadcast_to_match(
                match_id,
                &json!({
                    "type": "player_ready",
                    "user_id": user_id,
                }),
                &state.game_connections,
            );
        }
        _ => {}
    }
}

async fn handle_match_chat(
    content: &serde_json::Value,
    user_id: &str,
    match_id: &str,
    state: &AppState,
    tx: &mpsc::Sender<Message>,
) {
    let raw_content = content
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if raw_content.is_empty() || raw_content.len() > 500 {
        return;
    }

    // Rate limit: 1 message per second per user
    let now = std::time::Instant::now();
    if let Some(last) = state.chat_rate_limits.get(user_id) {
        if now.duration_since(*last).as_secs_f64() < 1.0 {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": "Rate limited"})
                    .to_string()
                    .into(),
            ));
            return;
        }
    }
    state.chat_rate_limits.insert(user_id.to_string(), now);

    // Resolve username from cache or Django
    let username = {
        let cache_valid = state
            .username_cache
            .get(user_id)
            .map(|entry| entry.1.elapsed().as_secs() < 300)
            .unwrap_or(false);

        if cache_valid {
            state
                .username_cache
                .get(user_id)
                .map(|e| e.0.clone())
                .unwrap_or_else(|| user_id.to_string())
        } else {
            match state.django.get_user(user_id).await {
                Ok(info) => {
                    state.username_cache.insert(
                        user_id.to_string(),
                        (info.username.clone(), std::time::Instant::now()),
                    );
                    info.username
                }
                Err(_) => user_id.to_string(),
            }
        }
    };

    // Save to Django (fire-and-forget)
    {
        let django = state.django.clone();
        let mid = match_id.to_string();
        let uid = user_id.to_string();
        let msg_content = raw_content.clone();
        tokio::spawn(async move {
            if let Err(e) = django.save_match_chat_message(&mid, &uid, &msg_content).await {
                error!("Failed to save match {mid} chat message for user {uid}: {e}");
            }
        });
    }

    // Broadcast to all players in this match
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let chat_msg = json!({
        "type": "chat_message",
        "user_id": user_id,
        "username": username,
        "content": raw_content,
        "timestamp": timestamp,
    });
    broadcast_to_match(match_id, &chat_msg, &state.game_connections);
}

async fn handle_select_capital(
    content: &serde_json::Value,
    state_mgr: &GameStateManager,
    user_id: &str,
    match_id: &str,
    state: &AppState,
    tx: &mpsc::Sender<Message>,
) {
    let region_id = match content.get("region_id").and_then(|v| v.as_str()) {
        Some(id) => id.to_string(),
        None => return,
    };

    finalize_capital_selection_if_expired(state_mgr, match_id, state).await;

    // Pre-check
    let player = match state_mgr.get_player(user_id).await {
        Ok(Some(p)) => p,
        _ => return,
    };
    if player.capital_region_id.is_some() {
        let _ = tx.try_send(Message::Text(
            json!({"type": "error", "message": "Już wybrałeś stolicę"})
                .to_string()
                .into(),
        ));
        return;
    }

    // Lock the region
    let lock_name = format!("capital_lock:{region_id}");
    match state_mgr.try_lock(&lock_name, 5).await {
        Ok(true) => {}
        _ => {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": "Ten region jest już zajęty"})
                    .to_string()
                    .into(),
            ));
            return;
        }
    }

    // Re-validate inside lock
    let result = async {
        let player = match state_mgr.get_player(user_id).await? {
            Some(p) => p,
            None => return Ok(()),
        };
        if player.capital_region_id.is_some() {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": "Już wybrałeś stolicę"})
                    .to_string()
                    .into(),
            ));
            return Ok(());
        }

        let region = match state_mgr.get_region(&region_id).await? {
            Some(r) => r,
            None => {
                let _ = tx.try_send(Message::Text(
                    json!({"type": "error", "message": "Region nie istnieje"})
                        .to_string()
                        .into(),
                ));
                return Ok(());
            }
        };

        if region.owner_id.is_some() {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": "Ten region jest już zajęty"})
                    .to_string()
                    .into(),
            ));
            return Ok(());
        }

        let meta = state_mgr.get_meta().await?;
        let starting_units: i64 = meta
            .get("starting_units")
            .and_then(|v| v.parse().ok())
            .unwrap_or(10);
        let min_dist: usize = meta
            .get("min_capital_distance")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3);

        // Check capital distance
        let regions = state_mgr.get_all_regions().await?;
        let neighbor_map = state.django.get_neighbor_map().await.unwrap_or_default();
        if is_capital_too_close(&region_id, min_dist, &regions, &neighbor_map) {
            let _ = tx.try_send(Message::Text(
                json!({"type": "error", "message": format!("Stolica musi być co najmniej {min_dist} regiony od stolicy innego gracza")})
                    .to_string()
                    .into(),
            ));
            return Ok(());
        }

        // Set capital
        let mut player = player;
        player.capital_region_id = Some(region_id.clone());
        player.total_regions_conquered += 1;
        player.total_units_produced = player.total_units_produced.saturating_add(starting_units as u32);
        state_mgr.set_player(user_id, &player).await?;

        let mut region = region;
        region.owner_id = Some(user_id.to_string());
        region.is_capital = true;
        region.unit_count = starting_units;
        let ut = region.unit_type.clone().unwrap_or_else(|| "infantry".into());
        region.units.insert(ut.clone(), starting_units);
        region.unit_type = Some(ut);
        state_mgr.set_region(&region_id, &region).await?;

        Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
    }
    .await;

    let _ = state_mgr.release_lock(&lock_name).await;

    if result.is_err() {
        error!("Error during capital selection: {:?}", result.err());
        return;
    }

    // In tutorial matches, auto-select bot capital close to the human player
    let meta = state_mgr.get_meta().await.unwrap_or_default();
    if meta.get("is_tutorial").map(|v| v == "1").unwrap_or(false) {
        auto_select_tutorial_bot_capital(state_mgr, state, &region_id).await;
    }

    // Broadcast updated state
    if let Ok(full_state) = state_mgr.get_full_state().await {
        broadcast_to_match(
            match_id,
            &json!({"type": "game_state", "state": full_state}),
            &state.game_connections,
        );
    }

    // Check if all capitals selected
    check_all_capitals_selected(state_mgr, match_id, state).await;
}

async fn check_all_capitals_selected(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    let players = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };

    let alive_players: HashMap<_, _> = players
        .iter()
        .filter(|(_, p)| p.is_alive)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    if alive_players.len() <= 1 {
        finish_match_with_current_state(state_mgr, &players, match_id, state).await;
        return;
    }

    // Separate alive players into humans and bots.
    let all_humans_selected = alive_players
        .values()
        .filter(|p| !p.is_bot)
        .all(|p| p.capital_region_id.is_some());

    // If all humans have capitals but some bots haven't picked yet, trigger bot selection now.
    // When there are no human players (all-bot match) the filter is empty and all() returns true,
    // so bots select immediately — preserving the existing all-bot behaviour.
    let bots_need_capitals = alive_players
        .values()
        .any(|p| p.is_bot && p.capital_region_id.is_none());

    if all_humans_selected && bots_need_capitals {
        let meta = state_mgr.get_meta().await.unwrap_or_default();
        let is_tutorial = meta.get("is_tutorial").map(|v| v == "1").unwrap_or(false);
        if !is_tutorial {
            if let Err(e) = auto_select_bot_capitals(state_mgr, state).await {
                error!("Failed to auto-select bot capitals: {e}");
            }
        }
    }

    // Re-fetch players after potential bot capital assignment.
    let players_after = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };
    let alive_after: HashMap<_, _> = players_after
        .iter()
        .filter(|(_, p)| p.is_alive)
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

    if alive_after
        .values()
        .all(|p| p.capital_region_id.is_some())
    {
        let _ = state_mgr.set_meta_field("status", "in_progress").await;
        let _ = state.django.update_match_status(match_id, "in_progress").await;

        broadcast_to_match(
            match_id,
            &json!({"type": "game_starting"}),
            &state.game_connections,
        );

        try_start_game_loop(state_mgr, match_id, state).await;
    }
}

async fn try_start_game_loop(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    let acquired = state_mgr
        .try_lock("loop_lock", 3600)
        .await
        .unwrap_or(false);
    if !acquired {
        return;
    }

    info!("Starting game loop for match {match_id}");

    let state_mgr = state_mgr.clone();
    let match_id = match_id.to_string();
    let state = state.clone();

    tokio::spawn(async move {
        game_loop_supervised(&state_mgr, &match_id, &state).await;
    });
}

async fn game_loop_supervised(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    const MAX_RETRIES: u32 = 3;

    for attempt in 1..=MAX_RETRIES {
        match game_loop(state_mgr, match_id, state).await {
            Ok(()) => return,
            Err(e) => {
                error!(
                    "Game loop crashed (attempt {attempt}/{MAX_RETRIES}) for match {match_id}: {e}"
                );
                if attempt < MAX_RETRIES {
                    match state_mgr.validate_state().await {
                        Ok(false) => {
                            broadcast_to_match(
                                match_id,
                                &json!({"type": "error", "message": "Wykryto problem z serwerem, przywracanie stanu gry..."}),
                                &state.game_connections,
                            );
                            match state.django.get_latest_snapshot(match_id).await {
                                Ok(snapshot) => {
                                    if let (Some(_tick), Some(state_data)) =
                                        (snapshot.tick, snapshot.state_data)
                                    {
                                        match serde_json::from_value::<FullGameState>(state_data) {
                                            Ok(full_state) => {
                                                match state_mgr.restore_full_state(&full_state).await {
                                                    Ok(()) => {
                                                        info!(
                                                            "Restored game state from snapshot for match {match_id}"
                                                        );
                                                    }
                                                    Err(e) => {
                                                        error!(
                                                            "Failed to restore game state for match {match_id}: {e}"
                                                        );
                                                    }
                                                }
                                            }
                                            Err(e) => {
                                                error!(
                                                    "Failed to deserialize snapshot for match {match_id}: {e}"
                                                );
                                            }
                                        }
                                    } else {
                                        error!(
                                            "No usable snapshot found for match {match_id}"
                                        );
                                    }
                                }
                                Err(e) => {
                                    error!(
                                        "Failed to fetch latest snapshot for match {match_id}: {e}"
                                    );
                                }
                            }
                        }
                        Ok(true) => {
                            broadcast_to_match(
                                match_id,
                                &json!({"type": "error", "message": "Chwilowy błąd serwera, wznawianie gry..."}),
                                &state.game_connections,
                            );
                        }
                        Err(e) => {
                            error!("Failed to validate state for match {match_id}: {e}");
                            broadcast_to_match(
                                match_id,
                                &json!({"type": "error", "message": "Chwilowy błąd serwera, wznawianie gry..."}),
                                &state.game_connections,
                            );
                        }
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    let _ = state_mgr.try_lock("loop_lock", 3600).await;
                } else {
                    error!("Game loop permanently failed for match {match_id}");
                    broadcast_to_match(
                        match_id,
                        &json!({"type": "error", "message": "Krytyczny błąd serwera gry"}),
                        &state.game_connections,
                    );
                }
            }
        }
    }

    let _ = state_mgr.release_lock("loop_lock").await;
}

async fn game_loop(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let meta = state_mgr.get_meta().await?;
    let tick_interval_ms: u64 = meta
        .get("tick_interval_ms")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1000);
    let tick_interval = std::time::Duration::from_millis(tick_interval_ms);

    // Load engine dependencies
    let match_data = state.django.get_match_data(match_id).await
        .map_err(|e| format!("Failed to get match data: {e}"))?;
    let settings: GameSettings =
        serde_json::from_value(match_data.settings_snapshot.clone())?;
    let neighbor_map = state.django.get_neighbor_map().await
        .map_err(|e| format!("Failed to get neighbor map: {e}"))?;

    let mut engine = GameEngine::new(settings.clone(), neighbor_map.clone());
    let anticheat_enabled = settings.is_system_module_enabled("anticheat");
    let mut anticheat = AnticheatEngine::new(match_id.to_string(), state_mgr.redis());
    let snapshot_interval = settings.snapshot_interval_ticks;
    let mut next_tick_at = tokio::time::Instant::now() + tick_interval;

    // Save initial state snapshot (tick 0)
    if let Ok(full_state) = state_mgr.get_full_state().await {
        let state_json = serde_json::to_value(&full_state).unwrap_or_default();
        let _ = state.django.save_snapshot(match_id, 0, state_json).await;
    }

    // Initialize BotBrains for bot players
    let initial_players = state_mgr.get_all_players().await?;
    let is_tutorial = meta.get("is_tutorial").map(|v| v == "1").unwrap_or(false);
    let bot_brains: HashMap<String, Box<dyn BotStrategy>> = initial_players
        .iter()
        .filter(|(_, p)| p.is_bot && p.is_alive)
        .map(|(id, _)| {
            let brain: Box<dyn BotStrategy> = if is_tutorial {
                Box::new(TutorialBotBrain::new(id.clone()))
            } else {
                Box::new(BotBrain::new(id.clone()))
            };
            (id.clone(), brain)
        })
        .collect();

    let mut current_tick_multiplier: u64 = 1;

    loop {
        tokio::time::sleep_until(next_tick_at).await;
        let tick_start = tokio::time::Instant::now();

        // Check if match was cancelled by admin
        {
            let cancel_key = format!("game:{}:cancel_requested", match_id);
            let mut conn = state_mgr.redis();
            let cancelled: bool = redis::cmd("GET")
                .arg(&cancel_key)
                .query_async::<Option<String>>(&mut conn)
                .await
                .unwrap_or(None)
                .is_some();

            if cancelled {
                info!("Match {match_id} cancelled by admin");
                let _: () = redis::cmd("DEL")
                    .arg(&cancel_key)
                    .query_async(&mut conn)
                    .await
                    .unwrap_or(());

                let cancel_msg = json!({
                    "type": "error",
                    "message": "Mecz został anulowany przez administratora.",
                    "fatal": true,
                });
                broadcast_to_match(match_id, &cancel_msg, &state.game_connections);

                let _ = state_mgr.set_meta_field("status", "cancelled").await;
                let _ = state.django.update_match_status(match_id, "cancelled").await;
                let _ = state.django.cleanup_match(match_id).await;

                return Ok(());
            }
        }

        // Read tick multiplier for tutorial fast-forward
        if is_tutorial {
            if let Ok(m) = state_mgr.get_meta().await {
                current_tick_multiplier = m
                    .get("tick_multiplier")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1)
                    .clamp(1, 10);
            }
        }

        let mut tick_data = state_mgr.get_tick_data().await?;
        let tick = tick_data.tick;

        // Check if match should end (no human players alive)
        let has_alive_human = tick_data.players.values().any(|p| p.is_alive && !p.is_bot);
        if !has_alive_human {
            info!("Match {match_id} has no alive human players, ending match");
            let alive: Vec<(&String, &Player)> = tick_data.players.iter()
                .filter(|(_, p)| p.is_alive)
                .collect();
            // Find the last eliminated human as "winner"
            let winner_id = if alive.len() == 1 {
                Some(alive[0].0.clone())
            } else {
                tick_data.players.iter()
                    .filter(|(_, p)| !p.is_bot)
                    .max_by_key(|(_, p)| p.eliminated_tick.unwrap_or(0))
                    .map(|(id, _)| id.clone())
            };
            // Eliminate remaining bots
            for (_, player) in tick_data.players.iter_mut() {
                if player.is_alive && player.is_bot {
                    player.is_alive = false;
                    player.eliminated_reason = Some("match_ended".to_string());
                    player.eliminated_tick = Some(tick);
                }
            }
            let _ = state_mgr.set_players_bulk(&tick_data.players).await;
            let _ = state_mgr.set_meta_field("status", "finished").await;
            let _ = state.django.update_match_status(match_id, "finished").await;
            let early_now_secs = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            let early_weather = maplord_engine::compute_weather_with_settings(early_now_secs, &settings);
            let game_over_msg = json!({
                "type": "game_tick",
                "tick": tick,
                "events": [{"type": "game_over", "winner_id": winner_id}],
                "regions": {},
                "players": tick_data.players,
                "buildings_queue": tick_data.buildings_queue,
                "unit_queue": tick_data.unit_queue,
                "transit_queue": tick_data.transit_queue,
                "air_transit_queue": tick_data.air_transit_queue,
                "weather": early_weather,
            });
            broadcast_to_match(match_id, &game_over_msg, &state.game_connections);
            dispatch_finalization(state_mgr, match_id, winner_id.as_deref(), tick, state).await;
            anticheat.cleanup().await;
            return Ok(());
        }

        // Generate bot actions
        for (bot_id, brain) in &bot_brains {
            if tick_data
                .players
                .get(bot_id)
                .map(|p| p.is_alive)
                .unwrap_or(false)
            {
                let bot_actions = brain.decide(
                    &tick_data.players,
                    &tick_data.regions,
                    &neighbor_map,
                    &settings,
                    tick,
                    &tick_data.diplomacy,
                );
                tick_data.actions.extend(bot_actions);
            }
        }

        // Anti-cheat analysis (pre-tick) — skip if module disabled
        let ac_verdict = if anticheat_enabled {
            anticheat
                .analyze_tick(
                    &tick_data.actions,
                    tick,
                    &tick_data.regions,
                    &tick_data.players,
                    &neighbor_map,
                )
                .await
        } else {
            AnticheatVerdict::Allow
        };

        match &ac_verdict {
            AnticheatVerdict::CancelMatch { reason } => {
                warn!("ANTICHEAT: Cancelling match {match_id} — {reason}");

                // Report violation + ban the cheater via Django (fire-and-forget)
                let violations = anticheat.get_violations().await;
                let django = state.django.clone();
                let mid = match_id.to_string();
                let all_player_ids: Vec<String> = tick_data.players.keys().cloned().collect();
                tokio::spawn(async move {
                    for v in &violations {
                        let _ = django.report_anticheat_violation(
                            &mid, &v.player_id, &v.kind.to_string(), "ban", &v.detail, v.tick,
                        ).await;
                    }
                    // Ban the worst offender(s)
                    let mut banned = std::collections::HashSet::new();
                    for v in &violations {
                        if banned.insert(v.player_id.clone()) {
                            let _ = django.ban_player(&v.player_id, "Anticheat: match cancelled").await;
                        }
                    }
                    // Compensate innocent players
                    let innocent: Vec<String> = all_player_ids
                        .into_iter()
                        .filter(|pid| !banned.contains(pid))
                        .collect();
                    if !innocent.is_empty() {
                        let _ = django.compensate_players(&mid, &innocent).await;
                    }
                });

                let cancel_msg = json!({
                    "type": "error",
                    "message": "Mecz anulowany z powodu wykrycia oszustwa.",
                    "fatal": true,
                });
                broadcast_to_match(match_id, &cancel_msg, &state.game_connections);
                let _ = state_mgr.set_meta_field("status", "cancelled").await;
                let _ = state.django.update_match_status(match_id, "cancelled").await;
                let _ = state.django.cleanup_match(match_id).await;
                anticheat.cleanup().await;
                return Ok(());
            }
            AnticheatVerdict::FlagPlayer { player_id, reason } => {
                warn!("ANTICHEAT: Flagging player {player_id} in match {match_id} — {reason}");

                // Report violation + ban via Django (fire-and-forget)
                {
                    let django = state.django.clone();
                    let mid = match_id.to_string();
                    let pid = player_id.clone();
                    let r = reason.clone();
                    tokio::spawn(async move {
                        let _ = django.report_anticheat_violation(
                            &mid, &pid, "flagged", "flag", &r, tick,
                        ).await;
                        let _ = django.ban_player(&pid, &format!("Anticheat: {r}")).await;
                    });
                }

                // Eliminate the cheater
                if let Some(player) = tick_data.players.get_mut(player_id) {
                    player.is_alive = false;
                    player.eliminated_reason = Some("cheating_detected".to_string());
                    player.eliminated_tick = Some(tick);
                }
                let _ = state_mgr.set_players_bulk(&tick_data.players).await;
                let _ = state.django.set_player_alive(match_id, player_id, false).await;

                // Notify all players
                let cheat_now_secs = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let cheat_weather = maplord_engine::compute_weather_with_settings(cheat_now_secs, &settings);
                let flag_msg = json!({
                    "type": "game_tick",
                    "tick": tick,
                    "events": [{
                        "type": "player_eliminated",
                        "player_id": player_id,
                        "reason": "cheating_detected",
                    }],
                    "regions": {},
                    "players": tick_data.players,
                    "buildings_queue": tick_data.buildings_queue,
                    "unit_queue": tick_data.unit_queue,
                    "transit_queue": tick_data.transit_queue,
                    "air_transit_queue": tick_data.air_transit_queue,
                    "active_effects": tick_data.active_effects,
                    "weather": cheat_weather,
                });
                broadcast_to_match(match_id, &flag_msg, &state.game_connections);

                // Remove cheater's actions from this tick
                let cheater_id = player_id.clone();
                tick_data.actions.retain(|a| {
                    a.player_id.as_deref() != Some(&cheater_id)
                });
            }
            AnticheatVerdict::Warn { player_id, reason } => {
                info!("ANTICHEAT: Warning player {player_id} in match {match_id} — {reason}");
                // Send private warning to the player
                if let Some(match_conns) = state.game_connections.get(match_id) {
                    if let Some(player_senders) = match_conns.get(player_id) {
                        let warn_msg = Message::Text(
                            json!({
                                "type": "anticheat_warning",
                                "message": "Wykryto podejrzaną aktywność. Dalsze naruszenia mogą skutkować usunięciem z meczu.",
                            })
                            .to_string()
                            .into(),
                        );
                        for sender in player_senders.iter() {
                            let _ = sender.try_send(warn_msg.clone());
                        }
                    }
                }
            }
            AnticheatVerdict::Allow => {}
        }

        // Resolve disconnect timeouts
        let timeout_events = resolve_disconnect_timeout_events(&mut tick_data.players);
        if !timeout_events.is_empty() {
            state_mgr.set_players_bulk(&tick_data.players).await?;
            for event in &timeout_events {
                if let Event::PlayerEliminated { player_id, .. } = event {
                    let _ = state.django.set_player_alive(match_id, player_id, false).await;
                }
            }
        }

        let regions_before = tick_data.regions.clone();

        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let weather = maplord_engine::compute_weather_with_settings(now_secs, &settings);
        engine.set_weather(&weather);

        let mut events = engine.process_tick(
            &mut tick_data.players,
            &mut tick_data.regions,
            &tick_data.actions,
            &mut tick_data.buildings_queue,
            &mut tick_data.unit_queue,
            &mut tick_data.transit_queue,
            &mut tick_data.air_transit_queue,
            tick,
            &mut tick_data.active_effects,
            &mut tick_data.diplomacy,
        );

        if !timeout_events.is_empty() {
            let mut combined = timeout_events;
            combined.append(&mut events);
            events = combined;
        }

        // Mark eliminated_tick on players
        for event in &events {
            if let Event::PlayerEliminated { player_id, reason } = event {
                if let Some(player) = tick_data.players.get_mut(player_id) {
                    player.eliminated_reason = Some(reason.clone());
                    player.eliminated_tick = Some(tick);
                }
            }
        }

        // Compute changed regions (delta)
        let changed_regions = compute_changed_regions(&regions_before, &tick_data.regions);
        let dirty_ids: HashSet<String> = changed_regions.keys().cloned().collect();

        // Write back
        state_mgr
            .set_tick_result(
                &tick_data.players,
                &tick_data.regions,
                &tick_data.buildings_queue,
                &tick_data.unit_queue,
                &tick_data.transit_queue,
                &tick_data.air_transit_queue,
                &tick_data.active_effects,
                &tick_data.diplomacy,
                Some(&dirty_ids),
            )
            .await?;

        // Set alive state in DB for eliminated players
        for event in &events {
            if let Event::PlayerEliminated { player_id, .. } = event {
                let _ = state.django.set_player_alive(match_id, player_id, false).await;
            }
        }

        // Log bombarded regions in the delta to verify state is correct
        for event in &events {
            if let Event::Bombard { target_region_id, total_killed, .. } = event {
                let after_units = tick_data.regions.get(target_region_id)
                    .map(|r| r.unit_count).unwrap_or(-1);
                let in_delta = changed_regions.contains_key(target_region_id);
                eprintln!("[TICK] Bombarded {} killed={} after_unit_count={} in_delta={}",
                    target_region_id, total_killed, after_units, in_delta);
            }
        }

        // Broadcast tick
        let tick_msg = json!({
            "type": "game_tick",
            "tick": tick,
            "events": events,
            "regions": changed_regions,
            "players": tick_data.players,
            "buildings_queue": tick_data.buildings_queue,
            "unit_queue": tick_data.unit_queue,
            "transit_queue": tick_data.transit_queue,
            "air_transit_queue": tick_data.air_transit_queue,
            "active_effects": tick_data.active_effects,
            "weather": weather,
            "diplomacy": tick_data.diplomacy,
        });
        broadcast_to_match(match_id, &tick_msg, &state.game_connections);

        let primary_game_over = events.iter().any(|e| matches!(e, Event::GameOver { .. }));

        // Tutorial fast-forward: process additional ticks without sleeping
        if is_tutorial && current_tick_multiplier > 1 && !primary_game_over {
            for _ in 1..current_tick_multiplier {
                let mut extra_tick = state_mgr.get_tick_data().await?;
                let extra_tick_num = extra_tick.tick;

                // Generate bot actions
                for (bot_id, brain) in &bot_brains {
                    if extra_tick.players.get(bot_id).map(|p| p.is_alive).unwrap_or(false) {
                        let bot_actions = brain.decide(
                            &extra_tick.players,
                            &extra_tick.regions,
                            &neighbor_map,
                            &settings,
                            extra_tick_num,
                            &extra_tick.diplomacy,
                        );
                        extra_tick.actions.extend(bot_actions);
                    }
                }

                let extra_timeout_events = resolve_disconnect_timeout_events(&mut extra_tick.players);
                if !extra_timeout_events.is_empty() {
                    state_mgr.set_players_bulk(&extra_tick.players).await?;
                }

                let extra_regions_before = extra_tick.regions.clone();

                let extra_now_secs = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64;
                let extra_weather = maplord_engine::compute_weather_with_settings(extra_now_secs, &settings);
                engine.set_weather(&extra_weather);

                let mut extra_events = engine.process_tick(
                    &mut extra_tick.players,
                    &mut extra_tick.regions,
                    &extra_tick.actions,
                    &mut extra_tick.buildings_queue,
                    &mut extra_tick.unit_queue,
                    &mut extra_tick.transit_queue,
                    &mut extra_tick.air_transit_queue,
                    extra_tick_num,
                    &mut extra_tick.active_effects,
                    &mut extra_tick.diplomacy,
                );

                if !extra_timeout_events.is_empty() {
                    let mut combined = extra_timeout_events;
                    combined.append(&mut extra_events);
                    extra_events = combined;
                }

                for event in &extra_events {
                    if let Event::PlayerEliminated { player_id, reason } = event {
                        if let Some(player) = extra_tick.players.get_mut(player_id) {
                            player.eliminated_reason = Some(reason.clone());
                            player.eliminated_tick = Some(extra_tick_num);
                        }
                    }
                }

                let extra_changed = compute_changed_regions(&extra_regions_before, &extra_tick.regions);
                let extra_dirty: HashSet<String> = extra_changed.keys().cloned().collect();

                state_mgr.set_tick_result(
                    &extra_tick.players,
                    &extra_tick.regions,
                    &extra_tick.buildings_queue,
                    &extra_tick.unit_queue,
                    &extra_tick.transit_queue,
                    &extra_tick.air_transit_queue,
                    &extra_tick.active_effects,
                    &extra_tick.diplomacy,
                    Some(&extra_dirty),
                ).await?;

                for event in &extra_events {
                    if let Event::PlayerEliminated { player_id, .. } = event {
                        let _ = state.django.set_player_alive(match_id, player_id, false).await;
                    }
                }

                // Broadcast this extra tick
                let extra_msg = json!({
                    "type": "game_tick",
                    "tick": extra_tick_num,
                    "events": extra_events,
                    "regions": extra_changed,
                    "players": extra_tick.players,
                    "buildings_queue": extra_tick.buildings_queue,
                    "unit_queue": extra_tick.unit_queue,
                    "transit_queue": extra_tick.transit_queue,
                    "air_transit_queue": extra_tick.air_transit_queue,
                    "active_effects": extra_tick.active_effects,
                    "weather": extra_weather,
                    "diplomacy": extra_tick.diplomacy,
                });
                broadcast_to_match(match_id, &extra_msg, &state.game_connections);

                // Check game over in extra ticks
                let extra_game_over = extra_events.iter().any(|e| matches!(e, Event::GameOver { .. }));
                if extra_game_over {
                    let _ = state_mgr.set_meta_field("status", "finished").await;
                    let winner_id = extra_events.iter().find_map(|e| {
                        if let Event::GameOver { winner_id } = e {
                            winner_id.clone()
                        } else {
                            None
                        }
                    });
                    if let Ok(full_state) = state_mgr.get_full_state().await {
                        let state_json = serde_json::to_value(&full_state).unwrap_or_default();
                        let _ = state.django.finalize_match(
                            match_id,
                            winner_id.as_deref(),
                            extra_tick_num as u64,
                            state_json,
                        ).await;
                    }
                    let state_clone = state.clone();
                    let match_id_clone = match_id.to_string();
                    tokio::spawn(async move {
                        tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
                        let _ = state_clone.django.cleanup_match(&match_id_clone).await;
                    });
                    return Ok(());
                }

                // Small sleep between extra ticks
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
        }

        // Periodic snapshot
        if tick as u64 % snapshot_interval == 0 {
            if let Ok(full_state) = state_mgr.get_full_state().await {
                let state_json = serde_json::to_value(&full_state).unwrap_or_default();
                let _ = state
                    .django
                    .save_snapshot(match_id, tick as u64, state_json)
                    .await;
            }
        }

        // Check for time limit expiry
        if settings.match_duration_limit_minutes > 0 {
            let max_ticks = (settings.match_duration_limit_minutes * 60 * 1000) / settings.tick_interval_ms;
            if tick as u64 >= max_ticks && !events.iter().any(|e| matches!(e, Event::GameOver { .. })) {
                info!("Match {match_id} reached time limit ({} min), ending", settings.match_duration_limit_minutes);
                // Determine winner by most regions, then most units
                let alive: Vec<(&String, &Player)> = tick_data.players.iter()
                    .filter(|(_, p)| p.is_alive)
                    .collect();
                let winner_id = if alive.len() == 1 {
                    Some(alive[0].0.clone())
                } else if alive.is_empty() {
                    None
                } else {
                    // Count regions per player
                    let mut region_counts: HashMap<&str, (i64, i64)> = HashMap::new();
                    for region in tick_data.regions.values() {
                        if let Some(ref oid) = region.owner_id {
                            let entry = region_counts.entry(oid.as_str()).or_insert((0, 0));
                            entry.0 += 1;
                            entry.1 += region.unit_count;
                        }
                    }
                    alive.iter()
                        .max_by_key(|(id, _)| {
                            let (r, u) = region_counts.get(id.as_str()).copied().unwrap_or((0, 0));
                            (r, u)
                        })
                        .map(|(id, _)| id.to_string())
                };
                events.push(Event::GameOver { winner_id: winner_id.clone() });
            }
        }

        // Check for game over
        let is_game_over = events.iter().any(|e| matches!(e, Event::GameOver { .. }));
        if is_game_over {
            let _ = state_mgr.set_meta_field("status", "finished").await;
            let winner_id = events.iter().find_map(|e| {
                if let Event::GameOver { winner_id } = e {
                    winner_id.clone()
                } else {
                    None
                }
            });

            // Finalize
            if let Ok(full_state) = state_mgr.get_full_state().await {
                let state_json = serde_json::to_value(&full_state).unwrap_or_default();
                let _ = state
                    .django
                    .finalize_match(
                        match_id,
                        winner_id.as_deref(),
                        tick as u64,
                        state_json,
                    )
                    .await;
            }

            // Schedule cleanup
            let state_clone = state.clone();
            let match_id_clone = match_id.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
                let _ = state_clone.django.cleanup_match(&match_id_clone).await;
            });

            anticheat.cleanup().await;
            return Ok(());
        }

        // Compensate for processing time
        let elapsed = tick_start.elapsed();
        next_tick_at += tick_interval;
        if elapsed > tick_interval {
            next_tick_at = tokio::time::Instant::now();
        }
    }
}

fn compute_changed_regions(
    before: &HashMap<String, Region>,
    after: &HashMap<String, Region>,
) -> HashMap<String, serde_json::Value> {
    let mut changed = HashMap::new();
    for (rid, region) in after {
        if before.get(rid) != Some(region) {
            changed.insert(rid.clone(), region_to_json_no_sea(region));
        }
    }
    changed
}

/// Serialize region to JSON without sea_distances (large, immutable field).
fn region_to_json_no_sea(region: &Region) -> serde_json::Value {
    let mut val = serde_json::to_value(region).unwrap_or_default();
    if let Some(obj) = val.as_object_mut() {
        obj.remove("sea_distances");
    }
    val
}

fn resolve_disconnect_timeout_events(players: &mut HashMap<String, Player>) -> Vec<Event> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let mut events = Vec::new();

    for (player_id, player) in players.iter_mut() {
        if !player.is_alive || player.is_bot {
            continue;
        }
        let deadline = player.disconnect_deadline.unwrap_or(0);
        if deadline <= 0 || deadline > now {
            continue;
        }
        player.is_alive = false;
        player.connected = false;
        player.disconnect_deadline = None;
        player.left_match_at = Some(now);
        events.push(Event::PlayerEliminated {
            player_id: player_id.clone(),
            reason: "disconnect_timeout".into(),
        });
    }

    if !events.is_empty() {
        let alive: Vec<&String> = players
            .iter()
            .filter(|(_, p)| p.is_alive)
            .map(|(id, _)| id)
            .collect();
        if alive.len() <= 1 {
            events.push(Event::GameOver {
                winner_id: alive.first().map(|id| (*id).clone()),
            });
        }
    }

    events
}

async fn eliminate_player(
    state_mgr: &GameStateManager,
    player_id: &str,
    reason: &str,
    match_id: &str,
    state: &AppState,
) {
    let mut players = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };

    let player = match players.get_mut(player_id) {
        Some(p) if p.is_alive => p,
        _ => return,
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    player.is_alive = false;
    player.connected = false;
    player.disconnect_deadline = None;
    player.left_match_at = Some(now);

    let meta = state_mgr.get_meta().await.unwrap_or_default();
    let current_tick: i64 = meta
        .get("current_tick")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    player.eliminated_reason = Some(reason.to_string());
    player.eliminated_tick = Some(current_tick);

    let _ = state_mgr.set_players_bulk(&players).await;
    let _ = state.django.set_player_alive(match_id, player_id, false).await;

    // Clear provinces owned by the eliminated player
    if let Ok(mut regions) = state_mgr.get_all_regions().await {
        let mut changed = false;
        for region in regions.values_mut() {
            if region.owner_id.as_deref() == Some(player_id) {
                region.owner_id = None;
                region.units.clear();
                region.unit_count = 0;
                region.unit_type = None;
                region.is_capital = false;
                region.building_instances.clear();
                region.building_type = None;
                region.defense_bonus = 0.0;
                region.vision_range = 0;
                region.unit_generation_bonus = 0.0;
                region.energy_generation_bonus = 0.0;
                changed = true;
            }
        }
        if changed {
            let _ = state_mgr.set_regions_bulk(&regions).await;
        }
    }

    let mut events: Vec<Event> = vec![Event::PlayerEliminated {
        player_id: player_id.to_string(),
        reason: reason.to_string(),
    }];

    let alive: Vec<&String> = players
        .iter()
        .filter(|(_, p)| p.is_alive)
        .map(|(id, _)| id)
        .collect();

    let alive_humans: Vec<&String> = players
        .iter()
        .filter(|(_, p)| p.is_alive && !p.is_bot)
        .map(|(id, _)| id)
        .collect();

    // Game ends when: exactly 1 player alive (winner), 0 alive (tie),
    // or no human players remain (bots can't play alone).
    let winner_id = if alive.len() == 1 {
        Some(alive[0].clone())
    } else if alive_humans.is_empty() && !alive.is_empty() {
        // No humans left, last alive bot "wins" (or the human who was eliminated last)
        // Find the player eliminated most recently as the winner
        let last_eliminated = players
            .iter()
            .filter(|(_, p)| !p.is_bot)
            .max_by_key(|(_, p)| p.eliminated_tick.unwrap_or(0))
            .map(|(id, _)| id.clone());
        last_eliminated
    } else {
        None
    };

    if winner_id.is_some() || alive.is_empty() || alive_humans.is_empty() {
        let _ = state_mgr.set_meta_field("status", "finished").await;
        let _ = state.django.update_match_status(match_id, "finished").await;
        events.push(Event::GameOver {
            winner_id: winner_id.clone(),
        });
    }

    let regions = state_mgr.get_all_regions().await.unwrap_or_default();
    let elim_now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let elim_weather = compute_weather_from_meta(state_mgr, elim_now_secs).await;
    let tick_msg = json!({
        "type": "game_tick",
        "tick": current_tick,
        "events": events,
        "regions": regions,
        "players": players,
        "buildings_queue": state_mgr.get_all_buildings().await.unwrap_or_default(),
        "unit_queue": state_mgr.get_all_unit_queue().await.unwrap_or_default(),
        "transit_queue": state_mgr.get_all_transit_queue().await.unwrap_or_default(),
        "air_transit_queue": state_mgr.get_all_air_transit_queue().await.unwrap_or_default(),
        "active_effects": state_mgr.get_all_active_effects().await.unwrap_or_default(),
        "weather": elim_weather,
    });
    broadcast_to_match(match_id, &tick_msg, &state.game_connections);

    if events.iter().any(|e| matches!(e, Event::GameOver { .. })) {
        dispatch_finalization(state_mgr, match_id, winner_id.as_deref(), current_tick, state).await;
    } else if meta.get("status").map(|s| s.as_str()) == Some("selecting") {
        check_all_capitals_selected(state_mgr, match_id, state).await;
    }
}

async fn dispatch_finalization(
    state_mgr: &GameStateManager,
    match_id: &str,
    winner_id: Option<&str>,
    total_ticks: i64,
    state: &AppState,
) {
    if let Ok(full_state) = state_mgr.get_full_state().await {
        let state_json = serde_json::to_value(&full_state).unwrap_or_default();
        let _ = state
            .django
            .finalize_match(match_id, winner_id, total_ticks as u64, state_json)
            .await;
    }

    let state_clone = state.clone();
    let match_id_clone = match_id.to_string();
    tokio::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
        let _ = state_clone.django.cleanup_match(&match_id_clone).await;
    });
}

async fn ensure_game_initialized(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if is_game_initialized(state_mgr).await? {
        return Ok(());
    }

    let acquired = state_mgr.try_lock("init_lock", 15).await?;
    if acquired {
        let result = async {
            if !is_game_initialized(state_mgr).await? {
                initialize_game(state_mgr, match_id, state).await?;
            }
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        }
        .await;
        let _ = state_mgr.release_lock("init_lock").await;
        return result;
    }

    // Wait for initialization
    for _ in 0..30 {
        if is_game_initialized(state_mgr).await? {
            return Ok(());
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    // Last-resort self-heal
    if state_mgr.try_lock("init_lock", 15).await? {
        let result = async {
            if !is_game_initialized(state_mgr).await? {
                initialize_game(state_mgr, match_id, state).await?;
            }
            Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
        }
        .await;
        let _ = state_mgr.release_lock("init_lock").await;
        return result;
    }

    Ok(())
}

async fn is_game_initialized(
    state_mgr: &GameStateManager,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let meta = state_mgr.get_meta().await?;
    if meta.is_empty() {
        return Ok(false);
    }
    let players = state_mgr.get_all_players().await?;
    let regions = state_mgr.get_all_regions().await?;
    Ok(!players.is_empty() && !regions.is_empty())
}

async fn initialize_game(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let match_data = state.django.get_match_data(match_id).await
        .map_err(|e| format!("Failed to get match data: {e}"))?;
    let settings: GameSettings =
        serde_json::from_value(match_data.settings_snapshot.clone())?;

    state_mgr
        .init_meta(settings.tick_interval_ms, match_data.max_players)
        .await?;
    state_mgr
        .set_meta_field("starting_units", &settings.starting_units.to_string())
        .await?;
    state_mgr
        .set_meta_field("min_capital_distance", &settings.min_capital_distance.to_string())
        .await?;
    state_mgr
        .set_meta_field("neutral_region_units", &settings.neutral_region_units.to_string())
        .await?;
    state_mgr
        .set_meta_field("starting_energy", &settings.starting_energy.to_string())
        .await?;
    let capital_selection_time = settings.capital_selection_time_seconds;
    state_mgr
        .set_meta_field("capital_selection_time_seconds", &capital_selection_time.to_string())
        .await?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    state_mgr
        .set_meta_field(
            "capital_selection_ends_at",
            &(now + capital_selection_time).to_string(),
        )
        .await?;
    state_mgr
        .set_meta_field("disconnect_grace_seconds", &settings.disconnect_grace_seconds.to_string())
        .await?;
    state_mgr
        .set_meta_field("capital_protection_ticks", &settings.capital_protection_ticks.to_string())
        .await?;
    if settings.diplomacy_enabled {
        state_mgr.set_meta_field("diplomacy_enabled", "1").await?;
    }
    if !settings.weather_enabled {
        state_mgr.set_meta_field("weather_enabled", "0").await?;
    }
    if !settings.day_night_enabled {
        state_mgr.set_meta_field("day_night_enabled", "0").await?;
    }
    if match_data.is_tutorial {
        state_mgr.set_meta_field("is_tutorial", "1").await?;
    }
    state_mgr
        .set_meta_field("started_at", &now.to_string())
        .await?;

    // Set up players
    let mut players = HashMap::new();
    for p in &match_data.players {
        let player = Player {
            user_id: p.user_id.clone(),
            username: p.username.clone(),
            color: p.color.clone(),
            is_alive: true,
            connected: p.is_bot, // Bots are always "connected"
            disconnect_deadline: None,
            left_match_at: None,
            eliminated_reason: None,
            eliminated_tick: None,
            capital_region_id: None,
            energy: settings.starting_energy,
            energy_accum: 0.0,
            ability_cooldowns: HashMap::new(),
            is_bot: p.is_bot,
            total_units_produced: 0,
            total_units_lost: 0,
            total_regions_conquered: 0,
            total_buildings_built: 0,
            // Deck fields — populated from deck_snapshot when the Django API provides them;
            // default to empty so the engine stays backwards-compatible.
            unlocked_buildings: p.unlocked_buildings.clone(),
            unlocked_units: p.unlocked_units.clone(),
            ability_scrolls: p.ability_scrolls.clone(),
            active_boosts: p.active_boosts.iter()
                .filter_map(|v| serde_json::from_value::<ActiveBoost>(v.clone()).ok())
                .collect(),
            active_match_boosts: Vec::new(),
            ability_levels: p.ability_levels.clone(),
            building_levels: p.building_levels.clone(),
            unit_levels: p.unit_levels.clone(),
            cosmetics: p.cosmetics.clone(),
            action_points: settings.max_action_points,
            ap_regen_accum: 0.0,
        };
        players.insert(p.user_id.clone(), player);
    }
    state_mgr.set_players_bulk(&players).await?;

    // Set up regions
    let match_regions = state.django.get_match_regions(match_id).await
        .map_err(|e| format!("Failed to get regions: {e}"))?;

    let default_unit_type = settings
        .default_unit_type_slug
        .clone()
        .unwrap_or_else(|| "infantry".into());

    let neutral_min = 1i64;
    let neutral_max = 11i64;

    // Pre-generate neutral unit counts to avoid holding non-Send rng across await
    let neutral_counts: Vec<i64> = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        (0..match_regions.len())
            .map(|_| rng.gen_range(neutral_min..=neutral_max))
            .collect()
    };

    let mut regions = HashMap::new();
    for ((region_id, info), &neutral_units) in match_regions.iter().zip(neutral_counts.iter()) {
        let mut units = HashMap::new();
        units.insert(default_unit_type.clone(), neutral_units);

        regions.insert(
            region_id.clone(),
            Region {
                name: info.name.clone(),
                country_code: info.country_code.clone(),
                centroid: info.centroid,
                owner_id: None,
                unit_count: neutral_units,
                unit_type: Some(default_unit_type.clone()),
                is_capital: false,
                building_type: None,
                building_instances: Vec::new(),
                defense_bonus: 0.0,
                vision_range: 0,
                unit_generation_bonus: 0.0,
                energy_generation_bonus: 0.0,
                is_coastal: info.is_coastal,
                sea_distances: if info.sea_distances.is_array() {
                    info.sea_distances
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                } else {
                    Vec::new()
                },
                units,
                unit_accum: 0.0,
                action_cooldowns: HashMap::new(),
                fatigue_until: None,
                fatigue_modifier: 0.0,
            },
        );
    }
    state_mgr.set_regions_bulk(&regions).await?;

    Ok(())
}

async fn auto_select_bot_capitals(
    state_mgr: &GameStateManager,
    state: &AppState,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut players = state_mgr.get_all_players().await?;
    let mut regions = state_mgr.get_all_regions().await?;
    let meta = state_mgr.get_meta().await?;

    let bot_ids: Vec<String> = players
        .iter()
        .filter(|(_, p)| p.is_bot && p.is_alive && p.capital_region_id.is_none())
        .map(|(id, _)| id.clone())
        .collect();

    if bot_ids.is_empty() {
        return Ok(());
    }

    let min_dist: usize = meta
        .get("min_capital_distance")
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);
    let starting_units: i64 = meta
        .get("starting_units")
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let neighbor_map = state.django.get_neighbor_map().await.unwrap_or_default();

    for bot_id in &bot_ids {
        let brain = BotBrain::new(bot_id.clone());
        let region_id = match brain.pick_capital(&regions, &neighbor_map, min_dist) {
            Some(id) => id,
            None => continue,
        };

        if let Some(player) = players.get_mut(bot_id) {
            player.capital_region_id = Some(region_id.clone());
            player.total_regions_conquered += 1;
            player.total_units_produced = player.total_units_produced.saturating_add(starting_units as u32);
            state_mgr.set_player(bot_id, player).await?;
        }

        if let Some(region) = regions.get_mut(&region_id) {
            region.owner_id = Some(bot_id.clone());
            region.is_capital = true;
            region.unit_count = starting_units;
            let ut = region
                .unit_type
                .clone()
                .unwrap_or_else(|| "infantry".into());
            region.units.insert(ut.clone(), starting_units);
            region.unit_type = Some(ut);
            state_mgr.set_region(&region_id, region).await?;
        }
    }

    Ok(())
}

/// In tutorial matches, pick the bot's capital as close as possible to the human's capital.
async fn auto_select_tutorial_bot_capital(
    state_mgr: &GameStateManager,
    state: &AppState,
    human_capital_id: &str,
) {
    let players = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut regions = match state_mgr.get_all_regions().await {
        Ok(r) => r,
        Err(_) => return,
    };
    let meta = state_mgr.get_meta().await.unwrap_or_default();

    // Find bot players without capitals
    let bot_ids: Vec<String> = players
        .iter()
        .filter(|(_, p)| p.is_bot && p.is_alive && p.capital_region_id.is_none())
        .map(|(id, _)| id.clone())
        .collect();

    if bot_ids.is_empty() {
        return;
    }

    let starting_units: i64 = meta
        .get("starting_units")
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let min_dist: usize = meta
        .get("min_capital_distance")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);

    let neighbor_map = state.django.get_neighbor_map().await.unwrap_or_default();

    // Assign capital to each bot, giving each a distinct region via BFS from the human capital.
    // used_regions tracks regions already assigned in this loop so no two bots share the same capital.
    let mut used_regions: HashSet<String> = HashSet::new();
    used_regions.insert(human_capital_id.to_string());

    for bot_id in &bot_ids {
        // BFS from human's capital to find the closest unowned, unassigned region that
        // respects min_dist. We re-run BFS for each bot so the search skips regions that
        // were already assigned to earlier bots in this iteration.
        let mut visited = HashSet::new();
        visited.insert(human_capital_id.to_string());
        let mut queue = VecDeque::new();
        queue.push_back((human_capital_id.to_string(), 0usize));

        let mut best_region: Option<String> = None;

        while let Some((current, dist)) = queue.pop_front() {
            if dist >= min_dist {
                if let Some(r) = regions.get(&current) {
                    if r.owner_id.is_none() && !used_regions.contains(&current) {
                        best_region = Some(current.clone());
                        break;
                    }
                }
            }

            if let Some(neighbors) = neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) && regions.contains_key(neighbor) {
                        visited.insert(neighbor.clone());
                        queue.push_back((neighbor.clone(), dist + 1));
                    }
                }
            }
        }

        let region_id = match best_region {
            Some(id) => id,
            None => {
                // Fallback: any unowned, unassigned region
                match regions
                    .iter()
                    .find(|(id, r)| r.owner_id.is_none() && !used_regions.contains(*id))
                {
                    Some((id, _)) => id.clone(),
                    None => continue,
                }
            }
        };

        used_regions.insert(region_id.clone());

        let mut players = match state_mgr.get_all_players().await {
            Ok(p) => p,
            Err(_) => return,
        };

        if let Some(player) = players.get_mut(bot_id) {
            player.capital_region_id = Some(region_id.clone());
            player.total_regions_conquered += 1;
            player.total_units_produced = player
                .total_units_produced
                .saturating_add(starting_units as u32);
            let _ = state_mgr.set_player(bot_id, player).await;
        }

        if let Some(region) = regions.get_mut(&region_id) {
            region.owner_id = Some(bot_id.clone());
            region.is_capital = true;
            region.unit_count = starting_units;
            let ut = region.unit_type.clone().unwrap_or_else(|| "infantry".into());
            region.units.insert(ut.clone(), starting_units);
            region.unit_type = Some(ut);
            let _ = state_mgr.set_region(&region_id, region).await;
        }
    }
}

async fn mark_player_connected(
    state_mgr: &GameStateManager,
    user_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut player = match state_mgr.get_player(user_id).await? {
        Some(p) => p,
        None => return Err("Player not found".into()),
    };

    // Player explicitly left the match — do not allow reconnect
    if !player.is_alive && player.left_match_at.is_some() {
        return Err("Player has left the match".into());
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let deadline = player.disconnect_deadline.unwrap_or(0);
    if player.is_alive && deadline > 0 && deadline <= now {
        return Err("Player timed out".into());
    }

    player.connected = true;
    player.disconnect_deadline = None;
    state_mgr.set_player(user_id, &player).await?;
    state_mgr.incr_connection(user_id).await?;

    Ok(())
}

async fn mark_player_disconnected(
    state_mgr: &GameStateManager,
    user_id: &str,
    match_id: &str,
    state: &AppState,
) {
    let meta = match state_mgr.get_meta().await {
        Ok(m) => m,
        Err(_) => return,
    };

    let status = meta.get("status").cloned().unwrap_or_default();
    if status != "selecting" && status != "in_progress" {
        return;
    }

    let count = state_mgr.decr_connection(user_id).await.unwrap_or(0);
    if count > 0 {
        return; // Other tabs still connected
    }

    let mut player = match state_mgr.get_player(user_id).await {
        Ok(Some(p)) => p,
        _ => return,
    };

    if !player.is_alive || player.is_bot {
        return;
    }

    let grace_seconds: i64 = meta
        .get("disconnect_grace_seconds")
        .and_then(|v| v.parse().ok())
        .unwrap_or(180);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    player.connected = false;
    player.disconnect_deadline = Some(now + grace_seconds);
    let _ = state_mgr.set_player(user_id, &player).await;

    let current_tick: i64 = meta
        .get("current_tick")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let players = state_mgr.get_all_players().await.unwrap_or_default();

    // Check if all human players have disconnected — if so, shorten the grace period
    // to a 10-second reconnect window instead of eliminating immediately. This allows
    // page refreshes to reconnect without losing the match, while still cleaning up
    // quickly if all humans are truly gone.
    let any_human_connected = players
        .values()
        .any(|p| !p.is_bot && p.is_alive && p.connected);

    if !any_human_connected {
        info!("All human players disconnected from match {match_id}, using short reconnect window");
        let short_grace = 10i64;
        for (pid, p) in &players {
            if !p.is_bot && p.is_alive && !p.connected {
                if let Ok(Some(mut player_data)) = state_mgr.get_player(pid).await {
                    player_data.disconnect_deadline = Some(now + short_grace);
                    let _ = state_mgr.set_player(pid, &player_data).await;
                }
            }
        }
        return;
    }

    let disc_now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let disc_weather = compute_weather_from_meta(state_mgr, disc_now_secs).await;
    let tick_msg = json!({
        "type": "game_tick",
        "tick": current_tick,
        "events": [Event::PlayerDisconnected {
            player_id: user_id.to_string(),
            grace_seconds,
        }],
        "regions": {},
        "players": players,
        "buildings_queue": state_mgr.get_all_buildings().await.unwrap_or_default(),
        "unit_queue": state_mgr.get_all_unit_queue().await.unwrap_or_default(),
        "transit_queue": state_mgr.get_all_transit_queue().await.unwrap_or_default(),
        "air_transit_queue": state_mgr.get_all_air_transit_queue().await.unwrap_or_default(),
        "weather": disc_weather,
    });
    broadcast_to_match(match_id, &tick_msg, &state.game_connections);
}

async fn finalize_expired_disconnects(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    let meta = match state_mgr.get_meta().await {
        Ok(m) => m,
        Err(_) => return,
    };
    let status = meta.get("status").cloned().unwrap_or_default();
    if status != "selecting" && status != "in_progress" {
        return;
    }

    let players = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let expired: Vec<String> = players
        .iter()
        .filter(|(_, p)| {
            p.is_alive
                && p.disconnect_deadline.unwrap_or(0) > 0
                && p.disconnect_deadline.unwrap_or(0) <= now
        })
        .map(|(id, _)| id.clone())
        .collect();

    for player_id in expired {
        eliminate_player(state_mgr, &player_id, "disconnect_timeout", match_id, state).await;
    }
}

async fn finalize_capital_selection_if_expired(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    let meta = match state_mgr.get_meta().await {
        Ok(m) => m,
        Err(_) => return,
    };

    if meta.get("status").map(|s| s.as_str()) != Some("selecting") {
        return;
    }

    let ends_at: i64 = meta
        .get("capital_selection_ends_at")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    if ends_at > now {
        return;
    }

    if !state_mgr
        .try_lock("capital_finalize_lock", 30)
        .await
        .unwrap_or(false)
    {
        return;
    }

    // Re-validate inside lock
    let meta = state_mgr.get_meta().await.unwrap_or_default();
    if meta.get("status").map(|s| s.as_str()) != Some("selecting") {
        let _ = state_mgr.release_lock("capital_finalize_lock").await;
        return;
    }
    let ends_at: i64 = meta
        .get("capital_selection_ends_at")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    if ends_at > now {
        let _ = state_mgr.release_lock("capital_finalize_lock").await;
        return;
    }

    auto_assign_missing_capitals(state_mgr, match_id, state).await;
    let _ = state_mgr.release_lock("capital_finalize_lock").await;
}

async fn try_schedule_capital_selection_timeout(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    if !state_mgr
        .try_lock("capital_timer_lock", 3600)
        .await
        .unwrap_or(false)
    {
        return;
    }

    let meta = state_mgr.get_meta().await.unwrap_or_default();
    let ends_at: u64 = meta
        .get("capital_selection_ends_at")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let delay = if ends_at > now { ends_at - now } else { 0 };

    let state_mgr = state_mgr.clone();
    let match_id = match_id.to_string();
    let state = state.clone();

    tokio::spawn(async move {
        if delay > 0 {
            tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
        }
        finalize_capital_selection_if_expired(&state_mgr, &match_id, &state).await;
        let _ = state_mgr.release_lock("capital_timer_lock").await;
    });
}

async fn auto_assign_missing_capitals(
    state_mgr: &GameStateManager,
    match_id: &str,
    state: &AppState,
) {
    let meta = state_mgr.get_meta().await.unwrap_or_default();
    if meta.get("status").map(|s| s.as_str()) != Some("selecting") {
        return;
    }

    let mut players = match state_mgr.get_all_players().await {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut regions = match state_mgr.get_all_regions().await {
        Ok(r) => r,
        Err(_) => return,
    };

    let min_dist: usize = meta
        .get("min_capital_distance")
        .and_then(|v| v.parse().ok())
        .unwrap_or(3);
    let starting_units: i64 = meta
        .get("starting_units")
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);

    let neighbor_map = state.django.get_neighbor_map().await.unwrap_or_default();

    let mut missing: Vec<String> = players
        .iter()
        .filter(|(_, p)| p.is_alive && p.capital_region_id.is_none())
        .map(|(id, _)| id.clone())
        .collect();

    if missing.is_empty() {
        check_all_capitals_selected(state_mgr, match_id, state).await;
        return;
    }

    use rand::seq::SliceRandom;
    missing.shuffle(&mut rand::thread_rng());

    for player_id in &missing {
        let region_id = pick_random_capital_region(&regions, &neighbor_map, min_dist);
        let region_id = match region_id {
            Some(id) => id,
            None => continue,
        };

        if let Some(player) = players.get_mut(player_id) {
            player.capital_region_id = Some(region_id.clone());
            player.total_regions_conquered += 1;
            player.total_units_produced = player.total_units_produced.saturating_add(starting_units as u32);
            let _ = state_mgr.set_player(player_id, player).await;
        }

        if let Some(region) = regions.get_mut(&region_id) {
            region.owner_id = Some(player_id.clone());
            region.is_capital = true;
            region.unit_count = starting_units;
            let ut = region
                .unit_type
                .clone()
                .unwrap_or_else(|| "infantry".into());
            region.units.insert(ut.clone(), starting_units);
            region.unit_type = Some(ut);
            let _ = state_mgr.set_region(&region_id, region).await;
        }
    }

    if let Ok(full_state) = state_mgr.get_full_state().await {
        broadcast_to_match(
            match_id,
            &json!({"type": "game_state", "state": full_state}),
            &state.game_connections,
        );
    }

    check_all_capitals_selected(state_mgr, match_id, state).await;
}

fn pick_random_capital_region(
    regions: &HashMap<String, Region>,
    neighbor_map: &HashMap<String, Vec<String>>,
    min_distance: usize,
) -> Option<String> {
    let mut available: Vec<String> = regions
        .iter()
        .filter(|(_, r)| r.owner_id.is_none())
        .map(|(id, _)| id.clone())
        .collect();

    use rand::seq::SliceRandom;
    available.shuffle(&mut rand::thread_rng());

    let existing_capitals: HashSet<String> = regions
        .iter()
        .filter(|(_, r)| r.is_capital)
        .map(|(id, _)| id.clone())
        .collect();

    for region_id in &available {
        if !is_capital_too_close(region_id, min_distance, regions, neighbor_map) || existing_capitals.is_empty() {
            return Some(region_id.clone());
        }
    }

    available.first().cloned()
}

fn is_capital_too_close(
    region_id: &str,
    min_distance: usize,
    regions: &HashMap<String, Region>,
    neighbor_map: &HashMap<String, Vec<String>>,
) -> bool {
    let existing_capitals: HashSet<&String> = regions
        .iter()
        .filter(|(_, r)| r.is_capital)
        .map(|(id, _)| id)
        .collect();

    if existing_capitals.is_empty() {
        return false;
    }

    let mut visited = HashSet::new();
    visited.insert(region_id.to_string());
    let mut queue = VecDeque::new();
    queue.push_back((region_id.to_string(), 0usize));

    while let Some((current, dist)) = queue.pop_front() {
        if dist > 0 && existing_capitals.contains(&current) {
            return true;
        }
        if dist >= min_distance {
            continue;
        }
        if let Some(neighbors) = neighbor_map.get(&current) {
            for neighbor in neighbors {
                if regions.contains_key(neighbor) && !visited.contains(neighbor) {
                    visited.insert(neighbor.clone());
                    queue.push_back((neighbor.clone(), dist + 1));
                }
            }
        }
    }

    false
}

async fn finish_match_with_current_state(
    state_mgr: &GameStateManager,
    players: &HashMap<String, Player>,
    match_id: &str,
    state: &AppState,
) {
    let alive: Vec<&String> = players
        .iter()
        .filter(|(_, p)| p.is_alive)
        .map(|(id, _)| id)
        .collect();
    let winner_id = if alive.len() == 1 {
        Some(alive[0].clone())
    } else {
        None
    };

    let meta = state_mgr.get_meta().await.unwrap_or_default();
    let current_tick: i64 = meta
        .get("current_tick")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let _ = state_mgr.set_meta_field("status", "finished").await;
    let _ = state.django.update_match_status(match_id, "finished").await;

    let finish_now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let finish_weather = compute_weather_from_meta(state_mgr, finish_now_secs).await;
    let tick_msg = json!({
        "type": "game_tick",
        "tick": current_tick,
        "events": [Event::GameOver { winner_id: winner_id.clone() }],
        "regions": {},
        "players": players,
        "buildings_queue": state_mgr.get_all_buildings().await.unwrap_or_default(),
        "unit_queue": state_mgr.get_all_unit_queue().await.unwrap_or_default(),
        "transit_queue": state_mgr.get_all_transit_queue().await.unwrap_or_default(),
        "air_transit_queue": state_mgr.get_all_air_transit_queue().await.unwrap_or_default(),
        "weather": finish_weather,
    });
    broadcast_to_match(match_id, &tick_msg, &state.game_connections);

    dispatch_finalization(state_mgr, match_id, winner_id.as_deref(), current_tick, state).await;
}

pub fn broadcast_to_match(
    match_id: &str,
    msg: &serde_json::Value,
    connections: &GameConnections,
) {
    if let Some(match_conns) = connections.get(match_id) {
        let text = msg.to_string();
        for entry in match_conns.iter() {
            for sender in entry.value().iter() {
                // try_send: drop message for slow clients rather than blocking
                let _ = sender.try_send(Message::Text(text.clone().into()));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maplord_engine::{Event, Player, Region};
    use std::collections::HashMap;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_region(owner_id: Option<&str>, is_capital: bool) -> Region {
        Region {
            owner_id: owner_id.map(|s| s.to_string()),
            is_capital,
            ..Region::default()
        }
    }

    fn make_player(is_alive: bool, is_bot: bool, capital: Option<&str>) -> Player {
        Player {
            user_id: "p1".to_string(),
            is_alive,
            is_bot,
            capital_region_id: capital.map(|s| s.to_string()),
            ..Player::default()
        }
    }

    fn make_alive_player(id: &str, capital: Option<&str>) -> Player {
        Player {
            user_id: id.to_string(),
            is_alive: true,
            is_bot: false,
            capital_region_id: capital.map(|s| s.to_string()),
            ..Player::default()
        }
    }

    // -----------------------------------------------------------------------
    // region_to_json_no_sea
    // -----------------------------------------------------------------------

    #[test]
    fn region_to_json_no_sea_removes_sea_distances_field() {
        let mut region = Region::default();
        region.sea_distances = vec![serde_json::json!({"target": "r2", "distance_km": 100})];

        let val = region_to_json_no_sea(&region);

        assert!(
            val.get("sea_distances").is_none(),
            "sea_distances must be stripped"
        );
    }

    #[test]
    fn region_to_json_no_sea_preserves_owner_id() {
        let mut region = Region::default();
        region.owner_id = Some("player_abc".to_string());

        let val = region_to_json_no_sea(&region);

        assert_eq!(
            val["owner_id"].as_str(),
            Some("player_abc")
        );
    }

    #[test]
    fn region_to_json_no_sea_preserves_unit_count() {
        let mut region = Region::default();
        region.unit_count = 42;

        let val = region_to_json_no_sea(&region);

        assert_eq!(val["unit_count"].as_i64(), Some(42));
    }

    #[test]
    fn region_to_json_no_sea_preserves_is_capital_flag() {
        let mut region = Region::default();
        region.is_capital = true;

        let val = region_to_json_no_sea(&region);

        assert_eq!(val["is_capital"].as_bool(), Some(true));
    }

    #[test]
    fn region_to_json_no_sea_works_without_sea_distances() {
        let region = Region::default();
        let val = region_to_json_no_sea(&region);
        // Should still produce a valid object and not panic.
        assert!(val.is_object());
    }

    // -----------------------------------------------------------------------
    // compute_changed_regions
    // -----------------------------------------------------------------------

    #[test]
    fn compute_changed_regions_returns_empty_when_nothing_changed() {
        let mut regions: HashMap<String, Region> = HashMap::new();
        regions.insert("r1".to_string(), Region::default());

        let changed = compute_changed_regions(&regions, &regions.clone());

        assert!(changed.is_empty());
    }

    #[test]
    fn compute_changed_regions_detects_unit_count_change() {
        let before: HashMap<String, Region> = {
            let mut m = HashMap::new();
            m.insert("r1".to_string(), Region { unit_count: 5, ..Region::default() });
            m
        };
        let after: HashMap<String, Region> = {
            let mut m = HashMap::new();
            m.insert("r1".to_string(), Region { unit_count: 10, ..Region::default() });
            m
        };

        let changed = compute_changed_regions(&before, &after);

        assert!(changed.contains_key("r1"));
    }

    #[test]
    fn compute_changed_regions_detects_ownership_change() {
        let before: HashMap<String, Region> = {
            let mut m = HashMap::new();
            m.insert("r1".to_string(), make_region(None, false));
            m
        };
        let after: HashMap<String, Region> = {
            let mut m = HashMap::new();
            m.insert("r1".to_string(), make_region(Some("player1"), false));
            m
        };

        let changed = compute_changed_regions(&before, &after);

        assert!(changed.contains_key("r1"));
    }

    #[test]
    fn compute_changed_regions_includes_only_changed_regions() {
        let mut base = HashMap::new();
        base.insert("r1".to_string(), Region::default());
        base.insert("r2".to_string(), Region::default());

        let mut after = base.clone();
        after.insert("r2".to_string(), Region { unit_count: 99, ..Region::default() });

        let changed = compute_changed_regions(&base, &after);

        assert!(!changed.contains_key("r1"), "unchanged r1 should be absent");
        assert!(changed.contains_key("r2"), "changed r2 should be present");
    }

    #[test]
    fn compute_changed_regions_strips_sea_distances_from_output() {
        let before: HashMap<String, Region> = {
            let mut m = HashMap::new();
            m.insert("r1".to_string(), Region { unit_count: 1, ..Region::default() });
            m
        };
        let after: HashMap<String, Region> = {
            let mut m = HashMap::new();
            let mut r = Region { unit_count: 2, ..Region::default() };
            r.sea_distances = vec![serde_json::json!({"target": "r2"})];
            m.insert("r1".to_string(), r);
            m
        };

        let changed = compute_changed_regions(&before, &after);

        assert!(changed["r1"].get("sea_distances").is_none());
    }

    // -----------------------------------------------------------------------
    // is_capital_too_close
    // -----------------------------------------------------------------------

    #[test]
    fn is_capital_too_close_returns_false_when_no_capitals_exist() {
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        regions.insert("r2".to_string(), make_region(None, false));

        let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

        assert!(!is_capital_too_close("r1", 3, &regions, &neighbor_map));
    }

    #[test]
    fn is_capital_too_close_returns_true_when_adjacent_capital_within_min_dist() {
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        regions.insert("r2".to_string(), make_region(Some("p2"), true)); // capital

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);
        neighbor_map.insert("r2".to_string(), vec!["r1".to_string()]);

        // min_distance=3: r2 is 1 hop from r1, well within range
        assert!(is_capital_too_close("r1", 3, &regions, &neighbor_map));
    }

    #[test]
    fn is_capital_too_close_returns_false_when_capital_beyond_min_dist() {
        // r1 - r2 - r3 - r4 - r5(capital): 4 hops from r1, min_dist=3.
        // The BFS expands up to dist < 3, visiting nodes at dist 0,1,2.
        // r5 is at dist 4 — never reached by the BFS — so not flagged as too close.
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        regions.insert("r2".to_string(), make_region(None, false));
        regions.insert("r3".to_string(), make_region(None, false));
        regions.insert("r4".to_string(), make_region(None, false));
        regions.insert("r5".to_string(), make_region(Some("p2"), true));

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);
        neighbor_map.insert("r2".to_string(), vec!["r1".to_string(), "r3".to_string()]);
        neighbor_map.insert("r3".to_string(), vec!["r2".to_string(), "r4".to_string()]);
        neighbor_map.insert("r4".to_string(), vec!["r3".to_string(), "r5".to_string()]);
        neighbor_map.insert("r5".to_string(), vec!["r4".to_string()]);

        // r5 is 4 hops away (> min_dist=3) — should not be flagged as too close.
        assert!(!is_capital_too_close("r1", 3, &regions, &neighbor_map));
    }

    #[test]
    fn is_capital_too_close_returns_true_when_capital_exactly_at_min_dist_minus_one() {
        // r1 - r2 - r3(capital): 2 hops, min_dist=3 => too close
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        regions.insert("r2".to_string(), make_region(None, false));
        regions.insert("r3".to_string(), make_region(Some("p2"), true));

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);
        neighbor_map.insert("r2".to_string(), vec!["r1".to_string(), "r3".to_string()]);
        neighbor_map.insert("r3".to_string(), vec!["r2".to_string()]);

        assert!(is_capital_too_close("r1", 3, &regions, &neighbor_map));
    }

    #[test]
    fn is_capital_too_close_with_min_dist_zero_always_returns_false() {
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        regions.insert("r2".to_string(), make_region(Some("p2"), true));

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);

        // With min_distance=0 the BFS never expands, so nothing is "too close"
        assert!(!is_capital_too_close("r1", 0, &regions, &neighbor_map));
    }

    // -----------------------------------------------------------------------
    // resolve_disconnect_timeout_events
    // -----------------------------------------------------------------------

    #[test]
    fn resolve_disconnect_timeout_events_returns_empty_when_no_deadlines() {
        let mut players = HashMap::new();
        players.insert("p1".to_string(), make_player(true, false, None));

        let events = resolve_disconnect_timeout_events(&mut players);

        assert!(events.is_empty());
    }

    #[test]
    fn resolve_disconnect_timeout_events_skips_dead_players() {
        let past = 1i64; // UNIX timestamp in the past
        let mut players = HashMap::new();
        let mut p = make_player(false, false, None); // dead
        p.disconnect_deadline = Some(past);
        players.insert("p1".to_string(), p);

        let events = resolve_disconnect_timeout_events(&mut players);

        assert!(events.is_empty(), "dead players should not be timed out");
    }

    #[test]
    fn resolve_disconnect_timeout_events_skips_bots() {
        let past = 1i64;
        let mut players = HashMap::new();
        let mut p = make_player(true, true, None); // bot
        p.disconnect_deadline = Some(past);
        players.insert("bot1".to_string(), p);

        let events = resolve_disconnect_timeout_events(&mut players);

        assert!(events.is_empty(), "bots should not be timed out");
    }

    #[test]
    fn resolve_disconnect_timeout_events_eliminates_player_past_deadline() {
        let past = 1i64; // well in the past
        let mut players = HashMap::new();
        let mut p = make_player(true, false, None);
        p.disconnect_deadline = Some(past);
        players.insert("p1".to_string(), p);

        let events = resolve_disconnect_timeout_events(&mut players);

        let has_elimination = events.iter().any(|e| {
            matches!(e, Event::PlayerEliminated { player_id, .. } if player_id == "p1")
        });
        assert!(has_elimination);
    }

    #[test]
    fn resolve_disconnect_timeout_events_marks_player_dead_after_timeout() {
        let past = 1i64;
        let mut players = HashMap::new();
        let mut p = make_player(true, false, None);
        p.disconnect_deadline = Some(past);
        players.insert("p1".to_string(), p);

        resolve_disconnect_timeout_events(&mut players);

        assert!(!players["p1"].is_alive, "player should be marked dead");
    }

    #[test]
    fn resolve_disconnect_timeout_events_clears_deadline_after_timeout() {
        let past = 1i64;
        let mut players = HashMap::new();
        let mut p = make_player(true, false, None);
        p.disconnect_deadline = Some(past);
        players.insert("p1".to_string(), p);

        resolve_disconnect_timeout_events(&mut players);

        assert!(
            players["p1"].disconnect_deadline.is_none(),
            "deadline should be cleared after timeout"
        );
    }

    #[test]
    fn resolve_disconnect_timeout_events_emits_game_over_when_last_player_times_out() {
        let past = 1i64;
        let mut players = HashMap::new();
        let mut p = make_player(true, false, None);
        p.disconnect_deadline = Some(past);
        players.insert("p1".to_string(), p);

        let events = resolve_disconnect_timeout_events(&mut players);

        let has_game_over = events.iter().any(|e| matches!(e, Event::GameOver { .. }));
        assert!(has_game_over, "GameOver should be emitted when last player times out");
    }

    #[test]
    fn resolve_disconnect_timeout_events_no_game_over_when_two_players_survive() {
        // p1 times out; p2 and p3 remain alive → 2 alive players → no GameOver.
        let past = 1i64;
        let mut players = HashMap::new();

        let mut p1 = make_player(true, false, None);
        p1.disconnect_deadline = Some(past);

        let mut p2 = make_player(true, false, None);
        p2.user_id = "p2".to_string();
        // No deadline set — p2 stays alive indefinitely.

        let mut p3 = make_player(true, false, None);
        p3.user_id = "p3".to_string();

        players.insert("p1".to_string(), p1);
        players.insert("p2".to_string(), p2);
        players.insert("p3".to_string(), p3);

        let events = resolve_disconnect_timeout_events(&mut players);

        let has_game_over = events.iter().any(|e| matches!(e, Event::GameOver { .. }));
        assert!(!has_game_over, "game should not end while two players remain alive");
    }

    #[test]
    fn resolve_disconnect_timeout_events_skips_player_with_future_deadline() {
        let far_future = i64::MAX;
        let mut players = HashMap::new();
        let mut p = make_player(true, false, None);
        p.disconnect_deadline = Some(far_future);
        players.insert("p1".to_string(), p);

        let events = resolve_disconnect_timeout_events(&mut players);

        assert!(events.is_empty(), "future deadline should not be triggered");
    }

    // -----------------------------------------------------------------------
    // broadcast_to_match
    // -----------------------------------------------------------------------

    #[test]
    fn broadcast_to_match_sends_to_registered_sender() {
        let connections = new_game_connections();
        let (tx, mut rx) = mpsc::channel::<Message>(8);

        connections
            .entry("match1".to_string())
            .or_insert_with(DashMap::new)
            .entry("player1".to_string())
            .or_default()
            .push(tx);

        let msg = serde_json::json!({"type": "test", "value": 42});
        broadcast_to_match("match1", &msg, &connections);

        let received = rx.try_recv().expect("should have received a message");
        if let Message::Text(text) = received {
            let parsed: serde_json::Value = serde_json::from_str(&text).unwrap();
            assert_eq!(parsed["type"], "test");
            assert_eq!(parsed["value"], 42);
        } else {
            panic!("expected Text message");
        }
    }

    #[test]
    fn broadcast_to_match_does_nothing_for_unknown_match() {
        let connections = new_game_connections();
        let msg = serde_json::json!({"type": "test"});
        // Should not panic even when no match is registered.
        broadcast_to_match("nonexistent_match", &msg, &connections);
    }

    #[test]
    fn broadcast_to_match_sends_to_multiple_players() {
        let connections = new_game_connections();
        let (tx1, mut rx1) = mpsc::channel::<Message>(8);
        let (tx2, mut rx2) = mpsc::channel::<Message>(8);

        {
            let match_entry = connections
                .entry("match1".to_string())
                .or_insert_with(DashMap::new);
            match_entry
                .entry("p1".to_string())
                .or_default()
                .push(tx1);
            match_entry
                .entry("p2".to_string())
                .or_default()
                .push(tx2);
        }

        let msg = serde_json::json!({"type": "ping"});
        broadcast_to_match("match1", &msg, &connections);

        assert!(rx1.try_recv().is_ok(), "p1 should receive the message");
        assert!(rx2.try_recv().is_ok(), "p2 should receive the message");
    }

    #[test]
    fn broadcast_to_match_message_is_valid_json() {
        let connections = new_game_connections();
        let (tx, mut rx) = mpsc::channel::<Message>(8);

        connections
            .entry("m1".to_string())
            .or_insert_with(DashMap::new)
            .entry("p1".to_string())
            .or_default()
            .push(tx);

        let msg = serde_json::json!({"type": "game_tick", "tick": 5});
        broadcast_to_match("m1", &msg, &connections);

        if let Ok(Message::Text(text)) = rx.try_recv() {
            assert!(
                serde_json::from_str::<serde_json::Value>(&text).is_ok(),
                "broadcast payload must be valid JSON"
            );
        }
    }

    #[test]
    fn broadcast_to_match_does_not_send_to_different_match() {
        let connections = new_game_connections();
        let (tx, mut rx) = mpsc::channel::<Message>(8);

        connections
            .entry("match_A".to_string())
            .or_insert_with(DashMap::new)
            .entry("p1".to_string())
            .or_default()
            .push(tx);

        let msg = serde_json::json!({"type": "ping"});
        broadcast_to_match("match_B", &msg, &connections);

        assert!(
            rx.try_recv().is_err(),
            "player in match_A must not receive message sent to match_B"
        );
    }

    // -----------------------------------------------------------------------
    // new_game_connections
    // -----------------------------------------------------------------------

    #[test]
    fn new_game_connections_returns_empty_map() {
        let connections = new_game_connections();
        assert!(connections.is_empty());
    }

    // -----------------------------------------------------------------------
    // pick_random_capital_region
    // -----------------------------------------------------------------------

    #[test]
    fn pick_random_capital_region_returns_none_when_all_owned() {
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(Some("p1"), false));
        regions.insert("r2".to_string(), make_region(Some("p2"), false));
        let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

        let result = pick_random_capital_region(&regions, &neighbor_map, 3);

        assert!(result.is_none());
    }

    #[test]
    fn pick_random_capital_region_returns_some_when_unowned_region_exists() {
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(None, false));
        let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();

        let result = pick_random_capital_region(&regions, &neighbor_map, 3);

        assert!(result.is_some());
    }

    #[test]
    fn pick_random_capital_region_prefers_far_from_existing_capitals() {
        // Two unowned regions: r2 is directly adjacent to the capital r1,
        // r3 is 3 hops away. With min_dist=3 only r3 should qualify.
        let mut regions = HashMap::new();
        regions.insert("r1".to_string(), make_region(Some("p0"), true)); // existing capital
        regions.insert("r2".to_string(), make_region(None, false));      // adjacent = too close
        regions.insert("r3".to_string(), make_region(None, false));      // far enough

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);
        neighbor_map.insert("r2".to_string(), vec!["r1".to_string(), "r3".to_string()]);
        neighbor_map.insert("r3".to_string(), vec!["r2".to_string()]);

        // With min_dist=3, r2 is only 1 hop from capital, r3 is 2 hops — still within min_dist.
        // The function falls back to `available.first()` when none pass the distance check.
        let result = pick_random_capital_region(&regions, &neighbor_map, 3);
        assert!(result.is_some(), "should always return something when unowned regions exist");
    }

    // -----------------------------------------------------------------------
    // TokenQuery deserialization
    // -----------------------------------------------------------------------

    #[test]
    fn token_query_deserializes_all_fields() {
        let json = r#"{"token":"tok","ticket":"tkt","nonce":"non"}"#;
        let q: TokenQuery = serde_json::from_str(json).unwrap();

        assert_eq!(q.token.as_deref(), Some("tok"));
        assert_eq!(q.ticket.as_deref(), Some("tkt"));
        assert_eq!(q.nonce.as_deref(), Some("non"));
    }

    #[test]
    fn token_query_allows_missing_optional_fields() {
        let json = r#"{}"#;
        let q: TokenQuery = serde_json::from_str(json).unwrap();

        assert!(q.token.is_none());
        assert!(q.ticket.is_none());
        assert!(q.nonce.is_none());
    }

    #[test]
    fn token_query_partial_fields_are_allowed() {
        let json = r#"{"token":"only_token"}"#;
        let q: TokenQuery = serde_json::from_str(json).unwrap();

        assert_eq!(q.token.as_deref(), Some("only_token"));
        assert!(q.ticket.is_none());
        assert!(q.nonce.is_none());
    }

    // -----------------------------------------------------------------------
    // Alive player count checks (helper logic extracted from game logic)
    // -----------------------------------------------------------------------

    #[test]
    fn all_alive_players_have_capitals_when_all_assigned() {
        let mut players = HashMap::new();
        players.insert("p1".to_string(), make_alive_player("p1", Some("r1")));
        players.insert("p2".to_string(), make_alive_player("p2", Some("r2")));

        let alive_with_capitals = players
            .values()
            .filter(|p| p.is_alive && p.capital_region_id.is_some())
            .count();
        let alive_total = players.values().filter(|p| p.is_alive).count();

        assert_eq!(alive_with_capitals, alive_total);
    }

    #[test]
    fn not_all_alive_players_have_capitals_when_one_missing() {
        let mut players = HashMap::new();
        players.insert("p1".to_string(), make_alive_player("p1", Some("r1")));
        players.insert("p2".to_string(), make_alive_player("p2", None)); // no capital yet

        let all_have_capitals = players
            .values()
            .filter(|p| p.is_alive)
            .all(|p| p.capital_region_id.is_some());

        assert!(!all_have_capitals);
    }

    #[test]
    fn eliminated_players_are_excluded_from_alive_count() {
        let mut players = HashMap::new();
        players.insert("p1".to_string(), make_alive_player("p1", Some("r1")));
        let mut dead = make_alive_player("p2", None);
        dead.is_alive = false;
        players.insert("p2".to_string(), dead);

        let alive_count = players.values().filter(|p| p.is_alive).count();

        assert_eq!(alive_count, 1);
    }
}
