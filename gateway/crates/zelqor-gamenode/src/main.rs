mod config;
mod match_runner;

use config::NodeConfig;
use futures_util::{SinkExt, StreamExt};
use match_runner::{MatchCommand, MatchResult, MatchRunner};
use serde::Deserialize;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

/// Shared state pushed by the gateway to this gamenode.
#[derive(Default)]
struct NodeState {
    /// Region adjacency map (pushed once on registration).
    neighbor_map: RwLock<Option<serde_json::Value>>,
    /// System module states (pushed periodically).
    system_modules: RwLock<Option<serde_json::Value>>,
    /// Match regions keyed by match_id (pushed after each StartMatch).
    match_regions: dashmap::DashMap<String, serde_json::Value>,
}
use tokio::time::{interval, Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{error, info, warn};
use zelqor_protocol::{GatewayToNode, NodeToGateway};

/// Response body from the OAuth token endpoint.
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

/// Obtain an access token from the gateway OAuth endpoint using client credentials.
async fn fetch_access_token(
    client: &reqwest::Client,
    cfg: &NodeConfig,
) -> anyhow::Result<String> {
    let body = serde_json::json!({
        "grant_type": "client_credentials",
        "client_id": cfg.client_id,
        "client_secret": cfg.client_secret,
    });

    let resp = client
        .post(cfg.token_url())
        .json(&body)
        .send()
        .await
        .map_err(|e| anyhow::anyhow!("OAuth request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow::anyhow!(
            "OAuth endpoint returned {status}: {body}"
        ));
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to parse token response: {e}"))?;

    Ok(token_resp.access_token)
}

/// Send a `NodeToGateway` message serialised as a JSON text frame.
async fn send_msg<S>(
    sink: &mut S,
    msg: &NodeToGateway,
) -> Result<(), tokio_tungstenite::tungstenite::Error>
where
    S: SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    let text = serde_json::to_string(msg).expect("NodeToGateway is always serializable");
    sink.send(Message::Text(text.into())).await
}

#[tokio::main]
async fn main() {
    // Load .env if present (dev convenience).
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,zelqor_gamenode=debug".into()),
        )
        .init();

    let cfg = NodeConfig::from_env();
    info!(
        server_name = %cfg.server_name,
        region = %cfg.region,
        max_matches = cfg.max_matches,
        gateway_url = %cfg.gateway_url,
        "Starting Zelqor Gamenode"
    );

    // Build an HTTP client for OAuth.
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Failed to build HTTP client");

    // Set up shutdown signal handling.
    let shutdown = Arc::new(tokio::sync::Notify::new());
    let shutdown_tx = shutdown.clone();

    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm =
            signal(SignalKind::terminate()).expect("Failed to install SIGTERM handler");

        tokio::select! {
            _ = sigterm.recv() => info!("Received SIGTERM"),
            _ = tokio::signal::ctrl_c() => info!("Received SIGINT (Ctrl+C)"),
        }

        info!("Shutdown signal received, initiating graceful shutdown");
        shutdown_tx.notify_waiters();
    });

    // Main connection loop — reconnect on failure.
    loop {
        tokio::select! {
            _ = shutdown.notified() => {
                info!("Gamenode shutting down cleanly");
                break;
            }
            _ = run_connection(&cfg, &http_client) => {
                warn!("Gateway connection closed, reconnecting in 5 seconds...");
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// Establish a single connection lifecycle: authenticate, connect, register, run loop.
async fn run_connection(cfg: &NodeConfig, http_client: &reqwest::Client) {
    // 1. Obtain access token.
    let access_token = match fetch_access_token(http_client, cfg).await {
        Ok(t) => {
            info!("Successfully obtained access token");
            t
        }
        Err(e) => {
            error!("Failed to obtain access token: {e}");
            return;
        }
    };

    // 2. Connect to gateway WebSocket.
    let ws_url = cfg.ws_url(&access_token);
    info!(url = %ws_url, "Connecting to gateway WebSocket");

    let (ws_stream, _response) = match connect_async(&ws_url).await {
        Ok(pair) => pair,
        Err(e) => {
            error!("WebSocket connection failed: {e}");
            return;
        }
    };

    info!("Connected to gateway");
    let (mut ws_sink, mut ws_source) = ws_stream.split();

    // 3. Send Register message.
    let register_msg = NodeToGateway::Register {
        server_id: cfg.client_id.clone(),
        server_name: cfg.server_name.clone(),
        region: cfg.region.clone(),
        max_matches: cfg.max_matches,
    };

    if let Err(e) = send_msg(&mut ws_sink, &register_msg).await {
        error!("Failed to send Register message: {e}");
        return;
    }

    info!(
        server_id = %cfg.client_id,
        region = %cfg.region,
        max_matches = cfg.max_matches,
        "Sent Register to gateway"
    );

    // 4. Create the match runner, shared state, and a channel for match results.
    let match_runner = MatchRunner::new();
    let node_state = Arc::new(NodeState::default());
    let (result_tx, mut result_rx) = mpsc::unbounded_channel::<MatchResult>();

    // 5. Spawn heartbeat task — sends HeartbeatAck every 10 seconds.
    let (hb_tx, mut hb_rx) = tokio::sync::mpsc::unbounded_channel::<NodeToGateway>();

    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(10));
        loop {
            ticker.tick().await;
            let ack = NodeToGateway::HeartbeatAck {
                // active_count() reads the DashMap length; cheap O(1) call.
                active_matches: 0, // placeholder; updated below via a separate channel
                cpu_load: 0.0,
            };
            if hb_tx.send(ack).is_err() {
                // Receiver dropped — connection is gone.
                break;
            }
        }
    });

    // 6. Main message loop.
    loop {
        tokio::select! {
            // Outbound: heartbeats queued by the heartbeat task.
            Some(msg) = hb_rx.recv() => {
                // Patch the heartbeat with the current active_count.
                let msg = if let NodeToGateway::HeartbeatAck { cpu_load, .. } = msg {
                    NodeToGateway::HeartbeatAck {
                        active_matches: match_runner.active_count(),
                        cpu_load,
                    }
                } else {
                    msg
                };
                if let Err(e) = send_msg(&mut ws_sink, &msg).await {
                    error!("Failed to send heartbeat: {e}");
                    break;
                }
                info!("Sent HeartbeatAck to gateway");
            }

            // Match results: forward to gateway as NodeToGateway messages.
            Some(result) = result_rx.recv() => {
                let outbound = match result {
                    MatchResult::Tick { match_id, tick, tick_data } => {
                        NodeToGateway::TickBroadcast { match_id, tick, tick_data }
                    }
                    MatchResult::Finished {
                        match_id,
                        winner_id,
                        total_ticks,
                        final_state,
                    } => {
                        NodeToGateway::MatchFinished {
                            match_id,
                            winner_id,
                            total_ticks,
                            final_state,
                        }
                    }
                    MatchResult::PlayerEliminated { match_id, user_id } => {
                        NodeToGateway::PlayerEliminated { match_id, user_id }
                    }
                };
                if let Err(e) = send_msg(&mut ws_sink, &outbound).await {
                    error!("Failed to send match result to gateway: {e}");
                    break;
                }
            }

            // Inbound: messages from the gateway.
            maybe_msg = ws_source.next() => {
                match maybe_msg {
                    Some(Ok(Message::Text(text))) => {
                        handle_gateway_message(&text, &match_runner, &result_tx, &node_state);
                    }
                    Some(Ok(Message::Ping(data))) => {
                        // Respond to ping frames.
                        if let Err(e) = ws_sink.send(Message::Pong(data)).await {
                            error!("Failed to send Pong: {e}");
                            break;
                        }
                    }
                    Some(Ok(Message::Close(frame))) => {
                        info!(?frame, "Gateway closed connection");
                        break;
                    }
                    Some(Ok(_)) => {
                        // Binary / Pong frames — ignore.
                    }
                    Some(Err(e)) => {
                        error!("WebSocket error: {e}");
                        break;
                    }
                    None => {
                        info!("Gateway stream ended");
                        break;
                    }
                }
            }
        }
    }
}

