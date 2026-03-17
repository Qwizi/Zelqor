use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{State, WebSocketUpgrade};
use axum::response::Response;
use futures::SinkExt;
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::mpsc;
use tracing::{error, info};

/// Global chat connection registry: user_id -> Vec<sender>
pub type ChatConnections = Arc<dashmap::DashMap<String, Vec<mpsc::UnboundedSender<Message>>>>;

pub fn new_chat_connections() -> ChatConnections {
    Arc::new(dashmap::DashMap::new())
}

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
    pub ticket: Option<String>,
    pub nonce: Option<String>,
}

pub async fn ws_chat_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
    if let Err(resp) = crate::auth::check_origin(&headers, &state.config.allowed_ws_origins) {
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
        match crate::auth::validate_ticket(&ticket, query.nonce.as_deref(), &mut state.redis.clone()).await {
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

    ws.on_upgrade(move |socket| handle_chat_socket(socket, user_id, state))
}

pub async fn resolve_username(state: &AppState, user_id: &str) -> String {
    // Check cache first (TTL = 5 minutes)
    let cache_valid = state
        .username_cache
        .get(user_id)
        .map(|entry| entry.1.elapsed().as_secs() < 300)
        .unwrap_or(false);

    if cache_valid {
        if let Some(entry) = state.username_cache.get(user_id) {
            return entry.0.clone();
        }
    }

    match state.django.get_user(user_id).await {
        Ok(info) => {
            state
                .username_cache
                .insert(user_id.to_string(), (info.username.clone(), Instant::now()));
            info.username
        }
        Err(e) => {
            error!("Failed to fetch user {user_id} from Django: {e}");
            user_id.to_string()
        }
    }
}

async fn handle_chat_socket(socket: WebSocket, user_id: String, state: AppState) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Check that the account is active (not banned)
    match state.django.get_user(&user_id).await {
        Ok(user_info) if !user_info.is_active => {
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Account banned".into(),
                })))
                .await;
            return;
        }
        Err(e) => {
            error!("Chat: failed to verify user {user_id}: {e}");
            let _ = ws_sender
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4003,
                    reason: "Failed to verify account".into(),
                })))
                .await;
            return;
        }
        Ok(_) => {}
    }

    // Resolve username (with cache)
    let username = resolve_username(&state, &user_id).await;
    info!("Chat: user {user_id} ({username}) connected");

    // Create channel for outgoing messages
    let (tx, mut rx) = mpsc::unbounded_channel::<Message>();

    // Send chat history (fire-and-forget task so it doesn't block registration)
    {
        let django = state.django.clone();
        let tx_hist = tx.clone();
        tokio::spawn(async move {
            match django.get_chat_messages(50).await {
                Ok(messages) => {
                    let msg = json!({"type": "chat_history", "messages": messages});
                    let _ = tx_hist.send(Message::Text(msg.to_string().into()));
                }
                Err(e) => {
                    error!("Failed to fetch global chat history: {e}");
                }
            }
        });
    }

    // Register sender in ChatConnections
    state
        .chat_connections
        .entry(user_id.clone())
        .or_default()
        .push(tx.clone());

    // Spawn outgoing message forwarder
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Process incoming messages
    let user_id_clone = user_id.clone();
    let username_clone = username.clone();
    let state_clone = state.clone();
    let tx_clone = tx.clone();

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(content) = serde_json::from_str::<serde_json::Value>(&text) {
                        handle_chat_message(
                            &content,
                            &user_id_clone,
                            &username_clone,
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

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    // Cleanup: remove this sender from ChatConnections
    if let Some(mut senders) = state.chat_connections.get_mut(&user_id) {
        senders.retain(|s| !s.is_closed());
    }
    // Remove empty entry
    state.chat_connections.remove_if(&user_id, |_, v| v.is_empty());

    info!("Chat: user {user_id} disconnected");
}

async fn handle_chat_message(
    content: &serde_json::Value,
    user_id: &str,
    username: &str,
    state: &AppState,
    tx: &mpsc::UnboundedSender<Message>,
) {
    let action = content.get("action").and_then(|v| v.as_str()).unwrap_or("");

    if action != "chat_message" {
        return;
    }

    let raw_content = content
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    // Validate length: 1–500 chars
    if raw_content.is_empty() || raw_content.len() > 500 {
        return;
    }

    // Rate limit: 1 message per second per user
    let now = Instant::now();
    if let Some(last) = state.chat_rate_limits.get(user_id) {
        if now.duration_since(*last).as_secs_f64() < 1.0 {
            let _ = tx.send(Message::Text(
                json!({"type": "error", "message": "Rate limited"})
                    .to_string()
                    .into(),
            ));
            return;
        }
    }
    state.chat_rate_limits.insert(user_id.to_string(), now);

    // Save to Django (fire-and-forget)
    {
        let django = state.django.clone();
        let uid = user_id.to_string();
        let msg_content = raw_content.clone();
        tokio::spawn(async move {
            if let Err(e) = django.save_chat_message(&uid, &msg_content).await {
                error!("Failed to save global chat message for user {uid}: {e}");
            }
        });
    }

    // Build broadcast payload
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let broadcast_msg = json!({
        "type": "chat_message",
        "user_id": user_id,
        "username": username,
        "content": raw_content,
        "timestamp": timestamp,
    });

    let text = broadcast_msg.to_string();

    // Broadcast to every connected user
    for entry in state.chat_connections.iter() {
        for sender in entry.value().iter() {
            let _ = sender.send(Message::Text(text.clone().into()));
        }
    }
}

// ---------------------------------------------------------------------------
// Unit tests — pure logic only, no WebSocket or Django connections needed.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // new_chat_connections
    // -----------------------------------------------------------------------

    mod new_chat_connections_tests {
        use super::*;

        #[test]
        fn creates_empty_registry() {
            let conns = new_chat_connections();
            assert!(conns.is_empty(), "new registry must be empty");
        }

        #[test]
        fn can_insert_and_retrieve_a_sender() {
            let conns = new_chat_connections();
            let (tx, _rx) = mpsc::unbounded_channel::<Message>();

            conns
                .entry("user-1".to_string())
                .or_default()
                .push(tx);

            assert!(conns.contains_key("user-1"));
        }

        #[test]
        fn supports_multiple_senders_per_user() {
            let conns = new_chat_connections();
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
            let conns = new_chat_connections();
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
    // TokenQuery deserialization
    // -----------------------------------------------------------------------

    mod token_query {
        use super::*;

        #[test]
        fn deserializes_all_fields() {
            let json = r#"{"token":"tok","ticket":"tkt","nonce":"non"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert_eq!(q.token.as_deref(), Some("tok"));
            assert_eq!(q.ticket.as_deref(), Some("tkt"));
            assert_eq!(q.nonce.as_deref(), Some("non"));
        }

        #[test]
        fn all_fields_optional_when_absent() {
            let q: TokenQuery = serde_json::from_str("{}").unwrap();

            assert!(q.token.is_none());
            assert!(q.ticket.is_none());
            assert!(q.nonce.is_none());
        }

        #[test]
        fn token_only_parses_correctly() {
            let json = r#"{"token":"access-token-abc"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert_eq!(q.token.as_deref(), Some("access-token-abc"));
            assert!(q.ticket.is_none());
            assert!(q.nonce.is_none());
        }

        #[test]
        fn ticket_and_nonce_without_token_is_valid() {
            let json = r#"{"ticket":"t1","nonce":"n1"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert!(q.token.is_none());
            assert_eq!(q.ticket.as_deref(), Some("t1"));
            assert_eq!(q.nonce.as_deref(), Some("n1"));
        }
    }

    // -----------------------------------------------------------------------
    // chat broadcast payload structure
    // -----------------------------------------------------------------------

    mod broadcast_payload {
        use super::*;

        /// Builds the broadcast payload the same way handle_chat_message does.
        fn make_broadcast_payload(
            user_id: &str,
            username: &str,
            content: &str,
            timestamp: u64,
        ) -> serde_json::Value {
            json!({
                "type": "chat_message",
                "user_id": user_id,
                "username": username,
                "content": content,
                "timestamp": timestamp,
            })
        }

        #[test]
        fn payload_has_correct_type_field() {
            let v = make_broadcast_payload("u1", "Alice", "Hello", 0);
            assert_eq!(v["type"], "chat_message");
        }

        #[test]
        fn payload_includes_user_id() {
            let v = make_broadcast_payload("user-42", "Bob", "Hi", 0);
            assert_eq!(v["user_id"], "user-42");
        }

        #[test]
        fn payload_includes_username() {
            let v = make_broadcast_payload("u1", "Charlie", "Hey", 0);
            assert_eq!(v["username"], "Charlie");
        }

        #[test]
        fn payload_includes_content() {
            let v = make_broadcast_payload("u1", "Dave", "World", 0);
            assert_eq!(v["content"], "World");
        }

        #[test]
        fn payload_includes_timestamp() {
            let ts = 1_700_000_000u64;
            let v = make_broadcast_payload("u1", "Eve", "Msg", ts);
            assert_eq!(v["timestamp"], ts);
        }

        #[test]
        fn payload_serialises_to_valid_json_string() {
            let v = make_broadcast_payload("u1", "Frank", "Test", 12345);
            let text = v.to_string();
            let reparsed: serde_json::Value = serde_json::from_str(&text)
                .expect("broadcast payload must be valid JSON when serialised to string");
            assert_eq!(reparsed["type"], "chat_message");
        }
    }

    // -----------------------------------------------------------------------
    // Content validation rules (replicated from handle_chat_message logic)
    // -----------------------------------------------------------------------

    mod content_validation {
        /// Mirrors the validation logic from handle_chat_message.
        fn is_valid_content(raw: &str) -> bool {
            let trimmed = raw.trim();
            !trimmed.is_empty() && trimmed.len() <= 500
        }

        #[test]
        fn empty_string_is_rejected() {
            assert!(!is_valid_content(""), "empty content must be rejected");
        }

        #[test]
        fn whitespace_only_string_is_rejected() {
            assert!(!is_valid_content("   "), "whitespace-only content must be rejected");
        }

        #[test]
        fn single_character_is_accepted() {
            assert!(is_valid_content("a"), "single char must be accepted");
        }

        #[test]
        fn exactly_500_chars_is_accepted() {
            let msg = "x".repeat(500);
            assert!(is_valid_content(&msg), "500-char message must be accepted");
        }

        #[test]
        fn exactly_501_chars_is_rejected() {
            let msg = "x".repeat(501);
            assert!(!is_valid_content(&msg), "501-char message must be rejected");
        }

        #[test]
        fn unicode_content_is_accepted_when_within_byte_limit() {
            // A short Polish phrase well within 500 bytes.
            let msg = "Dzień dobry!";
            assert!(is_valid_content(msg));
        }

        #[test]
        fn leading_whitespace_is_trimmed_for_validation() {
            // Content that is non-empty after trimming should pass.
            let msg = "  hello  ";
            assert!(is_valid_content(msg));
        }
    }
}
