use crate::server_registry::ConnectedServer;
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::Response;
use futures::SinkExt;
use futures::StreamExt;
use serde::Deserialize;
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use zelqor_protocol::{GatewayToNode, NodeToGateway};

#[derive(Deserialize)]
pub(crate) struct ServerQuery {
    token: Option<String>,
}

/// WebSocket upgrade handler for gamenode connections at `/ws/server/`.
///
/// Authentication: a non-empty `token` query parameter is required.
/// Full OAuth validation will be wired in once the Django OAuth app is ready;
/// for now a non-empty token is sufficient for the skeleton to compile and
/// connect.
pub async fn ws_server_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<ServerQuery>,
) -> Response {
    // Require a non-empty token — OAuth validation will be added later.
    let token = match query.token {
        Some(t) if !t.is_empty() => t,
        _ => {
            return axum::response::IntoResponse::into_response((
                axum::http::StatusCode::UNAUTHORIZED,
                "Missing or empty token",
            ));
        }
    };

    ws.on_upgrade(move |socket| handle_server_socket(socket, token, state))
}

async fn handle_server_socket(socket: WebSocket, _token: String, state: AppState) {
    let (mut ws_sink, mut ws_source) = socket.split();

    // Wait for the Register message from the gamenode.
    let register_msg = match wait_for_register(&mut ws_source).await {
        Some(msg) => msg,
        None => {
            warn!("Gamenode did not send Register message; closing connection");
            let _ = ws_sink
                .send(Message::Close(Some(axum::extract::ws::CloseFrame {
                    code: 4001,
                    reason: "Expected Register message".into(),
                })))
                .await;
            return;
        }
    };

    let NodeToGateway::Register {
        server_id,
        server_name,
        region,
        max_matches,
    } = register_msg
    else {
        // wait_for_register only returns Register variants; this arm is unreachable.
        return;
    };

    info!(
        server_id = %server_id,
        server_name = %server_name,
        region = %region,
        max_matches,
        "Gamenode registered"
    );

    // Create an mpsc channel so other parts of the gateway can push messages to this node.
    let (tx, mut rx) = mpsc::unbounded_channel::<GatewayToNode>();

    // Verify whether this server is official (verified) by asking Django.
    let is_official = match state.django.get_server_info(&server_id).await {
        Ok(info) => {
            info!(
                server_id = %server_id,
                is_verified = info.is_verified,
                "Resolved server verification status from Django"
            );
            info.is_verified
        }
        Err(e) => {
            warn!(
                server_id = %server_id,
                "Could not fetch server info from Django, defaulting to unofficial: {e}"
            );
            false
        }
    };

    // Clone tx before moving it into ConnectedServer so we can push initial data.
    let plugin_tx = tx.clone();

    let connected = ConnectedServer {
        server_id: server_id.clone(),
        server_name,
        sender: tx,
        active_matches: 0,
        max_matches,
        region,
        last_heartbeat: Instant::now(),
        is_official,
    };

    state.server_registry.register(connected);

    // Update Django DB — mark server as online.
    {
        let django = state.django.clone();
        let sid = server_id.clone();
        tokio::spawn(async move {
            if let Err(e) = django.update_server_status(&sid, "online").await {
                warn!(server_id = %sid, "Failed to set server online in Django: {e}");
            }
        });
    }

    // Push installed plugin list to the gamenode so it can download WASM files.
    // The gamenode never talks to Django directly — the gateway mediates.
    {
        let django = state.django.clone();
        let sid = server_id.clone();
        let node_tx = plugin_tx;
        tokio::spawn(async move {
            match django.get_server_plugins(&sid).await {
                Ok(resp) => {
                    let plugins_json = serde_json::to_value(&resp.plugins)
                        .unwrap_or_else(|_| serde_json::json!([]));
                    let _ = node_tx.send(GatewayToNode::PluginList {
                        plugins: plugins_json,
                    });
                    info!(server_id = %sid, count = resp.plugins.len(), "Pushed PluginList to gamenode");
                }
                Err(e) => {
                    warn!(server_id = %sid, "Failed to fetch plugins from Django: {e}");
                    // Send empty list so gamenode can proceed without plugins.
                    let _ = node_tx.send(GatewayToNode::PluginList {
                        plugins: serde_json::json!([]),
                    });
                }
            }
        });
    }

    // Spawn task: forwards queued gateway→node messages to the WebSocket sink.
    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(e) => {
                    error!("Failed to serialise GatewayToNode message: {e}");
                    continue;
                }
            };
            if ws_sink.send(Message::Text(text.into())).await.is_err() {
                break;
            }
        }
    });

    // Receive loop: handle messages from the gamenode (heartbeats, state updates).
    let server_id_recv = server_id.clone();
    let state_recv = state.clone();
    let recv_task = tokio::spawn(async move {
        while let Some(msg_result) = ws_source.next().await {
            match msg_result {
                Ok(Message::Text(text)) => {
                    handle_node_message(&text, &server_id_recv, &state_recv);
                }
                Ok(Message::Close(_)) => {
                    info!(server_id = %server_id_recv, "Gamenode sent Close frame");
                    break;
                }
                Ok(_) => {} // Ping/Pong/Binary — ignore.
                Err(e) => {
                    error!(server_id = %server_id_recv, "WebSocket error: {e}");
                    break;
                }
            }
        }
    });

    tokio::select! {
        _ = send_task => {}
        _ = recv_task => {}
    }

    state.server_registry.unassign_all_for_server(&server_id);
    state.server_registry.unregister(&server_id);

    // Update Django DB — mark server as offline.
    {
        let django = state.django.clone();
        let sid = server_id.clone();
        tokio::spawn(async move {
            if let Err(e) = django.update_server_status(&sid, "offline").await {
                warn!(server_id = %sid, "Failed to set server offline in Django: {e}");
            }
        });
    }

    info!(server_id = %server_id, "Gamenode disconnected");
}