/// Dispatch a single inbound text frame from the gateway.
fn handle_gateway_message(
    text: &str,
    match_runner: &MatchRunner,
    result_tx: &mpsc::UnboundedSender<MatchResult>,
    node_state: &Arc<NodeState>,
) {
    let msg: GatewayToNode = match serde_json::from_str(text) {
        Ok(m) => m,
        Err(e) => {
            warn!("Failed to parse gateway message: {e} | raw: {text}");
            return;
        }
    };

    match msg {
        GatewayToNode::StartMatch {
            match_id,
            match_data,
        } => {
            info!(match_id = %match_id, "Received StartMatch");
            match_runner.start_match(match_id, match_data, result_tx.clone());
        }
        GatewayToNode::PlayerAction {
            match_id,
            user_id,
            action,
        } => {
            info!(match_id = %match_id, user_id = %user_id, "Received PlayerAction");
            match_runner.send_command(
                &match_id,
                MatchCommand::PlayerAction { user_id, action },
            );
        }
        GatewayToNode::PlayerConnect {
            match_id,
            user_id,
        } => {
            info!(match_id = %match_id, user_id = %user_id, "Player connected to match");
            match_runner.send_command(&match_id, MatchCommand::PlayerConnect { user_id });
        }
        GatewayToNode::PlayerDisconnect {
            match_id,
            user_id,
        } => {
            info!(match_id = %match_id, user_id = %user_id, "Player disconnected from match");
            match_runner.send_command(
                &match_id,
                MatchCommand::PlayerDisconnect { user_id },
            );
        }
        GatewayToNode::Heartbeat => {
            info!("Received Heartbeat ping from gateway");
            // The periodic HeartbeatAck is handled by the heartbeat task; this
            // handles an explicit ping if the gateway sends one outside the interval.
        }
        GatewayToNode::MatchRegions { match_id, regions } => {
            tracing::debug!(match_id = %match_id, "Caching match regions from gateway");
            node_state.match_regions.insert(match_id, regions);
        }
        GatewayToNode::NeighborMap { neighbors } => {
            tracing::debug!("Caching neighbor map from gateway");
            *node_state.neighbor_map.write().unwrap() = Some(neighbors);
        }
        GatewayToNode::SystemModules { modules } => {
            tracing::debug!("Caching system modules from gateway");
            *node_state.system_modules.write().unwrap() = Some(modules);
        }
    }
}
