use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use futures::StreamExt;
use futures::SinkExt;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::mpsc;
use tracing::{error, info, warn};

/// Social connection registry: user_id -> Vec<sender>
pub type SocialConnections = Arc<dashmap::DashMap<String, Vec<mpsc::UnboundedSender<Message>>>>;

pub fn new_social_connections() -> SocialConnections {
    Arc::new(dashmap::DashMap::new())
}

#[derive(Deserialize)]
pub(crate) struct TokenQuery {
    token: Option<String>,
    ticket: Option<String>,
    nonce: Option<String>,
}

pub async fn ws_social_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
    if let Err(resp) = auth::check_origin(&headers, &state.config.allowed_ws_origins) {
        return resp;
    }

    // Authenticate via query params: token (JWT) or ticket (one-time Redis ticket).
    let pre_auth_user_id = if let Some(token) = &query.token {
        match auth::validate_token(token, &state.config.secret_key) {
            Ok(uid) => Some(uid),
            Err(_) => None,
        }
    } else if let Some(ticket) = &query.ticket {
        match auth::validate_ticket(
            ticket,
            query.nonce.as_deref(),
            &mut state.redis.clone(),
        )
        .await
        {
            Ok(uid) => Some(uid),
            Err(e) => {
                tracing::warn!("Ticket validation failed: {e}");
                None
            }
        }
    } else {
        None
    };

    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| handle_social_socket(socket, pre_auth_user_id, state))
}

async fn handle_social_socket(
    socket: WebSocket,
    pre_auth_user_id: Option<String>,
    state: AppState,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Authenticate — either from pre-validated query param or first-message auth frame.
    let user_id = match crate::ws_auth::authenticate_ws(
        &mut ws_receiver,
        pre_auth_user_id,
        &state.config.secret_key,
    )
    .await
    {
        Some(uid) => uid,
        None => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4001,
                    reason: "Authentication failed".into(),
                })))
                .await;
            return;
        }
    };

    info!("Social: user {user_id} connected");

    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Register sender in SocialConnections
    state
        .social_connections
        .entry(user_id.clone())
        .or_default()
        .push(tx);

    // Spawn outgoing message forwarder
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Receive task: this is a push-only channel, so we only need to watch for
    // close frames or errors to detect disconnection.
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            if let Message::Close(_) = msg {
                break;
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Cleanup: remove closed senders for this user
    if let Some(mut senders) = state.social_connections.get_mut(&user_id) {
        senders.retain(|s| !s.is_closed());
    }
    // Remove empty entry
    state
        .social_connections
        .remove_if(&user_id, |_, v| v.is_empty());

    info!("Social: user {user_id} disconnected");
}

/// Set a player's activity status in Redis with a 1-hour TTL.
///
/// The key `player:status:{user_id}` stores a JSON string with status details.
/// Django reads this key in its `activity_status` property.
pub async fn set_player_status(redis: &mut redis::aio::ConnectionManager, user_id: &str, status: &serde_json::Value) {
    use redis::AsyncCommands;
    let key = format!("player:status:{user_id}");
    let _: Result<(), _> = redis.set_ex::<_, _, ()>(&key, status.to_string(), 3600).await;
}

/// Remove the player's activity status key from Redis.
///
/// Called when the player leaves a queue or a match so Django shows them as
/// plain "online" (or offline if they also close the social socket).
pub async fn clear_player_status(redis: &mut redis::aio::ConnectionManager, user_id: &str) {
    use redis::AsyncCommands;
    let key = format!("player:status:{user_id}");
    let _: Result<(), _> = redis.del(&key).await;
}

/// Send a JSON payload to all WebSocket connections for the given user.
pub fn send_to_user(user_id: &str, msg: &serde_json::Value, connections: &SocialConnections) {
    if let Some(senders) = connections.get(user_id) {
        let text = msg.to_string();
        for sender in senders.value().iter() {
            let _ = sender.send(Message::Text(text.clone().into()));
        }
    }
}

