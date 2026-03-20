use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Game settings snapshot — mirrors Django's settings_snapshot JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameSettings {
    #[serde(default = "default_tick_interval")]
    pub tick_interval_ms: u64,
    #[serde(default = "default_capital_selection_time")]
    pub capital_selection_time_seconds: u64,
    #[serde(default = "default_base_unit_generation_rate")]
    pub base_unit_generation_rate: f64,
    #[serde(default = "default_capital_generation_bonus")]
    pub capital_generation_bonus: f64,
    #[serde(default = "default_starting_energy")]
    pub starting_energy: i64,
    #[serde(default = "default_base_energy_per_tick")]
    pub base_energy_per_tick: f64,
    #[serde(default = "default_region_energy_per_tick")]
    pub region_energy_per_tick: f64,
    #[serde(default)]
    pub attacker_advantage: f64,
    #[serde(default = "default_defender_advantage")]
    pub defender_advantage: f64,
    #[serde(default = "default_combat_randomness")]
    pub combat_randomness: f64,
    #[serde(default = "default_starting_units")]
    pub starting_units: i64,
    #[serde(default = "default_neutral_region_units")]
    pub neutral_region_units: i64,
    #[serde(default)]
    pub building_types: HashMap<String, BuildingConfig>,
    #[serde(default)]
    pub unit_types: HashMap<String, UnitConfig>,
    #[serde(default)]
    pub ability_types: HashMap<String, AbilityConfig>,
    #[serde(default)]
    pub default_unit_type_slug: Option<String>,
    #[serde(default = "default_min_capital_distance")]
    pub min_capital_distance: i64,
    #[serde(default = "default_elo_k_factor")]
    pub elo_k_factor: i64,
    #[serde(default)]
    pub match_duration_limit_minutes: u64,
    #[serde(default = "default_true")]
    pub weather_enabled: bool,
    #[serde(default = "default_true")]
    pub day_night_enabled: bool,

    // Weather gameplay modifiers
    #[serde(default = "default_night_defense_modifier")]
    pub night_defense_modifier: f64,
    #[serde(default = "default_dawn_dusk_defense_modifier")]
    pub dawn_dusk_defense_modifier: f64,
    #[serde(default = "default_storm_randomness_modifier")]
    pub storm_randomness_modifier: f64,
    #[serde(default = "default_fog_randomness_modifier")]
    pub fog_randomness_modifier: f64,
    #[serde(default = "default_rain_randomness_modifier")]
    pub rain_randomness_modifier: f64,
    #[serde(default = "default_storm_energy_modifier")]
    pub storm_energy_modifier: f64,
    #[serde(default = "default_rain_energy_modifier")]
    pub rain_energy_modifier: f64,
    #[serde(default = "default_storm_unit_gen_modifier")]
    pub storm_unit_gen_modifier: f64,
    #[serde(default = "default_rain_unit_gen_modifier")]
    pub rain_unit_gen_modifier: f64,

    // Gameplay limits
    #[serde(default = "default_disconnect_grace_seconds")]
    pub disconnect_grace_seconds: u64,
    #[serde(default = "default_max_build_queue_per_region")]
    pub max_build_queue_per_region: u64,
    #[serde(default = "default_max_unit_queue_per_region")]
    pub max_unit_queue_per_region: u64,
    #[serde(default = "default_casualty_factor")]
    pub casualty_factor: f64,
    #[serde(default = "default_snapshot_interval_ticks")]
    pub snapshot_interval_ticks: u64,

    // Game module system (weather, combat, economy, etc.)
    #[serde(default)]
    pub modules: HashMap<String, ModuleConfig>,

    // System module configs (anticheat, chat, matchmaking, etc.)
    #[serde(default)]
    pub system_modules: HashMap<String, SystemModuleSnapshot>,
}

/// Configuration for a single game module.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
}

/// Snapshot of a system module's state and config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemModuleSnapshot {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
}

impl GameSettings {
    /// Check if a system module is enabled.
    pub fn is_system_module_enabled(&self, slug: &str) -> bool {
        self.system_modules
            .get(slug)
            .map(|m| m.enabled)
            .unwrap_or(true) // fail-open
    }

