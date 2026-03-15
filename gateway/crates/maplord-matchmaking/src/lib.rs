use dashmap::DashMap;
use maplord_django::DjangoClient;
use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// How long to wait before filling with bots (seconds).
const BOT_FILL_TIMEOUT_SECS: u64 = 30;

/// Redis key TTL for lobby mappings (10 minutes).
const LOBBY_KEY_TTL_SECS: u64 = 600;

/// Message sent to a matchmaking WebSocket connection.
#[derive(Debug, Clone)]
pub enum MatchmakingMessage {
    Json(serde_json::Value),
    Close,
}

/// Unique ID for each WebSocket connection.
static CONNECTION_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Per-connection handle stored in the lobby map.
struct ConnectionHandle {
    conn_id: u64,
    user_id: String,
    username: String,
    sender: mpsc::UnboundedSender<MatchmakingMessage>,
}

/// Manages matchmaking WebSocket connections organized by lobby.
///
/// - `lobby_connections` (DashMap): lobby_id → WS connection handles (local, ephemeral)
/// - Redis `lobby:user:{user_id}` → lobby_id (persisted, survives reconnect)
/// - Django DB is the source of truth for lobby state (players, status, etc.)
pub struct MatchmakingManager {
    lobby_connections: DashMap<String, Vec<ConnectionHandle>>,
    django: DjangoClient,
    redis: ConnectionManager,
}

impl MatchmakingManager {
    pub fn new(django: DjangoClient, redis: ConnectionManager) -> Self {
        Self {
            lobby_connections: DashMap::new(),
            django,
            redis,
        }
    }

    // ── Redis helpers ────────────────────────────────────────────────

    async fn redis_set_user_lobby(&self, user_id: &str, lobby_id: &str) {
        let key = format!("lobby:user:{user_id}");
        let mut conn = self.redis.clone();
        let _: Result<(), _> = conn.set_ex(&key, lobby_id, LOBBY_KEY_TTL_SECS).await;
    }

    async fn redis_get_user_lobby(&self, user_id: &str) -> Option<String> {
        let key = format!("lobby:user:{user_id}");
        let mut conn = self.redis.clone();
        conn.get(&key).await.ok()
    }

    async fn redis_del_user_lobby(&self, user_id: &str) {
        let key = format!("lobby:user:{user_id}");
        let mut conn = self.redis.clone();
        let _: Result<(), _> = conn.del(&key).await;
    }

    // ── Connect ──────────────────────────────────────────────────────

    /// Handle a new matchmaking WebSocket connection.
    /// Returns (receiver, conn_id).
    pub async fn connect(
        self: &Arc<Self>,
        user_id: &str,
        username: &str,
        game_mode: Option<&str>,
    ) -> Result<(mpsc::UnboundedReceiver<MatchmakingMessage>, u64), String> {
        let (tx, rx) = mpsc::unbounded_channel();
        let conn_id = CONNECTION_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

        // 1. Check for active match first
        match self.django.get_active_match(user_id).await {
            Ok(Some(match_id)) => {
                let _ = self.django.remove_from_queue(user_id).await;
                let _ = tx.send(MatchmakingMessage::Json(json!({
                    "type": "active_match_exists",
                    "match_id": match_id,
                })));
                let _ = tx.send(MatchmakingMessage::Close);
                return Ok((rx, conn_id));
            }
            Ok(None) => {}
            Err(e) => warn!("Failed to check active match for {user_id}: {e}"),
        }

        // 2. Check for active lobby — first Redis (fast), then Django (authoritative)
        let active_lobby = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => Some(lid),
            None => {
                // Redis miss — check Django
                match self.django.get_active_lobby(user_id).await {
                    Ok(Some(lid)) => {
                        // Re-populate Redis
                        self.redis_set_user_lobby(user_id, &lid).await;
                        Some(lid)
                    }
                    Ok(None) => None,
                    Err(e) => {
                        warn!("Failed to check active lobby for {user_id}: {e}");
                        None
                    }
                }
            }
        };