/// Spawn a background task that subscribes to the `social:events` Redis pub/sub channel and
/// forwards events to the relevant user's WebSocket connections.
///
/// Expected message format published by Django:
/// ```json
/// {
///   "type": "notification",  // or "direct_message"
///   "user_id": "target-user-uuid",
///   "payload": { ... }
/// }
/// ```
pub fn spawn_social_pubsub(redis_url: String, connections: SocialConnections) {
    tokio::spawn(async move {
        loop {
            match run_social_pubsub_loop(&redis_url, &connections).await {
                Ok(_) => info!("Social pub/sub loop ended, reconnecting..."),
                Err(e) => error!("Social pub/sub error: {e}, reconnecting in 2s..."),
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        }
    });
}

async fn run_social_pubsub_loop(
    redis_url: &str,
    connections: &SocialConnections,
) -> Result<(), String> {
    let client =
        redis::Client::open(redis_url).map_err(|e| format!("Redis client error: {e}"))?;
    let mut conn = client
        .get_async_pubsub()
        .await
        .map_err(|e| format!("Redis pubsub error: {e}"))?;

    conn.subscribe("social:events")
        .await
        .map_err(|e| format!("Subscribe error: {e}"))?;

    info!("Social: subscribed to social:events pub/sub channel");

    let mut stream = conn.on_message();

    while let Some(msg) = stream.next().await {
        let payload: String = match msg.get_payload() {
            Ok(p) => p,
            Err(e) => {
                warn!("Social: failed to decode pub/sub message payload: {e}");
                continue;
            }
        };

        let event: serde_json::Value = match serde_json::from_str(&payload) {
            Ok(v) => v,
            Err(e) => {
                warn!("Social: failed to parse pub/sub event as JSON: {e}");
                continue;
            }
        };

        let user_id = match event.get("user_id").and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => {
                warn!("Social: pub/sub event missing 'user_id' field");
                continue;
            }
        };

        let event_type = match event.get("type").and_then(|v| v.as_str()) {
            Some(t) => t.to_string(),
            None => {
                warn!("Social: pub/sub event missing 'type' field");
                continue;
            }
        };

        let inner_payload = match event.get("payload") {
            Some(p) => p.clone(),
            None => {
                warn!("Social: pub/sub event missing 'payload' field");
                continue;
            }
        };

        // Forward the full envelope (type + payload) so the client can dispatch
        let envelope = serde_json::json!({
            "type": event_type,
            "payload": inner_payload,
        });

        info!("Social: forwarding {event_type} event to user {user_id}");
        send_to_user(&user_id, &envelope, connections);
    }

    Err("Social pub/sub stream ended unexpectedly".to_string())
}