    /// Get a system module config value as a specific type.
    pub fn system_module_config<T: serde::de::DeserializeOwned>(
        &self,
        slug: &str,
        key: &str,
        default: T,
    ) -> T {
        self.system_modules
            .get(slug)
            .and_then(|m| m.config.get(key))
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or(default)
    }
}

fn default_true() -> bool { true }
fn default_tick_interval() -> u64 { 1000 }
fn default_capital_selection_time() -> u64 { 30 }
fn default_base_unit_generation_rate() -> f64 { 1.0 }
fn default_capital_generation_bonus() -> f64 { 2.0 }
fn default_starting_energy() -> i64 { 120 }
fn default_base_energy_per_tick() -> f64 { 2.0 }
fn default_region_energy_per_tick() -> f64 { 0.35 }
fn default_defender_advantage() -> f64 { 0.1 }
fn default_combat_randomness() -> f64 { 0.2 }
fn default_starting_units() -> i64 { 10 }
fn default_neutral_region_units() -> i64 { 3 }
fn default_min_capital_distance() -> i64 { 3 }
fn default_elo_k_factor() -> i64 { 32 }
fn default_night_defense_modifier() -> f64 { 1.15 }
fn default_dawn_dusk_defense_modifier() -> f64 { 1.05 }
fn default_storm_randomness_modifier() -> f64 { 1.4 }
fn default_fog_randomness_modifier() -> f64 { 1.25 }
fn default_rain_randomness_modifier() -> f64 { 1.1 }
fn default_storm_energy_modifier() -> f64 { 0.85 }
fn default_rain_energy_modifier() -> f64 { 0.95 }
fn default_storm_unit_gen_modifier() -> f64 { 0.90 }
fn default_rain_unit_gen_modifier() -> f64 { 0.95 }
fn default_disconnect_grace_seconds() -> u64 { 180 }
fn default_max_build_queue_per_region() -> u64 { 3 }
fn default_max_unit_queue_per_region() -> u64 { 4 }
fn default_casualty_factor() -> f64 { 0.5 }
fn default_snapshot_interval_ticks() -> u64 { 30 }

