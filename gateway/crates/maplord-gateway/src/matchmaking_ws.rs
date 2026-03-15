use crate::auth;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Path, State, WebSocketUpgrade};
use axum::response::Response;
use maplord_matchmaking::MatchmakingMessage;

use serde::Deserialize;

#[derive(Deserialize)]
pub struct TokenQuery {
    pub token: Option<String>,
    pub ticket: Option<String>,
    pub nonce: Option<String>,
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

    let game_mode_slug = game_mode.map(|p| p.0);

    ws.on_upgrade(move |socket| handle_matchmaking_socket(socket, user_id, game_mode_slug, state))
}

async fn handle_matchmaking_socket(
    socket: WebSocket,
    user_id: String,
    game_mode: Option<String>,
    state: AppState,
) {
    use futures::{SinkExt, StreamExt};
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
    let (mut rx, conn_id) = match state
        .matchmaking
        .connect(&user_id, &username, game_mode_ref)
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
}