// ---------------------------------------------------------------------------
// Unit tests — pure logic only, no WebSocket or Redis connections needed.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // new_social_connections
    // -----------------------------------------------------------------------

    mod new_social_connections_tests {
        use super::*;

        #[test]
        fn creates_empty_registry() {
            let conns = new_social_connections();
            assert!(conns.is_empty(), "new registry must be empty");
        }

        #[test]
        fn can_insert_and_retrieve_a_sender() {
            let conns = new_social_connections();
            let (tx, _rx) = mpsc::unbounded_channel::<Message>();

            conns
                .entry("user-1".to_string())
                .or_default()
                .push(tx);

            assert!(conns.contains_key("user-1"));
        }

        #[test]
        fn supports_multiple_senders_per_user() {
            let conns = new_social_connections();
            let (tx1, _rx1) = mpsc::unbounded_channel::<Message>();
            let (tx2, _rx2) = mpsc::unbounded_channel::<Message>();

            {
                let mut entry = conns.entry("user-1".to_string()).or_default();
                entry.push(tx1);
                entry.push(tx2);
            }

            let count = conns.get("user-1").map(|v| v.len()).unwrap_or(0);
            assert_eq!(count, 2, "should store two senders for the same user");
        }

        #[test]
        fn multiple_users_are_stored_independently() {
            let conns = new_social_connections();
            let (tx1, _) = mpsc::unbounded_channel::<Message>();
            let (tx2, _) = mpsc::unbounded_channel::<Message>();

            conns.entry("user-1".to_string()).or_default().push(tx1);
            conns.entry("user-2".to_string()).or_default().push(tx2);

            assert_eq!(conns.len(), 2);
            assert!(conns.contains_key("user-1"));
            assert!(conns.contains_key("user-2"));
        }
    }

    // -----------------------------------------------------------------------
    // send_to_user
    // -----------------------------------------------------------------------

    mod send_to_user_tests {
        use super::*;

        #[test]
        fn delivers_message_to_registered_user() {
            let conns = new_social_connections();
            let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

            conns.entry("user-42".to_string()).or_default().push(tx);

            let payload = serde_json::json!({"type": "notification", "text": "hello"});
            send_to_user("user-42", &payload, &conns);

            let received = rx.try_recv().expect("should have received a message");
            if let Message::Text(text) = received {
                let parsed: serde_json::Value =
                    serde_json::from_str(&text).expect("must be valid JSON");
                assert_eq!(parsed["type"], "notification");
                assert_eq!(parsed["text"], "hello");
            } else {
                panic!("expected a Text message");
            }
        }

        #[test]
        fn no_panic_for_unknown_user() {
            let conns = new_social_connections();
            let payload = serde_json::json!({"type": "notification"});
            // Must not panic when the user is not registered
            send_to_user("no-such-user", &payload, &conns);
        }

        #[test]
        fn delivers_to_all_senders_for_same_user() {
            let conns = new_social_connections();
            let (tx1, mut rx1) = mpsc::unbounded_channel::<Message>();
            let (tx2, mut rx2) = mpsc::unbounded_channel::<Message>();

            {
                let mut entry = conns.entry("user-multi".to_string()).or_default();
                entry.push(tx1);
                entry.push(tx2);
            }

            let payload = serde_json::json!({"type": "direct_message", "content": "hi"});
            send_to_user("user-multi", &payload, &conns);

            assert!(rx1.try_recv().is_ok(), "first sender should receive the message");
            assert!(rx2.try_recv().is_ok(), "second sender should receive the message");
        }

        #[test]
        fn message_is_valid_json_text() {
            let conns = new_social_connections();
            let (tx, mut rx) = mpsc::unbounded_channel::<Message>();
            conns.entry("user-json".to_string()).or_default().push(tx);

            let payload = serde_json::json!({"type": "notification", "data": {"count": 5}});
            send_to_user("user-json", &payload, &conns);

            let msg = rx.try_recv().expect("message must arrive");
            if let Message::Text(text) = msg {
                let reparsed: serde_json::Value =
                    serde_json::from_str(&text).expect("must be valid JSON");
                assert_eq!(reparsed["data"]["count"], 5);
            } else {
                panic!("expected Text message");
            }
        }

        #[test]
        fn send_to_user_silently_skips_closed_senders() {
            // When the receiver is dropped the sender is closed.
            // send_to_user must not panic — the send error is intentionally ignored.
            let conns = new_social_connections();
            let (tx, rx) = mpsc::unbounded_channel::<Message>();
            // Drop the receiver immediately so the sender is closed.
            drop(rx);
            conns.entry("user-closed".to_string()).or_default().push(tx);

            let payload = serde_json::json!({"type": "notification"});
            // Must not panic.
            send_to_user("user-closed", &payload, &conns);
        }

        #[test]
        fn send_to_user_delivers_to_live_sender_when_another_is_closed() {
            let conns = new_social_connections();
            let (tx_closed, rx_closed) = mpsc::unbounded_channel::<Message>();
            let (tx_live, mut rx_live) = mpsc::unbounded_channel::<Message>();

            // Close the first sender.
            drop(rx_closed);

            {
                let mut entry = conns.entry("user-mixed".to_string()).or_default();
                entry.push(tx_closed);
                entry.push(tx_live);
            }

            let payload = serde_json::json!({"type": "direct_message", "content": "test"});
            send_to_user("user-mixed", &payload, &conns);

            // The live receiver should still get the message.
            assert!(
                rx_live.try_recv().is_ok(),
                "live sender should receive the message even if another sender is closed"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Social pub/sub envelope structure
    // -----------------------------------------------------------------------

    mod pubsub_envelope {
        /// Mirrors the envelope construction in run_social_pubsub_loop.
        fn build_envelope(event_type: &str, inner_payload: &serde_json::Value) -> serde_json::Value {
            serde_json::json!({
                "type": event_type,
                "payload": inner_payload,
            })
        }

        #[test]
        fn envelope_has_type_field() {
            let env = build_envelope("notification", &serde_json::json!({"text": "hi"}));
            assert_eq!(env["type"], "notification");
        }

        #[test]
        fn envelope_has_payload_field() {
            let inner = serde_json::json!({"count": 3});
            let env = build_envelope("direct_message", &inner);
            assert_eq!(env["payload"]["count"], 3);
        }

        #[test]
        fn envelope_does_not_include_user_id() {
            // The user_id is used for routing but is NOT forwarded to the client.
            let env = build_envelope("notification", &serde_json::json!({}));
            assert!(
                env.get("user_id").is_none(),
                "envelope sent to client must not contain user_id"
            );
        }

        #[test]
        fn envelope_serialises_to_valid_json() {
            let env = build_envelope("match_found", &serde_json::json!({"match_id": "abc-123"}));
            let text = env.to_string();
            let reparsed: serde_json::Value =
                serde_json::from_str(&text).expect("envelope must round-trip through JSON");
            assert_eq!(reparsed["type"], "match_found");
            assert_eq!(reparsed["payload"]["match_id"], "abc-123");
        }

        #[test]
        fn event_missing_user_id_is_detectable() {
            // Mirrors the guard: event.get("user_id").and_then(|v| v.as_str())
            let event = serde_json::json!({"type": "notification", "payload": {}});
            let user_id = event.get("user_id").and_then(|v| v.as_str());
            assert!(
                user_id.is_none(),
                "event without user_id should produce None from the guard"
            );
        }

        #[test]
        fn event_missing_type_is_detectable() {
            let event = serde_json::json!({"user_id": "u1", "payload": {}});
            let event_type = event.get("type").and_then(|v| v.as_str());
            assert!(
                event_type.is_none(),
                "event without type should produce None from the guard"
            );
        }

        #[test]
        fn event_missing_payload_is_detectable() {
            let event = serde_json::json!({"user_id": "u1", "type": "notification"});
            let payload = event.get("payload");
            assert!(
                payload.is_none(),
                "event without payload should produce None from the guard"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Redis key naming for set_player_status / clear_player_status
    // -----------------------------------------------------------------------

    mod status_key_naming {
        /// Mirrors the key construction used in set_player_status and
        /// clear_player_status: `player:status:{user_id}`.
        fn status_key(user_id: &str) -> String {
            format!("player:status:{user_id}")
        }

        #[test]
        fn key_has_correct_prefix() {
            assert!(status_key("user-42").starts_with("player:status:"));
        }

        #[test]
        fn key_ends_with_user_id() {
            let uid = "user-42";
            assert!(status_key(uid).ends_with(uid));
        }

        #[test]
        fn key_format_is_stable() {
            assert_eq!(status_key("abc-123"), "player:status:abc-123");
        }

        #[test]
        fn key_is_unique_per_user() {
            assert_ne!(status_key("user-1"), status_key("user-2"));
        }

        #[test]
        fn key_works_for_uuid_style_ids() {
            let uid = "550e8400-e29b-41d4-a716-446655440000";
            assert_eq!(
                status_key(uid),
                "player:status:550e8400-e29b-41d4-a716-446655440000"
            );
        }
    }

    // -----------------------------------------------------------------------
    // SocialConnections cleanup — remove_if behaviour (mirrors chat cleanup)
    // -----------------------------------------------------------------------

    mod cleanup {
        use super::*;

        #[test]
        fn remove_if_drops_entry_when_all_senders_closed() {
            let conns = new_social_connections();
            let (tx, rx) = mpsc::unbounded_channel::<Message>();

            conns.entry("user-gone".to_string()).or_default().push(tx);
            drop(rx);

            if let Some(mut senders) = conns.get_mut("user-gone") {
                senders.retain(|s| !s.is_closed());
            }
            conns.remove_if("user-gone", |_, v| v.is_empty());

            assert!(
                !conns.contains_key("user-gone"),
                "entry should be removed when all senders are closed"
            );
        }

        #[test]
        fn remove_if_retains_entry_when_live_sender_remains() {
            let conns = new_social_connections();
            let (tx_live, _rx_live) = mpsc::unbounded_channel::<Message>();
            let (tx_dead, rx_dead) = mpsc::unbounded_channel::<Message>();

            {
                let mut entry = conns.entry("user-partial".to_string()).or_default();
                entry.push(tx_live);
                entry.push(tx_dead);
            }

            drop(rx_dead);

            if let Some(mut senders) = conns.get_mut("user-partial") {
                senders.retain(|s| !s.is_closed());
            }
            conns.remove_if("user-partial", |_, v| v.is_empty());

            assert!(
                conns.contains_key("user-partial"),
                "entry should be kept when at least one sender is still live"
            );
        }
    }
}
