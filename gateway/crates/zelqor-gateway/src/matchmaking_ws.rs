use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use zelqor_matchmaking::MatchmakingMessage;

use serde::Deserialize;

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
    pub ticket: Option<String>,
    pub nonce: Option<String>,
    pub server_id: Option<String>,
}

pub async fn ws_matchmaking_handler(
    ws: WebSocketUpgrade,
    game_mode: Option<Path<String>>,
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    axum_extra::extract::Query(query): axum_extra::extract::Query<TokenQuery>,
) -> Response {
    if let Err(resp) = crate::auth::check_origin(&headers, &state.config.allowed_ws_origins) {
        return resp;
    }

    // Authenticate via query params: token (JWT) or ticket (one-time Redis ticket).
    let pre_auth_user_id = if let Some(token) = &query.token {
        // JWT token in query params (backward compat)
        match auth::validate_token(token, &state.config.secret_key) {
            Ok(uid) => Some(uid),
            Err(_) => None,
        }
    } else if let Some(ticket) = &query.ticket {
        // Ticket-only auth (httpOnly cookie flow — frontend can't send JWT directly)
        match crate::auth::validate_ticket(
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

    let game_mode_slug = game_mode.map(|p| p.0);
    let server_id = query.server_id;

    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| {
            handle_matchmaking_socket(socket, pre_auth_user_id, game_mode_slug, server_id, state)
        })
}

async fn handle_matchmaking_socket(
    socket: WebSocket,
    pre_auth_user_id: Option<String>,
    game_mode: Option<String>,
    server_id: Option<String>,
    state: AppState,
) {
    use futures::{SinkExt, StreamExt};
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

    // Check that the matchmaking module is enabled
    match state.django.get_system_modules().await {
        Ok(modules) => {
            if let Some(mm_module) = modules.get("matchmaking") {
                if !mm_module.enabled {
                    let _ = ws_sender
                        .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                            code: 4503,
                            reason: "Matchmaking is currently disabled".into(),
                        })))
                        .await;
                    return;
                }
            }
        }
        Err(e) => {
            tracing::warn!("Matchmaking: failed to check system modules: {e}");
            // fail-open: allow connection if we can't check
        }
    }

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
            tracing::error!("Matchmaking: failed to verify user {user_id}: {e}");
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

    // Resolve username for chat display (cached via chat::resolve_username).
    let username = crate::chat::resolve_username(&state, &user_id).await;

    let game_mode_ref = game_mode.as_deref();
    let server_id_ref = server_id.as_deref();
    let (mut rx, conn_id) = match state
        .matchmaking
        .connect(&user_id, &username, game_mode_ref, server_id_ref)
        .await
    {
        Ok(result) => result,
        Err(e) => {
            let _ = ws_sender
                .send(Message::Text(
                    serde_json::json!({"type": "error", "message": e})
                        .to_string()
                        .into(),
                ))
                .await;
            return;
        }
    };

    crate::social::set_player_status(&mut state.redis.clone(), &user_id, &serde_json::json!({
        "status": "in_queue",
        "game_mode": game_mode.as_deref().unwrap_or("default"),
    })).await;

    // Send LiveKit voice token for lobby voice chat (fire-and-forget).
    if let Some(lobby_id) = state.matchmaking.get_user_lobby_id(&user_id).await {
        let config = state.config.clone();
        let uid = user_id.clone();
        let uname = username.clone();
        let mm = state.matchmaking.clone();
        let lid = lobby_id.clone();
        tokio::spawn(async move {
            match crate::voice::generate_voice_token(
                &config.livekit_api_key,
                &config.livekit_api_secret,
                &format!("lobby_{}", lid),
                &uid,
                &uname,
            ) {
                Ok(token) => {
                    mm.send_voice_token(&uid, &lid, &token, &config.livekit_public_url);
                }
                Err(e) => {
                    tracing::warn!("Failed to generate lobby voice token for {uid}: {e}");
                }
            }
        });
    }

    // Forward outgoing messages to WebSocket.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                MatchmakingMessage::Json(val) => {
                    if ws_sender
                        .send(Message::Text(val.to_string().into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                MatchmakingMessage::Close => {
                    let _ = ws_sender.close().await;
                    break;
                }
            }
        }
    });

    // Process incoming messages.
    let matchmaking = state.matchmaking.clone();
    let user_id_clone = user_id.clone();
    let game_mode_clone = game_mode.clone();
    let mut redis_for_recv = state.redis.clone();

    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_receiver.next().await {
            match msg {
                Message::Text(text) => {
                    if let Ok(content) = serde_json::from_str::<serde_json::Value>(&text) {
                        let action = content
                            .get("action")
                            .and_then(|v| v.as_str())
                            .unwrap_or("");
                        match action {
                            "cancel" => {
                                matchmaking
                                    .handle_cancel(
                                        &user_id_clone,
                                        game_mode_clone.as_deref(),
                                    )
                                    .await;
                                crate::social::clear_player_status(&mut redis_for_recv, &user_id_clone).await;
                                break;
                            }
                            "status" => {
                                matchmaking
                                    .handle_status(
                                        &user_id_clone,
                                        game_mode_clone.as_deref(),
                                    )
                                    .await;
                            }
                            "ready" => {
                                matchmaking
                                    .handle_ready(
                                        &user_id_clone,
                                        game_mode_clone.as_deref(),
                                    )
                                    .await;
                            }
                            "fill_bots" => {
                                matchmaking
                                    .request_bot_fill_for_lobby(
                                        &user_id_clone,
                                    )
                                    .await;
                            }
                            "instant_bot" => {
                                matchmaking
                                    .request_bot_fill_for_lobby(
                                        &user_id_clone,
                                    )
                                    .await;
                                matchmaking
                                    .instant_bot_fill_for_lobby(
                                        &user_id_clone,
                                    )
                                    .await;
                            }
                            "chat_message" => {
                                if let Some(msg_content) = content
                                    .get("content")
                                    .and_then(|v| v.as_str())
                                {
                                    let trimmed = msg_content.trim();
                                    if !trimmed.is_empty() && trimmed.len() <= 500 {
                                        matchmaking.handle_chat_message(
                                            &user_id_clone,
                                            trimmed,
                                        ).await;
                                    }
                                }
                            }
                            _ => {}
                        }
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

    // Cleanup on disconnect — only removes this specific connection,
    // not a newer reconnection from the same user.
    state
        .matchmaking
        .disconnect(&user_id, game_mode.as_deref(), conn_id)
        .await;

    crate::social::clear_player_status(&mut state.redis.clone(), &user_id).await;
}

// ---------------------------------------------------------------------------
// Unit tests — pure data parsing and derivation only, no I/O needed.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // TokenQuery deserialization
    // -----------------------------------------------------------------------

    mod token_query {
        use super::*;

        #[test]
        fn deserializes_all_three_fields() {
            let json = r#"{"token":"t","ticket":"tkt","nonce":"non"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert_eq!(q.token.as_deref(), Some("t"));
            assert_eq!(q.ticket.as_deref(), Some("tkt"));
            assert_eq!(q.nonce.as_deref(), Some("non"));
        }

        #[test]
        fn all_fields_are_optional_and_absent_by_default() {
            let q: TokenQuery = serde_json::from_str("{}").unwrap();

            assert!(q.token.is_none());
            assert!(q.ticket.is_none());
            assert!(q.nonce.is_none());
        }

        #[test]
        fn token_only_is_valid() {
            let json = r#"{"token":"access-token-xyz"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert_eq!(q.token.as_deref(), Some("access-token-xyz"));
            assert!(q.ticket.is_none());
            assert!(q.nonce.is_none());
        }

        #[test]
        fn ticket_and_nonce_without_token_is_valid() {
            let json = r#"{"ticket":"tkt-abc","nonce":"nonce-42"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();

            assert!(q.token.is_none());
            assert_eq!(q.ticket.as_deref(), Some("tkt-abc"));
            assert_eq!(q.nonce.as_deref(), Some("nonce-42"));
        }

        #[test]
        fn extra_unknown_fields_are_ignored() {
            let json = r#"{"token":"tok","extra_field":"ignored"}"#;
            let q: TokenQuery = serde_json::from_str(json).unwrap();
            assert_eq!(q.token.as_deref(), Some("tok"));
        }
    }

    // -----------------------------------------------------------------------
    // Incoming WS message action field parsing
    // -----------------------------------------------------------------------

    mod action_parsing {
        // Mirrors the pattern used in handle_matchmaking_socket's recv loop.

        fn parse_action(json_str: &str) -> &'static str {
            // We can't call the actual handler without a socket, but we can
            // verify the parsing pattern with static dispatch.
            // The handler does: content.get("action").and_then(|v| v.as_str()).unwrap_or("")
            // We return a &'static str by matching against known values.
            let v: serde_json::Value = serde_json::from_str(json_str).unwrap_or_default();
            let action = v.get("action").and_then(|a| a.as_str()).unwrap_or("");
            match action {
                "cancel" => "cancel",
                "status" => "status",
                "ready" => "ready",
                "fill_bots" => "fill_bots",
                "instant_bot" => "instant_bot",
                "chat_message" => "chat_message",
                _ => "unknown",
            }
        }

        #[test]
        fn cancel_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"cancel"}"#), "cancel");
        }

        #[test]
        fn status_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"status"}"#), "status");
        }

        #[test]
        fn ready_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"ready"}"#), "ready");
        }

        #[test]
        fn fill_bots_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"fill_bots"}"#), "fill_bots");
        }

        #[test]
        fn instant_bot_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"instant_bot"}"#), "instant_bot");
        }

        #[test]
        fn chat_message_action_is_recognised() {
            assert_eq!(parse_action(r#"{"action":"chat_message"}"#), "chat_message");
        }

        #[test]
        fn unknown_action_falls_through() {
            assert_eq!(parse_action(r#"{"action":"nonexistent"}"#), "unknown");
        }

        #[test]
        fn missing_action_field_falls_through() {
            assert_eq!(parse_action(r#"{"type":"something_else"}"#), "unknown");
        }

        #[test]
        fn empty_object_falls_through() {
            assert_eq!(parse_action("{}"), "unknown");
        }
    }

    // -----------------------------------------------------------------------
    // chat_message content trimming and validation
    // -----------------------------------------------------------------------

    mod chat_content_validation {
        /// Mirrors the validation in handle_matchmaking_socket:
        ///   let trimmed = msg_content.trim();
        ///   if !trimmed.is_empty() && trimmed.len() <= 500 { ... }
        fn is_valid(raw: &str) -> bool {
            let trimmed = raw.trim();
            !trimmed.is_empty() && trimmed.len() <= 500
        }

        #[test]
        fn empty_string_is_rejected() {
            assert!(!is_valid(""));
        }

        #[test]
        fn whitespace_only_is_rejected() {
            assert!(!is_valid("  \t\n  "));
        }

        #[test]
        fn minimum_valid_message_is_one_char() {
            assert!(is_valid("x"));
        }

        #[test]
        fn exactly_500_chars_is_accepted() {
            assert!(is_valid(&"a".repeat(500)));
        }

        #[test]
        fn exactly_501_chars_is_rejected() {
            assert!(!is_valid(&"a".repeat(501)));
        }

        #[test]
        fn leading_and_trailing_whitespace_is_trimmed() {
            // After trimming, the content is non-empty and short enough.
            assert!(is_valid("  hello world  "));
        }

        #[test]
        fn content_with_only_spaces_does_not_sneak_through_at_501_bytes() {
            // 501 spaces: after trim = empty → rejected.
            assert!(!is_valid(&" ".repeat(501)));
        }
    }

    // -----------------------------------------------------------------------
    // game_mode_slug derivation
    // -----------------------------------------------------------------------

    mod game_mode_slug {
        /// Mirrors the expression: `game_mode.map(|p| p.0)`
        fn derive_slug(raw: Option<&str>) -> Option<String> {
            raw.map(|s| {
                // Simulates extracting the inner String from axum's Path<String>.
                s.to_string()
            })
        }

        #[test]
        fn some_path_produces_slug() {
            let slug = derive_slug(Some("ranked"));
            assert_eq!(slug, Some("ranked".to_string()));
        }

        #[test]
        fn none_path_produces_none() {
            let slug = derive_slug(None);
            assert!(slug.is_none());
        }

        #[test]
        fn slug_preserves_hyphens() {
            let slug = derive_slug(Some("team-battle"));
            assert_eq!(slug, Some("team-battle".to_string()));
        }

        #[test]
        fn slug_preserves_underscores() {
            let slug = derive_slug(Some("quick_match"));
            assert_eq!(slug, Some("quick_match".to_string()));
        }
    }
}