impl Default for GameSettings {
    fn default() -> Self {
        Self {
            tick_interval_ms: default_tick_interval(),
            capital_selection_time_seconds: default_capital_selection_time(),
            base_unit_generation_rate: default_base_unit_generation_rate(),
            capital_generation_bonus: default_capital_generation_bonus(),
            starting_energy: default_starting_energy(),
            base_energy_per_tick: default_base_energy_per_tick(),
            region_energy_per_tick: default_region_energy_per_tick(),
            attacker_advantage: 0.0,
            defender_advantage: default_defender_advantage(),
            combat_randomness: default_combat_randomness(),
            starting_units: default_starting_units(),
            neutral_region_units: default_neutral_region_units(),
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: None,
            min_capital_distance: default_min_capital_distance(),
            elo_k_factor: default_elo_k_factor(),
            match_duration_limit_minutes: 0,
            weather_enabled: true,
            day_night_enabled: true,
            night_defense_modifier: default_night_defense_modifier(),
            dawn_dusk_defense_modifier: default_dawn_dusk_defense_modifier(),
            storm_randomness_modifier: default_storm_randomness_modifier(),
            fog_randomness_modifier: default_fog_randomness_modifier(),
            rain_randomness_modifier: default_rain_randomness_modifier(),
            storm_energy_modifier: default_storm_energy_modifier(),
            rain_energy_modifier: default_rain_energy_modifier(),
            storm_unit_gen_modifier: default_storm_unit_gen_modifier(),
            rain_unit_gen_modifier: default_rain_unit_gen_modifier(),
            disconnect_grace_seconds: default_disconnect_grace_seconds(),
            max_build_queue_per_region: default_max_build_queue_per_region(),
            max_unit_queue_per_region: default_max_unit_queue_per_region(),
            casualty_factor: default_casualty_factor(),
            snapshot_interval_ticks: default_snapshot_interval_ticks(),
            modules: HashMap::new(),
            system_modules: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingConfig {
    #[serde(default)]
    pub cost: i64,
    #[serde(default)]
    pub energy_cost: i64,
    #[serde(default = "default_build_time")]
    pub build_time_ticks: i64,
    #[serde(default = "default_max_per_region")]
    pub max_per_region: i64,
    #[serde(default)]
    pub defense_bonus: f64,
    #[serde(default)]
    pub vision_range: i64,
    #[serde(default)]
    pub unit_generation_bonus: f64,
    #[serde(default)]
    pub energy_generation_bonus: f64,
    #[serde(default)]
    pub requires_coastal: bool,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub asset_key: String,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub produced_unit_slug: Option<String>,
    #[serde(default = "default_max_level")]
    pub max_level: i64,
    #[serde(default)]
    pub level_stats: HashMap<String, serde_json::Value>,
}

fn default_build_time() -> i64 { 10 }
fn default_max_per_region() -> i64 { 1 }
fn default_max_level() -> i64 { 3 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UnitConfig {
    #[serde(default = "default_f64_one")]
    pub attack: f64,
    #[serde(default = "default_f64_one")]
    pub defense: f64,
    #[serde(default = "default_i64_one")]
    pub speed: i64,
    #[serde(default = "default_i64_one")]
    pub attack_range: i64,
    #[serde(default)]
    pub sea_range: i64,
    #[serde(default)]
    pub sea_hop_distance_km: i64,
    #[serde(default = "default_movement_type")]
    pub movement_type: String,
    #[serde(default)]
    pub production_cost: i64,
    #[serde(default)]
    pub production_time_ticks: i64,
    #[serde(default)]
    pub produced_by_slug: Option<String>,
    #[serde(default = "default_i64_one")]
    pub manpower_cost: i64,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub asset_key: String,
    #[serde(default = "default_max_level")]
    pub max_level: i64,
    #[serde(default)]
    pub level_stats: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub is_stealth: bool,
    #[serde(default)]
    pub path_damage: f64,
    #[serde(default)]
    pub aoe_damage: f64,
    #[serde(default)]
    pub blockade_port: bool,
    #[serde(default)]
    pub intercept_air: bool,
    #[serde(default)]
    pub can_station_anywhere: bool,
    #[serde(default)]
    pub lifetime_ticks: i64,
    #[serde(default = "default_combat_target")]
    pub combat_target: String,
    /// Ticks per province-hop for air transit (0 = use ground speed formula).
    /// Higher = slower. E.g. bomber=4 means 4 ticks per hop, fighter=2.
    #[serde(default)]
    pub air_speed_ticks_per_hop: i64,
    /// Ticks per province-hop for ground/sea transit (0 = use legacy speed formula).
    /// Higher = slower. E.g. infantry=3 means 3 ticks per hop, commando=1.
    #[serde(default)]
    pub ticks_per_hop: i64,
}

fn default_combat_target() -> String {
    "ground".to_string()
}

/// Ability config — mirrors Django AbilityType snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AbilityConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub asset_key: String,
    #[serde(default)]
    pub sound_key: String,
    #[serde(default = "default_target_type")]
    pub target_type: String,
    #[serde(default)]
    pub range: i64,
    #[serde(default)]
    pub energy_cost: i64,
    #[serde(default = "default_cooldown")]
    pub cooldown_ticks: i64,
    #[serde(default)]
    pub damage: i64,
    #[serde(default)]
    pub effect_duration_ticks: i64,
    #[serde(default)]
    pub effect_params: serde_json::Value,
    #[serde(default = "default_max_level")]
    pub max_level: i64,
    #[serde(default)]
    pub level_stats: HashMap<String, serde_json::Value>,
}

fn default_target_type() -> String { "enemy".into() }
fn default_cooldown() -> i64 { 60 }

/// Temporary in-match boost activated during gameplay, expires after N ticks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveMatchBoost {
    pub slug: String,
    #[serde(default)]
    pub effect_type: String,
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub ticks_remaining: i64,
    #[serde(default)]
    pub total_ticks: i64,
}

/// A pre-match boost applied to a player for the entire match (from deck).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveBoost {
    /// Slug identifying the boost type.
    pub slug: String,
    /// Boost parameters (e.g. `{"effect_type": "energy_bonus", "value": 0.2}`).
    #[serde(default)]
    pub params: serde_json::Value,
}

/// Active persistent effect during a match.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveEffect {
    #[serde(default)]
    pub effect_type: String,
    #[serde(default)]
    pub source_player_id: String,
    #[serde(default)]
    pub target_region_id: String,
    #[serde(default)]
    pub affected_region_ids: Vec<String>,
    #[serde(default)]
    pub ticks_remaining: i64,
    #[serde(default)]
    pub total_ticks: i64,
    #[serde(default)]
    pub params: serde_json::Value,
}

