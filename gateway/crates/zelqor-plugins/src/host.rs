use crate::{
    ActionVerdict, CombatEvent, PlayerAction, PluginError, PluginHost, PluginManifest,
    TickContext,
    sandbox::SandboxConfig,
};
use tracing::debug;
use wasmtime::{Config, Engine, Module, Store};

/// Per-invocation state for the plugin.
struct PluginState {
    host_call_count: u32,
    log_buffer: Vec<String>,
}

impl PluginState {
    fn new() -> Self {
        Self {
            host_call_count: 0,
            log_buffer: Vec::new(),
        }
    }
}

/// A loaded WASM plugin instance.
pub struct WasmPlugin {
    manifest: PluginManifest,
    engine: Engine,
    module: Module,
    sandbox: SandboxConfig,
}

impl WasmPlugin {
    /// Load a WASM plugin from bytes.
    pub fn load(
        wasm_bytes: &[u8],
        manifest: PluginManifest,
        sandbox: SandboxConfig,
    ) -> Result<Self, PluginError> {
        let mut config = Config::new();
        config.consume_fuel(true);
        config.wasm_memory64(false);

        let engine = Engine::new(&config)
            .map_err(|e| PluginError::Compilation(e.to_string()))?;

        let module = Module::new(&engine, wasm_bytes)
            .map_err(|e| PluginError::Compilation(e.to_string()))?;

        Ok(Self {
            manifest,
            engine,
            module,
            sandbox,
        })
    }

    /// Create a fresh store with sandbox limits applied.
    fn create_store(&self) -> Store<PluginState> {
        let mut store = Store::new(&self.engine, PluginState::new());
        store.set_fuel(self.sandbox.max_fuel_per_call).ok();
        store
    }
}

impl PluginHost for WasmPlugin {
    fn on_tick(&self, ctx: &TickContext) -> Result<Vec<String>, PluginError> {
        if !self.manifest.hooks.contains(&"on_tick".to_string()) {
            return Ok(Vec::new());
        }
        debug!(plugin = %self.manifest.name, tick = ctx.tick, "on_tick");
        // WASM invocation will be wired when WIT bindings are generated.
        // The store is created to validate sandbox limits are applied.
        let _store = self.create_store();
        Ok(Vec::new())
    }

    fn on_combat(&self, event: &CombatEvent) -> Result<Option<CombatEvent>, PluginError> {
        if !self.manifest.hooks.contains(&"on_combat".to_string()) {
            return Ok(None);
        }
        debug!(plugin = %self.manifest.name, "on_combat");
        let _store = self.create_store();
        Ok(None) // No modification until WIT bindings are wired
    }

    fn on_player_action(&self, action: &PlayerAction) -> Result<ActionVerdict, PluginError> {
        if !self.manifest.hooks.contains(&"on_player_action".to_string()) {
            return Ok(ActionVerdict::Allow);
        }
        debug!(plugin = %self.manifest.name, user = %action.user_id, "on_player_action");
        let _store = self.create_store();
        Ok(ActionVerdict::Allow) // Allow by default until WIT bindings are wired
    }

    fn on_match_start(&self, match_id: &str, player_ids: &[String]) -> Result<(), PluginError> {
        if !self.manifest.hooks.contains(&"on_match_start".to_string()) {
            return Ok(());
        }
        debug!(
            plugin = %self.manifest.name,
            match_id,
            players = player_ids.len(),
            "on_match_start"
        );
        let _store = self.create_store();
        Ok(())
    }

    fn on_match_end(&self, match_id: &str, winner_id: Option<&str>) -> Result<(), PluginError> {
        if !self.manifest.hooks.contains(&"on_match_end".to_string()) {
            return Ok(());
        }
        debug!(
            plugin = %self.manifest.name,
            match_id,
            ?winner_id,
            "on_match_end"
        );
        let _store = self.create_store();
        Ok(())
    }

    fn name(&self) -> &str {
        &self.manifest.name
    }
}
