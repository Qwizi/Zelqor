pub mod host;
pub mod sandbox;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PluginError {
    #[error("WASM compilation failed: {0}")]
    Compilation(String),
    #[error("Plugin execution failed: {0}")]
    Execution(String),
    #[error("Plugin timed out after {0}ms")]
    Timeout(u64),
    #[error("Plugin exceeded memory limit")]
    MemoryExceeded,
    #[error("Invalid plugin manifest: {0}")]
    InvalidManifest(String),
}

/// Plugin manifest describing a WASM plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub name: String,
    pub version: String,
    pub author: String,
    pub hooks: Vec<String>,
    pub permissions: Vec<String>,
    pub min_engine_version: Option<String>,
}

/// Context passed to plugins on each tick.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickContext {
    pub tick: u64,
    pub player_count: u32,
    pub match_id: String,
}

/// Combat event that plugins can inspect/modify.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatEvent {
    pub attacker_region: String,
    pub defender_region: String,
    pub attacker_units: u32,
    pub defender_units: u32,
}

/// Player action that plugins can allow/deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerAction {
    pub user_id: String,
    pub action_type: String,
    pub payload: String,
}

/// Result from a plugin's on_player_action hook.
#[derive(Debug, Clone, PartialEq)]
pub enum ActionVerdict {
    Allow,
    Deny,
}

/// Trait that all plugin hosts implement.
pub trait PluginHost: Send + Sync {
    fn on_tick(&self, ctx: &TickContext) -> Result<Vec<String>, PluginError>;
    fn on_combat(&self, event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError>;
    fn on_player_action(&self, action: &PlayerAction) -> Result<ActionVerdict, PluginError>;
    fn on_match_start(&self, match_id: &str, player_ids: &[String]) -> Result<(), PluginError>;
    fn on_match_end(&self, match_id: &str, winner_id: Option<&str>) -> Result<(), PluginError>;
    fn name(&self) -> &str;
}

/// Manages a collection of loaded plugins and dispatches game hooks to them.
pub struct PluginManager {
    plugins: Vec<Box<dyn PluginHost>>,
}

impl PluginManager {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    pub fn register(&mut self, plugin: Box<dyn PluginHost>) {
        tracing::info!(plugin = %plugin.name(), "Registering plugin");
        self.plugins.push(plugin);
    }

    pub fn plugin_count(&self) -> usize {
        self.plugins.len()
    }

    /// Dispatch on_tick to all plugins, collecting all emitted events.
    pub fn on_tick(&self, ctx: &TickContext) -> Vec<String> {
        let mut events = Vec::new();
        for plugin in &self.plugins {
            match plugin.on_tick(ctx) {
                Ok(mut e) => events.append(&mut e),
                Err(err) => {
                    tracing::warn!(plugin = %plugin.name(), %err, "on_tick hook failed");
                }
            }
        }
        events
    }

    /// Dispatch on_combat to all plugins. Plugins may modify the event; each
    /// plugin receives the (potentially modified) output of the previous one.
    pub fn on_combat(&self, event: CombatEvent) -> CombatEvent {
        let mut current = event;
        for plugin in &self.plugins {
            match plugin.on_combat(&current) {
                Ok(Some(modified)) => current = modified,
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(plugin = %plugin.name(), %err, "on_combat hook failed");
                }
            }
        }
        current
    }

    /// Dispatch on_player_action to all plugins. Returns Deny if any plugin
    /// denies the action; short-circuits on first Deny.
    pub fn on_player_action(&self, action: &PlayerAction) -> ActionVerdict {
        for plugin in &self.plugins {
            match plugin.on_player_action(action) {
                Ok(ActionVerdict::Deny) => {
                    tracing::debug!(
                        plugin = %plugin.name(),
                        user = %action.user_id,
                        action_type = %action.action_type,
                        "Plugin denied player action"
                    );
                    return ActionVerdict::Deny;
                }
                Ok(ActionVerdict::Allow) => {}
                Err(err) => {
                    tracing::warn!(plugin = %plugin.name(), %err, "on_player_action hook failed");
                }
            }
        }
        ActionVerdict::Allow
    }

