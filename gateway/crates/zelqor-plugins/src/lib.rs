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

// ---------------------------------------------------------------------------
// Shared verdict type
// ---------------------------------------------------------------------------

/// Result from verdict hooks — allow or deny the action.
#[derive(Debug, Clone, PartialEq)]
pub enum ActionVerdict {
    Allow,
    Deny,
}

// ---------------------------------------------------------------------------
// Core events (original 5 hooks)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Economy events
// ---------------------------------------------------------------------------

/// Economy parameters for a single tick that plugins can modify.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EconomyContext {
    pub match_id: String,
    pub tick: u64,
    /// Income per region per tick.
    pub region_income: f64,
    /// Global multiplier applied to all income.
    pub income_multiplier: f64,
    /// Upkeep cost per unit per tick.
    pub unit_upkeep: f64,
}

/// An energy-spend attempt that plugins can allow or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnergyEvent {
    pub match_id: String,
    pub user_id: String,
    /// How much energy is being spent.
    pub amount: f64,
    /// Why the energy is being spent (e.g. "unit_produce", "ability").
    pub reason: String,
}

// ---------------------------------------------------------------------------
// Unit events
// ---------------------------------------------------------------------------

/// A unit production or destruction event that plugins can modify or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitEvent {
    pub match_id: String,
    pub user_id: String,
    pub region_id: String,
    pub unit_type: String,
    pub count: u32,
}

/// A unit movement order that plugins can modify or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitMoveEvent {
    pub match_id: String,
    pub user_id: String,
    pub from_region: String,
    pub to_region: String,
    pub unit_type: String,
    pub count: u32,
}

// ---------------------------------------------------------------------------
// Building events
// ---------------------------------------------------------------------------

/// A building construction, upgrade, or destruction event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingEvent {
    pub match_id: String,
    pub user_id: String,
    pub region_id: String,
    pub building_type: String,
    /// Current level (0 for new constructions).
    pub level: u32,
}

// ---------------------------------------------------------------------------
// Territory events
// ---------------------------------------------------------------------------

/// A region capture or loss event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegionEvent {
    pub match_id: String,
    /// Player who now owns / previously owned the region.
    pub user_id: String,
    pub region_id: String,
    /// The player from whom the region was taken, if any.
    pub previous_owner: Option<String>,
}

// ---------------------------------------------------------------------------
// Diplomacy events
// ---------------------------------------------------------------------------

/// A diplomacy proposal, acceptance, or rejection event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiplomacyEvent {
    pub match_id: String,
    pub proposer_id: String,
    pub target_id: String,
    /// e.g. "alliance", "non_aggression", "trade"
    pub deal_type: String,
}

// ---------------------------------------------------------------------------
// Ability / special events
// ---------------------------------------------------------------------------

/// An ability use event that plugins can modify or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityEvent {
    pub match_id: String,
    pub user_id: String,
    pub ability_id: String,
    pub target_region: Option<String>,
    pub payload: String,
}

/// A special-weapon launch event (nuke, bomber) that plugins can allow or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpecialEvent {
    pub match_id: String,
    pub user_id: String,
    /// "nuke" | "bomber"
    pub weapon_type: String,
    pub origin_region: String,
    pub target_region: String,
}

// ---------------------------------------------------------------------------
// Chat / voting events
// ---------------------------------------------------------------------------

/// A chat message event that plugins can allow or deny.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatEvent {
    pub match_id: String,
    pub user_id: String,
    pub message: String,
    /// "match" | "global" | "team"
    pub channel: String,
}

/// A vote-start or vote-end event.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoteEvent {
    pub match_id: String,
    pub initiator_id: String,
    /// e.g. "kick", "pause", "surrender"
    pub vote_type: String,
    /// JSON payload with vote-specific data.
    pub payload: String,
    /// Only populated on vote-end.
    pub outcome: Option<String>,
}

// ---------------------------------------------------------------------------
// PluginHost trait
// ---------------------------------------------------------------------------

/// Trait that all plugin hosts implement.
///
/// Every method has a default implementation so plugin authors only need to
/// override the hooks they care about.  `name` is the only required method.
pub trait PluginHost: Send + Sync {
    fn name(&self) -> &str;

    // --- Original 5 hooks ---------------------------------------------------