fn default_f64_one() -> f64 { 1.0 }
pub fn default_i64_one() -> i64 { 1 }
fn default_movement_type() -> String { "land".into() }

/// An individual building instance placed in a region.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BuildingInstance {
    pub building_type: String,
    #[serde(default = "default_i64_one")]
    pub level: i64,
}

/// Player state stored in Redis.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Player {
    pub user_id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub color: String,
    #[serde(default = "default_true")]
    pub is_alive: bool,
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub disconnect_deadline: Option<i64>,
    #[serde(default)]
    pub left_match_at: Option<i64>,
    #[serde(default)]
    pub eliminated_reason: Option<String>,
    #[serde(default)]
    pub eliminated_tick: Option<i64>,
    #[serde(default)]
    pub capital_region_id: Option<String>,
    #[serde(default)]
    pub energy: i64,
    #[serde(default)]
    pub energy_accum: f64,
    #[serde(default)]
    pub ability_cooldowns: HashMap<String, i64>,
    #[serde(default)]
    pub is_bot: bool,
    /// Cumulative units produced via the unit production queue during the match.
    #[serde(default)]
    pub total_units_produced: u32,
    /// Cumulative units lost in combat (attacking units that died, or defending units wiped out).
    #[serde(default)]
    pub total_units_lost: u32,
    /// Cumulative regions conquered (successful attacks that changed ownership).
    #[serde(default)]
    pub total_regions_conquered: u32,
    /// Cumulative buildings constructed during the match.
    #[serde(default)]
    pub total_buildings_built: u32,
    /// Building slugs unlocked by blueprints (from deck).
    /// When non-empty, only these building types (plus always-available ones) may be built.
    #[serde(default)]
    pub unlocked_buildings: Vec<String>,
    /// Unit slugs unlocked by blueprints (from deck).
    /// When non-empty, only these unit types (plus units with no `produced_by_slug`) are producible.
    #[serde(default)]
    pub unlocked_units: Vec<String>,
    /// Ability scrolls carried into the match: slug → remaining uses.
    /// When non-empty the scroll system is active and uses are consumed on each cast.
    #[serde(default)]
    pub ability_scrolls: HashMap<String, i64>,
    /// Pre-match boosts active for the entire match.
    #[serde(default)]
    pub active_boosts: Vec<ActiveBoost>,
    /// Temporary in-match boosts (activated during gameplay, expire after N ticks).
    #[serde(default)]
    pub active_match_boosts: Vec<ActiveMatchBoost>,
    /// Ability levels from deck: ability_slug → level (1-3). Higher = stronger.
    #[serde(default)]
    pub ability_levels: HashMap<String, i64>,
    /// Building max levels from deck: building_slug → max level (1-3).
    #[serde(default)]
    pub building_levels: HashMap<String, i64>,
    /// Unit max levels from deck: unit_slug -> max level (1-3).
    #[serde(default)]
    pub unit_levels: HashMap<String, i64>,
    /// Visual cosmetics metadata — passed through to clients, never processed by the engine.
    #[serde(default)]
    pub cosmetics: HashMap<String, serde_json::Value>,
}