        if let Some(lobby_id) = active_lobby {
            info!("User {user_id} reconnecting to lobby {lobby_id}");
            return self.reconnect_to_lobby(user_id, username, &lobby_id, tx, rx, conn_id).await;
        }

        // 3. Add to Django queue
        if let Err(e) = self.django.add_to_queue(user_id, game_mode).await {
            warn!("Failed to add {user_id} to queue: {e}");
        }

        // 4. Find or create lobby
        let lobby_id = self.find_or_create_lobby(user_id, game_mode, &tx).await?;

        // 5. Register
        self.register_connection(user_id, username, &lobby_id, tx, conn_id).await;

        Ok((rx, conn_id))
    }

    async fn reconnect_to_lobby(
        &self,
        user_id: &str,
        username: &str,
        lobby_id: &str,
        tx: mpsc::UnboundedSender<MatchmakingMessage>,
        rx: mpsc::UnboundedReceiver<MatchmakingMessage>,
        conn_id: u64,
    ) -> Result<(mpsc::UnboundedReceiver<MatchmakingMessage>, u64), String> {
        // Get lobby state from Django and send full state to user
        match self.django.get_lobby(lobby_id).await {
            Ok(state) => {
                let _ = tx.send(MatchmakingMessage::Json(json!({
                    "type": "lobby_created",
                    "lobby_id": state.lobby_id,
                    "max_players": state.max_players,
                    "players": state.players,
                    "created_at": state.created_at,
                })));
                if state.status == "full" || state.status == "ready" {
                    let _ = tx.send(MatchmakingMessage::Json(json!({
                        "type": "lobby_full",
                        "lobby_id": state.lobby_id,
                        "players": state.players,
                        "full_at": state.full_at,
                    })));
                }
                if state.status == "ready" {
                    let _ = tx.send(MatchmakingMessage::Json(json!({
                        "type": "all_ready",
                        "lobby_id": state.lobby_id,
                    })));
                }
            }
            Err(e) => {
                warn!("Failed to get lobby state for reconnect: {e}");
                // Still register — handle_status will deliver state later
            }
        }

        self.register_connection(user_id, username, lobby_id, tx, conn_id).await;
        Ok((rx, conn_id))
    }

    async fn register_connection(
        &self,
        user_id: &str,
        username: &str,
        lobby_id: &str,
        tx: mpsc::UnboundedSender<MatchmakingMessage>,
        conn_id: u64,
    ) {
        self.lobby_connections
            .entry(lobby_id.to_string())
            .or_default()
            .push(ConnectionHandle {
                conn_id,
                user_id: user_id.to_string(),
                username: username.to_string(),
                sender: tx,
            });
        self.redis_set_user_lobby(user_id, lobby_id).await;
    }

    // ── Find / Create lobby ──────────────────────────────────────────

    async fn find_or_create_lobby(
        &self,
        user_id: &str,
        game_mode: Option<&str>,
        tx: &mpsc::UnboundedSender<MatchmakingMessage>,
    ) -> Result<String, String> {
        // Single atomic Django call: find waiting lobby + join, or create new one.
        // Uses select_for_update(skip_locked=True) to prevent race conditions.
        let result = self.django.find_or_create_lobby(user_id, game_mode).await
            .map_err(|e| format!("Failed to find or create lobby: {e}"))?;

        let lobby_id = result.lobby_id.clone();

        // Send lobby state to this user
        let created_at = self.django.get_lobby(&lobby_id).await
            .ok().and_then(|s| s.created_at);
        let _ = tx.send(MatchmakingMessage::Json(json!({
            "type": "lobby_created",
            "lobby_id": result.lobby_id,
            "max_players": result.max_players,
            "players": result.players,
            "created_at": created_at,
        })));

        if result.created {
            info!("Created lobby {lobby_id} for user {user_id}");
        } else {
            info!("User {user_id} joined lobby {lobby_id}");

            // Broadcast player_joined to existing members
            let uname = self.django.get_user(user_id).await
                .map(|u| u.username)
                .unwrap_or_else(|_| user_id.to_string());

            self.broadcast_to_lobby(&lobby_id, &json!({
                "type": "player_joined",
                "lobby_id": lobby_id,
                "player": {
                    "user_id": user_id,
                    "username": uname,
                    "is_bot": false,
                    "is_ready": false,
                },
            }), Some(user_id));

            // If lobby is now full, broadcast to everyone
            if result.status == "full" {
                let full_msg = json!({
                    "type": "lobby_full",
                    "lobby_id": lobby_id,
                    "players": result.players,
                    "full_at": result.full_at,
                });
                self.broadcast_to_lobby(&lobby_id, &full_msg, None);
                // Also send to joining user (not yet in lobby_connections)
                let _ = tx.send(MatchmakingMessage::Json(full_msg));
            }
        }

        Ok(lobby_id)
    }

    // ── Broadcast helpers ────────────────────────────────────────────

    fn broadcast_to_lobby(&self, lobby_id: &str, msg: &serde_json::Value, exclude_user: Option<&str>) {
        if let Some(connections) = self.lobby_connections.get(lobby_id) {
            for conn in connections.iter() {
                if let Some(excluded) = exclude_user {
                    if conn.user_id == excluded {
                        continue;
                    }
                }
                let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
            }
        }
    }

    fn send_to_user_in_lobby(&self, lobby_id: &str, user_id: &str, msg: &serde_json::Value) {
        if let Some(connections) = self.lobby_connections.get(lobby_id) {
            for conn in connections.iter() {
                if conn.user_id == user_id {
                    let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                }
            }
        }
    }

    // ── Disconnect ───────────────────────────────────────────────────

    /// Handle WS disconnection (page refresh, network drop).
    /// Only removes this specific conn_id from local state.
    /// Does NOT remove from Django lobby or Redis — user may reconnect.
    pub async fn disconnect(&self, user_id: &str, _game_mode: Option<&str>, conn_id: u64) {
        // Find lobby from Redis (DashMap may not have it)
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };

        // Remove only this specific connection
        if let Some(mut connections) = self.lobby_connections.get_mut(&lobby_id) {
            connections.retain(|c| c.conn_id != conn_id);
        }

        // Don't remove Redis mapping — user may reconnect
    }

    // ── Cancel (explicit leave) ──────────────────────────────────────

    pub async fn handle_cancel(&self, user_id: &str, _game_mode: Option<&str>) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };

        // Leave lobby in Django
        match self.django.leave_lobby(&lobby_id, user_id).await {
            Ok(result) => {
                if result.cancelled {
                    self.broadcast_to_lobby(&lobby_id, &json!({
                        "type": "lobby_cancelled",
                        "lobby_id": lobby_id,
                        "reason": "host_left",
                    }), Some(user_id));
                    self.close_lobby_connections(&lobby_id);
                    // Clean up Redis for all remaining users
                    if let Some(connections) = self.lobby_connections.get(&lobby_id) {
                        for conn in connections.iter() {
                            self.redis_del_user_lobby(&conn.user_id).await;
                        }
                    }
                } else {
                    // Non-host left — broadcast player_left + send updated lobby state
                    self.broadcast_to_lobby(&lobby_id, &json!({
                        "type": "player_left",
                        "lobby_id": lobby_id,
                        "user_id": user_id,
                    }), None);
                    // Send full updated state so remaining players see reset
                    if let Ok(state) = self.django.get_lobby(&lobby_id).await {
                        self.broadcast_to_lobby(&lobby_id, &json!({
                            "type": "lobby_created",
                            "lobby_id": state.lobby_id,
                            "max_players": state.max_players,
                            "players": state.players,
                        }), None);
                    }
                }
            }
            Err(e) => warn!("Failed to leave lobby for cancel: {e}"),
        }

        // Send confirmation and close to the leaving user
        self.send_to_user_in_lobby(&lobby_id, user_id, &json!({"type": "queue_left"}));
        if let Some(connections) = self.lobby_connections.get(&lobby_id) {
            for conn in connections.iter() {
                if conn.user_id == user_id {
                    let _ = conn.sender.send(MatchmakingMessage::Close);
                }
            }
        }

        // Clean up local + Redis for leaving user
        if let Some(mut connections) = self.lobby_connections.get_mut(&lobby_id) {
            connections.retain(|c| c.user_id != user_id);
        }
        self.redis_del_user_lobby(user_id).await;
        let _ = self.django.remove_from_queue(user_id).await;
    }

    // ── Ready ────────────────────────────────────────────────────────

    pub async fn handle_ready(&self, user_id: &str, _game_mode: Option<&str>) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };

        // Check current ready state to toggle
        let currently_ready = self.django.get_lobby(&lobby_id).await
            .ok()
            .map(|state| state.players.iter().any(|p| p.user_id == user_id && p.is_ready))
            .unwrap_or(false);
        let new_ready = !currently_ready;

        match self.django.set_ready(&lobby_id, user_id, new_ready).await {
            Ok(result) => {
                // Broadcast ready state for all players (bots may have auto-readied)
                for player in &result.players {
                    self.broadcast_to_lobby(&lobby_id, &json!({
                        "type": "player_ready",
                        "lobby_id": lobby_id,
                        "user_id": player.user_id,
                        "is_ready": player.is_ready,
                    }), None);
                }

                if new_ready && result.all_ready {
                    self.broadcast_to_lobby(&lobby_id, &json!({
                        "type": "all_ready",
                        "lobby_id": lobby_id,
                    }), None);
                    self.start_match(&lobby_id).await;
                }
            }
            Err(e) => warn!("Failed to set ready for {user_id} in lobby {lobby_id}: {e}"),
        }
    }

    // ── Status ───────────────────────────────────────────────────────

    pub async fn handle_status(&self, user_id: &str, _game_mode: Option<&str>) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };

        match self.django.get_lobby(&lobby_id).await {
            Ok(state) => {
                self.send_to_user_in_lobby(&lobby_id, user_id, &json!({
                    "type": "lobby_created",
                    "lobby_id": state.lobby_id,
                    "max_players": state.max_players,
                    "players": state.players,
                    "created_at": state.created_at,
                }));
                if state.status == "full" || state.status == "ready" {
                    self.send_to_user_in_lobby(&lobby_id, user_id, &json!({
                        "type": "lobby_full",
                        "lobby_id": state.lobby_id,
                        "players": state.players,
                        "full_at": state.full_at,
                    }));
                }
                if state.status == "ready" {
                    self.send_to_user_in_lobby(&lobby_id, user_id, &json!({
                        "type": "all_ready",
                        "lobby_id": state.lobby_id,
                    }));
                }
            }
            Err(e) => warn!("Failed to get lobby state for status: {e}"),
        }
    }

    // ── Bot fill ─────────────────────────────────────────────────────

    pub async fn request_bot_fill(self: &Arc<Self>, game_mode: Option<&str>) {
        let gm = game_mode.map(|s| s.to_string());
        let mgr = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(BOT_FILL_TIMEOUT_SECS)).await;
            mgr.do_bot_fill_for_game_mode(gm.as_deref()).await;
        });
    }

    pub async fn request_bot_fill_for_lobby(self: &Arc<Self>, user_id: &str) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };
        let mgr = Arc::clone(self);
        info!("Bot fill requested for lobby {lobby_id}, waiting {BOT_FILL_TIMEOUT_SECS}s");
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_secs(BOT_FILL_TIMEOUT_SECS)).await;
            mgr.do_bot_fill(&lobby_id).await;
        });
    }

    pub async fn instant_bot_fill(&self, _game_mode: Option<&str>) {
        // No-op — use instant_bot_fill_for_lobby instead
    }

    pub async fn instant_bot_fill_for_lobby(&self, user_id: &str) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };
        info!("Instant bot fill for lobby {lobby_id}");
        self.do_bot_fill(&lobby_id).await;
    }

    async fn do_bot_fill_for_game_mode(&self, _game_mode: Option<&str>) {
        for entry in self.lobby_connections.iter() {
            let lobby_id = entry.key().clone();
            if !entry.value().is_empty() {
                self.do_bot_fill(&lobby_id).await;
                return;
            }
        }
    }

    async fn do_bot_fill(&self, lobby_id: &str) {
        let has_connections = self.lobby_connections
            .get(lobby_id)
            .map(|c| !c.is_empty())
            .unwrap_or(false);

        if !has_connections {
            info!("Bot fill skipped for lobby {lobby_id}: no connections");
            return;
        }

        match self.django.fill_lobby_bots(lobby_id).await {
            Ok(result) => {
                info!("Bots added to lobby {lobby_id}: {:?}", result.bot_ids);

                for player in &result.players {
                    if result.bot_ids.contains(&player.user_id) {
                        self.broadcast_to_lobby(lobby_id, &json!({
                            "type": "player_joined",
                            "lobby_id": lobby_id,
                            "player": {
                                "user_id": player.user_id,
                                "username": player.username,
                                "is_bot": true,
                                "is_ready": true,
                            },
                        }), None);
                    }
                }

                let all_ready = result.players.iter().all(|p| p.is_ready);
                if let Ok(state) = self.django.get_lobby(lobby_id).await {
                    if state.status == "full" || state.status == "ready" {
                        self.broadcast_to_lobby(lobby_id, &json!({
                            "type": "lobby_full",
                            "lobby_id": lobby_id,
                            "players": state.players,
                        }), None);
                    }
                    if state.status == "ready" || all_ready {
                        self.broadcast_to_lobby(lobby_id, &json!({
                            "type": "all_ready",
                            "lobby_id": lobby_id,
                        }), None);
                        self.start_match(lobby_id).await;
                    }
                }
            }
            Err(e) => warn!("Failed to fill bots for lobby {lobby_id}: {e}"),
        }
    }

    // ── Start match ──────────────────────────────────────────────────

    async fn start_match(&self, lobby_id: &str) {
        match self.django.start_match_from_lobby(lobby_id).await {
            Ok(result) => {
                if let Some(match_id) = result.match_id {
                    info!("Match {match_id} started from lobby {lobby_id}");

                    self.broadcast_to_lobby(lobby_id, &json!({
                        "type": "match_starting",
                        "match_id": match_id,
                    }), None);

                    self.broadcast_to_lobby(lobby_id, &json!({
                        "type": "match_found",
                        "match_id": match_id,
                    }), None);

                    // Clean up Redis for all users in this lobby
                    if let Some(connections) = self.lobby_connections.get(lobby_id) {
                        for conn in connections.iter() {
                            self.redis_del_user_lobby(&conn.user_id).await;
                        }
                    }

                    self.close_lobby_connections(lobby_id);
                    self.lobby_connections.remove(lobby_id);
                }
            }
            Err(e) => warn!("Failed to start match from lobby {lobby_id}: {e}"),
        }
    }

    fn close_lobby_connections(&self, lobby_id: &str) {
        if let Some(connections) = self.lobby_connections.get(lobby_id) {
            for conn in connections.iter() {
                let _ = conn.sender.send(MatchmakingMessage::Close);
            }
        }
    }

    // ── Chat ─────────────────────────────────────────────────────────

    pub async fn handle_chat_message(&self, user_id: &str, content: &str) {
        let lobby_id = match self.redis_get_user_lobby(user_id).await {
            Some(lid) => lid,
            None => return,
        };

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        let username = self.lobby_connections
            .get(&lobby_id)
            .and_then(|conns| {
                conns.iter()
                    .find(|c| c.user_id == user_id)
                    .map(|c| c.username.clone())
            })
            .unwrap_or_else(|| user_id.to_string());

        self.broadcast_to_lobby(&lobby_id, &json!({
            "type": "lobby_chat_message",
            "user_id": user_id,
            "username": username,
            "content": content,
            "timestamp": timestamp,
        }), None);
    }

    // ── Accessors ────────────────────────────────────────────────────

    pub async fn get_user_lobby_id(&self, user_id: &str) -> Option<String> {
        self.redis_get_user_lobby(user_id).await
    }

    pub fn send_voice_token(&self, user_id: &str, lobby_id: &str, token: &str, url: &str) {
        self.send_to_user_in_lobby(lobby_id, user_id, &json!({
            "type": "voice_token",
            "token": token,
            "url": url,
        }));
    }

    // ── Pub/Sub event handler ────────────────────────────────────────

    /// Handle an event from Redis pub/sub (published by Django/Celery).
    async fn handle_pubsub_event(&self, event: serde_json::Value) {
        let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let lobby_id = match event.get("lobby_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => return,
        };

        info!("Pub/sub event: {event_type} for lobby {lobby_id}");

        match event_type {
            "players_kicked" => {
                let kicked_ids: Vec<String> = event
                    .get("kicked_user_ids")
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                // Notify kicked players and close their connections
                for uid in &kicked_ids {
                    self.send_to_user_in_lobby(&lobby_id, uid, &json!({
                        "type": "lobby_cancelled",
                        "lobby_id": lobby_id,
                        "reason": "ready_timeout",
                    }));
                    // Close their WS
                    if let Some(connections) = self.lobby_connections.get(&lobby_id) {
                        for conn in connections.iter() {
                            if conn.user_id == *uid {
                                let _ = conn.sender.send(MatchmakingMessage::Close);
                            }
                        }
                    }
                    // Clean up Redis mapping
                    self.redis_del_user_lobby(uid).await;
                }

                // Remove kicked connections from local state
                if let Some(mut connections) = self.lobby_connections.get_mut(&lobby_id) {
                    connections.retain(|c| !kicked_ids.contains(&c.user_id));
                }

                // Send updated lobby state to remaining players
                if let Ok(state) = self.django.get_lobby(&lobby_id).await {
                    self.broadcast_to_lobby(&lobby_id, &json!({
                        "type": "lobby_created",
                        "lobby_id": state.lobby_id,
                        "max_players": state.max_players,
                        "players": state.players,
                        "created_at": state.created_at,
                    }), None);
                }
            }
            "lobby_cancelled" => {
                self.broadcast_to_lobby(&lobby_id, &json!({
                    "type": "lobby_cancelled",
                    "lobby_id": lobby_id,
                    "reason": event.get("reason").and_then(|v| v.as_str()).unwrap_or("timeout"),
                }), None);
                self.close_lobby_connections(&lobby_id);

                // Clean up Redis for all users
                if let Some((_, connections)) = self.lobby_connections.remove(&lobby_id) {
                    for conn in &connections {
                        self.redis_del_user_lobby(&conn.user_id).await;
                    }
                }
            }
            _ => {
                warn!("Unknown pub/sub event type: {event_type}");
            }
        }
    }

    /// Spawn a background task that subscribes to Redis pub/sub for lobby events.
    pub fn spawn_pubsub_listener(self: &Arc<Self>, redis_url: &str) {
        let mgr = Arc::clone(self);
        let url = redis_url.to_string();

        tokio::spawn(async move {
            loop {
                match Self::run_pubsub_loop(&mgr, &url).await {
                    Ok(_) => info!("Pub/sub loop ended, reconnecting..."),
                    Err(e) => error!("Pub/sub error: {e}, reconnecting in 2s..."),
                }
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            }
        });
    }

    async fn run_pubsub_loop(mgr: &Arc<Self>, redis_url: &str) -> Result<(), String> {
        let client = redis::Client::open(redis_url)
            .map_err(|e| format!("Redis client error: {e}"))?;
        let mut conn = client.get_async_pubsub().await
            .map_err(|e| format!("Redis pubsub error: {e}"))?;

        conn.subscribe("lobby:events").await
            .map_err(|e| format!("Subscribe error: {e}"))?;

        info!("Subscribed to lobby:events pub/sub channel");

        let mut stream = conn.on_message();
        use futures::StreamExt;

        while let Some(msg) = stream.next().await {
            let payload: String = match msg.get_payload() {
                Ok(p) => p,
                Err(e) => {
                    warn!("Failed to get pub/sub payload: {e}");
                    continue;
                }
            };

            match serde_json::from_str::<serde_json::Value>(&payload) {
                Ok(event) => mgr.handle_pubsub_event(event).await,
                Err(e) => warn!("Failed to parse pub/sub event: {e}"),
            }
        }

        Ok(())
    }
}