    fn on_tick(&self, _ctx: &TickContext) -> Result<Vec<String>, PluginError> {
        Ok(Vec::new())
    }

    fn on_combat(&self, _event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
        Ok(None)
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

    // --- Player lifecycle ----------------------------------------------------

    fn on_player_join(&self, _match_id: &str, _user_id: &str) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_player_leave(&self, _match_id: &str, _user_id: &str) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_player_eliminate(
        &self,
        _match_id: &str,
        _user_id: &str,
        _eliminated_by: Option<&str>,
    ) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Economy ------------------------------------------------------------

    /// Plugins may return a modified `EconomyContext`; returning `None` means
    /// no change.  Each plugin receives the output of the previous one.
    fn on_economy_tick(
        &self,
        ctx: &EconomyContext,
    ) -> Result<Option<EconomyContext>, PluginError> {
        let _ = ctx;
        Ok(None)
    }

    /// Plugins may deny energy spending; short-circuits on first `Deny`.
    fn on_energy_spend(&self, _event: &EnergyEvent) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    // --- Units & buildings --------------------------------------------------

    fn on_unit_produce(&self, _event: &UnitEvent) -> Result<Option<UnitEvent>, PluginError> {
        Ok(None)
    }

    fn on_unit_move(
        &self,
        _event: &UnitMoveEvent,
    ) -> Result<Option<UnitMoveEvent>, PluginError> {
        Ok(None)
    }

    fn on_building_construct(
        &self,
        _event: &BuildingEvent,
    ) -> Result<Option<BuildingEvent>, PluginError> {
        Ok(None)
    }

    fn on_building_upgrade(
        &self,
        _event: &BuildingEvent,
    ) -> Result<Option<BuildingEvent>, PluginError> {
        Ok(None)
    }

    fn on_building_destroy(&self, _event: &BuildingEvent) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Territory ----------------------------------------------------------

    fn on_region_capture(&self, _event: &RegionEvent) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_region_lose(&self, _event: &RegionEvent) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Diplomacy ----------------------------------------------------------

    fn on_diplomacy_propose(
        &self,
        _event: &DiplomacyEvent,
    ) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    fn on_diplomacy_accept(&self, _event: &DiplomacyEvent) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_diplomacy_reject(&self, _event: &DiplomacyEvent) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Capital & abilities ------------------------------------------------

    fn on_capital_select(
        &self,
        _match_id: &str,
        _user_id: &str,
        _region_id: &str,
    ) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    fn on_ability_use(
        &self,
        _event: &AbilityEvent,
    ) -> Result<Option<AbilityEvent>, PluginError> {
        Ok(None)
    }

    // --- Special weapons ----------------------------------------------------

    fn on_nuke_launch(&self, _event: &SpecialEvent) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    fn on_bomber_launch(&self, _event: &SpecialEvent) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    // --- Environment --------------------------------------------------------

    /// Returning `Ok(Some(weather))` overrides the incoming `new_weather`.
    fn on_weather_change(
        &self,
        _match_id: &str,
        _old_weather: &str,
        _new_weather: &str,
    ) -> Result<Option<String>, PluginError> {
        Ok(None)
    }

    fn on_day_night_change(&self, _match_id: &str, _phase: &str) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Chat & voting ------------------------------------------------------

    fn on_chat_message(&self, _event: &ChatEvent) -> Result<ActionVerdict, PluginError> {
        Ok(ActionVerdict::Allow)
    }

    fn on_vote_start(&self, _event: &VoteEvent) -> Result<(), PluginError> {
        Ok(())
    }

    fn on_vote_end(&self, _event: &VoteEvent) -> Result<(), PluginError> {
        Ok(())
    }

    // --- Config -------------------------------------------------------------

    /// Returning `Ok(Some(json))` replaces the config JSON for the match.
    fn on_config_reload(
        &self,
        _match_id: &str,
        _config_json: &str,
    ) -> Result<Option<String>, PluginError> {
        Ok(None)
    }
}

// ---------------------------------------------------------------------------
// PluginManager
// ---------------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Informational dispatch helpers (fire-and-forget)
    // -----------------------------------------------------------------------

