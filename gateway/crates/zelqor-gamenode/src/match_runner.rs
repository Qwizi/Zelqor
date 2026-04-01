use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use zelqor_plugins::{ActionVerdict, PlayerAction, PluginManager, TickContext};

/// Commands sent from the main connection loop into a running match task.
pub enum MatchCommand {
    PlayerAction {
        user_id: String,
        action: serde_json::Value,
    },
    PlayerConnect {
        user_id: String,
    },
    PlayerDisconnect {
        user_id: String,
    },
    Stop,
}

/// Results sent from a match task back to the main connection loop so the
/// loop can forward them to the gateway as `NodeToGateway` messages.
pub enum MatchResult {
    Tick {
        match_id: String,
        tick: u64,
        tick_data: serde_json::Value,
    },
    Finished {
        match_id: String,
        winner_id: Option<String>,
        total_ticks: u64,
        final_state: serde_json::Value,
    },
    PlayerEliminated {
        match_id: String,
        user_id: String,
    },
}

/// Manages active game matches on this gamenode.
///
/// Each match runs in its own tokio task. `MatchRunner` holds a sender for
/// each task so commands (player actions, connect/disconnect, stop) can be
/// forwarded without blocking the gateway I/O loop.
#[derive(Clone)]
pub struct MatchRunner {
    /// match_id → sender for forwarding commands into the match task.
    matches: Arc<DashMap<String, mpsc::UnboundedSender<MatchCommand>>>,
    /// Shared plugin manager applied to every match on this node.
    /// Wrapped in RwLock so plugins can be hot-swapped when the gateway
    /// pushes a new PluginList (e.g. after reconnect).
    plugins: Arc<std::sync::RwLock<Arc<PluginManager>>>,
}

impl MatchRunner {
    pub fn new() -> Self {
        Self {
            matches: Arc::new(DashMap::new()),
            plugins: Arc::new(std::sync::RwLock::new(Arc::new(PluginManager::new()))),
        }
    }

    /// Replace the plugin manager with a newly loaded one.
    ///
    /// Already-running matches keep using the previous manager (they hold
    /// their own `Arc` clone); new matches started after this call will use
    /// the updated plugins.
    pub fn set_plugins(&self, plugins: PluginManager) {
        *self.plugins.write().unwrap() = Arc::new(plugins);
    }

    /// Start a new match in a background task.
    ///
    /// `result_tx` is used by the task to send tick updates, elimination
    /// events, and the final result back to the caller's select loop.
    pub fn start_match(
        &self,
        match_id: String,
        match_data: serde_json::Value,
        result_tx: mpsc::UnboundedSender<MatchResult>,
    ) {
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<MatchCommand>();
        self.matches.insert(match_id.clone(), cmd_tx);

        let matches = self.matches.clone();
        let plugins = self.plugins.read().unwrap().clone();

        tokio::spawn(async move {
            tracing::info!(match_id = %match_id, "Match started");

            // Extract player IDs from match_data if available.
            let player_ids: Vec<String> = match_data
                .get("players")
                .and_then(|p| p.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();

            // Notify plugins that the match has started.
            plugins.on_match_start(&match_id, &player_ids);

            // Run game loop at 1 tick per second.
            let mut tick: u64 = 0;
            let mut ticker =
                tokio::time::interval(tokio::time::Duration::from_secs(1));

            loop {
                tokio::select! {
                    _ = ticker.tick() => {
                        tick += 1;

                        // Dispatch on_tick to all plugins.
                        let tick_ctx = TickContext {
                            tick,
                            player_count: player_ids.len() as u32,
                            match_id: match_id.clone(),
                        };
                        let plugin_events = plugins.on_tick(&tick_ctx);

                        // Engine tick processing goes here using zelqor_engine.
                        let mut tick_data = serde_json::json!({
                            "tick": tick,
                            "match_id": match_id,
                        });
                        if !plugin_events.is_empty() {
                            tick_data["plugin_events"] = serde_json::json!(plugin_events);
                        }

                        let _ = result_tx.send(MatchResult::Tick {
                            match_id: match_id.clone(),
                            tick,
                            tick_data,
                        });
                    }
                    Some(cmd) = cmd_rx.recv() => {
                        match cmd {
                            MatchCommand::PlayerAction { user_id, action } => {
                                // Ask plugins whether this action is allowed.
                                let plugin_action = PlayerAction {
                                    user_id: user_id.clone(),
                                    action_type: action
                                        .get("type")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown")
                                        .to_string(),
                                    payload: action.to_string(),
                                };

                                match plugins.on_player_action(&plugin_action) {
                                    ActionVerdict::Deny => {
                                        tracing::debug!(
                                            match_id = %match_id,
                                            user_id = %user_id,
                                            "Player action denied by plugin"
                                        );
                                    }
                                    ActionVerdict::Allow => {
                                        tracing::debug!(
                                            match_id = %match_id,
                                            user_id = %user_id,
                                            "Processing action"
                                        );
                                        // Engine would process the action here.
                                    }
                                }
                            }
                            MatchCommand::PlayerConnect { user_id } => {
                                tracing::info!(
                                    match_id = %match_id,
                                    user_id = %user_id,
                                    "Player connected"
                                );
                            }
                            MatchCommand::PlayerDisconnect { user_id } => {
                                tracing::info!(
                                    match_id = %match_id,
                                    user_id = %user_id,
                                    "Player disconnected"
                                );
                            }
                            MatchCommand::Stop => {
                                tracing::info!(match_id = %match_id, "Match stopped");
                                break;
                            }
                        }
                    }
                }
            }

            // Notify plugins that the match has ended.
            plugins.on_match_end(&match_id, None);

            matches.remove(&match_id);
            tracing::info!(match_id = %match_id, tick, "Match ended after {tick} ticks");
        });
    }

    /// Forward a command to a running match.
    ///
    /// Returns `true` if the message was enqueued, `false` if no match with
    /// that ID is currently running.
    pub fn send_command(&self, match_id: &str, cmd: MatchCommand) -> bool {
        if let Some(tx) = self.matches.get(match_id) {
            tx.send(cmd).is_ok()
        } else {
            tracing::warn!(match_id = %match_id, "No running match found");
            false
        }
    }

    /// Number of currently active matches.
    pub fn active_count(&self) -> u32 {
        self.matches.len() as u32
    }
}

impl Default for MatchRunner {
    fn default() -> Self {
        Self::new()
    }
}
