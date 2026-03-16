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
        let msg = json!({"type": "game_state", "state": full_state});
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

    // Send LiveKit voice chat token
    {
        let config = state.config.clone();
        let mid = match_id.clone();
        let uid = user_id.clone();
        let tx_voice = tx.clone();
        let state_voice = state.clone();
        tokio::spawn(async move {
            let username = crate::chat::resolve_username(&state_voice, &uid).await;
            match crate::voice::generate_voice_token(
                &config.livekit_api_key,
                &config.livekit_api_secret,
                &mid,
                &uid,
                &username,
            ) {
                Ok(token) => {
                    let msg = json!({
                        "type": "voice_token",
                        "token": token,
                        "url": config.livekit_public_url,
                    });
                    let _ = tx_voice.send(Message::Text(msg.to_string().into()));
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

    // Rate limit game actions (not chat/leave_match/set_tick_multiplier)
    if matches!(
        action,
        "attack" | "move" | "build" | "produce_unit" | "use_ability" | "select_capital"
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
        "attack" | "move" | "build" | "produce_unit" | "use_ability" => {
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

    if alive_players
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

    let engine = GameEngine::new(settings.clone(), neighbor_map.clone());
    let mut anticheat = AnticheatEngine::new(match_id.to_string(), state_mgr.redis());
    let snapshot_interval = 30u64;
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
            let game_over_msg = json!({
                "type": "game_tick",
                "tick": tick,
                "events": [{"type": "game_over", "winner_id": winner_id}],
                "regions": {},
                "players": tick_data.players,
                "buildings_queue": tick_data.buildings_queue,
                "unit_queue": tick_data.unit_queue,
                "transit_queue": tick_data.transit_queue,
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
                );
                tick_data.actions.extend(bot_actions);
            }
        }

        // Anti-cheat analysis (pre-tick)
        let ac_verdict = anticheat
            .analyze_tick(
                &tick_data.actions,
                tick,
                &tick_data.regions,
                &tick_data.players,
                &neighbor_map,
            )
            .await;

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
                    "active_effects": tick_data.active_effects,
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

        let mut events = engine.process_tick(
            &mut tick_data.players,
            &mut tick_data.regions,
            &tick_data.actions,
            &mut tick_data.buildings_queue,
            &mut tick_data.unit_queue,
            &mut tick_data.transit_queue,
            tick,
            &mut tick_data.active_effects,
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
                &tick_data.active_effects,
                Some(&dirty_ids),
            )
            .await?;

        // Set alive state in DB for eliminated players
        for event in &events {
            if let Event::PlayerEliminated { player_id, .. } = event {
                let _ = state.django.set_player_alive(match_id, player_id, false).await;
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
            "active_effects": tick_data.active_effects,
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
                        );
                        extra_tick.actions.extend(bot_actions);
                    }
                }

                let extra_timeout_events = resolve_disconnect_timeout_events(&mut extra_tick.players);
                if !extra_timeout_events.is_empty() {
                    state_mgr.set_players_bulk(&extra_tick.players).await?;
                }

                let extra_regions_before = extra_tick.regions.clone();

                let mut extra_events = engine.process_tick(
                    &mut extra_tick.players,
                    &mut extra_tick.regions,
                    &extra_tick.actions,
                    &mut extra_tick.buildings_queue,
                    &mut extra_tick.unit_queue,
                    &mut extra_tick.transit_queue,
                    extra_tick_num,
                    &mut extra_tick.active_effects,
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
                    &extra_tick.active_effects,
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
                    "active_effects": extra_tick.active_effects,
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
    let tick_msg = json!({
        "type": "game_tick",
        "tick": current_tick,
        "events": events,
        "regions": regions,
        "players": players,
        "buildings_queue": state_mgr.get_all_buildings().await.unwrap_or_default(),
        "unit_queue": state_mgr.get_all_unit_queue().await.unwrap_or_default(),
        "transit_queue": state_mgr.get_all_transit_queue().await.unwrap_or_default(),
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
        .set_meta_field("disconnect_grace_seconds", "180")
        .await?;
    if match_data.is_tutorial {
        state_mgr.set_meta_field("is_tutorial", "1").await?;
    }

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
            cosmetics: p.cosmetics.clone(),
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
            },
        );
    }
    state_mgr.set_regions_bulk(&regions).await?;

    // Auto-select capitals for bot players (skip for tutorial — bot picks after human)
    let is_tutorial_init = state_mgr
        .get_meta()
        .await
        .unwrap_or_default()
        .get("is_tutorial")
        .map(|v| v == "1")
        .unwrap_or(false);
    if !is_tutorial_init {
        auto_select_bot_capitals(state_mgr, state).await?;
    }

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

    // BFS from human's capital to find closest unowned region that respects min_dist
    let mut visited = HashSet::new();
    visited.insert(human_capital_id.to_string());
    let mut queue = VecDeque::new();
    queue.push_back((human_capital_id.to_string(), 0usize));

    let mut best_region: Option<String> = None;

    while let Some((current, dist)) = queue.pop_front() {
        // Check if this region is a valid capital location
        if dist >= min_dist {
            if let Some(r) = regions.get(&current) {
                if r.owner_id.is_none() {
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

    // Assign capital to each bot
    for bot_id in &bot_ids {
        let region_id = match &best_region {
            Some(id) => id.clone(),
            None => {
                // Fallback: any unowned region
                match regions.iter().find(|(_, r)| r.owner_id.is_none()) {
                    Some((id, _)) => id.clone(),
                    None => continue,
                }
            }
        };

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

    let tick_msg = json!({
        "type": "game_tick",
        "tick": current_tick,
        "events": [Event::GameOver { winner_id: winner_id.clone() }],
        "regions": {},
        "players": players,
        "buildings_queue": state_mgr.get_all_buildings().await.unwrap_or_default(),
        "unit_queue": state_mgr.get_all_unit_queue().await.unwrap_or_default(),
        "transit_queue": state_mgr.get_all_transit_queue().await.unwrap_or_default(),
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