/// Wait for the first meaningful message from the gamenode and return it if it
/// is a `NodeToGateway::Register`. Returns `None` on timeout, close, or an
/// unexpected message type.
async fn wait_for_register(
    source: &mut futures::stream::SplitStream<WebSocket>,
) -> Option<NodeToGateway> {
    use tokio::time::{timeout, Duration};

    let result = timeout(Duration::from_secs(10), async {
        while let Some(Ok(msg)) = source.next().await {
            match msg {
                Message::Text(text) => {
                    let parsed: NodeToGateway = match serde_json::from_str(&text) {
                        Ok(m) => m,
                        Err(e) => {
                            warn!("Failed to parse nodetoGateway message: {e}");
                            return None;
                        }
                    };
                    match parsed {
                        NodeToGateway::Register { .. } => return Some(parsed),
                        other => {
                            warn!("Expected Register, got {:?}", std::mem::discriminant(&other));
                            return None;
                        }
                    }
                }
                Message::Close(_) => return None,
                // Ping/Pong/Binary are ignored while waiting for the register frame.
                _ => continue,
            }
        }
        None
    })
    .await;

    result.unwrap_or(None)
}

/// Dispatch an inbound text message from a connected gamenode.
fn handle_node_message(text: &str, server_id: &str, state: &AppState) {
    let msg: NodeToGateway = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            warn!(server_id = %server_id, "Failed to parse NodeToGateway message: {e}");
            return;
        }
    };

    match msg {
        NodeToGateway::HeartbeatAck {
            active_matches,
            cpu_load,
        } => {
            state
                .server_registry
                .update_heartbeat(server_id, active_matches, cpu_load);
        }
        NodeToGateway::TickBroadcast {
            ref match_id,
            tick,
            ref tick_data,
        } => {
            tracing::debug!(server_id = %server_id, match_id = %match_id, tick, "TickBroadcast");
            crate::game::broadcast_to_match(match_id, tick_data, &state.game_connections);
        }
        NodeToGateway::MatchFinished {
            ref match_id,
            ref winner_id,
            total_ticks,
            ref final_state,
        } => {
            info!(
                server_id = %server_id,
                match_id = %match_id,
                ?winner_id,
                total_ticks,
                "MatchFinished"
            );
            state.server_registry.decrement_matches(server_id);
            state.server_registry.unassign_match(match_id);

            let django = state.django.clone();
            let match_id = match_id.clone();
            let winner_id = winner_id.clone();
            let final_state = final_state.clone();
            tokio::spawn(async move {
                let _ = django
                    .finalize_match(&match_id, winner_id.as_deref(), total_ticks, final_state)
                    .await;
                tokio::time::sleep(tokio::time::Duration::from_secs(120)).await;
                let _ = django.cleanup_match(&match_id).await;
            });
        }
        NodeToGateway::PlayerEliminated {
            ref match_id,
            ref user_id,
        } => {
            info!(
                server_id = %server_id,
                match_id = %match_id,
                user_id = %user_id,
                "PlayerEliminated"
            );
            let notification = serde_json::json!({
                "type": "notification",
                "event": "player_eliminated",
                "match_id": match_id,
                "user_id": user_id,
            });
            let text_msg = Message::Text(notification.to_string().into());
            if let Some(senders) = state.social_connections.get(user_id) {
                for sender in senders.value().iter() {
                    let _ = sender.send(text_msg.clone());
                }
            }
        }
        NodeToGateway::Register { .. } => {
            warn!(
                server_id = %server_id,
                "Received unexpected Register message after handshake"
            );
        }

        // ---------------------------------------------------------------
        // Proxy messages — gamenode → gateway → Django (server-scoped)
        // ---------------------------------------------------------------

        NodeToGateway::SaveSnapshot {
            ref match_id,
            tick,
            ref state_data,
        } => {
            if !verify_ownership(server_id, match_id, state) {
                return;
            }
            let django = state.django.clone();
            let match_id = match_id.clone();
            let state_data = state_data.clone();
            tokio::spawn(async move {
                let _ = django.save_snapshot(&match_id, tick, state_data).await;
            });
        }
        NodeToGateway::UpdateMatchStatus {
            ref match_id,
            ref status,
        } => {
            if !verify_ownership(server_id, match_id, state) {
                return;
            }
            let django = state.django.clone();
            let match_id = match_id.clone();
            let status = status.clone();
            tokio::spawn(async move {
                let _ = django.update_match_status(&match_id, &status).await;
            });
        }
        NodeToGateway::UpdatePlayerAlive {
            ref match_id,
            ref user_id,
            is_alive,
        } => {
            if !verify_ownership(server_id, match_id, state) {
                return;
            }
            let django = state.django.clone();
            let match_id = match_id.clone();
            let user_id = user_id.clone();
            tokio::spawn(async move {
                let _ = django.set_player_alive(&match_id, &user_id, is_alive).await;
            });
        }
        NodeToGateway::SendChatMessage {
            ref match_id,
            ref user_id,
            ref content,
        } => {
            if !verify_ownership(server_id, match_id, state) {
                return;
            }
            let django = state.django.clone();
            let match_id = match_id.clone();
            let user_id = user_id.clone();
            let content = content.clone();
            tokio::spawn(async move {
                let _ = django
                    .save_match_chat_message(&match_id, &user_id, &content)
                    .await;
            });
        }
        NodeToGateway::ReportViolation {
            ref match_id,
            ref player_id,
            ref violation_kind,
            ref severity,
            ref detail,
            tick,
        } => {
            if !verify_ownership(server_id, match_id, state) {
                return;
            }
            let django = state.django.clone();
            let match_id = match_id.clone();
            let player_id = player_id.clone();
            let violation_kind = violation_kind.clone();
            let severity = severity.clone();
            let detail = detail.clone();
            tokio::spawn(async move {
                let _ = django
                    .report_anticheat_violation(
                        &match_id,
                        &player_id,
                        &violation_kind,
                        &severity,
                        &detail,
                        tick as i64,
                    )
                    .await;
            });
        }
    }
}

/// Verify that the requesting server owns the match. Logs a warning and
/// returns `false` if the server is not the assigned owner.
fn verify_ownership(server_id: &str, match_id: &str, state: &AppState) -> bool {
    if state
        .server_registry
        .verify_match_owner(match_id, server_id)
    {
        return true;
    }
    warn!(
        server_id = %server_id,
        match_id = %match_id,
        "Server tried to act on a match it does not own — rejected"
    );
    false
}
