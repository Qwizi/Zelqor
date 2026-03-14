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
}

pub async fn ws_chat_handler(
    ws: WebSocketUpgrade,
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

    ws.on_upgrade(move |socket| handle_chat_socket(socket, user_id, state))
}

async fn resolve_username(state: &AppState, user_id: &str) -> String {
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