    /// Dispatch on_match_start to all plugins.
    pub fn on_match_start(&self, match_id: &str, player_ids: &[String]) {
        for plugin in &self.plugins {
            if let Err(err) = plugin.on_match_start(match_id, player_ids) {
                tracing::warn!(plugin = %plugin.name(), %err, "on_match_start hook failed");
            }
        }
    }

    /// Dispatch on_match_end to all plugins.
    pub fn on_match_end(&self, match_id: &str, winner_id: Option<&str>) {
        for plugin in &self.plugins {
            if let Err(err) = plugin.on_match_end(match_id, winner_id) {
                tracing::warn!(plugin = %plugin.name(), %err, "on_match_end hook failed");
            }
        }
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct AllowPlugin;

    impl PluginHost for AllowPlugin {
        fn on_tick(&self, _ctx: &TickContext) -> Result<Vec<String>, PluginError> {
            Ok(vec!["allow_event".into()])
        }
        fn on_combat(&self, event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
            Ok(Some(event.clone()))
        }
        fn on_player_action(&self, _action: &PlayerAction) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Allow)
        }
        fn on_match_start(&self, _match_id: &str, _player_ids: &[String]) -> Result<(), PluginError> {
            Ok(())
        }
        fn on_match_end(&self, _match_id: &str, _winner_id: Option<&str>) -> Result<(), PluginError> {
            Ok(())
        }
        fn name(&self) -> &str {
            "allow-plugin"
        }
    }

    struct DenyPlugin;

    impl PluginHost for DenyPlugin {
        fn on_tick(&self, _ctx: &TickContext) -> Result<Vec<String>, PluginError> {
            Ok(Vec::new())
        }
        fn on_combat(&self, _event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
            Ok(None)
        }
        fn on_player_action(&self, _action: &PlayerAction) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }
        fn on_match_start(&self, _match_id: &str, _player_ids: &[String]) -> Result<(), PluginError> {
            Ok(())
        }
        fn on_match_end(&self, _match_id: &str, _winner_id: Option<&str>) -> Result<(), PluginError> {
            Ok(())
        }
        fn name(&self) -> &str {
            "deny-plugin"
        }
    }

    fn make_tick_ctx() -> TickContext {
        TickContext {
            tick: 1,
            player_count: 2,
            match_id: "m1".into(),
        }
    }

    fn make_combat_event() -> CombatEvent {
        CombatEvent {
            attacker_region: "r1".into(),
            defender_region: "r2".into(),
            attacker_units: 10,
            defender_units: 5,
        }
    }

    fn make_player_action() -> PlayerAction {
        PlayerAction {
            user_id: "u1".into(),
            action_type: "move".into(),
            payload: "{}".into(),
        }
    }

    #[test]
    fn empty_manager_allows_all() {
        let mgr = PluginManager::new();
        assert_eq!(mgr.on_player_action(&make_player_action()), ActionVerdict::Allow);
        assert!(mgr.on_tick(&make_tick_ctx()).is_empty());
    }

    #[test]
    fn allow_plugin_does_not_deny() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        assert_eq!(mgr.on_player_action(&make_player_action()), ActionVerdict::Allow);
    }

    #[test]
    fn deny_plugin_rejects_action() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(mgr.on_player_action(&make_player_action()), ActionVerdict::Deny);
    }

    #[test]
    fn deny_short_circuits_even_with_allow_first() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(mgr.on_player_action(&make_player_action()), ActionVerdict::Deny);
    }

    #[test]
    fn on_tick_collects_events_from_all_plugins() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        mgr.register(Box::new(AllowPlugin));
        let events = mgr.on_tick(&make_tick_ctx());
        assert_eq!(events.len(), 2);
    }

    #[test]
    fn on_combat_passes_event_through_chain() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        let result = mgr.on_combat(make_combat_event());
        assert_eq!(result.attacker_region, "r1");
    }

    #[test]
    fn plugin_count_is_accurate() {
        let mut mgr = PluginManager::new();
        assert_eq!(mgr.plugin_count(), 0);
        mgr.register(Box::new(AllowPlugin));
        assert_eq!(mgr.plugin_count(), 1);
    }
}
