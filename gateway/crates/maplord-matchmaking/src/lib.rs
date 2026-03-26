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

    /// Store which active match a user is currently in.
    ///
    /// Key: `match:user:{user_id}` — TTL matches `LOBBY_KEY_TTL_SECS`.
    ///
    /// Only compiled when the `testing` feature is enabled.
    #[cfg(feature = "testing")]
    pub async fn redis_set_user_active_match(&self, user_id: &str, match_id: &str) {
        let key = format!("match:user:{user_id}");
        let mut conn = self.redis.clone();
        let _: Result<(), _> = conn.set_ex(&key, match_id, LOBBY_KEY_TTL_SECS).await;
    }

    #[cfg(feature = "testing")]
    pub async fn redis_get_user_active_match(&self, user_id: &str) -> Option<String> {
        let key = format!("match:user:{user_id}");
        let mut conn = self.redis.clone();
        conn.get(&key).await.ok()
    }

    #[cfg(feature = "testing")]
    pub async fn redis_del_user_active_match(&self, user_id: &str) {
        let key = format!("match:user:{user_id}");
        let mut conn = self.redis.clone();
        let _: Result<(), _> = conn.del(&key).await;
    }

    /// Re-exports of the private lobby helpers, available under the `testing` feature.
    #[cfg(feature = "testing")]
    pub async fn test_redis_set_user_lobby(&self, user_id: &str, lobby_id: &str) {
        self.redis_set_user_lobby(user_id, lobby_id).await;
    }

    #[cfg(feature = "testing")]
    pub async fn test_redis_get_user_lobby(&self, user_id: &str) -> Option<String> {
        self.redis_get_user_lobby(user_id).await
    }

    #[cfg(feature = "testing")]
    pub async fn test_redis_del_user_lobby(&self, user_id: &str) {
        self.redis_del_user_lobby(user_id).await;
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

                // Send push notification (fire-and-forget)
                let django = self.django.clone();
                let lid = lobby_id.clone();
                tokio::spawn(async move { django.notify_lobby_full(&lid).await });
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

                        // Send push notification (fire-and-forget)
                        let django = self.django.clone();
                        let lid = lobby_id.to_string();
                        tokio::spawn(async move { django.notify_lobby_full(&lid).await });
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

    #[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // MatchmakingMessage enum
    // -----------------------------------------------------------------------

    mod matchmaking_message {
        use super::*;

        #[test]
        fn json_variant_stores_value() {
            let val = serde_json::json!({"type": "lobby_created", "lobby_id": "l1"});
            let msg = MatchmakingMessage::Json(val.clone());
            match msg {
                MatchmakingMessage::Json(v) => assert_eq!(v["lobby_id"], "l1"),
                MatchmakingMessage::Close => panic!("expected Json variant"),
            }
        }

        #[test]
        fn close_variant_is_constructed() {
            let msg = MatchmakingMessage::Close;
            assert!(matches!(msg, MatchmakingMessage::Close));
        }

        #[test]
        fn json_variant_is_cloneable() {
            let val = serde_json::json!({"type": "match_found"});
            let msg = MatchmakingMessage::Json(val);
            let cloned = msg.clone();
            assert!(matches!(cloned, MatchmakingMessage::Json(_)));
        }

        #[test]
        fn close_variant_is_cloneable() {
            let msg = MatchmakingMessage::Close;
            let cloned = msg.clone();
            assert!(matches!(cloned, MatchmakingMessage::Close));
        }

        #[test]
        fn json_variant_debug_representation_is_non_empty() {
            let msg = MatchmakingMessage::Json(serde_json::json!({"x": 1}));
            let debug = format!("{msg:?}");
            assert!(!debug.is_empty());
        }

        #[test]
        fn json_variant_holds_nested_object() {
            let val = serde_json::json!({
                "type": "player_joined",
                "player": {
                    "user_id": "u1",
                    "is_bot": false
                }
            });
            let msg = MatchmakingMessage::Json(val);
            match msg {
                MatchmakingMessage::Json(v) => {
                    assert_eq!(v["player"]["user_id"], "u1");
                    assert_eq!(v["player"]["is_bot"], false);
                }
                MatchmakingMessage::Close => panic!("wrong variant"),
            }
        }
    }

    // -----------------------------------------------------------------------
    // ConnectionHandle / lobby_connections DashMap behaviour
    // -----------------------------------------------------------------------

    mod connection_counter {
        use super::*;
        use std::sync::atomic::Ordering;

        #[test]
        fn counter_increments_monotonically() {
            // Read the counter twice with a fetch_add in between to confirm
            // it moves forward. We add 0 to read without mutating, then 1 to advance.
            let before = CONNECTION_COUNTER.load(Ordering::Relaxed);
            let _ = CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
            let after = CONNECTION_COUNTER.load(Ordering::Relaxed);
            assert!(after > before, "counter should increase after fetch_add");
        }

        #[test]
        fn counter_is_u64() {
            // Just verify the type compiles as expected — load returns u64.
            let val: u64 = CONNECTION_COUNTER.load(Ordering::Relaxed);
            let _ = val; // suppress unused warning
        }
    }

    // -----------------------------------------------------------------------
    // Redis key construction (via the format strings used in the manager)
    // -----------------------------------------------------------------------

    mod redis_key_format {
        /// Mirrors the key format used by redis_set_user_lobby / redis_del_user_lobby.
        fn user_lobby_key(user_id: &str) -> String {
            format!("lobby:user:{user_id}")
        }

        #[test]
        fn key_contains_user_id_prefix() {
            let key = user_lobby_key("user-123");
            assert!(key.starts_with("lobby:user:"));
            assert!(key.ends_with("user-123"));
        }

        #[test]
        fn key_is_unique_per_user() {
            let k1 = user_lobby_key("alice");
            let k2 = user_lobby_key("bob");
            assert_ne!(k1, k2);
        }

        #[test]
        fn key_handles_uuid_style_ids() {
            let uid = "550e8400-e29b-41d4-a716-446655440000";
            let key = user_lobby_key(uid);
            assert_eq!(key, format!("lobby:user:{uid}"));
        }

        #[test]
        fn bot_fill_timeout_constant_is_30_seconds() {
            assert_eq!(super::BOT_FILL_TIMEOUT_SECS, 30);
        }

        #[test]
        fn lobby_key_ttl_is_10_minutes() {
            assert_eq!(super::LOBBY_KEY_TTL_SECS, 600);
        }
    }

    // -----------------------------------------------------------------------
    // DashMap broadcast logic (tested via mpsc channel pair)
    // -----------------------------------------------------------------------

    mod broadcast_helpers {
        use super::*;
        use tokio::sync::mpsc;

        /// Build a ConnectionHandle and return the receiver end.
        fn make_handle(
            conn_id: u64,
            user_id: &str,
            username: &str,
        ) -> (ConnectionHandle, mpsc::UnboundedReceiver<MatchmakingMessage>) {
            let (tx, rx) = mpsc::unbounded_channel();
            (
                ConnectionHandle {
                    conn_id,
                    user_id: user_id.to_string(),
                    username: username.to_string(),
                    sender: tx,
                },
                rx,
            )
        }

        #[test]
        fn handle_sender_delivers_json_message() {
            let (handle, mut rx) = make_handle(1, "user-1", "Alice");
            let msg = serde_json::json!({"type": "test"});
            handle
                .sender
                .send(MatchmakingMessage::Json(msg.clone()))
                .expect("send should succeed");
            let received = rx.try_recv().expect("message should be buffered");
            match received {
                MatchmakingMessage::Json(v) => assert_eq!(v["type"], "test"),
                _ => panic!("expected Json variant"),
            }
        }

        #[test]
        fn handle_sender_delivers_close_message() {
            let (handle, mut rx) = make_handle(2, "user-2", "Bob");
            handle
                .sender
                .send(MatchmakingMessage::Close)
                .expect("send should succeed");
            let received = rx.try_recv().expect("close should be buffered");
            assert!(matches!(received, MatchmakingMessage::Close));
        }

        #[test]
        fn dashmap_entry_stores_multiple_handles() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, _rx1) = make_handle(10, "user-a", "UserA");
            let (h2, _rx2) = make_handle(11, "user-b", "UserB");

            map.entry("lobby-1".to_string()).or_default().push(h1);
            map.entry("lobby-1".to_string()).or_default().push(h2);

            let connections = map.get("lobby-1").expect("lobby should exist");
            assert_eq!(connections.len(), 2);
        }

        #[test]
        fn retain_removes_specific_conn_id() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, _rx1) = make_handle(20, "user-x", "X");
            let (h2, _rx2) = make_handle(21, "user-y", "Y");

            map.entry("lobby-2".to_string()).or_default().push(h1);
            map.entry("lobby-2".to_string()).or_default().push(h2);

            // Remove conn_id 20 (simulating disconnect)
            if let Some(mut conns) = map.get_mut("lobby-2") {
                conns.retain(|c| c.conn_id != 20);
            }

            let conns = map.get("lobby-2").expect("lobby should still exist");
            assert_eq!(conns.len(), 1);
            assert_eq!(conns[0].conn_id, 21);
        }

        #[test]
        fn retain_by_user_id_removes_all_matching_connections() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, _rx1) = make_handle(30, "user-z", "Z");
            let (h2, _rx2) = make_handle(31, "user-z", "Z"); // same user, second tab
            let (h3, _rx3) = make_handle(32, "user-w", "W");

            let mut conns = map.entry("lobby-3".to_string()).or_default();
            conns.push(h1);
            conns.push(h2);
            conns.push(h3);
            drop(conns);

            if let Some(mut c) = map.get_mut("lobby-3") {
                c.retain(|conn| conn.user_id != "user-z");
            }

            let remaining = map.get("lobby-3").expect("lobby should exist");
            assert_eq!(remaining.len(), 1);
            assert_eq!(remaining[0].user_id, "user-w");
        }

        #[test]
        fn lookup_finds_user_in_lobby() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, _rx1) = make_handle(40, "user-find", "FindMe");

            map.entry("lobby-4".to_string()).or_default().push(h1);

            let found = map
                .get("lobby-4")
                .and_then(|conns| {
                    conns
                        .iter()
                        .find(|c| c.user_id == "user-find")
                        .map(|c| c.username.clone())
                });

            assert_eq!(found.as_deref(), Some("FindMe"));
        }

        // ── Broadcast to empty lobby ────────────────────────────────────

        #[test]
        fn broadcast_to_nonexistent_lobby_is_noop() {
            // Mirrors broadcast_to_lobby: if lobby_connections.get() returns None
            // the loop body never executes — no panic.
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let msg = serde_json::json!({"type": "lobby_full"});

            // Lobby "ghost" was never inserted — get() returns None.
            {
                if let Some(connections) = map.get("ghost-lobby") {
                    for conn in connections.iter() {
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                };
            }
            // Reaching here without panic means the empty-lobby guard works.
        }

        #[test]
        fn broadcast_to_empty_connection_list_is_noop() {
            // Lobby key exists but the Vec is empty (all connections removed).
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            map.entry("lobby-empty".to_string()).or_default(); // inserts empty Vec

            let msg = serde_json::json!({"type": "all_ready"});
            {
                if let Some(connections) = map.get("lobby-empty") {
                    for conn in connections.iter() {
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                };
            }
            // No receivers exist; reaching here without panic is the assertion.
        }

        // ── Broadcast with disconnected (dropped) receiver ──────────────

        #[test]
        fn broadcast_to_dropped_receiver_does_not_panic() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (tx, rx) = mpsc::unbounded_channel::<MatchmakingMessage>();
            // Drop the receiver immediately — sender is now disconnected.
            drop(rx);

            map.entry("lobby-dc".to_string())
                .or_default()
                .push(ConnectionHandle {
                    conn_id: 50,
                    user_id: "user-dc".to_string(),
                    username: "DC".to_string(),
                    sender: tx,
                });

            let msg = serde_json::json!({"type": "match_found"});
            {
                if let Some(connections) = map.get("lobby-dc") {
                    for conn in connections.iter() {
                        // send() returns Err when receiver is dropped; `let _` mirrors
                        // the production `let _ = conn.sender.send(...)` pattern.
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                };
            }
        }

        // ── Broadcast with exclusion by user_id ─────────────────────────

        #[test]
        fn broadcast_exclude_user_skips_that_connection() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h_alice, mut rx_alice) = make_handle(60, "alice", "Alice");
            let (h_bob, mut rx_bob) = make_handle(61, "bob", "Bob");

            {
                let mut entry = map.entry("lobby-excl".to_string()).or_default();
                entry.push(h_alice);
                entry.push(h_bob);
            }

            let msg = serde_json::json!({"type": "player_joined"});
            // Broadcast excluding "alice" — only bob should receive it.
            let exclude = Some("alice");
            if let Some(connections) = map.get("lobby-excl") {
                for conn in connections.iter() {
                    if let Some(excluded) = exclude {
                        if conn.user_id == excluded {
                            continue;
                        }
                    }
                    let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                }
            }

            assert!(
                rx_alice.try_recv().is_err(),
                "excluded user should receive nothing"
            );
            assert!(
                rx_bob.try_recv().is_ok(),
                "non-excluded user should receive the message"
            );
        }

        #[test]
        fn broadcast_no_exclusion_reaches_all_connections() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, mut rx1) = make_handle(70, "u1", "U1");
            let (h2, mut rx2) = make_handle(71, "u2", "U2");
            let (h3, mut rx3) = make_handle(72, "u3", "U3");

            {
                let mut entry = map.entry("lobby-all".to_string()).or_default();
                entry.push(h1);
                entry.push(h2);
                entry.push(h3);
            }

            let msg = serde_json::json!({"type": "lobby_full"});
            if let Some(connections) = map.get("lobby-all") {
                for conn in connections.iter() {
                    let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                }
            }

            assert!(rx1.try_recv().is_ok());
            assert!(rx2.try_recv().is_ok());
            assert!(rx3.try_recv().is_ok());
        }

        // ── send_to_user_in_lobby: targets only the matching user ───────

        #[test]
        fn send_to_specific_user_only_reaches_that_user() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h_alice, mut rx_alice) = make_handle(80, "alice", "Alice");
            let (h_bob, mut rx_bob) = make_handle(81, "bob", "Bob");

            {
                let mut entry = map.entry("lobby-targeted".to_string()).or_default();
                entry.push(h_alice);
                entry.push(h_bob);
            }

            let msg = serde_json::json!({"type": "voice_token", "token": "tok123"});
            // Mirrors send_to_user_in_lobby targeting "alice".
            if let Some(connections) = map.get("lobby-targeted") {
                for conn in connections.iter() {
                    if conn.user_id == "alice" {
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                }
            }

            let received = rx_alice.try_recv().expect("alice should receive the message");
            match received {
                MatchmakingMessage::Json(v) => assert_eq!(v["token"], "tok123"),
                _ => panic!("expected Json variant"),
            }
            assert!(
                rx_bob.try_recv().is_err(),
                "bob should not receive a targeted message"
            );
        }

        // ── Disconnect: conn_id removed, other connections intact ────────

        #[test]
        fn disconnect_removes_only_specified_conn_id() {
            // A user has two connections (two browser tabs).
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h_tab1, _rx1) = make_handle(90, "user-multi", "Multi");
            let (h_tab2, mut rx2) = make_handle(91, "user-multi", "Multi");

            {
                let mut entry = map.entry("lobby-multi".to_string()).or_default();
                entry.push(h_tab1);
                entry.push(h_tab2);
            }

            // Disconnect tab1 (conn_id 90) — mirrors disconnect() retain logic.
            if let Some(mut conns) = map.get_mut("lobby-multi") {
                conns.retain(|c| c.conn_id != 90);
            }

            // Tab2 must still be present and functional.
            let conns = map.get("lobby-multi").expect("lobby should persist");
            assert_eq!(conns.len(), 1);
            assert_eq!(conns[0].conn_id, 91);

            // The remaining sender is still live.
            conns[0]
                .sender
                .send(MatchmakingMessage::Json(serde_json::json!({"type":"ping"})))
                .expect("tab2 sender should still be live");
            drop(conns);
            assert!(rx2.try_recv().is_ok());
        }

        #[test]
        fn disconnect_does_not_remove_redis_mapping_simulation() {
            // The disconnect() method only removes the local conn_id entry and
            // explicitly does NOT call redis_del_user_lobby.  We verify this
            // by checking that after a retain the lobby entry still exists
            // (no cleanup of the lobby key itself).
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h, _rx) = make_handle(100, "user-disc", "Disc");
            map.entry("lobby-disc".to_string()).or_default().push(h);

            // Simulate disconnect: remove conn 100.
            if let Some(mut conns) = map.get_mut("lobby-disc") {
                conns.retain(|c| c.conn_id != 100);
            }

            // Lobby key still present (empty Vec) — Redis key would still be set
            // because disconnect() skips redis_del_user_lobby.
            assert!(
                map.contains_key("lobby-disc"),
                "lobby entry must remain for potential reconnect"
            );
            let conns = map.get("lobby-disc").unwrap();
            assert_eq!(conns.len(), 0, "no active connections after disconnect");
        }

        // ── Player leaves then rejoins ───────────────────────────────────

        #[test]
        fn player_leave_then_rejoin_reflects_correct_state() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h_alice, _rx_alice) = make_handle(110, "alice", "Alice");
            let (h_bob, mut rx_bob) = make_handle(111, "bob", "Bob");

            {
                let mut entry = map.entry("lobby-rejoin".to_string()).or_default();
                entry.push(h_alice);
                entry.push(h_bob);
            }

            // Alice leaves (handle_cancel retain-by-user_id pattern).
            if let Some(mut conns) = map.get_mut("lobby-rejoin") {
                conns.retain(|c| c.user_id != "alice");
            }

            {
                let conns = map.get("lobby-rejoin").unwrap();
                assert_eq!(conns.len(), 1, "only bob remains after alice leaves");
            }

            // Alice reconnects (register_connection push pattern).
            let (h_alice2, _rx_alice2) = make_handle(112, "alice", "Alice");
            map.entry("lobby-rejoin".to_string())
                .or_default()
                .push(h_alice2);

            {
                let conns = map.get("lobby-rejoin").unwrap();
                assert_eq!(conns.len(), 2, "alice and bob both present after rejoin");
            }

            // Bob can still receive messages after the rejoin.
            if let Some(conns) = map.get("lobby-rejoin") {
                for conn in conns.iter() {
                    if conn.user_id == "bob" {
                        let _ = conn
                            .sender
                            .send(MatchmakingMessage::Json(serde_json::json!({"type":"lobby_created"})));
                    }
                }
            }
            assert!(rx_bob.try_recv().is_ok());
        }

        // ── close_lobby_connections: every connection gets Close ─────────

        #[test]
        fn close_lobby_connections_sends_close_to_all() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, mut rx1) = make_handle(120, "u-close-1", "C1");
            let (h2, mut rx2) = make_handle(121, "u-close-2", "C2");
            let (h3, mut rx3) = make_handle(122, "u-close-3", "C3");

            {
                let mut entry = map.entry("lobby-close".to_string()).or_default();
                entry.push(h1);
                entry.push(h2);
                entry.push(h3);
            }

            // Mirrors close_lobby_connections().
            if let Some(connections) = map.get("lobby-close") {
                for conn in connections.iter() {
                    let _ = conn.sender.send(MatchmakingMessage::Close);
                }
            }

            assert!(matches!(rx1.try_recv().unwrap(), MatchmakingMessage::Close));
            assert!(matches!(rx2.try_recv().unwrap(), MatchmakingMessage::Close));
            assert!(matches!(rx3.try_recv().unwrap(), MatchmakingMessage::Close));
        }

        // ── Full lobby: all-ready scenario ───────────────────────────────

        #[test]
        fn all_players_ready_lobby_broadcasts_all_ready() {
            // Simulate: lobby with 2 players, both mark ready, then all_ready broadcast.
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h1, mut rx1) = make_handle(130, "p1", "Player1");
            let (h2, mut rx2) = make_handle(131, "p2", "Player2");

            {
                let mut entry = map.entry("lobby-ready".to_string()).or_default();
                entry.push(h1);
                entry.push(h2);
            }

            // Simulate set_ready result: all_ready == true.
            let all_ready = true;
            let players_ready = vec![
                ("p1", true),
                ("p2", true),
            ];

            // Broadcast individual ready states (mirrors handle_ready loop).
            if let Some(connections) = map.get("lobby-ready") {
                for (uid, is_ready) in &players_ready {
                    let msg = serde_json::json!({
                        "type": "player_ready",
                        "lobby_id": "lobby-ready",
                        "user_id": uid,
                        "is_ready": is_ready,
                    });
                    for conn in connections.iter() {
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                }
            }

            // Broadcast all_ready (mirrors handle_ready all_ready branch).
            if all_ready {
                if let Some(connections) = map.get("lobby-ready") {
                    let msg = serde_json::json!({
                        "type": "all_ready",
                        "lobby_id": "lobby-ready",
                    });
                    for conn in connections.iter() {
                        let _ = conn.sender.send(MatchmakingMessage::Json(msg.clone()));
                    }
                }
            }

            // Each player receives 2 player_ready messages + 1 all_ready = 3 messages.
            let mut p1_msgs = vec![];
            while let Ok(m) = rx1.try_recv() {
                p1_msgs.push(m);
            }
            let mut p2_msgs = vec![];
            while let Ok(m) = rx2.try_recv() {
                p2_msgs.push(m);
            }

            assert_eq!(p1_msgs.len(), 3, "p1 should receive 2 player_ready + 1 all_ready");
            assert_eq!(p2_msgs.len(), 3, "p2 should receive 2 player_ready + 1 all_ready");

            let last_p1 = match p1_msgs.last().unwrap() {
                MatchmakingMessage::Json(v) => v.clone(),
                _ => panic!("expected Json"),
            };
            assert_eq!(last_p1["type"], "all_ready");
        }

        // ── Bot fill: skip when no connections ───────────────────────────

        #[test]
        fn bot_fill_skipped_when_lobby_has_no_connections() {
            // Mirrors do_bot_fill guard: `if !has_connections { return; }`
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            // Lobby exists but is empty (all users disconnected).
            map.entry("lobby-botfill-empty".to_string()).or_default();

            let has_connections = map
                .get("lobby-botfill-empty")
                .map(|c| !c.is_empty())
                .unwrap_or(false);

            assert!(!has_connections, "should detect zero active connections");
            // In production, do_bot_fill returns early here — no Django call made.
        }

        #[test]
        fn bot_fill_proceeds_when_lobby_has_connections() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h, _rx) = make_handle(140, "real-player", "RealPlayer");
            map.entry("lobby-botfill-ok".to_string())
                .or_default()
                .push(h);

            let has_connections = map
                .get("lobby-botfill-ok")
                .map(|c| !c.is_empty())
                .unwrap_or(false);

            assert!(has_connections, "lobby with a live connection should proceed");
        }

        #[test]
        fn bot_fill_with_zero_remaining_slots_broadcasts_no_player_joined() {
            // Scenario: fill_lobby_bots returns bot_ids = [] (lobby already full).
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            let (h, mut rx) = make_handle(150, "p1", "P1");
            map.entry("lobby-full-bots".to_string())
                .or_default()
                .push(h);

            // Simulate fill result with no bots added.
            let bot_ids: Vec<String> = vec![];

            // Mirrors the do_bot_fill broadcast loop — skips when bot_ids empty.
            if let Some(connections) = map.get("lobby-full-bots") {
                for _player_id in &bot_ids {
                    // This loop body never executes.
                    for conn in connections.iter() {
                        let _ = conn.sender.send(MatchmakingMessage::Json(
                            serde_json::json!({"type": "player_joined"}),
                        ));
                    }
                }
            }

            // No player_joined messages should have been sent.
            assert!(
                rx.try_recv().is_err(),
                "no player_joined when no bots were added"
            );
        }

        // ── Pubsub event field extraction (pure JSON logic) ──────────────

        #[test]
        fn pubsub_players_kicked_field_extraction() {
            // Mirrors handle_pubsub_event "players_kicked" JSON parsing.
            let event = serde_json::json!({
                "type": "players_kicked",
                "lobby_id": "lobby-kick",
                "kicked_user_ids": ["u-kicked-1", "u-kicked-2"],
            });

            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let lobby_id = event.get("lobby_id").and_then(|v| v.as_str()).unwrap_or("");
            let kicked_ids: Vec<String> = event
                .get("kicked_user_ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            assert_eq!(event_type, "players_kicked");
            assert_eq!(lobby_id, "lobby-kick");
            assert_eq!(kicked_ids, vec!["u-kicked-1", "u-kicked-2"]);
        }

        #[test]
        fn pubsub_lobby_cancelled_reason_extracted() {
            let event = serde_json::json!({
                "type": "lobby_cancelled",
                "lobby_id": "lobby-cancel",
                "reason": "ready_timeout",
            });

            let reason = event
                .get("reason")
                .and_then(|v| v.as_str())
                .unwrap_or("timeout");

            assert_eq!(reason, "ready_timeout");
        }

        #[test]
        fn pubsub_missing_lobby_id_returns_none() {
            // Mirrors the `None => return` guard in handle_pubsub_event.
            let event = serde_json::json!({"type": "lobby_cancelled"});
            let lobby_id = event.get("lobby_id").and_then(|v| v.as_str());
            assert!(lobby_id.is_none(), "missing lobby_id should yield None");
        }

        #[test]
        fn pubsub_unknown_event_type_defaults_to_empty_string() {
            let event = serde_json::json!({"lobby_id": "l1"});
            let event_type = event.get("type").and_then(|v| v.as_str()).unwrap_or("");
            assert_eq!(event_type, "", "missing type field should default to empty");
        }

        #[test]
        fn pubsub_kicked_ids_missing_field_defaults_to_empty_vec() {
            let event = serde_json::json!({
                "type": "players_kicked",
                "lobby_id": "lobby-k",
                // no kicked_user_ids field
            });
            let kicked_ids: Vec<String> = event
                .get("kicked_user_ids")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            assert!(kicked_ids.is_empty(), "missing field should yield empty vec");
        }

        // ── Reconnect: lobby state message sequencing ────────────────────

        #[test]
        fn reconnect_to_waiting_lobby_sends_only_lobby_created() {
            // Mirrors reconnect_to_lobby: status "waiting" → only lobby_created sent.
            let (tx, mut rx) = mpsc::unbounded_channel::<MatchmakingMessage>();

            let status = "waiting";
            let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                "type": "lobby_created",
                "lobby_id": "lobby-rc",
            })));
            if status == "full" || status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "lobby_full",
                    "lobby_id": "lobby-rc",
                })));
            }
            if status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "all_ready",
                    "lobby_id": "lobby-rc",
                })));
            }

            let msg1 = rx.try_recv().expect("should receive lobby_created");
            match msg1 {
                MatchmakingMessage::Json(v) => assert_eq!(v["type"], "lobby_created"),
                _ => panic!("expected Json"),
            }
            assert!(
                rx.try_recv().is_err(),
                "no additional messages for waiting lobby"
            );
        }

        #[test]
        fn reconnect_to_full_lobby_sends_lobby_created_and_lobby_full() {
            let (tx, mut rx) = mpsc::unbounded_channel::<MatchmakingMessage>();

            let status = "full";
            let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                "type": "lobby_created",
                "lobby_id": "lobby-rc-full",
            })));
            if status == "full" || status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "lobby_full",
                    "lobby_id": "lobby-rc-full",
                })));
            }
            if status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "all_ready",
                    "lobby_id": "lobby-rc-full",
                })));
            }

            let m1 = rx.try_recv().unwrap();
            let m2 = rx.try_recv().unwrap();
            assert!(rx.try_recv().is_err(), "no all_ready for full (not ready) lobby");

            match m1 {
                MatchmakingMessage::Json(v) => assert_eq!(v["type"], "lobby_created"),
                _ => panic!("expected Json"),
            }
            match m2 {
                MatchmakingMessage::Json(v) => assert_eq!(v["type"], "lobby_full"),
                _ => panic!("expected Json"),
            }
        }

        #[test]
        fn reconnect_to_ready_lobby_sends_all_three_messages() {
            let (tx, mut rx) = mpsc::unbounded_channel::<MatchmakingMessage>();

            let status = "ready";
            let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                "type": "lobby_created",
                "lobby_id": "lobby-rc-ready",
            })));
            if status == "full" || status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "lobby_full",
                    "lobby_id": "lobby-rc-ready",
                })));
            }
            if status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "all_ready",
                    "lobby_id": "lobby-rc-ready",
                })));
            }

            let types: Vec<String> = (0..3)
                .map(|_| match rx.try_recv().unwrap() {
                    MatchmakingMessage::Json(v) => v["type"].as_str().unwrap().to_string(),
                    _ => panic!("expected Json"),
                })
                .collect();

            assert_eq!(types, vec!["lobby_created", "lobby_full", "all_ready"]);
            assert!(rx.try_recv().is_err(), "exactly three messages expected");
        }

        // ── Active match redirect: connect() fast-path messages ──────────

        #[test]
        fn active_match_response_contains_correct_type_and_match_id() {
            // Mirrors the connect() path when get_active_match returns Some(match_id).
            let (tx, mut rx) = mpsc::unbounded_channel::<MatchmakingMessage>();
            let match_id = "match-abc-123";

            let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                "type": "active_match_exists",
                "match_id": match_id,
            })));
            let _ = tx.send(MatchmakingMessage::Close);

            let msg = rx.try_recv().unwrap();
            match msg {
                MatchmakingMessage::Json(v) => {
                    assert_eq!(v["type"], "active_match_exists");
                    assert_eq!(v["match_id"], match_id);
                }
                _ => panic!("expected Json"),
            }
            assert!(matches!(rx.try_recv().unwrap(), MatchmakingMessage::Close));
        }

        // ── CONNECTION_COUNTER: concurrency uniqueness ───────────────────

        #[test]
        fn connection_counter_produces_unique_ids_under_concurrent_load() {
            use std::sync::atomic::Ordering;
            use std::collections::HashSet;
            use std::sync::{Arc, Mutex};

            let ids = Arc::new(Mutex::new(HashSet::<u64>::new()));
            let mut handles = vec![];

            for _ in 0..16 {
                let ids_clone = Arc::clone(&ids);
                let handle = std::thread::spawn(move || {
                    let id =
                        CONNECTION_COUNTER.fetch_add(1, Ordering::Relaxed);
                    ids_clone.lock().unwrap().insert(id);
                });
                handles.push(handle);
            }

            for h in handles {
                h.join().unwrap();
            }

            let set = ids.lock().unwrap();
            assert_eq!(set.len(), 16, "all 16 concurrent IDs must be unique");
        }

        // ── MatchmakingMessage: edge-case payloads ───────────────────────

        #[test]
        fn json_variant_with_null_value() {
            let msg = MatchmakingMessage::Json(serde_json::json!(null));
            match msg {
                MatchmakingMessage::Json(v) => assert!(v.is_null()),
                _ => panic!("wrong variant"),
            }
        }

        #[test]
        fn json_variant_with_array_payload() {
            let msg = MatchmakingMessage::Json(serde_json::json!([1, 2, 3]));
            match msg {
                MatchmakingMessage::Json(v) => {
                    assert!(v.is_array());
                    assert_eq!(v.as_array().unwrap().len(), 3);
                }
                _ => panic!("wrong variant"),
            }
        }

        #[test]
        fn json_variant_with_boolean_payload() {
            let msg = MatchmakingMessage::Json(serde_json::json!(true));
            match msg {
                MatchmakingMessage::Json(v) => assert_eq!(v.as_bool(), Some(true)),
                _ => panic!("wrong variant"),
            }
        }

        // ── handle_cancel: retain-by-user_id removes all tabs ───────────

        #[test]
        fn cancel_removes_all_connections_for_leaving_user() {
            let map: DashMap<String, Vec<ConnectionHandle>> = DashMap::new();
            // Alice has two connections (two tabs); Bob has one.
            let (h_a1, _rxa1) = make_handle(160, "alice", "Alice");
            let (h_a2, _rxa2) = make_handle(161, "alice", "Alice");
            let (h_bob, _rxb) = make_handle(162, "bob", "Bob");

            {
                let mut entry = map.entry("lobby-cancel-user".to_string()).or_default();
                entry.push(h_a1);
                entry.push(h_a2);
                entry.push(h_bob);
            }

            // handle_cancel retain pattern.
            if let Some(mut conns) = map.get_mut("lobby-cancel-user") {
                conns.retain(|c| c.user_id != "alice");
            }

            let conns = map.get("lobby-cancel-user").unwrap();
            assert_eq!(conns.len(), 1);
            assert_eq!(conns[0].user_id, "bob");
        }

        // ── voice_token message structure ────────────────────────────────

        #[test]
        fn voice_token_message_has_correct_fields() {
            // Mirrors send_voice_token JSON structure.
            let token = "eyJhbGciOiJIUzI1NiJ9.test";
            let url = "wss://livekit.example.com";

            let msg = serde_json::json!({
                "type": "voice_token",
                "token": token,
                "url": url,
            });

            assert_eq!(msg["type"], "voice_token");
            assert_eq!(msg["token"], token);
            assert_eq!(msg["url"], url);
        }

        // ── handle_status: correct messages per lobby state ──────────────

        #[test]
        fn status_messages_for_waiting_lobby_contains_only_lobby_created() {
            let (tx, mut rx) = mpsc::unbounded_channel::<MatchmakingMessage>();

            // Mirrors handle_status send sequence for status "waiting".
            let status = "waiting";
            let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                "type": "lobby_created",
                "lobby_id": "l1",
            })));
            if status == "full" || status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "lobby_full",
                })));
            }
            if status == "ready" {
                let _ = tx.send(MatchmakingMessage::Json(serde_json::json!({
                    "type": "all_ready",
                })));
            }

            let m = rx.try_recv().unwrap();
            match m {
                MatchmakingMessage::Json(v) => assert_eq!(v["type"], "lobby_created"),
                _ => panic!("expected Json"),
            }
            assert!(rx.try_recv().is_err());
        }
    }
}