/// Region state stored in Redis.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct Region {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub country_code: String,
    #[serde(default)]
    pub centroid: Option<[f64; 2]>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub unit_count: i64,
    #[serde(default)]
    pub unit_type: Option<String>,
    #[serde(default)]
    pub is_capital: bool,
    #[serde(default)]
    pub building_type: Option<String>,
    /// Individual building instances in this region.
    #[serde(default)]
    pub building_instances: Vec<BuildingInstance>,
    #[serde(default)]
    pub defense_bonus: f64,
    #[serde(default)]
    pub vision_range: i64,
    #[serde(default)]
    pub unit_generation_bonus: f64,
    #[serde(default)]
    pub energy_generation_bonus: f64,
    #[serde(default)]
    pub is_coastal: bool,
    #[serde(default)]
    pub sea_distances: Vec<serde_json::Value>,
    #[serde(default)]
    pub units: HashMap<String, i64>,
    #[serde(default)]
    pub unit_accum: f64,
}

/// Action from a player.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Action {
    pub action_type: String,
    #[serde(default)]
    pub player_id: Option<String>,
    #[serde(default)]
    pub source_region_id: Option<String>,
    #[serde(default)]
    pub target_region_id: Option<String>,
    #[serde(default)]
    pub region_id: Option<String>,
    #[serde(default)]
    pub units: Option<i64>,
    #[serde(default)]
    pub unit_type: Option<String>,
    #[serde(default)]
    pub building_type: Option<String>,
    #[serde(default)]
    pub ability_type: Option<String>,
    /// Boost parameters forwarded by the gateway when action_type == "activate_boost".
    /// Expected keys: "effect_type" (String), "value" (f64), "duration_ticks" (i64).
    #[serde(default)]
    pub boost_params: Option<serde_json::Value>,
    /// Number of escort fighters to send with a bomber (launch_bomber action).
    #[serde(default)]
    pub escort_fighters: Option<i64>,
    /// ID of an in-flight air mission to intercept (intercept action).
    #[serde(default)]
    pub target_flight_id: Option<String>,
}

/// Building queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingQueueItem {
    pub region_id: String,
    pub building_type: String,
    pub player_id: String,
    pub ticks_remaining: i64,
    pub total_ticks: i64,
    /// True when this queue entry represents a level upgrade rather than a new construction.
    #[serde(default)]
    pub is_upgrade: bool,
    /// Target level after upgrade completes. Only meaningful when `is_upgrade` is true.
    #[serde(default)]
    pub target_level: i64,
}

/// Unit production queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitQueueItem {
    pub region_id: String,
    pub player_id: String,
    pub unit_type: String,
    #[serde(default)]
    pub quantity: Option<i64>,
    #[serde(default)]
    pub manpower_cost: Option<i64>,
    pub ticks_remaining: i64,
    pub total_ticks: i64,
}

/// Transit queue item.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransitQueueItem {
    pub action_type: String,
    pub source_region_id: String,
    pub target_region_id: String,
    pub player_id: String,
    pub unit_type: String,
    pub units: i64,
    pub ticks_remaining: i64,
    pub travel_ticks: i64,
}

/// A group of interceptor fighters chasing an in-flight air mission.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InterceptorGroup {
    pub player_id: String,
    pub source_region_id: String,
    pub fighters: i64,
    /// 0.0 = just launched, 1.0 = reached the target flight.
    pub progress: f64,
    pub speed_per_tick: f64,
}

/// Air transit item — represents a bomber or fighter mission in flight.
/// Progress advances each tick; interceptors can attach mid-flight.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirTransitItem {
    pub id: String,
    /// "bomb_run" | "fighter_attack" | "escort_return"
    pub mission_type: String,
    pub source_region_id: String,
    pub target_region_id: String,
    pub player_id: String,
    pub unit_type: String,
    pub units: i64,
    /// Escort fighters traveling with a bomber (only for bomb_run).
    #[serde(default)]
    pub escort_fighters: i64,
    /// 0.0 = source, 1.0 = arrived at target.
    pub progress: f64,
    /// How much progress advances per tick.
    pub speed_per_tick: f64,
    /// Total distance in province hops (for frontend path rendering).
    #[serde(default)]
    pub total_distance: i64,
    /// Interceptor groups chasing this flight.
    #[serde(default)]
    pub interceptors: Vec<InterceptorGroup>,
    /// Province IDs along the flight path (from BFS), for path bombing.
    #[serde(default)]
    pub flight_path: Vec<String>,
    /// Index of last province in flight_path that was bombed (to avoid re-bombing).
    #[serde(default)]
    pub last_bombed_hop: usize,
}