    fn dispatch_info<F>(&self, hook_name: &str, f: F)
    where
        F: Fn(&dyn PluginHost) -> Result<(), PluginError>,
    {
        for plugin in &self.plugins {
            if let Err(err) = f(plugin.as_ref()) {
                tracing::warn!(plugin = %plugin.name(), hook = hook_name, %err, "hook failed");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Modifier dispatch helpers (pipeline / chain)
    // -----------------------------------------------------------------------

    fn dispatch_modifier<T, F>(&self, hook_name: &str, initial: T, f: F) -> T
    where
        T: Clone,
        F: Fn(&dyn PluginHost, &T) -> Result<Option<T>, PluginError>,
    {
        let mut current = initial;
        for plugin in &self.plugins {
            match f(plugin.as_ref(), &current) {
                Ok(Some(modified)) => current = modified,
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(plugin = %plugin.name(), hook = hook_name, %err, "hook failed");
                }
            }
        }
        current
    }

    // -----------------------------------------------------------------------
    // Verdict dispatch helpers (short-circuit on Deny)
    // -----------------------------------------------------------------------

    fn dispatch_verdict<F>(&self, hook_name: &str, f: F) -> ActionVerdict
    where
        F: Fn(&dyn PluginHost) -> Result<ActionVerdict, PluginError>,
    {
        for plugin in &self.plugins {
            match f(plugin.as_ref()) {
                Ok(ActionVerdict::Deny) => {
                    tracing::debug!(plugin = %plugin.name(), hook = hook_name, "Plugin denied");
                    return ActionVerdict::Deny;
                }
                Ok(ActionVerdict::Allow) => {}
                Err(err) => {
                    tracing::warn!(plugin = %plugin.name(), hook = hook_name, %err, "hook failed");
                }
            }
        }
        ActionVerdict::Allow
    }

    // -----------------------------------------------------------------------
    // Original 5 hooks
    // -----------------------------------------------------------------------

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

    /// Dispatch on_combat to all plugins. Each plugin receives the (potentially
    /// modified) output of the previous one.
    pub fn on_combat(&self, event: CombatEvent) -> CombatEvent {
        self.dispatch_modifier("on_combat", event, |p, e| p.on_combat(e))
    }

    /// Dispatch on_player_action. Short-circuits on first Deny.
    pub fn on_player_action(&self, action: &PlayerAction) -> ActionVerdict {
        self.dispatch_verdict("on_player_action", |p| p.on_player_action(action))
    }

    /// Dispatch on_match_start to all plugins.
    pub fn on_match_start(&self, match_id: &str, player_ids: &[String]) {
        self.dispatch_info("on_match_start", |p| p.on_match_start(match_id, player_ids));
    }

    /// Dispatch on_match_end to all plugins.
    pub fn on_match_end(&self, match_id: &str, winner_id: Option<&str>) {
        self.dispatch_info("on_match_end", |p| p.on_match_end(match_id, winner_id));
    }

    // -----------------------------------------------------------------------
    // Player lifecycle
    // -----------------------------------------------------------------------

    pub fn on_player_join(&self, match_id: &str, user_id: &str) {
        self.dispatch_info("on_player_join", |p| p.on_player_join(match_id, user_id));
    }

    pub fn on_player_leave(&self, match_id: &str, user_id: &str) {
        self.dispatch_info("on_player_leave", |p| p.on_player_leave(match_id, user_id));
    }

    pub fn on_player_eliminate(
        &self,
        match_id: &str,
        user_id: &str,
        eliminated_by: Option<&str>,
    ) {
        self.dispatch_info("on_player_eliminate", |p| {
            p.on_player_eliminate(match_id, user_id, eliminated_by)
        });
    }

    // -----------------------------------------------------------------------
    // Economy
    // -----------------------------------------------------------------------

    /// Chain economy context through all plugins. Each plugin may modify it.
    pub fn on_economy_tick(&self, ctx: EconomyContext) -> EconomyContext {
        self.dispatch_modifier("on_economy_tick", ctx, |p, c| p.on_economy_tick(c))
    }

    /// Short-circuits on first Deny.
    pub fn on_energy_spend(&self, event: &EnergyEvent) -> ActionVerdict {
        self.dispatch_verdict("on_energy_spend", |p| p.on_energy_spend(event))
    }

    // -----------------------------------------------------------------------
    // Units & buildings
    // -----------------------------------------------------------------------

    pub fn on_unit_produce(&self, event: UnitEvent) -> UnitEvent {
        self.dispatch_modifier("on_unit_produce", event, |p, e| p.on_unit_produce(e))
    }

    pub fn on_unit_move(&self, event: UnitMoveEvent) -> UnitMoveEvent {
        self.dispatch_modifier("on_unit_move", event, |p, e| p.on_unit_move(e))
    }

    pub fn on_building_construct(&self, event: BuildingEvent) -> BuildingEvent {
        self.dispatch_modifier("on_building_construct", event, |p, e| {
            p.on_building_construct(e)
        })
    }

    pub fn on_building_upgrade(&self, event: BuildingEvent) -> BuildingEvent {
        self.dispatch_modifier("on_building_upgrade", event, |p, e| {
            p.on_building_upgrade(e)
        })
    }

    pub fn on_building_destroy(&self, event: &BuildingEvent) {
        self.dispatch_info("on_building_destroy", |p| p.on_building_destroy(event));
    }

    // -----------------------------------------------------------------------
    // Territory
    // -----------------------------------------------------------------------

    pub fn on_region_capture(&self, event: &RegionEvent) {
        self.dispatch_info("on_region_capture", |p| p.on_region_capture(event));
    }

    pub fn on_region_lose(&self, event: &RegionEvent) {
        self.dispatch_info("on_region_lose", |p| p.on_region_lose(event));
    }

    // -----------------------------------------------------------------------
    // Diplomacy
    // -----------------------------------------------------------------------

    /// Short-circuits on first Deny.
    pub fn on_diplomacy_propose(&self, event: &DiplomacyEvent) -> ActionVerdict {
        self.dispatch_verdict("on_diplomacy_propose", |p| p.on_diplomacy_propose(event))
    }

    pub fn on_diplomacy_accept(&self, event: &DiplomacyEvent) {
        self.dispatch_info("on_diplomacy_accept", |p| p.on_diplomacy_accept(event));
    }

    pub fn on_diplomacy_reject(&self, event: &DiplomacyEvent) {
        self.dispatch_info("on_diplomacy_reject", |p| p.on_diplomacy_reject(event));
    }

    // -----------------------------------------------------------------------
    // Capital & abilities
    // -----------------------------------------------------------------------

    /// Short-circuits on first Deny.
    pub fn on_capital_select(
        &self,
        match_id: &str,
        user_id: &str,
        region_id: &str,
    ) -> ActionVerdict {
        self.dispatch_verdict("on_capital_select", |p| {
            p.on_capital_select(match_id, user_id, region_id)
        })
    }

    pub fn on_ability_use(&self, event: AbilityEvent) -> AbilityEvent {
        self.dispatch_modifier("on_ability_use", event, |p, e| p.on_ability_use(e))
    }

    // -----------------------------------------------------------------------
    // Special weapons
    // -----------------------------------------------------------------------

    /// Short-circuits on first Deny.
    pub fn on_nuke_launch(&self, event: &SpecialEvent) -> ActionVerdict {
        self.dispatch_verdict("on_nuke_launch", |p| p.on_nuke_launch(event))
    }

    /// Short-circuits on first Deny.
    pub fn on_bomber_launch(&self, event: &SpecialEvent) -> ActionVerdict {
        self.dispatch_verdict("on_bomber_launch", |p| p.on_bomber_launch(event))
    }

    // -----------------------------------------------------------------------
    // Environment
    // -----------------------------------------------------------------------

    /// Chain weather through plugins. Each plugin can override the value;
    /// the last plugin to return `Some` wins.
    pub fn on_weather_change(
        &self,
        match_id: &str,
        old_weather: &str,
        new_weather: &str,
    ) -> String {
        let mut current = new_weather.to_string();
        for plugin in &self.plugins {
            match plugin.on_weather_change(match_id, old_weather, &current) {
                Ok(Some(overridden)) => current = overridden,
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(
                        plugin = %plugin.name(),
                        hook = "on_weather_change",
                        %err,
                        "hook failed"
                    );
                }
            }
        }
        current
    }

    pub fn on_day_night_change(&self, match_id: &str, phase: &str) {
        self.dispatch_info("on_day_night_change", |p| {
            p.on_day_night_change(match_id, phase)
        });
    }

    // -----------------------------------------------------------------------
    // Chat & voting
    // -----------------------------------------------------------------------

    /// Short-circuits on first Deny.
    pub fn on_chat_message(&self, event: &ChatEvent) -> ActionVerdict {
        self.dispatch_verdict("on_chat_message", |p| p.on_chat_message(event))
    }

    pub fn on_vote_start(&self, event: &VoteEvent) {
        self.dispatch_info("on_vote_start", |p| p.on_vote_start(event));
    }

    pub fn on_vote_end(&self, event: &VoteEvent) {
        self.dispatch_info("on_vote_end", |p| p.on_vote_end(event));
    }

    // -----------------------------------------------------------------------
    // Config
    // -----------------------------------------------------------------------

    /// Chain config JSON through plugins. Each plugin may return a replacement.
    pub fn on_config_reload(&self, match_id: &str, config_json: &str) -> String {
        let mut current = config_json.to_string();
        for plugin in &self.plugins {
            match plugin.on_config_reload(match_id, &current) {
                Ok(Some(modified)) => current = modified,
                Ok(None) => {}
                Err(err) => {
                    tracing::warn!(
                        plugin = %plugin.name(),
                        hook = "on_config_reload",
                        %err,
                        "hook failed"
                    );
                }
            }
        }
        current
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Test plugin implementations
    // -----------------------------------------------------------------------

    /// A plugin that allows everything and emits one tick event.
    struct AllowPlugin;

    impl PluginHost for AllowPlugin {
        fn name(&self) -> &str {
            "allow-plugin"
        }

        fn on_tick(&self, _ctx: &TickContext) -> Result<Vec<String>, PluginError> {
            Ok(vec!["allow_event".into()])
        }

        fn on_combat(&self, event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
            Ok(Some(event.clone()))
        }

        fn on_player_action(&self, _action: &PlayerAction) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Allow)
        }

        fn on_match_start(
            &self,
            _match_id: &str,
            _player_ids: &[String],
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn on_match_end(
            &self,
            _match_id: &str,
            _winner_id: Option<&str>,
        ) -> Result<(), PluginError> {
            Ok(())
        }
    }

    /// A plugin that denies every verdict hook and leaves modifiers unchanged.
    struct DenyPlugin;

    impl PluginHost for DenyPlugin {
        fn name(&self) -> &str {
            "deny-plugin"
        }

        fn on_tick(&self, _ctx: &TickContext) -> Result<Vec<String>, PluginError> {
            Ok(Vec::new())
        }

        fn on_combat(&self, _event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
            Ok(None)
        }

        fn on_player_action(&self, _action: &PlayerAction) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_match_start(
            &self,
            _match_id: &str,
            _player_ids: &[String],
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn on_match_end(
            &self,
            _match_id: &str,
            _winner_id: Option<&str>,
        ) -> Result<(), PluginError> {
            Ok(())
        }

        fn on_energy_spend(&self, _event: &EnergyEvent) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_diplomacy_propose(
            &self,
            _event: &DiplomacyEvent,
        ) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_capital_select(
            &self,
            _match_id: &str,
            _user_id: &str,
            _region_id: &str,
        ) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_nuke_launch(&self, _event: &SpecialEvent) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_bomber_launch(&self, _event: &SpecialEvent) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }

        fn on_chat_message(&self, _event: &ChatEvent) -> Result<ActionVerdict, PluginError> {
            Ok(ActionVerdict::Deny)
        }
    }

    /// A plugin that doubles unit counts in production events.
    struct UnitDoublerPlugin;

    impl PluginHost for UnitDoublerPlugin {
        fn name(&self) -> &str {
            "unit-doubler"
        }

        fn on_unit_produce(&self, event: &UnitEvent) -> Result<Option<UnitEvent>, PluginError> {
            let mut modified = event.clone();
            modified.count *= 2;
            Ok(Some(modified))
        }
    }

    /// A plugin that overrides weather to always be "sunny".
    struct SunnyWeatherPlugin;

    impl PluginHost for SunnyWeatherPlugin {
        fn name(&self) -> &str {
            "sunny-weather"
        }

        fn on_weather_change(
            &self,
            _match_id: &str,
            _old_weather: &str,
            _new_weather: &str,
        ) -> Result<Option<String>, PluginError> {
            Ok(Some("sunny".to_string()))
        }
    }

    /// A plugin that modifies config JSON.
    struct ConfigPlugin;

    impl PluginHost for ConfigPlugin {
        fn name(&self) -> &str {
            "config-plugin"
        }

        fn on_config_reload(
            &self,
            _match_id: &str,
            _config_json: &str,
        ) -> Result<Option<String>, PluginError> {
            Ok(Some(r#"{"modified":true}"#.to_string()))
        }
    }

    // -----------------------------------------------------------------------
    // Fixture helpers
    // -----------------------------------------------------------------------

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

    fn make_economy_ctx() -> EconomyContext {
        EconomyContext {
            match_id: "m1".into(),
            tick: 1,
            region_income: 10.0,
            income_multiplier: 1.0,
            unit_upkeep: 0.5,
        }
    }

    fn make_unit_event() -> UnitEvent {
        UnitEvent {
            match_id: "m1".into(),
            user_id: "u1".into(),
            region_id: "r1".into(),
            unit_type: "infantry".into(),
            count: 5,
        }
    }

    fn make_special_event() -> SpecialEvent {
        SpecialEvent {
            match_id: "m1".into(),
            user_id: "u1".into(),
            weapon_type: "nuke".into(),
            origin_region: "r1".into(),
            target_region: "r2".into(),
        }
    }

    fn make_chat_event() -> ChatEvent {
        ChatEvent {
            match_id: "m1".into(),
            user_id: "u1".into(),
            message: "hello".into(),
            channel: "match".into(),
        }
    }

    fn make_diplomacy_event() -> DiplomacyEvent {
        DiplomacyEvent {
            match_id: "m1".into(),
            proposer_id: "u1".into(),
            target_id: "u2".into(),
            deal_type: "alliance".into(),
        }
    }

    fn make_energy_event() -> EnergyEvent {
        EnergyEvent {
            match_id: "m1".into(),
            user_id: "u1".into(),
            amount: 50.0,
            reason: "unit_produce".into(),
        }
    }

    // -----------------------------------------------------------------------
    // Original 5 hook tests (must keep passing)
    // -----------------------------------------------------------------------

    #[test]
    fn empty_manager_allows_all() {
        let mgr = PluginManager::new();
        assert_eq!(
            mgr.on_player_action(&make_player_action()),
            ActionVerdict::Allow
        );
        assert!(mgr.on_tick(&make_tick_ctx()).is_empty());
    }

    #[test]
    fn allow_plugin_does_not_deny() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        assert_eq!(
            mgr.on_player_action(&make_player_action()),
            ActionVerdict::Allow
        );
    }

    #[test]
    fn deny_plugin_rejects_action() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(
            mgr.on_player_action(&make_player_action()),
            ActionVerdict::Deny
        );
    }

    #[test]
    fn deny_short_circuits_even_with_allow_first() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(
            mgr.on_player_action(&make_player_action()),
            ActionVerdict::Deny
        );
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

    // -----------------------------------------------------------------------
    // Default-implementation tests (new hooks)
    // -----------------------------------------------------------------------

    #[test]
    fn default_hooks_compile_and_return_ok() {
        // AllowPlugin only overrides a subset; the rest use default impls.
        // This test ensures the defaults are reachable and correct.
        let plugin = AllowPlugin;
        assert!(plugin.on_player_join("m1", "u1").is_ok());
        assert!(plugin.on_player_leave("m1", "u1").is_ok());
        assert!(plugin.on_player_eliminate("m1", "u1", None).is_ok());
        assert_eq!(
            plugin.on_energy_spend(&make_energy_event()).unwrap(),
            ActionVerdict::Allow
        );
        assert!(plugin.on_economy_tick(&make_economy_ctx()).unwrap().is_none());
        assert!(plugin.on_unit_produce(&make_unit_event()).unwrap().is_none());
        assert!(plugin.on_region_capture(&RegionEvent {
            match_id: "m1".into(),
            user_id: "u1".into(),
            region_id: "r1".into(),
            previous_owner: None,
        }).is_ok());
        assert_eq!(
            plugin.on_nuke_launch(&make_special_event()).unwrap(),
            ActionVerdict::Allow
        );
        assert_eq!(
            plugin.on_chat_message(&make_chat_event()).unwrap(),
            ActionVerdict::Allow
        );
        assert!(plugin.on_weather_change("m1", "rain", "snow").unwrap().is_none());
        assert!(plugin.on_config_reload("m1", "{}").unwrap().is_none());
    }

    // -----------------------------------------------------------------------
    // Economy hooks
    // -----------------------------------------------------------------------

    #[test]
    fn economy_tick_passes_through_with_no_modifier() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin)); // uses default — no modification
        let ctx = make_economy_ctx();
        let result = mgr.on_economy_tick(ctx.clone());
        assert!((result.region_income - ctx.region_income).abs() < f64::EPSILON);
    }

    #[test]
    fn energy_spend_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(mgr.on_energy_spend(&make_energy_event()), ActionVerdict::Deny);
    }

    #[test]
    fn energy_spend_allowed_when_no_plugins() {
        let mgr = PluginManager::new();
        assert_eq!(mgr.on_energy_spend(&make_energy_event()), ActionVerdict::Allow);
    }

    // -----------------------------------------------------------------------
    // Unit hooks
    // -----------------------------------------------------------------------

    #[test]
    fn unit_doubler_modifies_count() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(UnitDoublerPlugin));
        let result = mgr.on_unit_produce(make_unit_event());
        assert_eq!(result.count, 10); // 5 * 2
    }

    #[test]
    fn unit_doubler_chained_twice_quadruples() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(UnitDoublerPlugin));
        mgr.register(Box::new(UnitDoublerPlugin));
        let result = mgr.on_unit_produce(make_unit_event());
        assert_eq!(result.count, 20); // 5 * 2 * 2
    }

    // -----------------------------------------------------------------------
    // Special weapon hooks
    // -----------------------------------------------------------------------

    #[test]
    fn nuke_allowed_with_no_plugins() {
        let mgr = PluginManager::new();
        assert_eq!(mgr.on_nuke_launch(&make_special_event()), ActionVerdict::Allow);
    }

    #[test]
    fn nuke_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(mgr.on_nuke_launch(&make_special_event()), ActionVerdict::Deny);
    }

    #[test]
    fn bomber_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(
            mgr.on_bomber_launch(&make_special_event()),
            ActionVerdict::Deny
        );
    }

    // -----------------------------------------------------------------------
    // Diplomacy hooks
    // -----------------------------------------------------------------------

    #[test]
    fn diplomacy_propose_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(
            mgr.on_diplomacy_propose(&make_diplomacy_event()),
            ActionVerdict::Deny
        );
    }

    #[test]
    fn diplomacy_propose_allowed_with_allow_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(AllowPlugin));
        assert_eq!(
            mgr.on_diplomacy_propose(&make_diplomacy_event()),
            ActionVerdict::Allow
        );
    }

    // -----------------------------------------------------------------------
    // Capital selection
    // -----------------------------------------------------------------------

    #[test]
    fn capital_select_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(
            mgr.on_capital_select("m1", "u1", "r1"),
            ActionVerdict::Deny
        );
    }

    // -----------------------------------------------------------------------
    // Chat hook
    // -----------------------------------------------------------------------

    #[test]
    fn chat_denied_by_deny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(DenyPlugin));
        assert_eq!(mgr.on_chat_message(&make_chat_event()), ActionVerdict::Deny);
    }

    #[test]
    fn chat_allowed_when_no_plugins() {
        let mgr = PluginManager::new();
        assert_eq!(
            mgr.on_chat_message(&make_chat_event()),
            ActionVerdict::Allow
        );
    }

    // -----------------------------------------------------------------------
    // Weather override
    // -----------------------------------------------------------------------

    #[test]
    fn weather_overridden_by_sunny_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(SunnyWeatherPlugin));
        assert_eq!(mgr.on_weather_change("m1", "rain", "storm"), "sunny");
    }

    #[test]
    fn weather_unchanged_with_no_plugins() {
        let mgr = PluginManager::new();
        assert_eq!(mgr.on_weather_change("m1", "rain", "snow"), "snow");
    }

    // -----------------------------------------------------------------------
    // Config reload
    // -----------------------------------------------------------------------

    #[test]
    fn config_reload_modified_by_plugin() {
        let mut mgr = PluginManager::new();
        mgr.register(Box::new(ConfigPlugin));
        let result = mgr.on_config_reload("m1", r#"{"original":true}"#);
        assert_eq!(result, r#"{"modified":true}"#);
    }

    #[test]
    fn config_reload_unchanged_with_no_plugins() {
        let mgr = PluginManager::new();
        let json = r#"{"key":"value"}"#;
        assert_eq!(mgr.on_config_reload("m1", json), json);
    }
}
