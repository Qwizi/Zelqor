/// Sandbox configuration for WASM plugins.
#[derive(Debug, Clone)]
pub struct SandboxConfig {
    /// Maximum memory in bytes (default: 16MB).
    pub max_memory_bytes: usize,
    /// Maximum fuel per tick call (default: 1_000_000).
    pub max_fuel_per_call: u64,
    /// Maximum wall-clock time per hook call in milliseconds (default: 50).
    pub max_wall_clock_ms: u64,
    /// Maximum host calls per tick (default: 1000).
    pub max_host_calls_per_tick: u32,
}

impl Default for SandboxConfig {
    fn default() -> Self {
        Self {
            max_memory_bytes: 16 * 1024 * 1024, // 16MB
            max_fuel_per_call: 1_000_000,
            max_wall_clock_ms: 50,
            max_host_calls_per_tick: 1000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_limits_are_sane() {
        let cfg = SandboxConfig::default();
        assert_eq!(cfg.max_memory_bytes, 16 * 1024 * 1024);
        assert_eq!(cfg.max_fuel_per_call, 1_000_000);
        assert_eq!(cfg.max_wall_clock_ms, 50);
        assert_eq!(cfg.max_host_calls_per_tick, 1000);
    }
}