/// Weather/day-night state computed from UTC time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WeatherState {
    /// 0.0 = midnight, 0.5 = noon, 1.0 = midnight again
    pub time_of_day: f64,
    /// "day", "night", "dawn", "dusk"
    pub phase: String,
    /// 0.0 = clear, 1.0 = heavy overcast
    pub cloud_coverage: f64,
    /// Overall visibility: 1.0 = full, 0.0 = zero (never actually zero)
    pub visibility: f64,
    /// Current weather condition: "clear", "cloudy", "rain", "fog", "storm"
    pub condition: String,
    /// Multiplier applied to defender_advantage (night = stronger defense)
    pub defense_modifier: f64,
    /// Multiplier applied to combat_randomness (fog/storm = more chaos)
    pub randomness_modifier: f64,
    /// Multiplier applied to energy generation (storm = reduced)
    pub energy_modifier: f64,
    /// Multiplier applied to unit generation rate (rain = slightly reduced)
    pub unit_gen_modifier: f64,
}

/// Events produced by the engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Event {
    #[serde(rename = "building_complete")]
    BuildingComplete {
        region_id: String,
        building_type: String,
        player_id: String,
        building_count: i64,
    },
    #[serde(rename = "build_started")]
    BuildStarted {
        region_id: String,
        building_type: String,
        player_id: String,
        ticks_remaining: i64,
        energy_cost: i64,
    },
    #[serde(rename = "unit_production_complete")]
    UnitProductionComplete {
        region_id: String,
        unit_type: String,
        player_id: String,
        quantity: i64,
    },
    #[serde(rename = "unit_production_failed")]
    UnitProductionFailed {
        region_id: String,
        unit_type: String,
        player_id: String,
        quantity: i64,
        message: String,
    },
    #[serde(rename = "unit_production_started")]
    UnitProductionStarted {
        region_id: String,
        player_id: String,
        unit_type: String,
        quantity: i64,
        ticks_remaining: i64,
        energy_cost: i64,
        manpower_cost: i64,
    },
    #[serde(rename = "troops_sent")]
    TroopsSent {
        action_type: String,
        source_region_id: String,
        target_region_id: String,
        player_id: String,
        units: i64,
        unit_type: String,
        travel_ticks: i64,
    },
    #[serde(rename = "units_moved")]
    UnitsMoved {
        source_region_id: String,
        target_region_id: String,
        units: i64,
        unit_type: String,
        player_id: String,
    },
    #[serde(rename = "attack_success")]
    AttackSuccess {
        source_region_id: String,
        target_region_id: String,
        player_id: String,
        units: i64,
        unit_type: String,
        old_owner_id: Option<String>,
        surviving_units: i64,
    },
    #[serde(rename = "attack_failed")]
    AttackFailed {
        source_region_id: String,
        target_region_id: String,
        player_id: String,
        units: i64,
        unit_type: String,
        defender_surviving: i64,
    },
    #[serde(rename = "capital_captured")]
    CapitalCaptured {
        region_id: String,
        captured_by: String,
        lost_by: String,
    },
    #[serde(rename = "player_eliminated")]
    PlayerEliminated {
        player_id: String,
        reason: String,
    },
    #[serde(rename = "player_disconnected")]
    PlayerDisconnected {
        player_id: String,
        grace_seconds: i64,
    },
    #[serde(rename = "game_over")]
    GameOver {
        winner_id: Option<String>,
    },
    #[serde(rename = "ability_used")]
    AbilityUsed {
        player_id: String,
        ability_type: String,
        target_region_id: String,
        sound_key: String,
    },
    #[serde(rename = "ability_effect_tick")]
    AbilityEffectTick {
        effect_type: String,
        target_region_id: String,
        affected_region_ids: Vec<String>,
        ticks_remaining: i64,
    },
    #[serde(rename = "ability_effect_expired")]
    AbilityEffectExpired {
        effect_type: String,
        target_region_id: String,
    },
    #[serde(rename = "shield_blocked")]
    ShieldBlocked {
        target_region_id: String,
        attacker_id: String,
        units: i64,
    },
    #[serde(rename = "action_rejected")]
    ActionRejected {
        player_id: String,
        message: String,
        action_type: Option<String>,
        source_region_id: Option<String>,
        target_region_id: Option<String>,
        region_id: Option<String>,
        building_type: Option<String>,
        unit_type: Option<String>,
    },
    #[serde(rename = "boost_activated")]
    BoostActivated {
        player_id: String,
        boost_slug: String,
        effect_type: String,
        duration_ticks: i64,
    },
    #[serde(rename = "boost_expired")]
    BoostExpired {
        player_id: String,
        boost_slug: String,
    },
    #[serde(rename = "building_upgraded")]
    BuildingUpgraded {
        region_id: String,
        building_type: String,
        player_id: String,
        new_level: i64,
    },
    /// Emitted when AOE units (e.g. artillery) deal splash damage to neighboring provinces.
    #[serde(rename = "aoe_damage")]
    AoeDamage {
        source_region_id: String,
        affected_region_ids: Vec<String>,
        player_id: String,
        damage_factor: f64,
    },
    /// Emitted when a unit with path_damage > 0 softens the target before arrival.
    #[serde(rename = "path_damage")]
    PathDamage {
        target_region_id: String,
        player_id: String,
        units_killed: i64,
    },
    /// Emitted when the flash ability creates a disorientation effect.
    #[serde(rename = "flash_effect")]
    FlashEffect {
        source_player_id: String,
        target_region_id: String,
        affected_region_ids: Vec<String>,
        ticks_remaining: i64,
    },
    /// Emitted when artillery fires a bombardment at a target region from range.
    /// No movement occurs — artillery stays in the source region.
    #[serde(rename = "bombard")]
    Bombard {
        player_id: String,
        source_region_id: String,
        target_region_id: String,
        artillery_count: i64,
        damage: i64,
    },
    /// An air mission (bomber/fighter) has been launched and is in flight.
    #[serde(rename = "air_mission_launched")]
    AirMissionLaunched {
        flight_id: String,
        mission_type: String,
        player_id: String,
        source_region_id: String,
        target_region_id: String,
        unit_type: String,
        units: i64,
        escort_fighters: i64,
        speed_per_tick: f64,
    },
    /// Interceptor fighters dispatched toward an in-flight air mission.
    #[serde(rename = "air_intercept_dispatched")]
    AirInterceptDispatched {
        flight_id: String,
        interceptor_player_id: String,
        source_region_id: String,
        fighters: i64,
    },
    /// Mid-air combat resolved between interceptors and a flight (escorts/bomber).
    #[serde(rename = "air_combat_resolved")]
    AirCombatResolved {
        flight_id: String,
        interceptor_player_id: String,
        target_player_id: String,
        interceptors_lost: i64,
        escorts_lost: i64,
        bombers_lost: i64,
        interceptors_remaining: i64,
        escorts_remaining: i64,
        bombers_remaining: i64,
    },
    /// Bomber arrived and struck the target — destruction results.
    #[serde(rename = "bomber_strike")]
    BomberStrike {
        player_id: String,
        target_region_id: String,
        bombers: i64,
        ground_units_destroyed: i64,
        buildings_destroyed: Vec<String>,
        province_neutralized: bool,
    },
    /// Province lost all defenders and became neutral (no owner).
    #[serde(rename = "province_neutralized")]
    ProvinceNeutralized {
        region_id: String,
        previous_owner_id: String,
    },
}
