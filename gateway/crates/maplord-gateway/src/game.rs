use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use dashmap::DashMap;
use maplord_engine::{Action, Event, GameEngine, GameSettings, Player, Region};
use maplord_state::GameStateManager;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tracing::{error, info};

/// Per-match connection registry: match_id -> (player_id -> Vec<sender>)
pub type GameConnections =
    Arc<DashMap<String, DashMap<String, Vec<mpsc::UnboundedSender<Message>>>>>;

pub fn new_game_connections() -> GameConnections {
    Arc::new(DashMap::new())
}

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
}

use serde::Deserialize;

pub async fn ws_game_handler(
    ws: WebSocketUpgrade,
    Path(match_id): Path<String>,
    State(state): State<AppState>,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
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

    ws.on_upgrade(move |socket| handle_game_socket(socket, match_id, user_id, state))
}

async fn handle_game_socket(socket: WebSocket, match_id: String, user_id: String, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Verify player membership
    match state.django.verify_player(&match_id, &user_id).await {
        Ok(true) => {}
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
        return;
    }

    // Mark player connected
    if let Err(e) = mark_player_connected(&state_mgr, &user_id).await {
        error!("Failed to mark player connected: {e}");
        return;
    }

    // Create channel for outgoing messages
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

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
        let _ = tx.send(Message::Text(msg.to_string().into()));
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

async fn handle_game_message(
    content: &serde_json::Value,
    state_mgr: &GameStateManager,
    user_id: &str,
    match_id: &str,
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
) {
    let action = content.get("action").and_then(|v| v.as_str()).unwrap_or("");

    match action {
        "select_capital" => {
            handle_select_capital(content, state_mgr, user_id, match_id, state, tx).await;
        }
        "leave_match" => {
            eliminate_player(state_mgr, user_id, "left_match", match_id, state).await;
            let _ = tx.send(Message::Text(
                json!({"type": "match_left"}).to_string().into(),
            ));
            let _ = tx.send(Message::Close(Some(axum::extract::ws::CloseFrame {
                code: 4000,
                reason: "Left match".into(),
            })));
        }
        "attack" | "move" | "build" | "produce_unit" => {
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
        _ => {}
    }
}

async fn handle_select_capital(
    content: &serde_json::Value,
    state_mgr: &GameStateManager,
    user_id: &str,
    match_id: &str,
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
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
        let _ = tx.send(Message::Text(
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
            let _ = tx.send(Message::Text(
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
            let _ = tx.send(Message::Text(
                json!({"type": "error", "message": "Już wybrałeś stolicę"})
                    .to_string()
                    .into(),
            ));
            return Ok(());
        }

        let region = match state_mgr.get_region(&region_id).await? {
            Some(r) => r,
            None => {
                let _ = tx.send(Message::Text(
                    json!({"type": "error", "message": "Region nie istnieje"})
                        .to_string()
                        .into(),
                ));
                return Ok(());
            }
        };

        if region.owner_id.is_some() {
            let _ = tx.send(Message::Text(
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
            let _ = tx.send(Message::Text(
                json!({"type": "error", "message": format!("Stolica musi być co najmniej {min_dist} regiony od stolicy innego gracza")})
                    .to_string()
                    .into(),
            ));
            return Ok(());
        }

        // Set capital
        let mut player = player;
        player.capital_region_id = Some(region_id.clone());
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
                    broadcast_to_match(
                        match_id,
                        &json!({"type": "error", "message": "Chwilowy błąd serwera, wznawianie gry..."}),
                        &state.game_connections,
                    );
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

    let engine = GameEngine::new(settings, neighbor_map);
    let snapshot_interval = 30u64;
    let mut next_tick_at = tokio::time::Instant::now() + tick_interval;

    loop {
        tokio::time::sleep_until(next_tick_at).await;
        let tick_start = tokio::time::Instant::now();

        let mut tick_data = state_mgr.get_tick_data().await?;
        let tick = tick_data.tick;

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
        });
        broadcast_to_match(match_id, &tick_msg, &state.game_connections);

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
            // Serialize region but strip sea_distances
            let mut val = serde_json::to_value(region).unwrap_or_default();
            if let Some(obj) = val.as_object_mut() {
                obj.remove("sea_distances");
            }
            changed.insert(rid.clone(), val);
        }
    }
    changed
}

fn resolve_disconnect_timeout_events(players: &mut HashMap<String, Player>) -> Vec<Event> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;
    let mut events = Vec::new();

    for (player_id, player) in players.iter_mut() {
        if !player.is_alive {
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
                region.buildings.clear();
                region.building_type = None;
                region.defense_bonus = 0.0;
                region.vision_range = 0;
                region.unit_generation_bonus = 0.0;
                region.currency_generation_bonus = 0.0;
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

    let winner_id = if alive.len() == 1 {
        Some(alive[0].clone())
    } else {
        None
    };

    if winner_id.is_some() || alive.is_empty() {
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
        .set_meta_field("starting_currency", &settings.starting_currency.to_string())
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

    // Set up players
    let mut players = HashMap::new();
    for p in &match_data.players {
        let player = Player {
            user_id: p.user_id.clone(),
            username: p.username.clone(),
            color: p.color.clone(),
            is_alive: true,
            connected: false,
            disconnect_deadline: None,
            left_match_at: None,
            eliminated_reason: None,
            eliminated_tick: None,
            capital_region_id: None,
            currency: settings.starting_currency,
            currency_accum: 0.0,
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
                buildings: HashMap::new(),
                defense_bonus: 0.0,
                vision_range: 0,
                unit_generation_bonus: 0.0,
                currency_generation_bonus: 0.0,
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

    Ok(())
}

async fn mark_player_connected(
    state_mgr: &GameStateManager,
    user_id: &str,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut player = match state_mgr.get_player(user_id).await? {
        Some(p) => p,
        None => return Err("Player not found".into()),
    };

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

    if !player.is_alive {
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
                let _ = sender.send(Message::Text(text.clone().into()));
            }
        }
    }
}
