mod types;

pub use types::*;

use rand::Rng;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};

fn uuid_v4() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut rng = rand::thread_rng();
    let rand_part: u32 = rng.gen();
    format!("{seq:04x}-{rand_part:08x}")
}

// Build/unit queue limits now come from self.settings.max_build_queue_per_region / max_unit_queue_per_region

/// Default unit type configs used as fallback when settings don't provide them.
fn default_unit_types() -> HashMap<String, UnitConfig> {
    let mut m = HashMap::new();
    m.insert(
        "infantry".into(),
        UnitConfig {
            attack: 1.0,
            defense: 1.0,
            speed: 1,
            attack_range: 1,
            sea_range: 0,
            sea_hop_distance_km: 0,
            movement_type: "land".into(),
            production_cost: 0,
            production_time_ticks: 0,
            produced_by_slug: None,
            manpower_cost: 1,
            ..Default::default()
        },
    );
    m.insert(
        "tank".into(),
        UnitConfig {
            attack: 3.0,
            defense: 2.5,
            speed: 1,
            attack_range: 1,
            sea_range: 0,
            sea_hop_distance_km: 0,
            movement_type: "land".into(),
            production_cost: 15,
            production_time_ticks: 8,
            produced_by_slug: Some("factory".into()),
            manpower_cost: 3,
            ..Default::default()
        },
    );
    m.insert(
        "ship".into(),
        UnitConfig {
            attack: 2.0,
            defense: 2.0,
            speed: 4,
            attack_range: 4,
            sea_range: 0,
            sea_hop_distance_km: 2800,
            movement_type: "sea".into(),
            production_cost: 20,
            production_time_ticks: 10,
            produced_by_slug: Some("port".into()),
            manpower_cost: 10,
            ..Default::default()
        },
    );
    m.insert(
        "fighter".into(),
        UnitConfig {
            attack: 2.5,
            defense: 1.0,
            speed: 3,
            attack_range: 3,
            sea_range: 0,
            sea_hop_distance_km: 0,
            movement_type: "air".into(),
            production_cost: 25,
            production_time_ticks: 12,
            produced_by_slug: Some("carrier".into()),
            manpower_cost: 10,
            ..Default::default()
        },
    );
    m.insert(
        "artillery".into(),
        UnitConfig {
            attack: 3.5,
            defense: 0.3,
            speed: 1,
            attack_range: 3,
            sea_range: 0,
            sea_hop_distance_km: 0,
            movement_type: "land".into(),
            production_cost: 18,
            production_time_ticks: 10,
            produced_by_slug: Some("factory".into()),
            manpower_cost: 5,
            aoe_damage: 0.3,
            combat_target: "ground".into(),
            ticks_per_hop: 4,
            ..Default::default()
        },
    );
    m.insert(
        "sam".into(),
        UnitConfig {
            attack: 3.0,
            defense: 0.5,
            speed: 1,
            attack_range: 2,
            movement_type: "land".into(),
            production_cost: 12,
            production_time_ticks: 6,
            produced_by_slug: Some("tower".into()),
            manpower_cost: 3,
            intercept_air: true,
            combat_target: "air".into(),
            ticks_per_hop: 2,
            ..Default::default()
        },
    );
    m
}

impl DiplomacyState {
    /// Get sorted player pair key.
    fn war_key(a: &str, b: &str) -> (String, String) {
        if a < b {
            (a.to_string(), b.to_string())
        } else {
            (b.to_string(), a.to_string())
        }
    }

    /// Check if two players are at war.
    pub fn are_at_war(&self, a: &str, b: &str) -> bool {
        let (pa, pb) = Self::war_key(a, b);
        self.wars.iter().any(|w| w.player_a == pa && w.player_b == pb)
    }

    /// Check if two players have an active pact (any type).
    pub fn have_pact(&self, a: &str, b: &str) -> bool {
        let (pa, pb) = Self::war_key(a, b);
        self.pacts.iter().any(|p| p.player_a == pa && p.player_b == pb)
    }

    /// Find the pact between two players if any.
    pub fn find_pact(&self, a: &str, b: &str) -> Option<&Pact> {
        let (pa, pb) = Self::war_key(a, b);
        self.pacts.iter().find(|p| p.player_a == pa && p.player_b == pb)
    }

    /// Find the war between two players if any.
    pub fn find_war(&self, a: &str, b: &str) -> Option<&War> {
        let (pa, pb) = Self::war_key(a, b);
        self.wars.iter().find(|w| w.player_a == pa && w.player_b == pb)
    }

    /// Declare war between two players. Removes any existing pact.
    /// Returns events (pact_broken if applicable, then war_declared).
    pub fn declare_war(&mut self, aggressor: &str, defender: &str, tick: i64) -> Vec<Event> {
        let mut events = Vec::new();
        let (pa, pb) = Self::war_key(aggressor, defender);

        // Already at war? No-op.
        if self.are_at_war(aggressor, defender) {
            return events;
        }

        // Break any existing pact first.
        if let Some(pact) = self.find_pact(aggressor, defender).cloned() {
            self.pacts.retain(|p| p.id != pact.id);
            events.push(Event::PactBroken {
                pact_id: pact.id,
                broken_by: aggressor.to_string(),
                player_a: pact.player_a,
                player_b: pact.player_b,
            });
        }

        // Remove any pending proposals between them.
        self.proposals.retain(|p| {
            !((p.from_player_id == aggressor && p.to_player_id == defender)
                || (p.from_player_id == defender && p.to_player_id == aggressor))
                || p.status != "pending"
        });

        self.wars.push(War {
            player_a: pa.clone(),
            player_b: pb.clone(),
            started_tick: tick,
            aggressor_id: aggressor.to_string(),
            provinces_changed: Vec::new(),
        });

        events.push(Event::WarDeclared {
            aggressor_id: aggressor.to_string(),
            defender_id: defender.to_string(),
            tick,
        });

        events
    }

    /// Record a province ownership change during a war.
    pub fn record_province_change(
        &mut self,
        attacker: &str,
        defender: &str,
        region_id: &str,
        from: &str,
        to: &str,
        tick: i64,
    ) {
        let (pa, pb) = Self::war_key(attacker, defender);
        if let Some(war) = self.wars.iter_mut().find(|w| w.player_a == pa && w.player_b == pb) {
            war.provinces_changed.push(ProvinceChange {
                region_id: region_id.to_string(),
                from_player_id: from.to_string(),
                to_player_id: to.to_string(),
                tick,
            });
        }
    }

    /// End a war between two players.
    pub fn end_war(&mut self, a: &str, b: &str) {
        let (pa, pb) = Self::war_key(a, b);
        self.wars.retain(|w| !(w.player_a == pa && w.player_b == pb));
    }
}

/// Compute the current weather state from a UTC Unix timestamp using default settings.
pub fn compute_weather(timestamp_secs: i64) -> WeatherState {
    let defaults = GameSettings {
        weather_enabled: true,
        day_night_enabled: true,
        night_defense_modifier: 1.15,
        dawn_dusk_defense_modifier: 1.05,
        storm_randomness_modifier: 1.4,
        fog_randomness_modifier: 1.25,
        rain_randomness_modifier: 1.1,
        storm_energy_modifier: 0.85,
        rain_energy_modifier: 0.95,
        storm_unit_gen_modifier: 0.90,
        rain_unit_gen_modifier: 0.95,
        ..Default::default()
    };
    compute_weather_with_settings(timestamp_secs, &defaults)
}

/// Compute weather with explicit toggle flags (backwards compat).
pub fn compute_weather_with_flags(timestamp_secs: i64, weather_enabled: bool, day_night_enabled: bool) -> WeatherState {
    let settings = GameSettings {
        weather_enabled,
        day_night_enabled,
        night_defense_modifier: 1.15,
        dawn_dusk_defense_modifier: 1.05,
        storm_randomness_modifier: 1.4,
        fog_randomness_modifier: 1.25,
        rain_randomness_modifier: 1.1,
        storm_energy_modifier: 0.85,
        rain_energy_modifier: 0.95,
        storm_unit_gen_modifier: 0.90,
        rain_unit_gen_modifier: 0.95,
        ..Default::default()
    };
    compute_weather_with_settings(timestamp_secs, &settings)
}

/// Compute weather using full game settings for all configurable modifiers.
pub fn compute_weather_with_settings(timestamp_secs: i64, settings: &GameSettings) -> WeatherState {
    // Time of day: 0.0 = midnight, 0.5 = noon
    let secs_in_day = ((timestamp_secs % 86400) + 86400) % 86400;
    let time_of_day = secs_in_day as f64 / 86400.0;

    // Phase — forced to "day" when day/night is disabled
    let phase = if settings.day_night_enabled {
        match time_of_day {
            t if t < 0.21 => "night",    // 00:00–05:00
            t if t < 0.29 => "dawn",     // 05:00–07:00
            t if t < 0.75 => "day",      // 07:00–18:00
            t if t < 0.83 => "dusk",     // 18:00–20:00
            _ => "night",                 // 20:00–00:00
        }
    } else {
        "day"
    };

    // Weather condition — forced to "clear" when weather is disabled
    let (condition, cloud_coverage) = if settings.weather_enabled {
        let day_of_year = (timestamp_secs / 86400) % 365;
        let hour = secs_in_day / 3600;
        let weather_seed = ((day_of_year * 7 + hour * 3) % 20) as f64;

        if weather_seed < 8.0 {
            ("clear", weather_seed * 0.05)             // 40% clear
        } else if weather_seed < 13.0 {
            ("cloudy", 0.4 + (weather_seed - 8.0) * 0.08) // 25% cloudy
        } else if weather_seed < 16.0 {
            ("rain", 0.7 + (weather_seed - 13.0) * 0.05)  // 15% rain
        } else if weather_seed < 18.0 {
            ("fog", 0.5 + (weather_seed - 16.0) * 0.1)    // 10% fog
        } else {
            ("storm", 0.9 + (weather_seed - 18.0) * 0.05) // 10% storm
        }
    } else {
        ("clear", 0.0)
    };

    // Visibility: day=high, night=lower, fog/storm=lower
    let base_visibility = match phase {
        "day" => 1.0,
        "dawn" | "dusk" => 0.7,
        _ => 0.5, // night
    };
    let weather_visibility = match condition {
        "clear" => 1.0,
        "cloudy" => 0.9,
        "rain" => 0.75,
        "fog" => 0.5,
        "storm" => 0.6,
        _ => 1.0,
    };
    let visibility = base_visibility * weather_visibility;

    // Gameplay modifiers — use configurable values from settings
    let defense_modifier = match phase {
        "night" => settings.night_defense_modifier,
        "dawn" | "dusk" => settings.dawn_dusk_defense_modifier,
        _ => 1.0,
    };

    let randomness_modifier = match condition {
        "storm" => settings.storm_randomness_modifier,
        "fog" => settings.fog_randomness_modifier,
        "rain" => settings.rain_randomness_modifier,
        _ => 1.0,
    };

    let energy_modifier = match condition {
        "storm" => settings.storm_energy_modifier,
        "rain" => settings.rain_energy_modifier,
        _ => 1.0,
    };

    let unit_gen_modifier = match condition {
        "storm" => settings.storm_unit_gen_modifier,
        "rain" => settings.rain_unit_gen_modifier,
        _ => 1.0,
    };

    WeatherState {
        time_of_day,
        phase: phase.to_string(),
        cloud_coverage,
        visibility,
        condition: condition.to_string(),
        defense_modifier,
        randomness_modifier,
        energy_modifier,
        unit_gen_modifier,
    }
}

/// Pure game logic engine — no I/O, no state management.
pub struct GameEngine {
    pub settings: GameSettings,
    pub neighbor_map: HashMap<String, Vec<String>>,
    default_units: HashMap<String, UnitConfig>,
    /// Weather modifier for defender advantage (1.0 = no change).
    weather_defense_modifier: f64,
    /// Weather modifier for combat randomness (1.0 = no change).
    weather_randomness_modifier: f64,
    /// Weather modifier for energy generation (1.0 = no change).
    weather_energy_modifier: f64,
    /// Weather modifier for unit generation (1.0 = no change).
    weather_unit_gen_modifier: f64,
}

impl GameEngine {
    pub fn new(settings: GameSettings, neighbor_map: HashMap<String, Vec<String>>) -> Self {
        Self {
            settings,
            neighbor_map,
            default_units: default_unit_types(),
            weather_defense_modifier: 1.0,
            weather_randomness_modifier: 1.0,
            weather_energy_modifier: 1.0,
            weather_unit_gen_modifier: 1.0,
        }
    }

    /// Update weather modifiers from the current weather state.
    /// Call this once per tick before process_tick.
    pub fn set_weather(&mut self, weather: &WeatherState) {
        self.weather_defense_modifier = weather.defense_modifier;
        self.weather_randomness_modifier = weather.randomness_modifier;
        self.weather_energy_modifier = weather.energy_modifier;
        self.weather_unit_gen_modifier = weather.unit_gen_modifier;
    }

    pub fn process_tick(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        actions: &[Action],
        buildings_queue: &mut Vec<BuildingQueueItem>,
        unit_queue: &mut Vec<UnitQueueItem>,
        transit_queue: &mut Vec<TransitQueueItem>,
        air_transit_queue: &mut Vec<AirTransitItem>,
        current_tick: i64,
        active_effects: &mut Vec<ActiveEffect>,
        diplomacy: &mut DiplomacyState,
    ) -> Vec<Event> {
        let mut events = Vec::new();

        // Regenerate Action Points for all players.
        self.regenerate_action_points(players, regions);

        // Process persistent effects (virus damage, etc.)
        events.extend(self.process_active_effects(regions, active_effects));

        events.extend(self.generate_energy(players, regions));
        // Unit generation moved to end of tick — after actions — so bombardment
        // damage isn't immediately undone by regeneration.

        let (remaining_buildings, build_events) =
            self.process_buildings(players, regions, buildings_queue);
        *buildings_queue = remaining_buildings;
        events.extend(build_events);

        let (remaining_units, unit_events) = self.process_unit_queue(players, regions, unit_queue);
        *unit_queue = remaining_units;
        events.extend(unit_events);

        let (remaining_transit, transit_events) =
            self.process_transit_queue_with_shield(players, regions, transit_queue, active_effects, diplomacy, current_tick);
        *transit_queue = remaining_transit;
        events.extend(transit_events);

        let (remaining_air, air_events) =
            self.process_air_transit(players, regions, air_transit_queue);
        *air_transit_queue = remaining_air;
        events.extend(air_events);

        for action in actions {
            // Check AP cost for this action type. Free actions (diplomacy, boost) cost 0.
            let ap_cost = self.get_ap_cost(&action.action_type);
            if ap_cost > 0 {
                if let Some(pid) = action.player_id.as_deref() {
                    let has_ap = players.get(pid).map(|p| p.action_points >= ap_cost).unwrap_or(false);
                    if !has_ap {
                        events.push(reject_action(pid, "Brak punktow akcji (AP)", action));
                        continue;
                    }
                    // Deduct AP
                    if let Some(player) = players.get_mut(pid) {
                        player.action_points -= ap_cost;
                    }
                }
            }

            if action.action_type == "use_ability" {
                // If the ability slug maps to a deck boost in the player's `active_boosts`,
                // treat it as a boost activation rather than a targeted ability cast.
                // The frontend sends `use_ability` for both abilities and boost items; we
                // distinguish them here so the correct handler runs.
                let is_boost = action.player_id.as_deref()
                    .and_then(|pid| players.get(pid))
                    .zip(action.ability_type.as_deref())
                    .map(|(player, slug)| {
                        player.active_boosts.iter().any(|b| b.slug == slug)
                    })
                    .unwrap_or(false);

                if is_boost {
                    // Build a synthetic `activate_boost` action that carries the boost params
                    // sourced from the matching `ActiveBoost` entry in the player's deck.
                    let boost_params = action.player_id.as_deref()
                        .and_then(|pid| players.get(pid))
                        .zip(action.ability_type.as_deref())
                        .and_then(|(player, slug)| {
                            player.active_boosts.iter().find(|b| b.slug == slug)
                        })
                        .map(|b| b.params.clone());

                    let mut synth = action.clone();
                    synth.action_type = "activate_boost".into();
                    synth.boost_params = boost_params;
                    events.extend(self.process_activate_boost(&synth, players));
                } else {
                    events.extend(self.process_ability(
                        action,
                        players,
                        regions,
                        current_tick,
                        active_effects,
                    ));
                }
            } else if action.action_type == "activate_boost" {
                events.extend(self.process_activate_boost(action, players));
            } else {
                events.extend(self.process_action(
                    action,
                    players,
                    regions,
                    buildings_queue,
                    unit_queue,
                    transit_queue,
                    air_transit_queue,
                    diplomacy,
                    current_tick,
                ));
            }
        }

        // Tick down in-match boosts and emit expiry events.
        events.extend(self.tick_match_boosts(players));

        // Collect regions that were bombardment targets — skip their regeneration this tick
        // so artillery damage actually sticks and isn't immediately healed.
        let bombarded: std::collections::HashSet<String> = events.iter().filter_map(|e| {
            if let Event::Bombard { target_region_id, .. } = e {
                Some(target_region_id.clone())
            } else {
                None
            }
        }).collect();

        // Unit generation AFTER actions, skipping bombarded provinces.
        events.extend(self.generate_units_with_effects_skip(players, regions, active_effects, &bombarded));

        // Diplomacy tick processing: expire pacts that have reached their expiry tick.
        if self.settings.diplomacy_enabled {
            let mut expired_pacts = Vec::new();
            diplomacy.pacts.retain(|pact| {
                if let Some(expires) = pact.expires_tick {
                    if current_tick >= expires {
                        expired_pacts.push(pact.clone());
                        return false;
                    }
                }
                true
            });
            for pact in expired_pacts {
                events.push(Event::PactExpired {
                    pact_id: pact.id,
                    player_a: pact.player_a,
                    player_b: pact.player_b,
                });
            }

            // Expire pending proposals that have timed out.
            let mut expired_proposals = Vec::new();
            for proposal in diplomacy.proposals.iter_mut() {
                if proposal.status == "pending" {
                    if let Some(expires) = proposal.expires_tick {
                        if current_tick >= expires {
                            proposal.status = "expired".to_string();
                            expired_proposals.push(proposal.clone());
                        }
                    }
                }
            }
            for proposal in &expired_proposals {
                events.push(Event::ProposalExpired {
                    proposal_id: proposal.id.clone(),
                    proposal_type: proposal.proposal_type.clone(),
                    from_player_id: proposal.from_player_id.clone(),
                    to_player_id: proposal.to_player_id.clone(),
                });
            }

            // Clean up old resolved/expired proposals.
            let cleanup_threshold = self.settings.peace_cooldown_ticks * 2;
            diplomacy.proposals.retain(|p| {
                p.status == "pending" || (current_tick - p.created_tick < cleanup_threshold)
            });
        }

        events.extend(self.check_conditions(players, regions, air_transit_queue));

        // Sync unit_count for all regions to reflect changes from generation, combat, etc.
        for region in regions.values_mut() {
            sync_region_unit_meta(region, self);
        }

        events
    }

    // --- Action Points ---

    fn get_ap_cost(&self, action_type: &str) -> i64 {
        match action_type {
            "attack" | "bombard" | "intercept" => self.settings.ap_cost_attack,
            "move" => self.settings.ap_cost_move,
            "build" | "upgrade_building" => self.settings.ap_cost_build,
            "produce_unit" => self.settings.ap_cost_produce,
            "use_ability" => self.settings.ap_cost_ability,
            // Diplomacy, boosts are free
            _ => 0,
        }
    }

    fn regenerate_action_points(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &HashMap<String, Region>,
    ) {
        let interval = self.settings.ap_regen_interval.max(1) as f64;
        let regen_per_tick = 1.0 / interval;
        let max_ap = self.settings.max_action_points;

        for player in players.values_mut() {
            if !player.is_alive || player.action_points >= max_ap {
                player.ap_regen_accum = 0.0;
                continue;
            }

            // Check for Command Center building bonus (+50% faster regen)
            let has_command_center = regions.values().any(|r| {
                r.owner_id.as_deref() == Some(&player.user_id)
                    && r.building_instances.iter().any(|b| b.building_type == "command_center")
            });
            let effective_regen = if has_command_center {
                regen_per_tick * 1.5
            } else {
                regen_per_tick
            };

            player.ap_regen_accum += effective_regen;
            let whole = player.ap_regen_accum as i64;
            if whole > 0 {
                player.action_points = (player.action_points + whole).min(max_ap);
                player.ap_regen_accum -= whole as f64;
            }
        }
    }

    // --- Currency generation ---

    fn generate_energy(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &HashMap<String, Region>,
    ) -> Vec<Event> {
        let base_energy = self.settings.base_energy_per_tick;
        let region_energy = self.settings.region_energy_per_tick;

        let mut owned_regions_by_player: HashMap<&str, Vec<&Region>> = HashMap::new();
        for region in regions.values() {
            if let Some(ref owner_id) = region.owner_id {
                owned_regions_by_player
                    .entry(owner_id.as_str())
                    .or_default()
                    .push(region);
            }
        }

        for (player_id, player) in players.iter_mut() {
            let owned = owned_regions_by_player.get(player_id.as_str());
            let region_count = owned.map_or(0, |r| r.len());
            let passive_bonus: f64 = owned.map_or(0.0, |regions| {
                regions.iter().map(|r| r.energy_generation_bonus).sum()
            });
            let mut income = base_energy + region_count as f64 * region_energy + passive_bonus;

            // Apply active boost multipliers (deck system).
            for boost in &player.active_boosts {
                if boost.params.get("effect_type").and_then(|v| v.as_str()) == Some("energy_bonus") {
                    let value = boost.params.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    income *= 1.0 + value;
                }
            }

            // Apply in-match activated boost multipliers.
            for boost in &player.active_match_boosts {
                if boost.effect_type == "energy_bonus" {
                    income *= 1.0 + boost.value;
                }
            }

            // Apply weather modifier to energy generation.
            income *= self.weather_energy_modifier;

            player.energy_accum += income;
            let whole = player.energy_accum as i64;
            if whole > 0 {
                player.energy += whole;
                player.energy_accum -= whole as f64;
            }
        }

        Vec::new()
    }

    // --- Building queue ---

    fn process_buildings(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        buildings_queue: &[BuildingQueueItem],
    ) -> (Vec<BuildingQueueItem>, Vec<Event>) {
        let mut events = Vec::new();
        let mut remaining = Vec::new();

        for building in buildings_queue {
            let mut building = building.clone();
            building.ticks_remaining -= 1;
            if building.ticks_remaining > 0 {
                remaining.push(building);
                continue;
            }

            let region = match regions.get_mut(&building.region_id) {
                Some(r) => r,
                None => continue,
            };

            if building.is_upgrade {
                // Upgrade: find the lowest-level instance of this type and bump it.
                let slug = &building.building_type;
                if let Some(instance) = region.building_instances
                    .iter_mut()
                    .filter(|b| &b.building_type == slug)
                    .min_by_key(|b| b.level)
                {
                    instance.level = building.target_level;
                }
                self.recompute_region_building_stats(region);

                events.push(Event::BuildingUpgraded {
                    region_id: building.region_id.clone(),
                    building_type: building.building_type.clone(),
                    player_id: building.player_id.clone(),
                    new_level: building.target_level,
                });
            } else {
                // New construction: push a fresh level-1 instance.
                region.building_instances.push(BuildingInstance {
                    building_type: building.building_type.clone(),
                    level: 1,
                });
                let building_count = Self::count_buildings(&region.building_instances, &building.building_type);
                self.recompute_region_building_stats(region);

                if let Some(player) = players.get_mut(&building.player_id) {
                    player.total_buildings_built += 1;
                }

                events.push(Event::BuildingComplete {
                    region_id: building.region_id.clone(),
                    building_type: building.building_type.clone(),
                    player_id: building.player_id.clone(),
                    building_count,
                });
            }
        }

        (remaining, events)
    }

    // --- Unit production queue ---

    fn process_unit_queue(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        unit_queue: &[UnitQueueItem],
    ) -> (Vec<UnitQueueItem>, Vec<Event>) {
        let mut events = Vec::new();
        let mut remaining = Vec::new();

        for item in unit_queue {
            let mut item = item.clone();
            item.ticks_remaining -= 1;
            if item.ticks_remaining > 0 {
                remaining.push(item);
                continue;
            }

            let region = match regions.get_mut(&item.region_id) {
                Some(r) => r,
                None => continue,
            };

            if region.owner_id.as_deref() != Some(&item.player_id) {
                continue;
            }

            let base_unit_type = self.default_unit_type_slug();
            let manpower_cost = item
                .manpower_cost
                .unwrap_or_else(|| self.get_unit_scale(&item.unit_type) as i64);
            let total_manpower = manpower_cost * item.quantity.unwrap_or(1);
            if get_available_units(region, &base_unit_type, self) < total_manpower {
                events.push(Event::UnitProductionFailed {
                    region_id: item.region_id.clone(),
                    unit_type: item.unit_type.clone(),
                    player_id: item.player_id.clone(),
                    quantity: item.quantity.unwrap_or(1),
                    message: "Za malo piechoty do finalizacji produkcji".into(),
                });
                continue;
            }

            let qty = item.quantity.unwrap_or(1);
            add_units(region, &item.unit_type, qty);

            if let Some(player) = players.get_mut(&item.player_id) {
                player.total_units_produced =
                    player.total_units_produced.saturating_add(qty as u32);
            }

            events.push(Event::UnitProductionComplete {
                region_id: item.region_id.clone(),
                unit_type: item.unit_type.clone(),
                player_id: item.player_id.clone(),
                quantity: qty,
            });
        }

        (remaining, events)
    }

    // --- Unit generation with virus reduction ---

    fn generate_units_with_effects(&self, players: &mut HashMap<String, Player>, regions: &mut HashMap<String, Region>, active_effects: &[ActiveEffect]) -> Vec<Event> {
        self.generate_units_with_effects_skip(players, regions, active_effects, &std::collections::HashSet::new())
    }

    fn generate_units_with_effects_skip(&self, players: &mut HashMap<String, Player>, regions: &mut HashMap<String, Region>, active_effects: &[ActiveEffect], skip_regions: &std::collections::HashSet<String>) -> Vec<Event> {
        // Collect virus-affected regions for production reduction
        let mut virus_regions: HashMap<String, f64> = HashMap::new();
        for effect in active_effects {
            if effect.effect_type == "ab_virus" {
                let reduction = effect.params.get("production_reduction")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.5);
                for rid in std::iter::once(&effect.target_region_id).chain(effect.affected_region_ids.iter()) {
                    let entry = virus_regions.entry(rid.clone()).or_insert(0.0);
                    *entry = (*entry + reduction).min(1.0);
                }
            }
        }

        let base_rate = self.settings.base_unit_generation_rate;
        let capital_bonus = self.settings.capital_generation_bonus;
        let default_unit_type = self.default_unit_type_slug();

        // Pre-compute unit_bonus multipliers from active deck boosts and in-match boosts.
        let mut unit_boost_by_player: HashMap<&str, f64> = HashMap::new();
        for (player_id, player) in players.iter() {
            let mut multiplier = 1.0f64;
            for boost in &player.active_boosts {
                if boost.params.get("effect_type").and_then(|v| v.as_str()) == Some("unit_bonus") {
                    let value = boost.params.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    multiplier *= 1.0 + value;
                }
            }
            for boost in &player.active_match_boosts {
                if boost.effect_type == "unit_bonus" {
                    multiplier *= 1.0 + boost.value;
                }
            }
            if (multiplier - 1.0).abs() > f64::EPSILON {
                unit_boost_by_player.insert(player_id.as_str(), multiplier);
            }
        }

        let mut rate_group_accum: HashMap<(String, u64), f64> = HashMap::new();
        let mut region_rates: Vec<(String, f64)> = Vec::new();

        if !skip_regions.is_empty() {
            eprintln!("[UNIT_GEN] Skipping {} bombarded regions: {:?}", skip_regions.len(), skip_regions);
        }
        for (rid, region) in regions.iter() {
            // Skip regions that were bombarded this tick — no regeneration.
            if skip_regions.contains(rid) {
                continue;
            }
            let owner = match &region.owner_id {
                Some(o) => o.clone(),
                None => continue,
            };

            let mut rate = base_rate;
            if region.is_capital {
                rate *= capital_bonus;
            }
            rate += region.unit_generation_bonus;

            // Apply virus production reduction
            if let Some(reduction) = virus_regions.get(rid) {
                rate *= 1.0 - reduction;
            }

            // Apply unit_bonus boost from player's deck.
            if let Some(&boost_mult) = unit_boost_by_player.get(owner.as_str()) {
                rate *= boost_mult;
            }

            // Apply weather modifier to unit generation.
            rate *= self.weather_unit_gen_modifier;

            let rate_key = (rate * 10000.0).round() as u64;
            let group_key = (owner, rate_key);
            let entry = rate_group_accum.entry(group_key).or_insert(0.0_f64);
            if region.unit_accum > *entry {
                *entry = region.unit_accum;
            }
            region_rates.push((rid.clone(), rate));
        }

        for ((_owner, _rate_key), accum) in rate_group_accum.iter_mut() {
            let rate = *_rate_key as f64 / 10000.0;
            *accum += rate;
        }

        for (rid, rate) in &region_rates {
            let region = match regions.get_mut(rid) {
                Some(r) => r,
                None => continue,
            };
            let owner = match &region.owner_id {
                Some(o) => o.clone(),
                None => continue,
            };
            let rate_key = (*rate * 10000.0).round() as u64;
            let group_key = (owner, rate_key);
            let canonical = match rate_group_accum.get(&group_key) {
                Some(a) => *a,
                None => continue,
            };
            region.unit_accum = canonical;
            let whole = region.unit_accum as i64;
            if whole > 0 {
                let owner_id = region.owner_id.clone();
                add_units(region, &default_unit_type, whole);
                region.unit_accum -= whole as f64;
                if let Some(oid) = owner_id {
                    if let Some(player) = players.get_mut(&oid) {
                        player.total_units_produced =
                            player.total_units_produced.saturating_add(whole as u32);
                    }
                }
            }
        }

        for (rid, rate) in &region_rates {
            let region = match regions.get_mut(rid) {
                Some(r) => r,
                None => continue,
            };
            let owner = match &region.owner_id {
                Some(o) => o.clone(),
                None => continue,
            };
            let rate_key = (*rate * 10000.0).round() as u64;
            let group_key = (owner, rate_key);
            if let Some(canonical) = rate_group_accum.get(&group_key) {
                let remainder = *canonical - (*canonical as i64) as f64;
                region.unit_accum = remainder;
            }
        }

        Vec::new()
    }

    // --- Transit queue with shield ---

    fn process_transit_queue_with_shield(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        transit_queue: &[TransitQueueItem],
        active_effects: &[ActiveEffect],
        diplomacy: &mut DiplomacyState,
        current_tick: i64,
    ) -> (Vec<TransitQueueItem>, Vec<Event>) {
        let mut events = Vec::new();
        let mut remaining = Vec::new();

        for item in transit_queue {
            let mut item = item.clone();
            item.ticks_remaining -= 1;
            if item.ticks_remaining > 0 {
                remaining.push(item);
                continue;
            }

            match item.action_type.as_str() {
                "move" => events.extend(self.resolve_move_arrival(&item, regions)),
                "attack" => {
                    // Check for active shield on target
                    if has_active_shield(&item.target_region_id, active_effects) {
                        // Shield blocks the attack — return units to source
                        if let Some(source) = regions.get_mut(&item.source_region_id) {
                            receive_units_in_region(source, &item.unit_type, item.units, self);
                        }
                        events.push(Event::ShieldBlocked {
                            target_region_id: item.target_region_id.clone(),
                            attacker_id: item.player_id.clone(),
                            units: item.units,
                        });
                    } else {
                        events.extend(self.resolve_attack_arrival(&item, players, regions, diplomacy, current_tick));
                    }
                }
                _ => {}
            }
        }

        (remaining, events)
    }

    // --- Ability processing ---

    fn process_ability(
        &self,
        action: &Action,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        current_tick: i64,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let ability_slug = match &action.ability_type {
            Some(slug) => slug,
            None => return vec![reject_action(player_id, "Brak typu zdolnosci", action)],
        };
        let target_region_id = match &action.target_region_id {
            Some(id) => id,
            None => return vec![reject_action(player_id, "Brak celu zdolnosci", action)],
        };

        let ability_config = match self.settings.ability_types.get(ability_slug) {
            Some(c) => c.clone(),
            None => return vec![reject_action(player_id, "Nieznana zdolnosc", action)],
        };

        let player = match players.get(player_id.as_str()) {
            Some(p) => p,
            None => return Vec::new(),
        };

        // Abilities require a scroll in the player's deck. No scroll = no ability.
        match player.ability_scrolls.get(ability_slug) {
            Some(&uses) if uses > 0 => {}
            _ => {
                return vec![reject_action(
                    player_id,
                    "Brak zwoju dla tej zdolnosci",
                    action,
                )];
            }
        }

        // Check cooldown
        if let Some(&ready_tick) = player.ability_cooldowns.get(ability_slug) {
            if current_tick < ready_tick {
                return vec![reject_action(player_id, "Zdolnosc jest na cooldownie", action)];
            }
        }

        // Read the ability level from the player's deck (immutable borrow ends here).
        let ability_level = player.ability_levels.get(ability_slug).copied().unwrap_or(1);

        // Read level-specific stats from config, falling back to base config values.
        let scaled_energy_cost = get_level_stat_i64(&ability_config.level_stats, ability_level, "energy_cost")
            .unwrap_or(ability_config.energy_cost);
        let scaled_damage = get_level_stat_i64(&ability_config.level_stats, ability_level, "damage")
            .unwrap_or(ability_config.damage);
        let scaled_duration = get_level_stat_i64(&ability_config.level_stats, ability_level, "effect_duration_ticks")
            .unwrap_or(ability_config.effect_duration_ticks);
        let scaled_cooldown = get_level_stat_i64(&ability_config.level_stats, ability_level, "cooldown_ticks")
            .unwrap_or(ability_config.cooldown_ticks);

        // Check energy using the level-scaled cost.
        if player.energy < scaled_energy_cost {
            return vec![reject_action(player_id, "Za malo waluty na zdolnosc", action)];
        }

        // Check target type validity
        let target_region = match regions.get(target_region_id) {
            Some(r) => r,
            None => return vec![reject_action(player_id, "Region docelowy nie istnieje", action)],
        };

        match ability_config.target_type.as_str() {
            "enemy" => {
                if target_region.owner_id.as_deref() == Some(player_id) {
                    return vec![reject_action(player_id, "Zdolnosc wymaga wrogiego celu", action)];
                }
            }
            "own" => {
                if target_region.owner_id.as_deref() != Some(player_id) {
                    return vec![reject_action(player_id, "Zdolnosc wymaga wlasnego regionu", action)];
                }
            }
            _ => {} // "any" — no restriction
        }

        // Check range via BFS from owned regions
        if ability_config.range > 0 {
            if !self.is_in_ability_range(player_id, target_region_id, regions, ability_config.range as usize) {
                return vec![reject_action(player_id, "Cel poza zasiegiem zdolnosci", action)];
            }
        }

        // Deduct energy, set cooldown, and consume one scroll use if deck system is active.
        let player = players.get_mut(player_id.as_str()).unwrap();
        player.energy -= scaled_energy_cost;
        player.ability_cooldowns.insert(
            ability_slug.clone(),
            current_tick + scaled_cooldown,
        );
        if let Some(uses) = player.ability_scrolls.get_mut(ability_slug) {
            *uses = (*uses - 1).max(0);
        }

        let mut events = vec![Event::AbilityUsed {
            player_id: player_id.clone(),
            ability_type: ability_slug.clone(),
            target_region_id: target_region_id.clone(),
            sound_key: ability_config.sound_key.clone(),
        }];

        // Execute ability-specific logic
        match ability_slug.as_str() {
            "ab_province_nuke" => {
                events.extend(self.execute_nuke(
                    player_id,
                    target_region_id,
                    &ability_config,
                    scaled_damage,
                    active_effects,
                ));
            }
            "ab_virus" => {
                events.extend(self.execute_virus(
                    player_id, target_region_id, &ability_config, scaled_duration, regions, active_effects,
                ));
            }
            "ab_pr_submarine" => {
                self.execute_submarine(
                    player_id, target_region_id, &ability_config, scaled_duration, regions, active_effects,
                );
            }
            "ab_shield" => {
                self.execute_shield(
                    player_id, target_region_id, &ability_config, scaled_duration, active_effects,
                );
            }
            "ab_conscription_point" => {
                events.extend(self.execute_conscription(
                    target_region_id, &ability_config, regions,
                ));
            }
            "ab_flash" => {
                events.extend(self.execute_flash(
                    player_id,
                    target_region_id,
                    &ability_config,
                    scaled_duration,
                    active_effects,
                ));
            }
            _ => {}
        }

        events
    }

    fn is_in_ability_range(
        &self,
        player_id: &str,
        target_id: &str,
        regions: &HashMap<String, Region>,
        max_range: usize,
    ) -> bool {
        // BFS from all owned regions to see if target is within range
        let mut visited = std::collections::HashSet::new();
        let mut queue = VecDeque::new();

        for (rid, region) in regions {
            if region.owner_id.as_deref() == Some(player_id) {
                visited.insert(rid.clone());
                queue.push_back((rid.clone(), 0usize));
            }
        }

        while let Some((current, depth)) = queue.pop_front() {
            if current == target_id {
                return true;
            }
            if depth >= max_range {
                continue;
            }
            if let Some(neighbors) = self.neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) && regions.contains_key(neighbor) {
                        visited.insert(neighbor.clone());
                        queue.push_back((neighbor.clone(), depth + 1));
                    }
                }
            }
        }

        false
    }

    fn execute_nuke(
        &self,
        player_id: &str,
        target_region_id: &str,
        _config: &AbilityConfig,
        scaled_damage: i64,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        // Nuke is delayed — damage applied on impact (after flight time)
        const NUKE_FLIGHT_TICKS: i64 = 8;

        let mut affected_neighbors = Vec::new();
        if let Some(neighbors) = self.neighbor_map.get(target_region_id) {
            for nid in neighbors {
                affected_neighbors.push(nid.clone());
            }
        }

        active_effects.push(ActiveEffect {
            effect_type: "ab_province_nuke".into(),
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: affected_neighbors,
            ticks_remaining: NUKE_FLIGHT_TICKS,
            total_ticks: NUKE_FLIGHT_TICKS,
            params: serde_json::json!({ "damage": scaled_damage }),
        });

        Vec::new()
    }

    fn apply_nuke_damage(
        &self,
        target_region_id: &str,
        affected_region_ids: &[String],
        damage: f64,
        regions: &mut HashMap<String, Region>,
    ) -> Vec<Event> {
        let kill_pct = (damage / 100.0).min(1.0);

        // Target gets full damage, neighbors get 50% splash
        let mut targets: Vec<(&str, f64)> = Vec::new();
        targets.push((target_region_id, 1.0));
        for nid in affected_region_ids {
            targets.push((nid.as_str(), 0.5));
        }

        for (rid, damage_mult) in &targets {
            let region = match regions.get_mut(*rid) {
                Some(r) => r,
                None => continue,
            };
            let effective_kill_pct = (kill_pct * damage_mult).min(1.0);
            let is_capital = region.is_capital;
            let mut new_units: HashMap<String, i64> = HashMap::new();
            let mut total_remaining: i64 = 0;
            for (unit_type, count) in &region.units {
                let killed = (*count as f64 * effective_kill_pct).round() as i64;
                let remaining = (*count - killed).max(0);
                if remaining > 0 {
                    new_units.insert(unit_type.clone(), remaining);
                    total_remaining += remaining;
                }
            }
            // Capital must keep at least 1 unit to prevent losing via nuke.
            // Always preserve infantry (the default unit type) for deterministic behaviour
            // rather than relying on arbitrary HashMap iteration order.
            if is_capital && total_remaining == 0 {
                let default_type = self.default_unit_type_slug();
                new_units.insert(default_type, 1);
            }
            region.units = new_units;
            sync_region_unit_meta(region, self);
        }

        Vec::new()
    }

    fn execute_virus(
        &self,
        player_id: &str,
        target_region_id: &str,
        config: &AbilityConfig,
        scaled_duration: i64,
        regions: &HashMap<String, Region>,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        let spread_range = config.effect_params.get("spread_range")
            .and_then(|v| v.as_i64())
            .unwrap_or(1) as usize;

        // BFS to find affected neighbors within spread_range
        let mut affected = Vec::new();
        let mut visited = std::collections::HashSet::new();
        visited.insert(target_region_id.to_string());
        let mut queue = VecDeque::new();
        queue.push_back((target_region_id.to_string(), 0usize));

        while let Some((current, depth)) = queue.pop_front() {
            if depth > 0 {
                affected.push(current.clone());
            }
            if depth >= spread_range {
                continue;
            }
            if let Some(neighbors) = self.neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) && regions.contains_key(neighbor) {
                        visited.insert(neighbor.clone());
                        queue.push_back((neighbor.clone(), depth + 1));
                    }
                }
            }
        }

        active_effects.push(ActiveEffect {
            effect_type: "ab_virus".into(),
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: affected,
            ticks_remaining: scaled_duration,
            total_ticks: scaled_duration,
            params: config.effect_params.clone(),
        });

        Vec::new()
    }

    fn execute_submarine(
        &self,
        player_id: &str,
        target_region_id: &str,
        _config: &AbilityConfig,
        scaled_duration: i64,
        regions: &HashMap<String, Region>,
        active_effects: &mut Vec<ActiveEffect>,
    ) {
        // Reveal target + neighboring enemy regions
        let mut revealed = Vec::new();
        if let Some(neighbors) = self.neighbor_map.get(target_region_id) {
            for nid in neighbors {
                if let Some(r) = regions.get(nid.as_str()) {
                    if r.owner_id.is_some() && r.owner_id.as_deref() != Some(player_id) {
                        revealed.push(nid.clone());
                    }
                }
            }
        }

        active_effects.push(ActiveEffect {
            effect_type: "ab_pr_submarine".into(),
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: revealed,
            ticks_remaining: scaled_duration,
            total_ticks: scaled_duration,
            params: serde_json::json!({}),
        });
    }

    fn execute_shield(
        &self,
        player_id: &str,
        target_region_id: &str,
        _config: &AbilityConfig,
        scaled_duration: i64,
        active_effects: &mut Vec<ActiveEffect>,
    ) {
        active_effects.push(ActiveEffect {
            effect_type: "ab_shield".into(),
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: Vec::new(),
            ticks_remaining: scaled_duration,
            total_ticks: scaled_duration,
            params: serde_json::json!({}),
        });
    }

    fn execute_flash(
        &self,
        player_id: &str,
        target_region_id: &str,
        config: &AbilityConfig,
        scaled_duration: i64,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        let radius = config
            .effect_params
            .get("radius")
            .and_then(|v| v.as_u64())
            .unwrap_or(2) as usize;

        // BFS to find all regions within the flash radius, including the target itself.
        let mut affected: Vec<String> = Vec::new();
        let mut visited = std::collections::HashSet::new();
        visited.insert(target_region_id.to_string());
        let mut queue = VecDeque::new();
        queue.push_back((target_region_id.to_string(), 0usize));

        while let Some((current, depth)) = queue.pop_front() {
            if depth > 0 {
                affected.push(current.clone());
            }
            if depth >= radius {
                continue;
            }
            if let Some(neighbors) = self.neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) {
                        visited.insert(neighbor.clone());
                        queue.push_back((neighbor.clone(), depth + 1));
                    }
                }
            }
        }

        let ticks = scaled_duration;
        active_effects.push(ActiveEffect {
            effect_type: "ab_flash".into(),
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: affected.clone(),
            ticks_remaining: ticks,
            total_ticks: ticks,
            params: config.effect_params.clone(),
        });

        vec![Event::FlashEffect {
            source_player_id: player_id.to_string(),
            target_region_id: target_region_id.to_string(),
            affected_region_ids: affected,
            ticks_remaining: ticks,
        }]
    }

    fn execute_conscription(
        &self,
        target_region_id: &str,
        config: &AbilityConfig,
        regions: &mut HashMap<String, Region>,
    ) -> Vec<Event> {
        let collect_percent = config.effect_params.get("collect_percent")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.3);

        let default_unit_type = self.default_unit_type_slug();

        // Find neutral neighbors
        let neighbors = match self.neighbor_map.get(target_region_id) {
            Some(n) => n.clone(),
            None => return Vec::new(),
        };

        let mut total_collected = 0i64;
        for neighbor_id in &neighbors {
            let neighbor = match regions.get_mut(neighbor_id) {
                Some(r) => r,
                None => continue,
            };
            // Only collect from neutral (unowned) regions
            if neighbor.owner_id.is_some() {
                continue;
            }
            let base_units = neighbor.units.get(&default_unit_type).copied().unwrap_or(0);
            let collected = (base_units as f64 * collect_percent).round() as i64;
            if collected > 0 {
                remove_units(neighbor, &default_unit_type, collected);
                sync_region_unit_meta(neighbor, self);
                total_collected += collected;
            }
        }

        if total_collected > 0 {
            let target = regions.get_mut(target_region_id).unwrap();
            add_units(target, &default_unit_type, total_collected);
            sync_region_unit_meta(target, self);
        }

        Vec::new()
    }

    fn process_active_effects(
        &self,
        regions: &mut HashMap<String, Region>,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        let mut events = Vec::new();
        let mut i = 0;

        while i < active_effects.len() {
            active_effects[i].ticks_remaining -= 1;

            // Submarine: emit tick event so frontend knows revealed regions
            if active_effects[i].effect_type == "ab_pr_submarine" {
                events.push(Event::AbilityEffectTick {
                    effect_type: "ab_pr_submarine".into(),
                    target_region_id: active_effects[i].target_region_id.clone(),
                    affected_region_ids: active_effects[i].affected_region_ids.clone(),
                    ticks_remaining: active_effects[i].ticks_remaining,
                });
            }

            // Flash: emit tick event every tick so the frontend maintains fog-of-war overlay.
            if active_effects[i].effect_type == "ab_flash" {
                events.push(Event::AbilityEffectTick {
                    effect_type: "ab_flash".into(),
                    target_region_id: active_effects[i].target_region_id.clone(),
                    affected_region_ids: active_effects[i].affected_region_ids.clone(),
                    ticks_remaining: active_effects[i].ticks_remaining,
                });
            }

            if active_effects[i].effect_type == "ab_virus" {
                let kill_percent = active_effects[i].params.get("unit_kill_percent")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.05);

                let all_affected: Vec<String> = std::iter::once(active_effects[i].target_region_id.clone())
                    .chain(active_effects[i].affected_region_ids.clone())
                    .collect();

                for rid in &all_affected {
                    if let Some(region) = regions.get_mut(rid) {
                        if region.units.is_empty() {
                            continue;
                        }
                        let had_units = region.units.values().any(|&c| c > 0);
                        let mut new_units: HashMap<String, i64> = HashMap::new();
                        for (unit_type, count) in &region.units {
                            let killed = (*count as f64 * kill_percent).ceil() as i64;
                            let remaining = (*count - killed).max(0);
                            if remaining > 0 {
                                new_units.insert(unit_type.clone(), remaining);
                            }
                        }
                        // Safety floor: a region that had units must keep at least 1
                        // so that multiple stacked virus effects cannot wipe it in one tick.
                        if had_units && new_units.is_empty() {
                            let default_type = self.default_unit_type_slug();
                            new_units.insert(default_type, 1);
                        }
                        region.units = new_units;
                        sync_region_unit_meta(region, self);
                    }
                }

                events.push(Event::AbilityEffectTick {
                    effect_type: "ab_virus".into(),
                    target_region_id: active_effects[i].target_region_id.clone(),
                    affected_region_ids: active_effects[i].affected_region_ids.clone(),
                    ticks_remaining: active_effects[i].ticks_remaining,
                });
            }

            if active_effects[i].ticks_remaining <= 0 {
                let expired = active_effects.swap_remove(i);

                // Nuke: apply damage on impact (when flight time expires)
                if expired.effect_type == "ab_province_nuke" {
                    let damage = expired.params.get("damage")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(50.0);
                    events.extend(self.apply_nuke_damage(
                        &expired.target_region_id,
                        &expired.affected_region_ids,
                        damage,
                        regions,
                    ));
                }

                events.push(Event::AbilityEffectExpired {
                    effect_type: expired.effect_type,
                    target_region_id: expired.target_region_id,
                });
            } else {
                i += 1;
            }
        }

        events
    }

    // --- Action processing ---

    fn process_action(
        &self,
        action: &Action,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        buildings_queue: &mut Vec<BuildingQueueItem>,
        unit_queue: &mut Vec<UnitQueueItem>,
        transit_queue: &mut Vec<TransitQueueItem>,
        air_transit_queue: &mut Vec<AirTransitItem>,
        diplomacy: &mut DiplomacyState,
        current_tick: i64,
    ) -> Vec<Event> {
        match action.action_type.as_str() {
            "attack" => self.process_attack(action, players, regions, transit_queue, air_transit_queue, diplomacy, current_tick),
            "move" => self.process_move(action, regions, transit_queue, air_transit_queue, current_tick),
            "build" | "upgrade_building" => self.process_build(action, players, regions, buildings_queue),
            "produce_unit" => self.process_unit_production(action, players, regions, unit_queue),
            "bombard" => self.process_bombard(action, players, regions),
            "intercept" => self.process_intercept(action, players, regions, air_transit_queue),
            "propose_pact" | "respond_pact" | "propose_peace" | "respond_peace" | "break_pact" | "declare_war" => {
                self.process_diplomacy_action(action, players, regions, diplomacy, current_tick)
            }
            _ => Vec::new(),
        }
    }

    fn process_diplomacy_action(
        &self,
        action: &Action,
        players: &HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        diplomacy: &mut DiplomacyState,
        current_tick: i64,
    ) -> Vec<Event> {
        if !self.settings.diplomacy_enabled {
            return Vec::new();
        }

        let player_id = match &action.player_id {
            Some(id) => id.as_str(),
            None => return Vec::new(),
        };

        // Verify player exists and is alive.
        match players.get(player_id) {
            Some(p) if p.is_alive => {}
            _ => return Vec::new(),
        }

        match action.action_type.as_str() {
            "declare_war" => {
                let target = match &action.target_player_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak celu", action)],
                };
                if player_id == target {
                    return vec![reject_action(player_id, "Nie mozesz wypowiedziec wojny sobie", action)];
                }
                match players.get(target) {
                    Some(p) if p.is_alive => {}
                    _ => return vec![reject_action(player_id, "Gracz nie istnieje lub jest wyeliminowany", action)],
                }
                if diplomacy.are_at_war(player_id, target) {
                    return vec![reject_action(player_id, "Juz jestescie w stanie wojny", action)];
                }
                diplomacy.declare_war(player_id, target, current_tick)
            }

            "propose_pact" => {
                let target = match &action.target_player_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak celu", action)],
                };
                if player_id == target {
                    return vec![reject_action(player_id, "Nie mozesz podpisac paktu z soba", action)];
                }
                match players.get(target) {
                    Some(p) if p.is_alive => {}
                    _ => return vec![reject_action(player_id, "Gracz nie istnieje lub jest wyeliminowany", action)],
                }
                // Can't propose NAP while at war.
                if diplomacy.are_at_war(player_id, target) {
                    return vec![reject_action(player_id, "Nie mozna zaproponowac paktu w trakcie wojny — najpierw zaproponuj pokoj", action)];
                }
                // Already have a pact?
                if diplomacy.have_pact(player_id, target) {
                    return vec![reject_action(player_id, "Pakt juz istnieje", action)];
                }
                // Already pending proposal?
                let has_pending = diplomacy.proposals.iter().any(|p| {
                    p.status == "pending"
                        && p.proposal_type == "nap"
                        && ((p.from_player_id == player_id && p.to_player_id == target)
                            || (p.from_player_id == target && p.to_player_id == player_id))
                });
                if has_pending {
                    return vec![reject_action(player_id, "Propozycja paktu juz oczekuje", action)];
                }

                let proposal_id = uuid_v4();
                let timeout = self.settings.proposal_timeout_ticks;
                let expires = if timeout > 0 { Some(current_tick + timeout) } else { None };
                diplomacy.proposals.push(DiplomacyProposal {
                    id: proposal_id.clone(),
                    proposal_type: "nap".to_string(),
                    from_player_id: player_id.to_string(),
                    to_player_id: target.to_string(),
                    created_tick: current_tick,
                    conditions: None,
                    status: "pending".to_string(),
                    rejected_tick: None,
                    expires_tick: expires,
                });

                vec![Event::PactProposed {
                    proposal_id,
                    from_player_id: player_id.to_string(),
                    to_player_id: target.to_string(),
                    pact_type: "nap".to_string(),
                }]
            }

            "respond_pact" => {
                let proposal_id = match &action.proposal_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak ID propozycji", action)],
                };
                let accept = action.accept.unwrap_or(false);

                let proposal = match diplomacy.proposals.iter_mut().find(|p| {
                    p.id == proposal_id && p.to_player_id == player_id && p.status == "pending"
                }) {
                    Some(p) => p,
                    None => return vec![reject_action(player_id, "Propozycja nie znaleziona lub nie do ciebie", action)],
                };

                if accept {
                    proposal.status = "accepted".to_string();
                    let (pa, pb) = DiplomacyState::war_key(&proposal.from_player_id, &proposal.to_player_id);
                    let pact_id = uuid_v4();
                    let expires_tick = if self.settings.nap_minimum_duration_ticks > 0 {
                        Some(current_tick + self.settings.nap_minimum_duration_ticks)
                    } else {
                        None
                    };

                    diplomacy.pacts.push(Pact {
                        id: pact_id.clone(),
                        pact_type: "nap".to_string(),
                        player_a: pa.clone(),
                        player_b: pb.clone(),
                        created_tick: current_tick,
                        expires_tick,
                    });

                    vec![Event::PactAccepted {
                        pact_id,
                        player_a: pa,
                        player_b: pb,
                        pact_type: "nap".to_string(),
                    }]
                } else {
                    let from = proposal.from_player_id.clone();
                    let to = proposal.to_player_id.clone();
                    proposal.status = "rejected".to_string();
                    proposal.rejected_tick = Some(current_tick);

                    vec![Event::PactRejected {
                        proposal_id: proposal_id.to_string(),
                        from_player_id: from,
                        to_player_id: to,
                    }]
                }
            }

            "break_pact" => {
                let pact_id = match &action.pact_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak ID paktu", action)],
                };
                let pact = match diplomacy.pacts.iter().find(|p| {
                    p.id == pact_id && (p.player_a == player_id || p.player_b == player_id)
                }) {
                    Some(p) => p.clone(),
                    None => return vec![reject_action(player_id, "Pakt nie znaleziony", action)],
                };

                diplomacy.pacts.retain(|p| p.id != pact_id);

                vec![Event::PactBroken {
                    pact_id: pact.id,
                    broken_by: player_id.to_string(),
                    player_a: pact.player_a,
                    player_b: pact.player_b,
                }]
            }

            "propose_peace" => {
                let target = match &action.target_player_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak celu", action)],
                };
                // Must be at war to propose peace.
                if !diplomacy.are_at_war(player_id, target) {
                    return vec![reject_action(player_id, "Nie jestescie w stanie wojny", action)];
                }
                // Check peace cooldown.
                let has_recent_rejected = diplomacy.proposals.iter().any(|p| {
                    p.proposal_type == "peace"
                        && p.status == "rejected"
                        && p.from_player_id == player_id
                        && p.to_player_id == target
                        && p.rejected_tick
                            .map(|t| current_tick - t < self.settings.peace_cooldown_ticks)
                            .unwrap_or(false)
                });
                if has_recent_rejected {
                    return vec![reject_action(player_id, "Musisz poczekac przed ponowna propozycja pokoju", action)];
                }
                // Already pending?
                let has_pending = diplomacy.proposals.iter().any(|p| {
                    p.status == "pending"
                        && p.proposal_type == "peace"
                        && p.from_player_id == player_id
                        && p.to_player_id == target
                });
                if has_pending {
                    return vec![reject_action(player_id, "Propozycja pokoju juz oczekuje", action)];
                }

                let condition_type = action
                    .condition_type
                    .clone()
                    .unwrap_or_else(|| "status_quo".to_string());
                let provinces_to_return = action.provinces_to_return.clone().unwrap_or_default();

                let conditions = PeaceConditions {
                    condition_type,
                    provinces_to_return,
                };

                let proposal_id = uuid_v4();
                let timeout = self.settings.proposal_timeout_ticks;
                let expires = if timeout > 0 { Some(current_tick + timeout) } else { None };
                diplomacy.proposals.push(DiplomacyProposal {
                    id: proposal_id.clone(),
                    proposal_type: "peace".to_string(),
                    from_player_id: player_id.to_string(),
                    to_player_id: target.to_string(),
                    created_tick: current_tick,
                    conditions: Some(conditions.clone()),
                    status: "pending".to_string(),
                    rejected_tick: None,
                    expires_tick: expires,
                });

                vec![Event::PeaceProposed {
                    proposal_id,
                    from_player_id: player_id.to_string(),
                    to_player_id: target.to_string(),
                    conditions,
                }]
            }

            "respond_peace" => {
                let proposal_id = match &action.proposal_id {
                    Some(id) => id.as_str(),
                    None => return vec![reject_action(player_id, "Brak ID propozycji", action)],
                };
                let accept = action.accept.unwrap_or(false);

                let proposal = match diplomacy.proposals.iter_mut().find(|p| {
                    p.id == proposal_id
                        && p.to_player_id == player_id
                        && p.status == "pending"
                        && p.proposal_type == "peace"
                }) {
                    Some(p) => p,
                    None => return vec![reject_action(player_id, "Propozycja pokoju nie znaleziona", action)],
                };

                if accept {
                    proposal.status = "accepted".to_string();
                    let from = proposal.from_player_id.clone();
                    let to = proposal.to_player_id.clone();
                    let conditions = proposal.conditions.clone().unwrap_or(PeaceConditions {
                        condition_type: "status_quo".to_string(),
                        provinces_to_return: Vec::new(),
                    });

                    // Apply peace conditions.
                    if conditions.condition_type == "return_provinces" {
                        let war = diplomacy.find_war(&from, &to).cloned();
                        if let Some(war) = war {
                            for region_id in &conditions.provinces_to_return {
                                let original_owner = war
                                    .provinces_changed
                                    .iter()
                                    .filter(|pc| pc.region_id == *region_id)
                                    .last()
                                    .map(|pc| pc.from_player_id.clone());

                                if let Some(original) = original_owner {
                                    if let Some(region) = regions.get_mut(region_id) {
                                        let current_owner = region.owner_id.clone();
                                        if current_owner.as_deref() == Some(&from)
                                            || current_owner.as_deref() == Some(&to)
                                        {
                                            region.owner_id = Some(original);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // End the war.
                    diplomacy.end_war(&from, &to);

                    vec![Event::PeaceAccepted {
                        from_player_id: from,
                        to_player_id: to,
                        conditions,
                    }]
                } else {
                    let from = proposal.from_player_id.clone();
                    let to = proposal.to_player_id.clone();
                    proposal.status = "rejected".to_string();
                    proposal.rejected_tick = Some(current_tick);

                    vec![Event::PeaceRejected {
                        proposal_id: proposal_id.to_string(),
                        from_player_id: from,
                        to_player_id: to,
                    }]
                }
            }

            _ => Vec::new(),
        }
    }

    fn process_attack(
        &self,
        action: &Action,
        _players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        transit_queue: &mut Vec<TransitQueueItem>,
        air_transit_queue: &mut Vec<AirTransitItem>,
        diplomacy: &mut DiplomacyState,
        current_tick: i64,
    ) -> Vec<Event> {
        let source_id = match &action.source_region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let target_id = match &action.target_region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let units = action.units.unwrap_or(0);
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };

        let source = match regions.get(source_id) {
            Some(r) => r,
            None => return Vec::new(),
        };
        if source.owner_id.as_deref() != Some(player_id) {
            return Vec::new();
        }

        // Region attack cooldown check
        if self.settings.region_attack_cooldown > 0 {
            if let Some(&ready_tick) = source.action_cooldowns.get("attack") {
                if current_tick < ready_tick {
                    return vec![reject_action(
                        player_id,
                        &format!("Region na cooldownie ({} ticki)", ready_tick - current_tick),
                        action,
                    )];
                }
            }
        }

        let unit_type = action
            .unit_type
            .clone()
            .unwrap_or_else(|| get_region_unit_type(source, self));

        if units <= 0 || get_available_units(source, &unit_type, self) < units {
            return Vec::new();
        }

        let target = match regions.get(target_id) {
            Some(r) => r,
            None => return Vec::new(),
        };

        if target.owner_id.as_deref() == Some(player_id) {
            return vec![reject_action(
                player_id,
                "Nie mozesz atakowac wlasnego regionu",
                action,
            )];
        }

        // Capital protection — reject attacks on capitals during protection period.
        if self.settings.capital_protection_ticks > 0
            && target.is_capital
            && target.owner_id.is_some()
            && current_tick < self.settings.capital_protection_ticks
        {
            return vec![Event::CapitalProtected {
                target_region_id: target_id.clone(),
                attacker_id: player_id.clone(),
                ticks_remaining: self.settings.capital_protection_ticks - current_tick,
            }];
        }

        // Diplomacy: auto-declare war if attacking a player-owned region.
        let mut diplomacy_events = Vec::new();
        if self.settings.diplomacy_enabled {
            if let Some(defender_id) = target.owner_id.as_deref() {
                if !diplomacy.are_at_war(player_id, defender_id) {
                    diplomacy_events.extend(diplomacy.declare_war(player_id, defender_id, current_tick));
                }
            }
        }

        let unit_config = self.get_unit_config(&unit_type);

        // SAM cannot attack — it can only be repositioned between own provinces via move.
        if unit_config.intercept_air && unit_config.movement_type == "land" {
            return vec![reject_action(player_id, "SAM nie moze atakowac — uzyj ruchu na wlasne prowincje", action)];
        }

        let attack_range = unit_config.attack_range.max(1);
        let distance = self.get_travel_distance(
            source_id,
            target_id,
            regions,
            &unit_config,
            attack_range as usize,
            None,
        );
        let distance = match distance {
            Some(d) => d,
            None => {
                return vec![reject_action(
                    player_id,
                    &attack_rejection_message(&unit_config),
                    action,
                )];
            }
        };

        let source = regions.get_mut(source_id).unwrap();
        deploy_units_from_region(source, &unit_type, units, self);

        // Set region attack cooldown
        if self.settings.region_attack_cooldown > 0 {
            source.action_cooldowns.insert(
                "attack".to_string(),
                current_tick + self.settings.region_attack_cooldown,
            );
        }

        // Air units go into the air transit queue instead of the ground transit queue.
        if unit_config.movement_type == "air" {
            // Geometric flight path — provinces whose centroids lie under the flight line.
            let flight_path = self.get_flight_line_path(source_id, target_id, regions, 8.0);
            let total_distance = flight_path.len().max(1) as i64;
            let ticks_per_hop = if unit_config.air_speed_ticks_per_hop > 0 {
                unit_config.air_speed_ticks_per_hop
            } else if unit_config.combat_target == "air" {
                2
            } else {
                3
            };
            let speed_per_tick = 1.0 / (ticks_per_hop as f64 * total_distance as f64).max(1.0);
            let mission_type = if unit_config.combat_target == "air" {
                "fighter_attack"
            } else {
                "bomb_run"
            };
            let escort_fighters = action.escort_fighters.unwrap_or(0);
            let flight_id = uuid_v4();
            let launch_force = units * unit_config.manpower_cost.max(1) as i64;
            eprintln!("[AIR] Launching {} mission {} | {} bombers × mc={} = force {} | escorts={} | {} → {}",
                mission_type, flight_id, units, unit_config.manpower_cost.max(1),
                launch_force, escort_fighters, source_id, target_id);
            air_transit_queue.push(AirTransitItem {
                id: flight_id.clone(),
                mission_type: mission_type.to_string(),
                source_region_id: source_id.clone(),
                target_region_id: target_id.clone(),
                player_id: player_id.clone(),
                unit_type: unit_type.clone(),
                units,
                escort_fighters,
                progress: 0.0,
                speed_per_tick,
                total_distance,
                interceptors: Vec::new(),
                flight_path,
                last_bombed_hop: 0,
            });
            let mut result_events = diplomacy_events;
            result_events.push(Event::AirMissionLaunched {
                flight_id,
                mission_type: mission_type.to_string(),
                player_id: player_id.clone(),
                source_region_id: source_id.clone(),
                target_region_id: target_id.clone(),
                unit_type: unit_type.clone(),
                units,
                escort_fighters,
                speed_per_tick,
            });
            return result_events;
        }

        let travel_ticks = get_travel_ticks(distance, &unit_config);

        transit_queue.push(TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: source_id.clone(),
            target_region_id: target_id.clone(),
            player_id: player_id.clone(),
            unit_type: unit_type.clone(),
            units,
            ticks_remaining: travel_ticks,
            travel_ticks,
        });

        let mut result_events = diplomacy_events;
        result_events.push(Event::TroopsSent {
            action_type: "attack".into(),
            source_region_id: source_id.clone(),
            target_region_id: target_id.clone(),
            player_id: player_id.clone(),
            units,
            unit_type,
            travel_ticks,
        });
        result_events
    }

    fn process_move(
        &self,
        action: &Action,
        regions: &mut HashMap<String, Region>,
        transit_queue: &mut Vec<TransitQueueItem>,
        air_transit_queue: &mut Vec<AirTransitItem>,
        current_tick: i64,
    ) -> Vec<Event> {
        let source_id = match &action.source_region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let target_id = match &action.target_region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let units = action.units.unwrap_or(0);
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };

        let source = match regions.get(source_id) {
            Some(r) => r,
            None => return Vec::new(),
        };
        let target = match regions.get(target_id) {
            Some(r) => r,
            None => return Vec::new(),
        };

        if source.owner_id.as_deref() != Some(player_id)
            || target.owner_id.as_deref() != Some(player_id)
        {
            return vec![reject_action(
                player_id,
                "Mozesz przemieszczac wojska tylko miedzy swoimi regionami",
                action,
            )];
        }

        // Region move cooldown check
        if self.settings.region_move_cooldown > 0 {
            if let Some(&ready_tick) = source.action_cooldowns.get("move") {
                if current_tick < ready_tick {
                    return vec![reject_action(
                        player_id,
                        &format!("Region na cooldownie ruchu ({} ticki)", ready_tick - current_tick),
                        action,
                    )];
                }
            }
        }

        let unit_type = action
            .unit_type
            .clone()
            .unwrap_or_else(|| get_region_unit_type(source, self));

        if units <= 0 || get_available_units(source, &unit_type, self) < units {
            return Vec::new();
        }

        let unit_config = self.get_unit_config(&unit_type);
        let speed = unit_config.speed.max(1);
        let move_range = speed.max(unit_config.attack_range) as usize;

        let distance = self.get_travel_distance(
            source_id,
            target_id,
            regions,
            &unit_config,
            move_range,
            Some(player_id),
        );
        let distance = match distance {
            Some(d) => d,
            None => {
                return vec![reject_action(
                    player_id,
                    &move_rejection_message(&unit_config),
                    action,
                )]
            }
        };

        let source = regions.get_mut(source_id).unwrap();
        deploy_units_from_region(source, &unit_type, units, self);

        // Set region move cooldown
        if self.settings.region_move_cooldown > 0 {
            source.action_cooldowns.insert(
                "move".to_string(),
                current_tick + self.settings.region_move_cooldown,
            );
        }

        // Air units go into the air transit queue instead of the ground transit queue.
        if unit_config.movement_type == "air" {
            // Geometric flight path — provinces whose centroids lie under the flight line.
            let flight_path = self.get_flight_line_path(source_id, target_id, regions, 8.0);
            let total_distance = flight_path.len().max(1) as i64;
            let ticks_per_hop = if unit_config.air_speed_ticks_per_hop > 0 {
                unit_config.air_speed_ticks_per_hop
            } else if unit_config.combat_target == "air" {
                2
            } else {
                3
            };
            let speed_per_tick = 1.0 / (ticks_per_hop as f64 * total_distance as f64).max(1.0);
            let flight_id = uuid_v4();
            eprintln!("[AIR] Launching air_move mission {} from {} to {} ({} units)",
                flight_id, source_id, target_id, units);
            air_transit_queue.push(AirTransitItem {
                id: flight_id.clone(),
                mission_type: "air_move".to_string(),
                source_region_id: source_id.clone(),
                target_region_id: target_id.clone(),
                player_id: player_id.clone(),
                unit_type: unit_type.clone(),
                units,
                escort_fighters: 0,
                progress: 0.0,
                speed_per_tick,
                total_distance,
                interceptors: Vec::new(),
                flight_path,
                last_bombed_hop: 0,
            });
            return vec![Event::TroopsSent {
                action_type: "move".into(),
                source_region_id: source_id.clone(),
                target_region_id: target_id.clone(),
                player_id: player_id.clone(),
                units,
                unit_type,
                travel_ticks: (ticks_per_hop * total_distance).max(1),
            }];
        }

        let travel_ticks = get_travel_ticks(distance, &unit_config);

        transit_queue.push(TransitQueueItem {
            action_type: "move".into(),
            source_region_id: source_id.clone(),
            target_region_id: target_id.clone(),
            player_id: player_id.clone(),
            unit_type: unit_type.clone(),
            units,
            ticks_remaining: travel_ticks,
            travel_ticks,
        });

        vec![Event::TroopsSent {
            action_type: "move".into(),
            source_region_id: source_id.clone(),
            target_region_id: target_id.clone(),
            player_id: player_id.clone(),
            units,
            unit_type,
            travel_ticks,
        }]
    }

    fn process_build(
        &self,
        action: &Action,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        buildings_queue: &mut Vec<BuildingQueueItem>,
    ) -> Vec<Event> {
        let region_id = match &action.region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let building_type = match &action.building_type {
            Some(bt) => bt,
            None => return Vec::new(),
        };
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };

        let player = match players.get_mut(player_id.as_str()) {
            Some(p) => p,
            None => return Vec::new(),
        };
        let region = match regions.get(region_id.as_str()) {
            Some(r) => r,
            None => return Vec::new(),
        };
        if region.owner_id.as_deref() != Some(player_id) {
            return Vec::new();
        }

        let config = match self.settings.building_types.get(building_type) {
            Some(c) => c,
            None => {
                return vec![reject_action(player_id, "Nieznany typ budynku", action)];
            }
        };

        // Deck system: when unlocked_buildings is non-empty only those slugs are permitted.
        if !player.unlocked_buildings.is_empty()
            && !player.unlocked_buildings.iter().any(|s| s == building_type)
        {
            return vec![reject_action(
                player_id,
                "Ten budynek nie jest odblokowany w twoim decku",
                action,
            )];
        }

        if config.requires_coastal && !region.is_coastal {
            return vec![reject_action(
                player_id,
                "Ten budynek mozna postawic tylko w regionie przybrzeznym",
                action,
            )];
        }

        let current_count = Self::count_buildings(&region.building_instances, building_type);

        // "build" action = always build a NEW instance (check max_per_region)
        // "upgrade_building" action = upgrade existing instance (check max_level)
        let is_upgrade = action.action_type == "upgrade_building";

        let queued_new_count = buildings_queue
            .iter()
            .filter(|q| q.region_id == *region_id && q.building_type == *building_type && !q.is_upgrade)
            .count() as i64;

        if is_upgrade {
            // Validate upgrade conditions
            if current_count == 0 {
                return vec![reject_action(player_id, "Brak budynku do ulepszenia", action)];
            }
            // Find the level of the lowest-level instance (the one that will be upgraded).
            let current_level = region.building_instances
                .iter()
                .filter(|b| &b.building_type == building_type)
                .map(|b| b.level)
                .min()
                .unwrap_or(1);
            let deck_max = player.building_levels.get(building_type).copied().unwrap_or(1);
            let config_max = config.max_level;
            let max_allowed_level = deck_max.min(config_max);
            let upgrade_queued = buildings_queue
                .iter()
                .any(|q| q.region_id == *region_id && q.building_type == *building_type && q.is_upgrade);
            if upgrade_queued {
                return vec![reject_action(player_id, "Ulepszenie juz w kolejce", action)];
            }
            if current_level >= max_allowed_level {
                return vec![reject_action(player_id, "Osiągnięto maksymalny poziom budynku", action)];
            }
        } else {
            // Validate new build (max_per_region)
            let is_new_build = current_count + queued_new_count < config.max_per_region as i64;
            if !is_new_build {
                return vec![reject_action(player_id, "Limit budynków w regionie", action)];
            }
        }

        let total_region_queue = buildings_queue
            .iter()
            .filter(|q| q.region_id == *region_id)
            .count();
        if total_region_queue >= self.settings.max_build_queue_per_region as usize {
            return vec![reject_action(
                player_id,
                "Region ma juz maksymalna liczbe budow w kolejce",
                action,
            )];
        }

        if is_upgrade {
            let current_level = region.building_instances
                .iter()
                .filter(|b| &b.building_type == building_type)
                .map(|b| b.level)
                .min()
                .unwrap_or(1);
            let next_level = current_level + 1;
            let upgrade_cost = get_level_stat_i64(&config.level_stats, next_level, "energy_cost")
                .unwrap_or(config.energy_cost * next_level);
            if player.energy < upgrade_cost {
                return vec![reject_action(player_id, "Za mało energii na ulepszenie", action)];
            }
            let upgrade_time = get_level_stat_i64(&config.level_stats, next_level, "build_time_ticks")
                .unwrap_or(config.build_time_ticks * next_level);
            player.energy -= upgrade_cost;

            buildings_queue.push(BuildingQueueItem {
                region_id: region_id.clone(),
                building_type: building_type.clone(),
                player_id: player_id.clone(),
                ticks_remaining: upgrade_time,
                total_ticks: upgrade_time,
                is_upgrade: true,
                target_level: next_level,
            });

            vec![Event::BuildStarted {
                region_id: region_id.clone(),
                building_type: building_type.clone(),
                player_id: player_id.clone(),
                ticks_remaining: upgrade_time,
                energy_cost: upgrade_cost,
            }]
        } else {
            // New build (level 1)
            let energy_cost = get_level_stat_i64(&config.level_stats, 1, "energy_cost")
                .unwrap_or(config.energy_cost);
            if player.energy < energy_cost {
                return vec![reject_action(player_id, "Za mało energii na budowę", action)];
            }
            let build_time = get_level_stat_i64(&config.level_stats, 1, "build_time_ticks")
                .unwrap_or(config.build_time_ticks);
            player.energy -= energy_cost;

            buildings_queue.push(BuildingQueueItem {
                region_id: region_id.clone(),
                building_type: building_type.clone(),
                player_id: player_id.clone(),
                ticks_remaining: build_time,
                total_ticks: build_time,
                is_upgrade: false,
                target_level: 0,
            });

            vec![Event::BuildStarted {
                region_id: region_id.clone(),
                building_type: building_type.clone(),
                player_id: player_id.clone(),
                ticks_remaining: build_time,
                energy_cost,
            }]
        }
    }

    fn process_unit_production(
        &self,
        action: &Action,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        unit_queue: &mut Vec<UnitQueueItem>,
    ) -> Vec<Event> {
        let region_id = match &action.region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let unit_type = match &action.unit_type {
            Some(ut) => ut,
            None => return Vec::new(),
        };
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };

        let player = match players.get_mut(player_id.as_str()) {
            Some(p) => p,
            None => return Vec::new(),
        };
        let region = match regions.get(region_id.as_str()) {
            Some(r) => r,
            None => return Vec::new(),
        };
        if region.owner_id.as_deref() != Some(player_id) {
            return Vec::new();
        }

        let unit_config = self.get_unit_config(unit_type);

        // Deck system: when unlocked_units is non-empty, units with a produced_by_slug (i.e.
        // advanced units) must appear in the unlock list; units without produced_by_slug (basic
        // infantry) are always available regardless of deck.
        if !player.unlocked_units.is_empty()
            && unit_config.produced_by_slug.is_some()
            && !player.unlocked_units.iter().any(|s| s == unit_type)
        {
            return vec![reject_action(
                player_id,
                "Ten typ jednostki nie jest odblokowany w twoim decku",
                action,
            )];
        }

        let produced_by_slug = match &unit_config.produced_by_slug {
            Some(slug) => slug.clone(),
            None => {
                return vec![reject_action(
                    player_id,
                    "Ten typ jednostki nie wymaga produkcji specjalnej",
                    action,
                )]
            }
        };

        if Self::count_buildings(&region.building_instances, &produced_by_slug) < 1 {
            return vec![reject_action(
                player_id,
                "Ten region nie ma wymaganej infrastruktury",
                action,
            )];
        }

        if unit_config.movement_type == "sea" && !region.is_coastal {
            return vec![reject_action(
                player_id,
                "Statki mozna produkowac tylko w regionie przybrzeznym",
                action,
            )];
        }

        let production_cost = get_level_stat_i64(&unit_config.level_stats, 1, "production_cost")
            .unwrap_or(unit_config.production_cost as i64);
        if player.energy < production_cost {
            return vec![reject_action(
                player_id,
                "Za malo waluty na produkcje jednostki",
                action,
            )];
        }

        let manpower_cost = get_level_stat_i64(&unit_config.level_stats, 1, "manpower_cost")
            .unwrap_or(unit_config.manpower_cost as i64)
            .max(1);
        let base_unit_type = self.default_unit_type_slug();
        if get_available_units(region, &base_unit_type, self) < manpower_cost {
            return vec![reject_action(
                player_id,
                "Za malo piechoty w regionie do zalogi tej jednostki",
                action,
            )];
        }

        let total_region_queue: i64 = unit_queue
            .iter()
            .filter(|q| q.region_id == *region_id)
            .map(|q| q.quantity.unwrap_or(1))
            .sum();
        if total_region_queue >= self.settings.max_unit_queue_per_region as i64 {
            return vec![reject_action(
                player_id,
                "Region ma juz maksymalna liczbe jednostek w produkcji",
                action,
            )];
        }

        player.energy -= production_cost;
        let production_time = get_level_stat_i64(&unit_config.level_stats, 1, "production_time_ticks")
            .unwrap_or(unit_config.production_time_ticks as i64)
            .max(1);

        unit_queue.push(UnitQueueItem {
            region_id: region_id.clone(),
            player_id: player_id.clone(),
            unit_type: unit_type.clone(),
            quantity: Some(1),
            manpower_cost: Some(manpower_cost),
            ticks_remaining: production_time,
            total_ticks: production_time,
        });

        vec![Event::UnitProductionStarted {
            region_id: region_id.clone(),
            player_id: player_id.clone(),
            unit_type: unit_type.clone(),
            quantity: 1,
            ticks_remaining: production_time,
            energy_cost: production_cost,
            manpower_cost,
        }]
    }

    // --- Bombard action ---

    fn process_bombard(
        &self,
        action: &Action,
        _players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
    ) -> Vec<Event> {
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let source_id = match &action.source_region_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        // Single target from target_region_ids[0] or target_region_id.
        let target_id = action.target_region_ids.as_ref()
            .and_then(|ids| ids.first().cloned())
            .or_else(|| action.target_region_id.clone());
        let target_id = match target_id {
            Some(id) => id,
            None => return Vec::new(),
        };

        let source = match regions.get(source_id) {
            Some(r) => r,
            None => return Vec::new(),
        };
        if source.owner_id.as_deref() != Some(player_id) {
            return Vec::new();
        }

        let unit_type = action.unit_type.clone().unwrap_or_else(|| {
            source.units.keys()
                .find(|ut| self.get_unit_config(ut).attack_range > 1)
                .cloned()
                .unwrap_or_else(|| "artillery".into())
        });

        let unit_config = self.get_unit_config(&unit_type);
        if unit_config.attack_range <= 1 {
            return vec![reject_action(player_id, "Ta jednostka nie ma zdolnosci bombardowania", action)];
        }

        // 1 artillery unit = 1 rocket. Fire requested amount or all available.
        let available = source.units.get(&unit_type).copied().unwrap_or(0);
        if available <= 0 {
            return Vec::new();
        }
        let rocket_count = action.units.map(|u| u.min(available)).unwrap_or(available);
        if rocket_count <= 0 {
            return Vec::new();
        }

        // Remove fired artillery from source — rockets are expendable ordnance.
        {
            let source_mut = regions.get_mut(source_id).unwrap();
            let remaining = available - rocket_count;
            if remaining > 0 {
                source_mut.units.insert(unit_type.clone(), remaining);
            } else {
                source_mut.units.remove(&unit_type);
            }
            sync_region_unit_meta(source_mut, self);
        }

        // Validate target: in range, enemy-owned.
        let max_range = unit_config.attack_range.max(1) as usize;
        let in_range = self.get_travel_distance(source_id, &target_id, regions, &unit_config, max_range, None).is_some();
        if !in_range {
            return vec![reject_action(player_id, "Cel poza zasiegiem bombardowania", action)];
        }

        // Validate target ownership using an immutable borrow (dropped before mutable use below).
        {
            let target = match regions.get(&target_id) {
                Some(r) => r,
                None => return Vec::new(),
            };
            let is_enemy = target.owner_id.as_ref().map(|oid| oid != player_id).unwrap_or(true);
            if !is_enemy {
                return vec![reject_action(player_id, "Nie mozna bombardowac wlasnych prowincji", action)];
            }
        }

        // SAM intercept: collect SAM units from target + neighboring provinces within SAM range.
        // Each SAM unit destroys 1 incoming rocket. BFS from target up to sam_range hops,
        // counting SAM owned by the defender. Uses only immutable borrows of `regions`.
        let sam_config = self.get_unit_config("sam");
        let sam_range = sam_config.attack_range.max(1) as usize;
        let mut total_sam = 0i64;
        let mut sam_region_ids: Vec<String> = Vec::new();

        let target_owner: Option<String> = regions.get(&target_id).and_then(|r| r.owner_id.clone());
        if let Some(ref defender_id) = target_owner {
            let mut visited = std::collections::HashSet::new();
            let mut queue = std::collections::VecDeque::new();
            visited.insert(target_id.clone());
            queue.push_back((target_id.clone(), 0usize));

            while let Some((rid, depth)) = queue.pop_front() {
                if let Some(region) = regions.get(&rid) {
                    if region.owner_id.as_deref() == Some(defender_id) {
                        let sam_count = region.units.get("sam").copied().unwrap_or(0);
                        if sam_count > 0 {
                            total_sam += sam_count;
                            sam_region_ids.push(rid.clone());
                        }
                    }
                }
                if depth < sam_range {
                    if let Some(neighbors) = self.neighbor_map.get(&rid) {
                        for nid in neighbors {
                            if visited.insert(nid.clone()) {
                                queue.push_back((nid.clone(), depth + 1));
                            }
                        }
                    }
                }
            }
        }

        let intercepted_count = total_sam.min(rocket_count);
        let effective_rockets = rocket_count - intercepted_count;

        // Consume SAM units — each SAM that intercepts is destroyed (one-shot)
        if intercepted_count > 0 {
            let mut remaining_to_consume = intercepted_count;
            for rid in &sam_region_ids {
                if remaining_to_consume <= 0 { break; }
                if let Some(region) = regions.get_mut(rid) {
                    let sam_count = region.units.get("sam").copied().unwrap_or(0);
                    let consumed = sam_count.min(remaining_to_consume);
                    let left = sam_count - consumed;
                    if left > 0 {
                        region.units.insert("sam".into(), left);
                    } else {
                        region.units.remove("sam");
                    }
                    remaining_to_consume -= consumed;
                    sync_region_unit_meta(region, self);
                }
            }
            eprintln!("[BOMBARD] SAM intercepted {} of {} rockets, SAM units consumed (regions: {:?})",
                intercepted_count, rocket_count, sam_region_ids);
        }

        // Each rocket deals damage = manpower_cost × attack of 1 artillery unit.
        let damage_per_rocket = (unit_config.manpower_cost.max(1) as f64 * unit_config.attack).ceil() as i64;
        eprintln!("[BOMBARD] damage_per_rocket={} (manpower={} × attack={})",
            damage_per_rocket, unit_config.manpower_cost, unit_config.attack);
        let mut total_killed = 0i64;

        // Now take the mutable borrow for the damage loop (all immutable borrows above are dropped).
        let target = regions.get_mut(&target_id).unwrap();

        for _r in 0..effective_rockets {
            let ground_total: i64 = target.units.iter()
                .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
                .map(|(_, c)| c)
                .sum();
            if ground_total <= 0 { break; }

            // This rocket kills damage_per_rocket worth of ground units (manpower × attack).
            let mut budget = damage_per_rocket;
            let mut new_units: HashMap<String, i64> = HashMap::new();
            for (ut, &count) in &target.units {
                let def_cfg = self.get_unit_config(ut);
                if def_cfg.movement_type == "air" || budget <= 0 {
                    new_units.insert(ut.clone(), count);
                    continue;
                }
                // Each defender unit costs its own manpower to kill.
                let def_mp = def_cfg.manpower_cost.max(1);
                let can_kill = (budget / def_mp).min(count);
                let killed = can_kill.max(if budget >= def_mp { 1 } else { 0 });
                budget -= killed * def_mp;
                total_killed += killed;
                let remaining = count - killed;
                if remaining > 0 {
                    new_units.insert(ut.clone(), remaining);
                }
            }
            target.units = new_units;
        }
        // Neutralize province if all ground units destroyed
        let ground_remaining: i64 = target.units.iter()
            .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
            .map(|(_, c)| *c)
            .sum();
        let neutralized = ground_remaining <= 0;
        if neutralized {
            target.owner_id = None;
            target.is_capital = false;
            target.units.clear();
            eprintln!("[BOMBARD] Province {} NEUTRALIZED by artillery", target_id);
        }
        sync_region_unit_meta(target, self);

        let remaining: i64 = target.units.values().sum();
        eprintln!("[BOMBARD] {} fires {}/{} rockets at {} | killed={} intercepted={} remaining={} neutralized={}",
            player_id, effective_rockets, rocket_count, target_id, total_killed, intercepted_count, remaining, neutralized);

        vec![Event::Bombard {
            player_id: player_id.clone(),
            source_region_id: source_id.clone(),
            target_region_id: target_id,
            rocket_count,
            total_killed,
            intercepted_count,
            sam_region_ids,
        }]
    }

    // --- Intercept action ---

    fn process_intercept(
        &self,
        action: &Action,
        _players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        air_transit_queue: &mut Vec<AirTransitItem>,
    ) -> Vec<Event> {
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        // Frontend sends region_id (not source_region_id) for intercept actions.
        let source_id = match action.source_region_id.as_ref().or(action.region_id.as_ref()) {
            Some(id) => id,
            None => return Vec::new(),
        };
        let flight_id = match &action.target_flight_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let fighters_sent = action.units.unwrap_or(0);
        if fighters_sent <= 0 {
            return Vec::new();
        }

        let source = match regions.get(source_id) {
            Some(r) => r,
            None => return Vec::new(),
        };
        if source.owner_id.as_deref() != Some(player_id) {
            return Vec::new();
        }

        // Find the unit type to intercept with — must be intercept_air-capable.
        let unit_type = action
            .unit_type
            .clone()
            .unwrap_or_else(|| get_region_unit_type(source, self));

        let unit_config = self.get_unit_config(&unit_type);
        if !unit_config.intercept_air && unit_config.movement_type != "air" {
            return vec![reject_action(player_id, "Ta jednostka nie moze przechwytyc", action)];
        }

        if get_available_units(source, &unit_type, self) < fighters_sent {
            return Vec::new();
        }

        // Find the target flight in the air transit queue.
        let flight = match air_transit_queue.iter_mut().find(|f| &f.id == flight_id) {
            Some(f) => f,
            None => return vec![reject_action(player_id, "Nie znaleziono lotu do przechwycenia", action)],
        };

        // Can't intercept own flights.
        if flight.player_id == *player_id {
            return Vec::new();
        }

        // Deploy fighters from source region.
        let source_mut = regions.get_mut(source_id).unwrap();
        deploy_units_from_region(source_mut, &unit_type, fighters_sent, self);

        let ticks_per_hop = if unit_config.air_speed_ticks_per_hop > 0 {
            unit_config.air_speed_ticks_per_hop
        } else {
            2
        };
        let speed_per_tick = 1.0 / (ticks_per_hop as f64 * flight.total_distance as f64).max(1.0);

        eprintln!("[AIR] Intercept dispatched: player={} flight={} fighters={}",
            player_id, flight_id, fighters_sent);

        flight.interceptors.push(InterceptorGroup {
            player_id: player_id.clone(),
            source_region_id: source_id.clone(),
            fighters: fighters_sent,
            progress: 0.0,
            speed_per_tick,
        });

        vec![Event::AirInterceptDispatched {
            flight_id: flight_id.clone(),
            interceptor_player_id: player_id.clone(),
            source_region_id: source_id.clone(),
            fighters: fighters_sent,
        }]
    }

    // --- Air transit processing ---

    fn process_air_transit(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        air_transit_queue: &[AirTransitItem],
    ) -> (Vec<AirTransitItem>, Vec<Event>) {
        let mut events = Vec::new();
        let mut remaining: Vec<AirTransitItem> = Vec::new();

        for item in air_transit_queue {
            let mut item = item.clone();

            // Advance interceptors and check for mid-air combat.
            let mut i = 0;
            while i < item.interceptors.len() {
                item.interceptors[i].progress += item.interceptors[i].speed_per_tick;
                if item.interceptors[i].progress >= 1.0 {
                    // Interceptor catches up — resolve air combat.
                    let interceptor = item.interceptors.remove(i);
                    eprintln!("[AIR] Interceptor caught flight {} (player={} fighters={})",
                        item.id, interceptor.player_id, interceptor.fighters);
                    let (new_item, combat_events) = self.resolve_air_interception(item, interceptor, regions);
                    item = new_item;
                    events.extend(combat_events);
                    // Don't increment i since we removed the element.
                } else {
                    i += 1;
                }
            }

            // Advance progress BEFORE path bombing so current_hop reflects new position.
            item.progress += item.speed_per_tick;

            // Bomber path bombing — budget model.
            // path_damage = fraction of total force allocated to the ENTIRE path.
            // This budget is split evenly across intermediate provinces.
            // Bomber does NOT lose units during flight — it drops ordnance.
            // Final target gets force × (1 - path_damage) × attack.
            if item.mission_type == "bomb_run" && item.units > 0 {
                let unit_config = self.get_unit_config(&item.unit_type);
                if unit_config.path_damage > 0.0 {
                    let current_hop = (item.progress * item.total_distance as f64) as usize;
                    let path_len = item.flight_path.len();
                    let start_hop = item.last_bombed_hop + 1;
                    let end_hop = current_hop.min(path_len.saturating_sub(1));
                    if start_hop <= end_hop && end_hop > 0 {
                        let unit_scale = self.get_unit_scale(&item.unit_type);
                        let attack = unit_config.attack;
                        let total_force = item.units * unit_scale;
                        // Count intermediate provinces (excluding source and target).
                        let num_intermediate = item.flight_path.iter()
                            .filter(|rid| **rid != item.source_region_id && **rid != item.target_region_id)
                            .count() as f64;
                        // Force budget per province = total_force × path_damage / num_intermediate.
                        let force_per_province = if num_intermediate > 0.0 {
                            (total_force as f64 * unit_config.path_damage / num_intermediate).round() as i64
                        } else { 0 };

                        let mut bombed_regions: std::collections::HashSet<String> = std::collections::HashSet::new();
                        for hop_idx in start_hop..=end_hop {
                            let hop_region_id = item.flight_path[hop_idx].clone();
                            if hop_region_id == item.source_region_id || hop_region_id == item.target_region_id {
                                continue;
                            }
                            let target_rid = hop_region_id.clone();
                            if bombed_regions.contains(&target_rid) {
                                continue;
                            }
                            let target_owner = regions.get(&target_rid).and_then(|r| r.owner_id.clone());
                            let is_enemy = match &target_owner {
                                Some(oid) => oid != &item.player_id,
                                None => true,
                            };
                            if !is_enemy {
                                continue;
                            }
                            if let Some(target_region) = regions.get_mut(&target_rid) {
                                let total_ground: i64 = target_region.units.iter()
                                    .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
                                    .map(|(_, c)| c)
                                    .sum();
                                if total_ground == 0 {
                                    continue;
                                }
                                let effective_damage = (force_per_province as f64 * attack).round() as i64;
                                let actual_kills = effective_damage.min(total_ground);
                                let kill_fraction = actual_kills as f64 / total_ground as f64;

                                let mut new_units: HashMap<String, i64> = HashMap::new();
                                let mut killed = 0i64;
                                for (ut, &count) in &target_region.units {
                                    let cfg = self.get_unit_config(ut);
                                    if cfg.movement_type == "air" {
                                        new_units.insert(ut.clone(), count);
                                        continue;
                                    }
                                    let k = (count as f64 * kill_fraction).round() as i64;
                                    let r = (count - k).max(0);
                                    killed += k;
                                    if r > 0 {
                                        new_units.insert(ut.clone(), r);
                                    }
                                }
                                target_region.units = new_units;
                                sync_region_unit_meta(target_region, self);
                                bombed_regions.insert(target_rid.clone());

                                // Bomber attrition: loses 1 unit per province bombed (ordnance expended).
                                // Always keeps at least 1 unit for the final strike.
                                if item.units > 1 {
                                    item.units -= 1;
                                }

                                eprintln!("[AIR] Path bomb {} -> {} | bombers={} force={} | budget={} damage={} killed={}/{}",
                                    item.id, target_rid, item.units, total_force, force_per_province, effective_damage, killed, total_ground);
                                events.push(Event::PathDamage {
                                    target_region_id: target_rid,
                                    player_id: item.player_id.clone(),
                                    units_killed: killed,
                                });
                            }
                        }
                        item.last_bombed_hop = end_hop;
                    }
                }
            }

            // Check for arrival (progress already advanced above).
            if item.progress >= 1.0 {
                eprintln!("[AIR] Flight {} arrived at {} (mission={})", item.id, item.target_region_id, item.mission_type);
                match item.mission_type.as_str() {
                    "bomb_run" => {
                        let arrival_events = self.resolve_bomber_arrival(&item, players, regions);
                        events.extend(arrival_events);
                    }
                    "fighter_attack" => {
                        let (returned, arrival_events) = self.resolve_fighter_arrival(&item, players, regions);
                        events.extend(arrival_events);
                        // Surviving fighters return home.
                        if returned > 0 {
                            if let Some(source) = regions.get_mut(&item.source_region_id) {
                                receive_units_in_region(source, &item.unit_type, returned, self);
                            }
                        }
                    }
                    "air_move" => {
                        // Deliver air units to target region.
                        if item.units > 0 {
                            if let Some(target) = regions.get_mut(&item.target_region_id) {
                                if target.owner_id.as_deref() == Some(&item.player_id) {
                                    receive_units_in_region(target, &item.unit_type, item.units, self);
                                    events.push(Event::UnitsMoved {
                                        source_region_id: item.source_region_id.clone(),
                                        target_region_id: item.target_region_id.clone(),
                                        units: item.units,
                                        unit_type: item.unit_type.clone(),
                                        player_id: item.player_id.clone(),
                                    });
                                } else {
                                    // Target changed ownership — return units to source.
                                    if let Some(source) = regions.get_mut(&item.source_region_id) {
                                        receive_units_in_region(source, &item.unit_type, item.units, self);
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
                // Flight is done; do not push to remaining.
            } else {
                remaining.push(item);
            }
        }

        (remaining, events)
    }

    fn resolve_air_interception(
        &self,
        mut flight: AirTransitItem,
        interceptor: InterceptorGroup,
        _regions: &mut HashMap<String, Region>,
    ) -> (AirTransitItem, Vec<Event>) {
        let mut events = Vec::new();
        let randomness = self.settings.combat_randomness * self.weather_randomness_modifier;
        let mut rng = rand::thread_rng();

        let interceptor_cfg = self.get_unit_config("fighter"); // default interceptor stats
        let escort_cfg = self.get_unit_config("fighter");
        let bomber_cfg = self.get_unit_config(&flight.unit_type);

        let mut interceptors = interceptor.fighters;
        let mut escorts = flight.escort_fighters;
        let mut bombers = flight.units;

        let interceptors_before = interceptors;
        let escorts_before = escorts;
        let bombers_before = bombers;

        // Phase 1: interceptors vs escorts.
        if escorts > 0 {
            let int_power = interceptors as f64 * interceptor_cfg.attack * (1.0 + rng.gen_range(-randomness..=randomness));
            let esc_power = escorts as f64 * escort_cfg.defense * (1.0 + rng.gen_range(-randomness..=randomness));
            if int_power >= esc_power {
                let losses = (escorts as f64 * (int_power / esc_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                escorts = (escorts - losses).max(0);
                let int_losses = (interceptors as f64 * (esc_power / int_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                interceptors = (interceptors - int_losses).max(0);
            } else {
                let losses = (interceptors as f64 * (esc_power / int_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                interceptors = (interceptors - losses).max(0);
                let esc_losses = (escorts as f64 * (int_power / esc_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                escorts = (escorts - esc_losses).max(0);
            }
        }

        // Phase 2: surviving interceptors vs bombers.
        if interceptors > 0 && bombers > 0 {
            let int_power = interceptors as f64 * interceptor_cfg.attack * (1.0 + rng.gen_range(-randomness..=randomness));
            let bom_power = bombers as f64 * bomber_cfg.defense * (1.0 + rng.gen_range(-randomness..=randomness));
            if int_power >= bom_power {
                let losses = (bombers as f64 * (int_power / bom_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                bombers = (bombers - losses).max(0);
            } else {
                let int_losses = (interceptors as f64 * (bom_power / int_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
                interceptors = (interceptors - int_losses).max(0);
            }
        }

        let interceptors_lost = (interceptors_before - interceptors).max(0);
        let escorts_lost = (escorts_before - escorts).max(0);
        let bombers_lost = (bombers_before - bombers).max(0);

        eprintln!("[AIR] Interception resolved: flight={} int_lost={} esc_lost={} bom_lost={}",
            flight.id, interceptors_lost, escorts_lost, bombers_lost);

        events.push(Event::AirCombatResolved {
            flight_id: flight.id.clone(),
            interceptor_player_id: interceptor.player_id.clone(),
            target_player_id: flight.player_id.clone(),
            interceptors_lost,
            escorts_lost,
            bombers_lost,
            interceptors_remaining: interceptors,
            escorts_remaining: escorts,
            bombers_remaining: bombers,
        });

        flight.units = bombers;
        flight.escort_fighters = escorts;

        (flight, events)
    }

    fn resolve_bomber_arrival(
        &self,
        flight: &AirTransitItem,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
    ) -> Vec<Event> {
        let mut events = Vec::new();
        let target_id = &flight.target_region_id;

        let target = match regions.get(target_id) {
            Some(r) => r,
            None => return events,
        };

        // If no longer an enemy province, bombers are consumed anyway. Only escorts return.
        if target.owner_id.as_deref() == Some(&flight.player_id) {
            if let Some(source) = regions.get_mut(&flight.source_region_id) {
                receive_units_in_region(source, "fighter", flight.escort_fighters, self);
            }
            return events;
        }

        let bomber_cfg = self.get_unit_config(&flight.unit_type);
        let unit_scale = self.get_unit_scale(&flight.unit_type);
        let randomness = self.settings.combat_randomness * self.weather_randomness_modifier;

        // Air combat at target: escorts + bombers vs air defenders.
        let mut effective_bombers = flight.units;
        {
            let target_snap = regions.get(target_id).unwrap();
            let mut air_def_power = 0.0f64;
            for (def_ut, &count) in &target_snap.units {
                let def_cfg = self.get_unit_config(def_ut);
                if def_cfg.movement_type == "air" || def_cfg.intercept_air {
                    let scale = self.get_unit_scale(def_ut);
                    air_def_power += count as f64 * scale as f64 * def_cfg.defense;
                }
            }

            if air_def_power > 0.0 {
                let escort_cfg = self.get_unit_config("fighter");
                let escort_power = flight.escort_fighters as f64 * escort_cfg.attack;
                let bomber_power = effective_bombers as f64 * unit_scale as f64 * bomber_cfg.attack * 0.3; // bombers fight poorly in air
                let total_attacker_power = escort_power + bomber_power;

                let mut rng = rand::thread_rng();
                let att_roll = total_attacker_power * (1.0 + rng.gen_range(-randomness..=randomness));
                let def_roll = air_def_power * (1.0 + rng.gen_range(-randomness..=randomness));

                // Remove air defenders.
                let def_casualty = if att_roll >= def_roll {
                    (total_attacker_power / air_def_power.max(1.0) * self.settings.casualty_factor).min(1.0)
                } else {
                    1.0 // all defenders survive, attackers take heavy losses
                };
                {
                    let target_mut = regions.get_mut(target_id).unwrap();
                    let mut new_units: HashMap<String, i64> = HashMap::new();
                    for (ut, &count) in &target_mut.units {
                        let cfg = self.get_unit_config(ut);
                        if cfg.movement_type == "air" {
                            let remaining = (count as f64 * (1.0 - def_casualty)).round() as i64;
                            if remaining > 0 {
                                new_units.insert(ut.clone(), remaining);
                            }
                        } else {
                            new_units.insert(ut.clone(), count);
                        }
                    }
                    target_mut.units = new_units;
                    sync_region_unit_meta(target_mut, self);
                }

                // Attacker casualties.
                let att_casualty = if att_roll >= def_roll {
                    (air_def_power / total_attacker_power.max(1.0) * self.settings.casualty_factor).min(1.0)
                } else {
                    (air_def_power / total_attacker_power.max(1.0) * self.settings.casualty_factor * 1.5).min(1.0)
                };
                // Kill escorts first, then bombers.
                let _escort_losses = (flight.escort_fighters as f64 * att_casualty).round() as i64;
                let _ = escort_power; // computed but not needed further
                let bomber_losses = (effective_bombers as f64 * att_casualty * 0.5).round() as i64;
                effective_bombers = (effective_bombers - bomber_losses).max(0);
            }
        }

        if effective_bombers == 0 {
            events.push(Event::AttackFailed {
                source_region_id: flight.source_region_id.clone(),
                target_region_id: target_id.clone(),
                player_id: flight.player_id.clone(),
                units: flight.units,
                unit_type: flight.unit_type.clone(),
                defender_surviving: regions.get(target_id).map(|r| r.unit_count).unwrap_or(0),
            });
            return events;
        }

        // Ground destruction: bombers kill ground units, destroy buildings, potentially neutralize.
        let target_mut = regions.get_mut(target_id).unwrap();
        let old_owner_id = target_mut.owner_id.clone();

        // Final strike: remaining force × (1 - path_damage) × attack.
        // path_damage fraction was already spent on intermediate provinces.
        let remaining_manpower = effective_bombers * unit_scale;
        let final_force_fraction = 1.0 - bomber_cfg.path_damage;
        let damage = (remaining_manpower as f64 * final_force_fraction * bomber_cfg.attack).round() as i64;
        let total_ground: i64 = target_mut.units.iter()
            .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
            .map(|(_, c)| *c)
            .sum();

        // Kill up to damage amount, distributed proportionally across unit types.
        let actual_kills = damage.min(total_ground);
        let kill_fraction = if total_ground > 0 {
            actual_kills as f64 / total_ground as f64
        } else {
            0.0
        };

        eprintln!("[AIR] Bomber strike on {} | bombers={} force={} × (1-{}) × {} = damage {} | ground={} kills={}",
            target_id, effective_bombers, remaining_manpower, bomber_cfg.path_damage, bomber_cfg.attack, damage, total_ground, actual_kills);

        let mut new_units: HashMap<String, i64> = HashMap::new();
        let mut ground_killed = 0i64;
        for (ut, &count) in &target_mut.units {
            let cfg = self.get_unit_config(ut);
            if cfg.movement_type == "air" {
                new_units.insert(ut.clone(), count);
                continue;
            }
            let killed = (count as f64 * kill_fraction).round() as i64;
            let remaining = (count - killed).max(0);
            ground_killed += killed;
            if remaining > 0 {
                new_units.insert(ut.clone(), remaining);
            }
        }
        target_mut.units = new_units;
        sync_region_unit_meta(target_mut, self);

        eprintln!("[AIR] Bomber strike result: ground_killed={} buildings_to_destroy={} remaining_ground={}",
            ground_killed, ((effective_bombers as f64 * unit_scale as f64) / 100.0).floor() as usize,
            target_mut.units.iter().filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air").map(|(_, c)| *c).sum::<i64>());

        // Building destruction.
        let buildings_to_destroy = ((effective_bombers as f64 * unit_scale as f64) / 100.0).floor() as usize;
        let mut destroyed_buildings: Vec<String> = Vec::new();
        for _ in 0..buildings_to_destroy {
            if target_mut.building_instances.is_empty() {
                break;
            }
            let idx = 0; // destroy first building (could randomize)
            let b = target_mut.building_instances.remove(idx);
            destroyed_buildings.push(b.building_type.clone());
        }
        if !destroyed_buildings.is_empty() {
            self.recompute_region_building_stats(target_mut);
        }

        // Check neutralization: if all ground units AND buildings gone.
        let ground_remaining: i64 = target_mut.units.iter()
            .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
            .map(|(_, c)| *c)
            .sum();
        let province_neutralized = ground_remaining == 0 && target_mut.building_instances.is_empty();

        if province_neutralized {
            if let Some(ref prev_owner) = old_owner_id {
                eprintln!("[AIR] Province {} neutralized by bomber strike from {}",
                    target_id, flight.player_id);
                target_mut.owner_id = None;
                target_mut.unit_count = 0;
                target_mut.unit_type = None;
                target_mut.is_capital = false;
                events.push(Event::ProvinceNeutralized {
                    region_id: target_id.clone(),
                    previous_owner_id: prev_owner.clone(),
                });
                if let Some(player) = players.get_mut(prev_owner.as_str()) {
                    if player.capital_region_id.as_deref() == Some(target_id) {
                        player.is_alive = false;
                        player.eliminated_reason = Some("capital_lost".into());
                        events.push(Event::PlayerEliminated {
                            player_id: prev_owner.clone(),
                            reason: "capital_lost".into(),
                        });
                    }
                }
            }
        }

        events.push(Event::BomberStrike {
            player_id: flight.player_id.clone(),
            target_region_id: target_id.clone(),
            bombers: effective_bombers,
            ground_units_destroyed: ground_killed,
            buildings_destroyed: destroyed_buildings,
            province_neutralized,
        });

        // Bombers are CONSUMED on strike — they don't return.
        // Only surviving escorts return to source.
        if flight.escort_fighters > 0 {
            if let Some(source) = regions.get_mut(&flight.source_region_id) {
                receive_units_in_region(source, "fighter", flight.escort_fighters, self);
            }
        }

        if let Some(player) = players.get_mut(&flight.player_id) {
            player.total_units_lost = player.total_units_lost.saturating_add(
                (flight.units - effective_bombers).max(0) as u32
            );
        }

        events
    }

    fn resolve_fighter_arrival(
        &self,
        flight: &AirTransitItem,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
    ) -> (i64, Vec<Event>) {
        let mut events = Vec::new();
        let target_id = &flight.target_region_id;

        let (target_owner_id, enemy_air) = match regions.get(target_id) {
            Some(r) => {
                if r.owner_id.as_deref() == Some(&flight.player_id) {
                    return (flight.units, events);
                }
                let air: Vec<(String, i64)> = r.units.iter()
                    .filter(|(ut, _)| self.get_unit_config(ut).movement_type == "air")
                    .map(|(ut, &c)| (ut.clone(), c))
                    .collect();
                (r.owner_id.clone().unwrap_or_default(), air)
            }
            None => {
                // Target gone — return all fighters home.
                return (flight.units, events);
            }
        };

        if enemy_air.is_empty() {
            // No air targets — return all fighters home.
            eprintln!("[AIR] Fighter {} reached {} but no air defenders; returning", flight.id, target_id);
            return (flight.units, events);
        }

        let fighter_cfg = self.get_unit_config(&flight.unit_type);
        let randomness = self.settings.combat_randomness * self.weather_randomness_modifier;
        let mut rng = rand::thread_rng();

        let mut attackers = flight.units;
        let total_enemy_air: i64 = enemy_air.iter().map(|(_, c)| c).sum();

        let att_power = attackers as f64 * fighter_cfg.attack * (1.0 + rng.gen_range(-randomness..=randomness));
        let def_power: f64 = enemy_air.iter().map(|(ut, c)| {
            let cfg = self.get_unit_config(ut);
            *c as f64 * cfg.defense
        }).sum::<f64>() * (1.0 + rng.gen_range(-randomness..=randomness));

        let att_losses;
        let def_losses;
        if att_power >= def_power {
            att_losses = (attackers as f64 * (def_power / att_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
            def_losses = (total_enemy_air as f64 * (att_power / def_power.max(1.0) * self.settings.casualty_factor).min(1.0)).round() as i64;
        } else {
            att_losses = (attackers as f64 * (def_power / att_power.max(1.0) * self.settings.casualty_factor * 1.5).min(1.0)).round() as i64;
            def_losses = (total_enemy_air as f64 * (att_power / def_power.max(1.0) * self.settings.casualty_factor * 0.5).min(1.0)).round() as i64;
        }

        attackers = (attackers - att_losses).max(0);

        // Remove enemy air casualties.
        {
            let target_mut = regions.get_mut(target_id).unwrap();
            let def_fraction = (def_losses as f64 / total_enemy_air as f64).min(1.0);
            let mut new_units: HashMap<String, i64> = HashMap::new();
            for (ut, &count) in &target_mut.units {
                let cfg = self.get_unit_config(ut);
                if cfg.movement_type == "air" {
                    let killed = (count as f64 * def_fraction).round() as i64;
                    let remaining = (count - killed).max(0);
                    if remaining > 0 {
                        new_units.insert(ut.clone(), remaining);
                    }
                } else {
                    new_units.insert(ut.clone(), count);
                }
            }
            target_mut.units = new_units;
            sync_region_unit_meta(target_mut, self);
        }

        if let Some(player) = players.get_mut(&flight.player_id) {
            player.total_units_lost = player.total_units_lost.saturating_add(att_losses.max(0) as u32);
        }

        eprintln!("[AIR] Fighter {} vs air defenders at {}: att_losses={} def_losses={}",
            flight.id, target_id, att_losses, def_losses);

        events.push(Event::AirCombatResolved {
            flight_id: flight.id.clone(),
            interceptor_player_id: flight.player_id.clone(),
            target_player_id: target_owner_id,
            interceptors_lost: att_losses,
            escorts_lost: 0,
            bombers_lost: 0,
            interceptors_remaining: attackers,
            escorts_remaining: 0,
            bombers_remaining: 0,
        });

        (attackers, events)
    }

    // --- Combat resolution ---

    fn resolve_move_arrival(
        &self,
        item: &TransitQueueItem,
        regions: &mut HashMap<String, Region>,
    ) -> Vec<Event> {
        let target = match regions.get(&item.target_region_id) {
            Some(r) => r,
            None => {
                if let Some(source) = regions.get_mut(&item.source_region_id) {
                    receive_units_in_region(source, &item.unit_type, item.units, self);
                }
                return Vec::new();
            }
        };

        if target.owner_id.as_deref() != Some(&item.player_id) {
            if let Some(source) = regions.get_mut(&item.source_region_id) {
                receive_units_in_region(source, &item.unit_type, item.units, self);
            }
            return vec![Event::ActionRejected {
                player_id: item.player_id.clone(),
                message: "Cel ruchu nie jest juz dostepny".into(),
                action_type: Some("move".into()),
                source_region_id: Some(item.source_region_id.clone()),
                target_region_id: Some(item.target_region_id.clone()),
                region_id: None,
                building_type: None,
                unit_type: Some(item.unit_type.clone()),
            }];
        }

        // Units are received and normalize_stationed_units handles conversion:
        // if the region lacks the required building, the special unit is dropped
        // but the infantry (manpower) it carried stays.
        let target = regions.get_mut(&item.target_region_id).unwrap();
        receive_units_in_region(target, &item.unit_type, item.units, self);

        vec![Event::UnitsMoved {
            source_region_id: item.source_region_id.clone(),
            target_region_id: item.target_region_id.clone(),
            units: item.units,
            unit_type: item.unit_type.clone(),
            player_id: item.player_id.clone(),
        }]
    }

    fn resolve_attack_arrival(
        &self,
        item: &TransitQueueItem,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        diplomacy: &mut DiplomacyState,
        current_tick: i64,
    ) -> Vec<Event> {
        let mut events = Vec::new();

        let target = match regions.get(&item.target_region_id) {
            Some(r) => r,
            None => {
                if let Some(source) = regions.get_mut(&item.source_region_id) {
                    receive_units_in_region(source, &item.unit_type, item.units, self);
                }
                return events;
            }
        };

        // If target now belongs to attacker, just move units there.
        if target.owner_id.as_deref() == Some(&item.player_id) {
            let target = regions.get_mut(&item.target_region_id).unwrap();
            receive_units_in_region(target, &item.unit_type, item.units, self);
            return vec![Event::UnitsMoved {
                source_region_id: item.source_region_id.clone(),
                target_region_id: item.target_region_id.clone(),
                units: item.units,
                unit_type: item.unit_type.clone(),
                player_id: item.player_id.clone(),
            }];
        }

        let unit_config = self.get_unit_config(&item.unit_type);
        let attacker_bonus = self.settings.attacker_advantage;
        let defense_building = target.defense_bonus;
        let randomness = self.settings.combat_randomness * self.weather_randomness_modifier;

        // Snapshot defending unit total and owner before any mutation.
        let defender_total_before: i64 = target.units.values().sum();
        let old_owner_id: Option<String> = target.owner_id.clone();

        let mut defender_bonus = self.settings.defender_advantage * self.weather_defense_modifier;
        // Apply defense_bonus boosts for the defending player: both deck boosts
        // (active_boosts) and temporary in-match boosts (active_match_boosts).
        if let Some(ref defender_player_id) = old_owner_id {
            if let Some(defender_player) = players.get(defender_player_id.as_str()) {
                // Deck boosts — permanent for the match duration.
                for boost in &defender_player.active_boosts {
                    if boost.params.get("effect_type").and_then(|v| v.as_str())
                        == Some("defense_bonus")
                    {
                        let value = boost.params.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                        defender_bonus += value;
                    }
                }
                // In-match activated boosts — expire after N ticks.
                for boost in &defender_player.active_match_boosts {
                    if boost.effect_type == "defense_bonus" {
                        defender_bonus += boost.value;
                    }
                }
            }
        }

        // Apply attack_bonus boosts for the attacking player: both deck boosts
        // (active_boosts) and temporary in-match boosts (active_match_boosts).
        let mut attack_bonus_sum = 0.0f64;
        if let Some(attacker_player) = players.get(&item.player_id) {
            for boost in &attacker_player.active_boosts {
                if boost.params.get("effect_type").and_then(|v| v.as_str())
                    == Some("attack_bonus")
                {
                    let value = boost.params.get("value").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    attack_bonus_sum += value;
                }
            }
            for boost in &attacker_player.active_match_boosts {
                if boost.effect_type == "attack_bonus" {
                    attack_bonus_sum += boost.value;
                }
            }
        }

        // ----------------------------------------------------------------
        // Phase 1 — Air Combat
        //
        // Classify the attacking unit as air or ground.  The defending
        // region may contain SAM units (intercept_air=true) which fight
        // alongside defending air units against incoming air attackers.
        // Bombers (combat_target="ground") survive phase 1 to join phase 2.
        // ----------------------------------------------------------------

        // Determine attacker category from unit config.
        let attacker_is_air = unit_config.movement_type == "air";
        let attacker_targets_air = unit_config.combat_target == "air";

        // Effective attacker count after phase-1 air combat (may be reduced).
        let mut effective_attacker_units = item.units;

        if attacker_is_air {
            // Collect defending air units + SAM ground units as air-phase defenders.
            let target_snap = match regions.get(&item.target_region_id) {
                Some(r) => r,
                None => return events,
            };

            let mut air_defender_power = 0.0f64;
            for (def_unit_type, &count) in &target_snap.units {
                let def_cfg = self.get_unit_config(def_unit_type);
                let is_air_defender =
                    def_cfg.movement_type == "air" || def_cfg.intercept_air;
                if is_air_defender {
                    let scale = self.get_unit_scale(def_unit_type);
                    air_defender_power +=
                        count as f64 * scale as f64 * def_cfg.defense * (1.0 + defender_bonus + defense_building);
                }
            }

            if air_defender_power > 0.0 {
                let unit_scale = self.get_unit_scale(&item.unit_type);
                let air_attacker_power =
                    effective_attacker_units as f64
                        * unit_scale as f64
                        * unit_config.attack
                        * (1.0 + attacker_bonus)
                        * (1.0 + attack_bonus_sum);

                let mut rng = rand::thread_rng();
                let air_att_roll =
                    air_attacker_power * (1.0 + rng.gen_range(-randomness..=randomness));
                let air_def_roll =
                    air_defender_power * (1.0 + rng.gen_range(-randomness..=randomness));

                if air_att_roll >= air_def_roll {
                    // Attacker wins air combat — take casualties proportional to defender strength.
                    let casualty_ratio =
                        (air_defender_power / air_attacker_power.max(1.0) * self.settings.casualty_factor)
                            .min(1.0);
                    let lost = (effective_attacker_units as f64 * casualty_ratio).round() as i64;
                    effective_attacker_units = (effective_attacker_units - lost).max(0);
                } else {
                    // Defender wins air combat — all incoming air units destroyed.
                    effective_attacker_units = 0;
                }

                // Remove defending air units and SAM that were consumed in air combat.
                // SAM units fire once then are unchanged; only air-to-air units take losses.
                // Simple model: surviving ratio mirrors attacker casualties inverted.
                let air_def_casualty =
                    (air_attacker_power / air_defender_power.max(1.0) * self.settings.casualty_factor)
                        .min(1.0);
                let target_mut = regions.get_mut(&item.target_region_id).unwrap();
                let mut new_units: HashMap<String, i64> = HashMap::new();
                for (def_unit_type, &count) in &target_mut.units {
                    let def_cfg = self.get_unit_config(def_unit_type);
                    // Only air-to-air defenders (not SAM ground) take losses in air combat.
                    let takes_air_losses = def_cfg.movement_type == "air";
                    if takes_air_losses {
                        let remaining =
                            (count as f64 * (1.0 - air_def_casualty)).round() as i64;
                        if remaining > 0 {
                            new_units.insert(def_unit_type.clone(), remaining);
                        }
                    } else {
                        new_units.insert(def_unit_type.clone(), count);
                    }
                }
                target_mut.units = new_units;
                sync_region_unit_meta(target_mut, self);
            }

            // Fighters (combat_target="air") do not proceed to ground combat.
            if attacker_targets_air && effective_attacker_units == 0 {
                events.push(Event::AttackFailed {
                    source_region_id: item.source_region_id.clone(),
                    target_region_id: item.target_region_id.clone(),
                    player_id: item.player_id.clone(),
                    units: item.units,
                    unit_type: item.unit_type.clone(),
                    defender_surviving: regions
                        .get(&item.target_region_id)
                        .map(|r| r.unit_count)
                        .unwrap_or(0),
                });
                return events;
            }
            if attacker_targets_air {
                // Fighters that survive air combat do not attack ground — they return.
                if effective_attacker_units > 0 {
                    if let Some(source) = regions.get_mut(&item.source_region_id) {
                        receive_units_in_region(
                            source,
                            &item.unit_type,
                            effective_attacker_units,
                            self,
                        );
                    }
                }
                return events;
            }

            // Bombers with no survivors after air combat: attack fails.
            if effective_attacker_units == 0 {
                events.push(Event::AttackFailed {
                    source_region_id: item.source_region_id.clone(),
                    target_region_id: item.target_region_id.clone(),
                    player_id: item.player_id.clone(),
                    units: item.units,
                    unit_type: item.unit_type.clone(),
                    defender_surviving: regions
                        .get(&item.target_region_id)
                        .map(|r| r.unit_count)
                        .unwrap_or(0),
                });
                return events;
            }
        }

        // ----------------------------------------------------------------
        // Path damage — applied before ground combat resolves.
        // Units with path_damage > 0 bombard the target on approach,
        // killing some defending units before the main assault.
        // ----------------------------------------------------------------
        if unit_config.path_damage > 0.0 && effective_attacker_units > 0 {
            let target_mut = regions.get_mut(&item.target_region_id).unwrap();
            let total_defenders: i64 = target_mut.units.values().sum();
            if total_defenders > 0 {
                let kill_fraction =
                    (unit_config.path_damage * effective_attacker_units as f64 / total_defenders as f64)
                        .min(0.5); // cap at 50% so path damage never trivially wins alone
                let mut new_units: HashMap<String, i64> = HashMap::new();
                let mut total_killed = 0i64;
                for (ut, &count) in &target_mut.units {
                    let killed = (count as f64 * kill_fraction).round() as i64;
                    let remaining = (count - killed).max(0);
                    total_killed += killed;
                    if remaining > 0 {
                        new_units.insert(ut.clone(), remaining);
                    }
                }
                target_mut.units = new_units;
                sync_region_unit_meta(target_mut, self);
                events.push(Event::PathDamage {
                    target_region_id: item.target_region_id.clone(),
                    player_id: item.player_id.clone(),
                    units_killed: total_killed,
                });
            }
        }

        // ----------------------------------------------------------------
        // Phase 2 — Ground Combat
        //
        // Surviving attackers (ground units, or bombers that passed phase 1)
        // fight the remaining ground defenders.
        //
        // Air Supremacy check (Option A): if the attacker is a ground unit
        // and the target contains ONLY air units (no ground units at all),
        // the attack is blocked — the ground force cannot capture a province
        // defended only by air.  Return units to source.
        // ----------------------------------------------------------------

        if !attacker_is_air {
            let target_snap = regions.get(&item.target_region_id);
            let only_air_defenders = target_snap.map(|r| {
                !r.units.is_empty()
                    && r.units.iter().all(|(ut, _)| {
                        self.get_unit_config(ut).movement_type == "air"
                    })
            }).unwrap_or(false);

            if only_air_defenders {
                if let Some(source) = regions.get_mut(&item.source_region_id) {
                    receive_units_in_region(source, &item.unit_type, effective_attacker_units, self);
                }
                events.push(Event::AttackFailed {
                    source_region_id: item.source_region_id.clone(),
                    target_region_id: item.target_region_id.clone(),
                    player_id: item.player_id.clone(),
                    units: item.units,
                    unit_type: item.unit_type.clone(),
                    defender_surviving: regions
                        .get(&item.target_region_id)
                        .map(|r| r.unit_count)
                        .unwrap_or(0),
                });
                return events;
            }
        }

        let target = match regions.get(&item.target_region_id) {
            Some(r) => r,
            None => return events,
        };

        let unit_scale = self.get_unit_scale(&item.unit_type);
        let mut attacker_power =
            effective_attacker_units as f64 * unit_scale as f64 * unit_config.attack * (1.0 + attacker_bonus);
        attacker_power *= 1.0 + attack_bonus_sum;
        let defender_power =
            self.get_region_defender_power(target, defender_bonus + defense_building, current_tick);

        let mut rng = rand::thread_rng();
        let attacker_roll =
            attacker_power * (1.0 + rng.gen_range(-randomness..=randomness));
        let defender_roll =
            defender_power * (1.0 + rng.gen_range(-randomness..=randomness));

        // Track total damage dealt by attacker for AOE calculation.
        let total_attacker_damage = attacker_power;

        if attacker_roll > defender_roll {
            let surviving_effective = (unit_scale as f64).max(
                (effective_attacker_units as f64
                    * unit_scale as f64
                    * (1.0 - defender_power / attacker_power.max(1.0) * self.settings.casualty_factor))
                    as f64,
            );
            let surviving =
                1i64.max((surviving_effective / unit_scale as f64).round() as i64);

            let target = regions.get_mut(&item.target_region_id).unwrap();
            target.owner_id = Some(item.player_id.clone());
            target.units.clear();
            receive_units_in_region(target, &item.unit_type, surviving, self);

            // Attacker: record losses for both sides.
            let attacker_lost = (effective_attacker_units - surviving).max(0) as u32;
            if let Some(player) = players.get_mut(&item.player_id) {
                player.total_units_lost =
                    player.total_units_lost.saturating_add(attacker_lost);
                player.total_regions_conquered += 1;
            }
            // Defender (previous owner): all their units in the region were destroyed.
            if let Some(ref prev_owner) = old_owner_id {
                let defender_lost = defender_total_before.max(0) as u32;
                if let Some(player) = players.get_mut(prev_owner.as_str()) {
                    player.total_units_lost =
                        player.total_units_lost.saturating_add(defender_lost);
                }
            }

            events.push(Event::AttackSuccess {
                source_region_id: item.source_region_id.clone(),
                target_region_id: item.target_region_id.clone(),
                player_id: item.player_id.clone(),
                units: item.units,
                unit_type: item.unit_type.clone(),
                old_owner_id: old_owner_id.clone(),
                surviving_units: surviving,
            });

            // Record province change in war for peace treaty tracking.
            if self.settings.diplomacy_enabled {
                if let Some(ref prev_owner) = old_owner_id {
                    diplomacy.record_province_change(
                        &item.player_id,
                        prev_owner,
                        &item.target_region_id,
                        prev_owner,
                        &item.player_id,
                        current_tick,
                    );
                }
            }

            let target = regions.get_mut(&item.target_region_id).unwrap();
            if target.is_capital && old_owner_id.is_some() {
                target.is_capital = false;
                events.push(Event::CapitalCaptured {
                    region_id: item.target_region_id.clone(),
                    captured_by: item.player_id.clone(),
                    lost_by: old_owner_id.unwrap(),
                });
            }
        } else {
            let remaining_ratio =
                (1.0 - attacker_power / defender_power.max(1.0) * self.settings.casualty_factor).max(0.0);

            let target = regions.get_mut(&item.target_region_id).unwrap();
            let mut reduced_units: HashMap<String, i64> = HashMap::new();
            for (defender_unit_type, count) in &target.units {
                let remaining_count = (*count as f64 * remaining_ratio).max(0.0) as i64;
                if remaining_count > 0 {
                    reduced_units.insert(defender_unit_type.clone(), remaining_count);
                }
            }
            target.units = reduced_units;
            sync_region_unit_meta(target, self);
            let surviving_defenders = target.unit_count;

            // All attacking units were destroyed in the failed assault.
            if let Some(player) = players.get_mut(&item.player_id) {
                player.total_units_lost =
                    player.total_units_lost.saturating_add(item.units as u32);
            }
            // Defender: units killed = total_before - survivors.
            if let Some(ref prev_owner) = old_owner_id {
                let defender_lost =
                    (defender_total_before - surviving_defenders).max(0) as u32;
                if let Some(player) = players.get_mut(prev_owner.as_str()) {
                    player.total_units_lost =
                        player.total_units_lost.saturating_add(defender_lost);
                }
            }

            events.push(Event::AttackFailed {
                source_region_id: item.source_region_id.clone(),
                target_region_id: item.target_region_id.clone(),
                player_id: item.player_id.clone(),
                units: item.units,
                unit_type: item.unit_type.clone(),
                defender_surviving: surviving_defenders,
            });
        }

        // ----------------------------------------------------------------
        // Combat Fatigue — weaken units in the target region after battle.
        // ----------------------------------------------------------------
        if self.settings.fatigue_attack_ticks > 0 || self.settings.fatigue_defense_ticks > 0 {
            if let Some(target_region) = regions.get_mut(&item.target_region_id) {
                // Check if attacker won (target now belongs to attacker)
                let attacker_won = target_region.owner_id.as_deref() == Some(&item.player_id);
                if attacker_won && self.settings.fatigue_attack_ticks > 0 {
                    target_region.fatigue_until = Some(current_tick + self.settings.fatigue_attack_ticks);
                    target_region.fatigue_modifier = self.settings.fatigue_attack_modifier;
                    events.push(Event::CombatFatigue {
                        region_id: item.target_region_id.clone(),
                        modifier: self.settings.fatigue_attack_modifier,
                        ticks: self.settings.fatigue_attack_ticks,
                    });
                } else if !attacker_won && self.settings.fatigue_defense_ticks > 0 {
                    target_region.fatigue_until = Some(current_tick + self.settings.fatigue_defense_ticks);
                    target_region.fatigue_modifier = self.settings.fatigue_defense_modifier;
                    events.push(Event::CombatFatigue {
                        region_id: item.target_region_id.clone(),
                        modifier: self.settings.fatigue_defense_modifier,
                        ticks: self.settings.fatigue_defense_ticks,
                    });
                }
            }
        }

        // ----------------------------------------------------------------
        // AOE Damage — artillery and other area-effect units deal splash
        // damage to enemy-owned neighbors of the target province.
        // ----------------------------------------------------------------
        if unit_config.aoe_damage > 0.0 {
            let aoe_factor = unit_config.aoe_damage * total_attacker_damage;
            // Collect neighbor IDs while immutably borrowing the neighbor_map.
            let neighbor_ids: Vec<String> = self
                .neighbor_map
                .get(&item.target_region_id)
                .cloned()
                .unwrap_or_default();

            let mut affected_neighbors: Vec<String> = Vec::new();
            for nid in &neighbor_ids {
                let neighbor_owner = regions.get(nid).and_then(|r| r.owner_id.clone());
                // Only damage regions owned by a different (enemy) player.
                let is_enemy = match &neighbor_owner {
                    Some(oid) => oid != &item.player_id,
                    None => false,
                };
                if is_enemy {
                    affected_neighbors.push(nid.clone());
                }
            }

            for nid in &affected_neighbors {
                if let Some(neighbor) = regions.get_mut(nid) {
                    let total: i64 = neighbor.units.iter()
                        .filter(|(ut, _)| self.get_unit_config(ut).movement_type != "air")
                        .map(|(_, c)| c)
                        .sum();
                    if total == 0 {
                        continue;
                    }
                    let kill_fraction = (aoe_factor / total as f64).min(0.8);
                    let mut new_units: HashMap<String, i64> = HashMap::new();
                    for (ut, &count) in &neighbor.units {
                        let cfg = self.get_unit_config(ut);
                        if cfg.movement_type == "air" {
                            // AOE does not affect air units.
                            new_units.insert(ut.clone(), count);
                            continue;
                        }
                        let remaining =
                            (count as f64 * (1.0 - kill_fraction)).round() as i64;
                        if remaining > 0 {
                            new_units.insert(ut.clone(), remaining);
                        }
                    }
                    neighbor.units = new_units;
                    sync_region_unit_meta(neighbor, self);
                }
            }

            if !affected_neighbors.is_empty() {
                events.push(Event::AoeDamage {
                    source_region_id: item.target_region_id.clone(),
                    affected_region_ids: affected_neighbors,
                    player_id: item.player_id.clone(),
                    damage_factor: aoe_factor,
                });
            }
        }

        events
    }

    // --- Win condition ---

    fn check_conditions(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        air_transit_queue: &mut Vec<AirTransitItem>,
    ) -> Vec<Event> {
        let mut events = Vec::new();
        let mut eliminated_ids = Vec::new();

        for (player_id, player) in players.iter_mut() {
            if !player.is_alive {
                continue;
            }

            if let Some(ref capital_region_id) = player.capital_region_id {
                if let Some(region) = regions.get(capital_region_id) {
                    if region.owner_id.as_deref() != Some(player_id) {
                        player.is_alive = false;
                        player.eliminated_reason = Some("capital_lost".into());
                        eliminated_ids.push(player_id.clone());
                        events.push(Event::PlayerEliminated {
                            player_id: player_id.clone(),
                            reason: "capital_lost".into(),
                        });
                    }
                }
            }
        }

        // Clear provinces owned by newly-eliminated players.
        for eliminated_id in &eliminated_ids {
            for region in regions.values_mut() {
                if region.owner_id.as_deref() == Some(eliminated_id) {
                    region.owner_id = None;
                    region.units.clear();
                    region.unit_count = 0;
                    region.unit_type = None;
                    region.is_capital = false;
                    region.building_instances.clear();
                    region.building_type = None;
                    region.defense_bonus = 0.0;
                    region.vision_range = 0;
                    region.unit_generation_bonus = 0.0;
                    region.energy_generation_bonus = 0.0;
                }
            }
        }

        // Remove in-flight air missions for ALL dead players (covers both newly-eliminated
        // players detected above and those marked is_alive=false earlier in the same tick
        // by inline paths such as the bomber-strike capital neutralisation).
        let dead_player_ids: std::collections::HashSet<&str> = players
            .iter()
            .filter(|(_, p)| !p.is_alive)
            .map(|(id, _)| id.as_str())
            .collect();
        if !dead_player_ids.is_empty() {
            air_transit_queue.retain(|item| !dead_player_ids.contains(item.player_id.as_str()));
        }

        let alive: Vec<&String> = players
            .iter()
            .filter(|(_, p)| p.is_alive)
            .map(|(id, _)| id)
            .collect();

        if alive.len() <= 1 {
            events.push(Event::GameOver {
                winner_id: alive.first().map(|id| (*id).clone()),
            });
        }

        events
    }

    // --- In-match boost activation ---

    fn process_activate_boost(
        &self,
        action: &Action,
        players: &mut HashMap<String, Player>,
    ) -> Vec<Event> {
        let player_id = match &action.player_id {
            Some(id) => id,
            None => return Vec::new(),
        };
        let slug = match &action.ability_type {
            Some(s) => s.clone(),
            None => return vec![reject_action(player_id, "Brak sluga boosta", action)],
        };

        let player = match players.get_mut(player_id.as_str()) {
            Some(p) => p,
            None => return Vec::new(),
        };

        // Consume one scroll use for this boost slug.
        {
            match player.ability_scrolls.get(&slug) {
                Some(&uses) if uses > 0 => {
                    *player.ability_scrolls.get_mut(&slug).unwrap() =
                        (uses - 1).max(0);
                }
                _ => {
                    return vec![reject_action(
                        player_id,
                        "Brak zwoju dla tego boosta",
                        action,
                    )];
                }
            }
        }

        // Parse boost params carried by the action (forwarded from gateway/Django).
        let params = match &action.boost_params {
            Some(p) => p.clone(),
            None => {
                return vec![reject_action(
                    player_id,
                    "Brak parametrow boosta",
                    action,
                )];
            }
        };

        let effect_type = params
            .get("effect_type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let value = params
            .get("value")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0);
        let duration_ticks = params
            .get("duration_ticks")
            .and_then(|v| v.as_i64())
            .unwrap_or(60);

        // Check if this boost is already active — replace it (refresh duration).
        if let Some(existing) = player
            .active_match_boosts
            .iter_mut()
            .find(|b| b.slug == slug)
        {
            existing.effect_type = effect_type.clone();
            existing.value = value;
            existing.ticks_remaining = duration_ticks;
            existing.total_ticks = duration_ticks;
        } else {
            player.active_match_boosts.push(ActiveMatchBoost {
                slug: slug.clone(),
                effect_type: effect_type.clone(),
                value,
                ticks_remaining: duration_ticks,
                total_ticks: duration_ticks,
            });
        }

        vec![Event::BoostActivated {
            player_id: player_id.clone(),
            boost_slug: slug,
            effect_type,
            duration_ticks,
        }]
    }

    fn tick_match_boosts(&self, players: &mut HashMap<String, Player>) -> Vec<Event> {
        let mut events = Vec::new();

        for (player_id, player) in players.iter_mut() {
            let mut i = 0;
            while i < player.active_match_boosts.len() {
                player.active_match_boosts[i].ticks_remaining -= 1;
                if player.active_match_boosts[i].ticks_remaining <= 0 {
                    let expired = player.active_match_boosts.remove(i);
                    events.push(Event::BoostExpired {
                        player_id: player_id.clone(),
                        boost_slug: expired.slug,
                    });
                } else {
                    i += 1;
                }
            }
        }

        events
    }

    // --- Helper methods ---

    /// Count how many building instances of a given type exist in a slice.
    pub fn count_buildings(instances: &[BuildingInstance], slug: &str) -> i64 {
        instances.iter().filter(|b| b.building_type == slug).count() as i64
    }

    /// Get the Nth instance (by insertion order) of a given building type.
    #[allow(dead_code)]
    pub fn get_building_instance<'a>(instances: &'a [BuildingInstance], slug: &str, index: usize) -> Option<&'a BuildingInstance> {
        instances.iter().filter(|b| b.building_type == slug).nth(index)
    }

    fn recompute_region_building_stats(&self, region: &mut Region) {
        region.defense_bonus = 0.0;
        region.vision_range = 0;
        region.unit_generation_bonus = 0.0;
        region.energy_generation_bonus = 0.0;

        let mut primary_slug: Option<String> = None;
        let mut primary_order: i64 = i64::MAX;

        for instance in &region.building_instances {
            let Some(config) = self.settings.building_types.get(&instance.building_type) else { continue };

            // Use level_stats if available; otherwise fall back to base config values.
            let defense = get_level_stat(&config.level_stats, instance.level, "defense_bonus")
                .unwrap_or(config.defense_bonus);
            let vision = get_level_stat_i64(&config.level_stats, instance.level, "vision_range")
                .unwrap_or(config.vision_range);
            let unit_gen = get_level_stat(&config.level_stats, instance.level, "unit_generation_bonus")
                .unwrap_or(config.unit_generation_bonus);
            let energy_gen = get_level_stat(&config.level_stats, instance.level, "energy_generation_bonus")
                .unwrap_or(config.energy_generation_bonus);

            region.defense_bonus += defense;
            region.vision_range += vision;
            region.unit_generation_bonus += unit_gen;
            region.energy_generation_bonus += energy_gen;

            let order = config.order;
            if primary_slug.is_none() || order < primary_order {
                primary_slug = Some(instance.building_type.clone());
                primary_order = order;
            }
        }

        region.building_type = primary_slug;
    }

    pub fn get_unit_config(&self, unit_type: &str) -> UnitConfig {
        if let Some(config) = self.settings.unit_types.get(unit_type) {
            return config.clone();
        }
        self.default_units
            .get(unit_type)
            .cloned()
            .unwrap_or_else(|| self.default_units["infantry"].clone())
    }

    pub fn get_unit_scale(&self, unit_type: &str) -> i64 {
        let config = self.get_unit_config(unit_type);
        config.manpower_cost.max(1) as i64
    }

    fn default_unit_type_slug(&self) -> String {
        self.settings
            .default_unit_type_slug
            .clone()
            .unwrap_or_else(|| "infantry".into())
    }

    fn get_region_defender_power(&self, region: &Region, defense_bonus: f64, current_tick: i64) -> f64 {
        let base_unit_type = self.default_unit_type_slug();
        let mut total = 0.0;
        for (unit_type, count) in &region.units {
            let unit_config = self.get_unit_config(unit_type);
            let effective_count = if *unit_type == base_unit_type {
                get_available_base_units(region, self)
            } else {
                *count * self.get_unit_scale(unit_type)
            };
            total += effective_count as f64 * unit_config.defense * (1.0 + defense_bonus);
        }
        if total == 0.0 {
            let fallback_config = self.get_unit_config(&get_region_unit_type(region, self));
            total = region.unit_count as f64 * fallback_config.defense * (1.0 + defense_bonus);
        }
        // Apply combat fatigue penalty if active
        if let Some(fatigue_until) = region.fatigue_until {
            if current_tick < fatigue_until {
                total *= 1.0 - region.fatigue_modifier;
            }
        }
        total
    }

    // --- Pathfinding ---

    pub fn get_travel_distance(
        &self,
        source_id: &str,
        target_id: &str,
        regions: &HashMap<String, Region>,
        unit_config: &UnitConfig,
        max_depth: usize,
        player_id: Option<&str>,
    ) -> Option<usize> {
        if source_id == target_id {
            return None;
        }

        let movement_type = &unit_config.movement_type;
        if movement_type == "sea" {
            return self.get_sea_distance(source_id, target_id, regions, max_depth, unit_config);
        }

        self.get_distance(source_id, target_id, max_depth, &|region_id: &str| {
            self.can_visit_region(region_id, regions, movement_type, player_id, target_id)
        })
    }

    fn get_sea_distance(
        &self,
        source_id: &str,
        target_id: &str,
        regions: &HashMap<String, Region>,
        _max_depth: usize,
        unit_config: &UnitConfig,
    ) -> Option<usize> {
        let source = regions.get(source_id)?;
        let target = regions.get(target_id)?;
        if !source.is_coastal || !target.is_coastal {
            return None;
        }

        let max_sea_range = 1i64.max(
            if unit_config.sea_range > 0 {
                unit_config.sea_range as i64
            } else {
                unit_config.sea_hop_distance_km as i64
            },
        );

        let distance_score = get_region_sea_distance_score(source, target_id)?;
        if distance_score > max_sea_range {
            return None;
        }

        Some(1.max(((distance_score + 19) / 20) as usize))
    }

    /// BFS path reconstruction — returns the full list of province IDs from source
    /// to target (inclusive of target, exclusive of source), or None if unreachable.
    /// Uses air movement (no restrictions), so it works for all air missions.
    pub fn get_path(&self, source_id: &str, target_id: &str) -> Option<Vec<String>> {
        if source_id == target_id {
            return None;
        }
        let mut visited: HashMap<String, Option<String>> = HashMap::new();
        visited.insert(source_id.to_string(), None);
        let mut queue = VecDeque::new();
        queue.push_back(source_id.to_string());

        while let Some(current) = queue.pop_front() {
            if current == target_id {
                // Reconstruct path from target back to source.
                let mut path = Vec::new();
                let mut node = current.clone();
                while node != source_id {
                    path.push(node.clone());
                    node = visited[&node].clone().unwrap();
                }
                path.reverse();
                return Some(path);
            }
            if let Some(neighbors) = self.neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains_key(neighbor) {
                        visited.insert(neighbor.clone(), Some(current.clone()));
                        queue.push_back(neighbor.clone());
                    }
                }
            }
        }
        None
    }

    fn get_distance(
        &self,
        source_id: &str,
        target_id: &str,
        max_depth: usize,
        can_visit: &dyn Fn(&str) -> bool,
    ) -> Option<usize> {
        let mut visited = std::collections::HashSet::new();
        visited.insert(source_id.to_string());
        let mut queue = VecDeque::new();
        queue.push_back((source_id.to_string(), 0usize));

        while let Some((current, depth)) = queue.pop_front() {
            if current == target_id {
                return Some(depth);
            }
            if depth >= max_depth {
                continue;
            }

            if let Some(neighbors) = self.neighbor_map.get(&current) {
                for neighbor in neighbors {
                    if !visited.contains(neighbor) && can_visit(neighbor) {
                        visited.insert(neighbor.clone());
                        queue.push_back((neighbor.clone(), depth + 1));
                    }
                }
            }
        }

        None
    }

    /// Compute a geometric flight path: all provinces whose centroids are
    /// within `corridor_width` distance of the straight line source→target.
    /// Returns province IDs ordered by projection along the line.
    pub fn get_flight_line_path(
        &self,
        source_id: &str,
        target_id: &str,
        regions: &HashMap<String, Region>,
        corridor_width: f64,
    ) -> Vec<String> {
        let src_centroid = match regions.get(source_id).and_then(|r| r.centroid) {
            Some(c) => c,
            None => return vec![source_id.to_string(), target_id.to_string()],
        };
        let tgt_centroid = match regions.get(target_id).and_then(|r| r.centroid) {
            Some(c) => c,
            None => return vec![source_id.to_string(), target_id.to_string()],
        };

        let dx = tgt_centroid[0] - src_centroid[0];
        let dy = tgt_centroid[1] - src_centroid[1];
        let line_len_sq = dx * dx + dy * dy;
        if line_len_sq < 1.0 {
            return vec![source_id.to_string(), target_id.to_string()];
        }

        // Collect all provinces near the flight line.
        let mut on_path: Vec<(String, f64)> = Vec::new();

        for (rid, region) in regions {
            if let Some(centroid) = region.centroid {
                let px = centroid[0] - src_centroid[0];
                let py = centroid[1] - src_centroid[1];
                let t = (px * dx + py * dy) / line_len_sq;
                if t < -0.05 || t > 1.05 {
                    continue;
                }
                let closest_x = src_centroid[0] + t * dx;
                let closest_y = src_centroid[1] + t * dy;
                let dist = ((centroid[0] - closest_x).powi(2) + (centroid[1] - closest_y).powi(2)).sqrt();
                if dist <= corridor_width {
                    on_path.push((rid.clone(), t));
                }
            }
        }

        on_path.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut result: Vec<String> = on_path.into_iter().map(|(rid, _)| rid).collect();
        if result.first().map(|s| s.as_str()) != Some(source_id) {
            result.retain(|r| r != source_id);
            result.insert(0, source_id.to_string());
        }
        if result.last().map(|s| s.as_str()) != Some(target_id) {
            result.retain(|r| r != target_id);
            result.push(target_id.to_string());
        }

        let line_len = line_len_sq.sqrt();
        eprintln!("[AIR] Flight line path from {} to {}: {} provinces in corridor (line_len={:.1}, corridor={:.1})",
            source_id, target_id, result.len(), line_len, corridor_width);

        result
    }

    fn can_visit_region(
        &self,
        region_id: &str,
        regions: &HashMap<String, Region>,
        movement_type: &str,
        player_id: Option<&str>,
        target_id: &str,
    ) -> bool {
        let region = match regions.get(region_id) {
            Some(r) => r,
            None => return false,
        };

        if movement_type == "sea" && !region.is_coastal {
            return false;
        }
        if movement_type == "air" {
            return true;
        }

        if let Some(pid) = player_id {
            if region_id != target_id && region.owner_id.as_deref() != Some(pid) {
                return false;
            }
        }

        true
    }
}

// --- Free functions for unit manipulation ---

fn get_region_unit_type(region: &Region, engine: &GameEngine) -> String {
    if !region.units.is_empty() {
        let base_unit_type = engine.default_unit_type_slug();
        region
            .units
            .iter()
            .max_by_key(|(unit_type, count)| {
                if **unit_type == base_unit_type {
                    get_available_base_units(region, engine)
                } else {
                    **count * engine.get_unit_scale(unit_type)
                }
            })
            .map(|(k, _)| k.clone())
            .unwrap_or_else(|| base_unit_type)
    } else {
        region
            .unit_type
            .clone()
            .unwrap_or_else(|| engine.default_unit_type_slug())
    }
}

fn get_available_units(region: &Region, unit_type: &str, engine: &GameEngine) -> i64 {
    let base_unit_type = engine.default_unit_type_slug();
    if unit_type == base_unit_type {
        return get_available_base_units(region, engine);
    }
    region.units.get(unit_type).copied().unwrap_or(0)
}

fn get_available_base_units(region: &Region, engine: &GameEngine) -> i64 {
    let base_unit_type = engine.default_unit_type_slug();
    let raw_base = region.units.get(&base_unit_type).copied().unwrap_or(0);
    let reserved = get_reserved_base_units(region, engine);
    (raw_base - reserved).max(0)
}

fn get_reserved_base_units(region: &Region, engine: &GameEngine) -> i64 {
    let base_unit_type = engine.default_unit_type_slug();
    let mut reserved = 0i64;
    for (unit_type, count) in &region.units {
        if *unit_type == base_unit_type {
            continue;
        }
        reserved += *count * engine.get_unit_scale(unit_type);
    }
    reserved
}

fn add_units(region: &mut Region, unit_type: &str, amount: i64) {
    if amount <= 0 {
        return;
    }
    *region.units.entry(unit_type.to_string()).or_insert(0) += amount;
}

fn remove_units(region: &mut Region, unit_type: &str, amount: i64) {
    if amount <= 0 {
        return;
    }
    if let Some(count) = region.units.get_mut(unit_type) {
        *count -= amount;
        if *count <= 0 {
            region.units.remove(unit_type);
        }
    }
}

fn sync_region_unit_meta(region: &mut Region, engine: &GameEngine) {
    let base_unit_type = engine.default_unit_type_slug();
    let mut unit_count = 0i64;
    for (unit_type, count) in &region.units {
        if *unit_type == base_unit_type {
            unit_count += get_available_base_units(region, engine);
        } else {
            unit_count += *count * engine.get_unit_scale(unit_type);
        }
    }
    region.unit_count = unit_count;
    region.unit_type = if !region.units.is_empty() {
        Some(get_region_unit_type(region, engine))
    } else {
        None
    };
}

fn is_embarked_unit(unit_type: &str, engine: &GameEngine) -> bool {
    let base = engine.default_unit_type_slug();
    unit_type != base && engine.get_unit_scale(unit_type) > 1
}

fn deploy_units_from_region(region: &mut Region, unit_type: &str, amount: i64, engine: &GameEngine) {
    remove_units(region, unit_type, amount);
    if is_embarked_unit(unit_type, engine) {
        let base = engine.default_unit_type_slug();
        remove_units(region, &base, amount * engine.get_unit_scale(unit_type));
    }
    sync_region_unit_meta(region, engine);
}

fn receive_units_in_region(
    region: &mut Region,
    unit_type: &str,
    amount: i64,
    engine: &GameEngine,
) {
    if is_embarked_unit(unit_type, engine) {
        let base = engine.default_unit_type_slug();
        add_units(region, &base, amount * engine.get_unit_scale(unit_type));
    }
    add_units(region, unit_type, amount);
    normalize_stationed_units(region, engine);
    sync_region_unit_meta(region, engine);
}

fn normalize_stationed_units(region: &mut Region, engine: &GameEngine) {
    if region.units.is_empty() {
        return;
    }
    let mut normalized: HashMap<String, i64> = HashMap::new();
    for (unit_type, count) in &region.units {
        if can_station_unit(region, unit_type, engine) {
            *normalized.entry(unit_type.clone()).or_insert(0) += count;
        }
        // Units that can't station are dropped. For embarked units (scale > 1),
        // receive_units_in_region already added their infantry backing, so
        // the manpower is preserved as infantry — effectively a conversion.
    }
    region.units = normalized;
}

fn can_station_unit(region: &Region, unit_type: &str, engine: &GameEngine) -> bool {
    let base = engine.default_unit_type_slug();
    if unit_type == base {
        return true;
    }
    let config = engine.get_unit_config(unit_type);
    // Air units can station anywhere — they don't need a production building present.
    if config.movement_type == "air" {
        return true;
    }
    if config.movement_type == "sea" && !region.is_coastal {
        return false;
    }
    // Units with can_station_anywhere skip the building requirement check.
    if config.can_station_anywhere {
        return true;
    }
    // Special units require their production building to station;
    // without one they are dropped and their infantry backing remains.
    if let Some(ref produced_by) = config.produced_by_slug {
        if GameEngine::count_buildings(&region.building_instances, produced_by) <= 0 {
            return false;
        }
    }
    true
}

fn get_travel_ticks(distance: usize, unit_config: &UnitConfig) -> i64 {
    let dist = distance.max(1) as i64;
    // Use explicit ticks_per_hop if set (higher = slower, e.g. infantry=3 means 3 ticks/hop).
    if unit_config.ticks_per_hop > 0 {
        return (unit_config.ticks_per_hop * dist).max(1);
    }
    let speed = unit_config.speed.max(1) as i64;
    1i64.max((dist + speed - 1) / speed)
}

fn get_region_sea_distance_score(source: &Region, target_id: &str) -> Option<i64> {
    for band in &source.sea_distances {
        if let Some(provinces) = band.get("provinces").and_then(|v| v.as_array()) {
            for province in provinces {
                if province.as_str() == Some(target_id) {
                    return band
                        .get("r")
                        .and_then(|v| v.as_i64());
                }
            }
        }
    }
    None
}

fn has_active_shield(region_id: &str, active_effects: &[ActiveEffect]) -> bool {
    active_effects.iter().any(|e| {
        e.effect_type == "ab_shield" && e.target_region_id == region_id && e.ticks_remaining > 0
    })
}

/// Look up a floating-point stat for a given level from a level_stats map.
/// Returns `None` when the level key or the stat key is absent.
fn get_level_stat(level_stats: &HashMap<String, serde_json::Value>, level: i64, key: &str) -> Option<f64> {
    level_stats
        .get(&level.to_string())
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_f64())
}

/// Look up an integer stat for a given level from a level_stats map.
/// Returns `None` when the level key or the stat key is absent.
fn get_level_stat_i64(level_stats: &HashMap<String, serde_json::Value>, level: i64, key: &str) -> Option<i64> {
    level_stats
        .get(&level.to_string())
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_i64())
}

fn reject_action(player_id: &str, message: &str, action: &Action) -> Event {
    Event::ActionRejected {
        player_id: player_id.to_string(),
        message: message.to_string(),
        action_type: Some(action.action_type.clone()),
        source_region_id: action.source_region_id.clone(),
        target_region_id: action.target_region_id.clone(),
        region_id: action.region_id.clone(),
        building_type: action.building_type.clone(),
        unit_type: action.unit_type.clone(),
    }
}

fn attack_rejection_message(unit_config: &UnitConfig) -> String {
    match unit_config.movement_type.as_str() {
        "sea" => "Statki moga atakowac tylko regiony przybrzezne w swoim zasiegu".into(),
        "air" => "Lotnictwo moze atakowac tylko cele w swoim zasiegu".into(),
        _ => "Ta jednostka moze atakowac tylko cele w swoim zasiegu".into(),
    }
}

fn move_rejection_message(unit_config: &UnitConfig) -> String {
    match unit_config.movement_type.as_str() {
        "sea" => "Statki moga poruszac sie tylko miedzy przybrzeznymi regionami".into(),
        "air" => "Lotnictwo moze przemieszczac sie tylko w swoim zasiegu".into(),
        _ => "Ta jednostka moze przemieszczac sie tylko w swoim zasiegu".into(),
    }
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    // -------------------------------------------------------------------------
    // Test fixture builders
    // -------------------------------------------------------------------------

    /// Minimal but complete GameSettings suitable for most tests.
    fn test_settings() -> GameSettings {
        let mut building_types = HashMap::new();
        building_types.insert(
            "barracks".into(),
            BuildingConfig {
                cost: 0,
                energy_cost: 30,
                build_time_ticks: 5,
                max_per_region: 1,
                defense_bonus: 0.2,
                vision_range: 1,
                unit_generation_bonus: 1.0,
                energy_generation_bonus: 0.0,
                requires_coastal: false,
                icon: String::new(),
                name: "Barracks".into(),
                asset_key: String::new(),
                order: 1,
                produced_unit_slug: None,
                max_level: 3,
                level_stats: HashMap::new(),
            },
        );
        building_types.insert(
            "factory".into(),
            BuildingConfig {
                cost: 0,
                energy_cost: 50,
                build_time_ticks: 8,
                max_per_region: 1,
                defense_bonus: 0.0,
                vision_range: 0,
                unit_generation_bonus: 0.0,
                energy_generation_bonus: 2.0,
                requires_coastal: false,
                icon: String::new(),
                name: "Factory".into(),
                asset_key: String::new(),
                order: 2,
                produced_unit_slug: Some("tank".into()),
                max_level: 3,
                level_stats: HashMap::new(),
            },
        );
        building_types.insert(
            "port".into(),
            BuildingConfig {
                cost: 0,
                energy_cost: 40,
                build_time_ticks: 6,
                max_per_region: 1,
                defense_bonus: 0.0,
                vision_range: 0,
                unit_generation_bonus: 0.0,
                energy_generation_bonus: 0.0,
                requires_coastal: true,
                icon: String::new(),
                name: "Port".into(),
                asset_key: String::new(),
                order: 3,
                produced_unit_slug: Some("ship".into()),
                max_level: 3,
                level_stats: HashMap::new(),
            },
        );

        let mut unit_types = HashMap::new();
        unit_types.insert(
            "infantry".into(),
            UnitConfig {
                attack: 1.0,
                defense: 1.0,
                speed: 1,
                attack_range: 1,
                sea_range: 0,
                sea_hop_distance_km: 0,
                movement_type: "land".into(),
                production_cost: 0,
                production_time_ticks: 0,
                produced_by_slug: None,
                manpower_cost: 1,
                ..Default::default()
            },
        );
        unit_types.insert(
            "tank".into(),
            UnitConfig {
                attack: 3.0,
                defense: 2.5,
                speed: 1,
                attack_range: 1,
                sea_range: 0,
                sea_hop_distance_km: 0,
                movement_type: "land".into(),
                production_cost: 15,
                production_time_ticks: 8,
                produced_by_slug: Some("factory".into()),
                manpower_cost: 3,
                ..Default::default()
            },
        );
        unit_types.insert(
            "ship".into(),
            UnitConfig {
                attack: 2.0,
                defense: 2.0,
                speed: 4,
                attack_range: 4,
                sea_range: 0,
                sea_hop_distance_km: 2800,
                movement_type: "sea".into(),
                production_cost: 20,
                production_time_ticks: 10,
                produced_by_slug: Some("port".into()),
                manpower_cost: 10,
                ..Default::default()
            },
        );

        GameSettings {
            building_types,
            unit_types,
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            combat_randomness: 0.0, // deterministic for tests
            ..Default::default()
        }
    }

    fn make_player(id: &str) -> Player {
        Player {
            user_id: id.into(),
            username: id.into(),
            color: "#ff0000".into(),
            is_alive: true,
            connected: true,
            energy: 200,
            energy_accum: 0.0,
            capital_region_id: None,
            action_points: 10,
            ap_regen_accum: 0.0,
            ..Default::default()
        }
    }

    fn make_region(id: &str, owner_id: Option<&str>, unit_count: i64) -> Region {
        let mut units = HashMap::new();
        if unit_count > 0 {
            units.insert("infantry".into(), unit_count);
        }
        Region {
            name: id.into(),
            country_code: "XX".into(),
            centroid: None,
            owner_id: owner_id.map(str::to_owned),
            unit_count,
            unit_type: if unit_count > 0 { Some("infantry".into()) } else { None },
            is_capital: false,
            building_type: None,
            building_instances: vec![],
            defense_bonus: 0.0,
            vision_range: 0,
            unit_generation_bonus: 0.0,
            energy_generation_bonus: 0.0,
            is_coastal: false,
            sea_distances: vec![],
            units,
            unit_accum: 0.0,
            action_cooldowns: HashMap::new(),
            fatigue_until: None,
            fatigue_modifier: 0.0,
        }
    }

    /// Build an engine with a linear chain of regions: A — B — C — D.
    fn make_linear_engine() -> (GameEngine, HashMap<String, Region>, HashMap<String, Player>) {
        let settings = test_settings();
        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        neighbor_map.insert("A".into(), vec!["B".into()]);
        neighbor_map.insert("B".into(), vec!["A".into(), "C".into()]);
        neighbor_map.insert("C".into(), vec!["B".into(), "D".into()]);
        neighbor_map.insert("D".into(), vec!["C".into()]);

        let engine = GameEngine::new(settings, neighbor_map);

        let mut regions = HashMap::new();
        regions.insert("A".into(), make_region("A", Some("p1"), 20));
        regions.insert("B".into(), make_region("B", Some("p1"), 15));
        regions.insert("C".into(), make_region("C", Some("p2"), 15));
        regions.insert("D".into(), make_region("D", Some("p2"), 20));

        let mut players = HashMap::new();
        players.insert("p1".into(), make_player("p1"));
        players.insert("p2".into(), make_player("p2"));

        (engine, regions, players)
    }

    // Helper to find a specific event variant by matching on its type name
    fn has_event<F: Fn(&Event) -> bool>(events: &[Event], predicate: F) -> bool {
        events.iter().any(predicate)
    }

    // -------------------------------------------------------------------------
    // 1. GameEngine construction and config lookups
    // -------------------------------------------------------------------------

    #[test]
    fn test_engine_new_stores_settings() {
        let settings = test_settings();
        let engine = GameEngine::new(settings.clone(), HashMap::new());
        assert_eq!(engine.settings.base_energy_per_tick, 2.0);
        assert_eq!(engine.settings.base_unit_generation_rate, 1.0);
    }

    #[test]
    fn test_get_unit_config_from_settings() {
        let settings = test_settings();
        let engine = GameEngine::new(settings, HashMap::new());
        let cfg = engine.get_unit_config("infantry");
        assert_eq!(cfg.attack, 1.0);
        assert_eq!(cfg.defense, 1.0);
        assert_eq!(cfg.manpower_cost, 1);
    }

    #[test]
    fn test_get_unit_config_tank() {
        let settings = test_settings();
        let engine = GameEngine::new(settings, HashMap::new());
        let cfg = engine.get_unit_config("tank");
        assert_eq!(cfg.attack, 3.0);
        assert_eq!(cfg.manpower_cost, 3);
    }

    #[test]
    fn test_get_unit_config_unknown_falls_back_to_infantry() {
        let settings = test_settings();
        let engine = GameEngine::new(settings, HashMap::new());
        let cfg = engine.get_unit_config("nonexistent_unit_type");
        // Falls back to default infantry config
        assert_eq!(cfg.attack, 1.0);
        assert_eq!(cfg.manpower_cost, 1);
    }

    #[test]
    fn test_get_unit_scale_infantry_is_one() {
        let settings = test_settings();
        let engine = GameEngine::new(settings, HashMap::new());
        assert_eq!(engine.get_unit_scale("infantry"), 1);
    }

    #[test]
    fn test_get_unit_scale_tank_is_three() {
        let settings = test_settings();
        let engine = GameEngine::new(settings, HashMap::new());
        assert_eq!(engine.get_unit_scale("tank"), 3);
    }

    #[test]
    fn test_get_travel_distance_adjacent() {
        let (engine, regions, _) = make_linear_engine();
        let infantry_cfg = engine.get_unit_config("infantry");
        let dist = engine.get_travel_distance("A", "B", &regions, &infantry_cfg, 1, None);
        assert_eq!(dist, Some(1));
    }

    #[test]
    fn test_get_travel_distance_two_hops() {
        let (engine, regions, _) = make_linear_engine();
        let infantry_cfg = engine.get_unit_config("infantry");
        let dist = engine.get_travel_distance("A", "C", &regions, &infantry_cfg, 2, None);
        assert_eq!(dist, Some(2));
    }

    #[test]
    fn test_get_travel_distance_out_of_range_returns_none() {
        let (engine, regions, _) = make_linear_engine();
        let infantry_cfg = engine.get_unit_config("infantry");
        // Range 1 can only reach B from A; C is at depth 2
        let dist = engine.get_travel_distance("A", "C", &regions, &infantry_cfg, 1, None);
        assert_eq!(dist, None);
    }

    #[test]
    fn test_get_travel_distance_same_region_returns_none() {
        let (engine, regions, _) = make_linear_engine();
        let infantry_cfg = engine.get_unit_config("infantry");
        let dist = engine.get_travel_distance("A", "A", &regions, &infantry_cfg, 5, None);
        assert_eq!(dist, None);
    }

    #[test]
    fn test_count_buildings_empty() {
        let instances: Vec<BuildingInstance> = vec![];
        assert_eq!(GameEngine::count_buildings(&instances, "barracks"), 0);
    }

    #[test]
    fn test_count_buildings_with_instances() {
        let instances = vec![
            BuildingInstance { building_type: "barracks".into(), level: 1 },
            BuildingInstance { building_type: "factory".into(), level: 1 },
            BuildingInstance { building_type: "barracks".into(), level: 2 },
        ];
        assert_eq!(GameEngine::count_buildings(&instances, "barracks"), 2);
        assert_eq!(GameEngine::count_buildings(&instances, "factory"), 1);
        assert_eq!(GameEngine::count_buildings(&instances, "port"), 0);
    }

    #[test]
    fn test_get_building_instance() {
        let instances = vec![
            BuildingInstance { building_type: "barracks".into(), level: 1 },
            BuildingInstance { building_type: "barracks".into(), level: 2 },
        ];
        let inst = GameEngine::get_building_instance(&instances, "barracks", 0);
        assert!(inst.is_some());
        assert_eq!(inst.unwrap().level, 1);

        let inst2 = GameEngine::get_building_instance(&instances, "barracks", 1);
        assert!(inst2.is_some());
        assert_eq!(inst2.unwrap().level, 2);

        let inst3 = GameEngine::get_building_instance(&instances, "barracks", 2);
        assert!(inst3.is_none());
    }

    // -------------------------------------------------------------------------
    // 2. Energy generation
    // -------------------------------------------------------------------------

    #[test]
    fn test_energy_generation_base_plus_region() {
        let (engine, regions, mut players) = make_linear_engine();
        // p1 owns A and B: base=2.0, 2 regions * 0.35 = 0.70, total = 2.70 per tick
        // After 1 tick (accumulated into energy_accum then floored) p1 gets 2 energy.
        let initial_energy = players["p1"].energy;
        engine.generate_energy(&mut players, &regions);
        // 2.0 + 2*0.35 = 2.70 accumulated
        let p1 = &players["p1"];
        assert!(p1.energy > initial_energy || p1.energy_accum > 0.0,
            "Energy should increase after one tick");
        // The accumulated amount should be exactly 2.70 (if integer part was added to energy)
        let total = p1.energy as f64 + p1.energy_accum;
        assert!((total - (initial_energy as f64 + 2.70)).abs() < 0.01,
            "Total energy+accum should be initial + 2.70, got {}", total);
    }

    #[test]
    fn test_energy_accumulates_fractional_parts() {
        let (engine, regions, mut players) = make_linear_engine();
        // Run 10 ticks; after 10 ticks p1 has accumulated 10 * 2.70 = 27 whole units
        for _ in 0..10 {
            engine.generate_energy(&mut players, &regions);
        }
        let p1 = &players["p1"];
        let total = p1.energy as f64 + p1.energy_accum;
        let expected = 200.0 + 10.0 * 2.70;
        assert!((total - expected).abs() < 0.1,
            "After 10 ticks total should be ~{:.1}, got {:.3}", expected, total);
    }

    #[test]
    fn test_energy_generation_with_building_bonus() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Add a factory to region A (energy_generation_bonus = 2.0)
        let region_a = regions.get_mut("A").unwrap();
        region_a.building_instances.push(BuildingInstance {
            building_type: "factory".into(),
            level: 1,
        });
        region_a.energy_generation_bonus = 2.0;

        let initial_energy = players["p1"].energy;
        engine.generate_energy(&mut players, &regions);
        let p1 = &players["p1"];
        let total = p1.energy as f64 + p1.energy_accum;
        // base 2.0 + 2 regions * 0.35 + 2.0 building bonus = 4.70
        let expected_accum = 4.70;
        assert!((total - (initial_energy as f64 + expected_accum)).abs() < 0.01,
            "Expected total {}, got {}", initial_energy as f64 + expected_accum, total);
    }

    // -------------------------------------------------------------------------
    // 3. Unit generation
    // -------------------------------------------------------------------------

    #[test]
    fn test_unit_generation_on_owned_region() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Run enough ticks so the accumulator crosses 1.0 for the non-capital regions.
        // base_rate = 1.0, non-capital: rate = 1.0 per tick.
        // After 1 tick unit_accum becomes 1.0, which floors to 1 unit added.
        let initial_a = regions["A"].units.get("infantry").copied().unwrap_or(0);
        let initial_b = regions["B"].units.get("infantry").copied().unwrap_or(0);

        // Run one full generate cycle
        engine.generate_units_with_effects(&mut players, &mut regions, &[]);

        let after_a = regions["A"].units.get("infantry").copied().unwrap_or(0);
        let after_b = regions["B"].units.get("infantry").copied().unwrap_or(0);

        // Both owned by p1, same rate — units should have been added
        assert!(after_a >= initial_a, "A should not lose units from generation");
        assert!(after_b >= initial_b, "B should not lose units from generation");
        assert!(after_a + after_b > initial_a + initial_b,
            "Total units for p1 should increase after generation");
    }

    #[test]
    fn test_capital_region_generates_more_units() {
        let settings = test_settings(); // capital_generation_bonus = 2.0
        let mut neighbor_map = HashMap::new();
        neighbor_map.insert("cap".into(), vec!["reg".into()]);
        neighbor_map.insert("reg".into(), vec!["cap".into()]);
        let engine = GameEngine::new(settings, neighbor_map);

        let mut regions = HashMap::new();
        let mut cap = make_region("cap", Some("p1"), 10);
        cap.is_capital = true;
        regions.insert("cap".into(), cap);
        regions.insert("reg".into(), make_region("reg", Some("p1"), 10));

        let mut players = HashMap::new();
        players.insert("p1".into(), make_player("p1"));

        // Multiple ticks so accumulator produces whole units
        for _ in 0..10 {
            engine.generate_units_with_effects(&mut players, &mut regions, &[]);
        }

        let cap_units = regions["cap"].units.get("infantry").copied().unwrap_or(0);
        let reg_units = regions["reg"].units.get("infantry").copied().unwrap_or(0);

        // Capital generates at rate 2.0 (base 1.0 * bonus 2.0), regular at 1.0.
        // After 10 ticks, capital should have significantly more units added.
        let cap_added = cap_units - 10;
        let reg_added = reg_units - 10;
        assert!(cap_added > reg_added,
            "Capital should gain more units; capital added {}, regular added {}", cap_added, reg_added);
    }

    // -------------------------------------------------------------------------
    // 4. Building queue completion
    // -------------------------------------------------------------------------

    #[test]
    fn test_building_queue_completes_after_ticks() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let buildings_queue = vec![BuildingQueueItem {
            region_id: "A".into(),
            building_type: "barracks".into(),
            player_id: "p1".into(),
            ticks_remaining: 1,
            total_ticks: 5,
            is_upgrade: false,
            target_level: 0,
        }];

        let (remaining, events) = engine.process_buildings(&mut players, &mut regions, &buildings_queue);
        // ticks_remaining decremented to 0, so should complete
        assert!(remaining.is_empty(), "Queue should be empty after completion");
        assert!(has_event(&events, |e| matches!(e, Event::BuildingComplete { region_id, building_type, .. }
            if region_id == "A" && building_type == "barracks")),
            "Should emit BuildingComplete");
        assert_eq!(
            GameEngine::count_buildings(&regions["A"].building_instances, "barracks"),
            1
        );
    }

    #[test]
    fn test_building_queue_not_complete_while_ticks_remain() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let buildings_queue = vec![BuildingQueueItem {
            region_id: "A".into(),
            building_type: "barracks".into(),
            player_id: "p1".into(),
            ticks_remaining: 3,
            total_ticks: 5,
            is_upgrade: false,
            target_level: 0,
        }];

        let (remaining, events) = engine.process_buildings(&mut players, &mut regions, &buildings_queue);
        assert_eq!(remaining.len(), 1, "Item should remain in queue");
        assert_eq!(remaining[0].ticks_remaining, 2);
        assert!(!has_event(&events, |e| matches!(e, Event::BuildingComplete { .. })));
        assert_eq!(
            GameEngine::count_buildings(&regions["A"].building_instances, "barracks"),
            0
        );
    }

    #[test]
    fn test_building_queue_increments_buildings_built_stat() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let buildings_queue = vec![BuildingQueueItem {
            region_id: "A".into(),
            building_type: "barracks".into(),
            player_id: "p1".into(),
            ticks_remaining: 1,
            total_ticks: 5,
            is_upgrade: false,
            target_level: 0,
        }];
        engine.process_buildings(&mut players, &mut regions, &buildings_queue);
        assert_eq!(players["p1"].total_buildings_built, 1);
    }

    // -------------------------------------------------------------------------
    // 5. Build action — energy cost deduction and queue creation
    // -------------------------------------------------------------------------

    #[test]
    fn test_build_action_enqueues_item_and_deducts_energy() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "build".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            building_type: Some("barracks".into()),
            ..Default::default()
        };

        let initial_energy = players["p1"].energy;
        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action,
            &mut players,
            &mut regions,
            &mut buildings_queue,
            &mut unit_queue,
            &mut transit_queue,
            &mut air_transit_queue,
            &mut diplomacy,
            1,
        );

        assert_eq!(buildings_queue.len(), 1);
        assert_eq!(buildings_queue[0].building_type, "barracks");
        assert_eq!(buildings_queue[0].ticks_remaining, 5);
        assert!(players["p1"].energy < initial_energy,
            "Energy should be deducted for build");
        assert_eq!(initial_energy - players["p1"].energy, 30); // energy_cost from config
        assert!(has_event(&events, |e| matches!(e, Event::BuildStarted { .. })));
    }

    #[test]
    fn test_build_action_rejected_insufficient_energy() {
        let (engine, mut regions, mut players) = make_linear_engine();
        players.get_mut("p1").unwrap().energy = 5; // way below 30 cost
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "build".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            building_type: Some("barracks".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(buildings_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }

    #[test]
    fn test_build_action_rejected_requires_coastal() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        // Port requires coastal but A is not coastal
        let action = Action {
            action_type: "build".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            building_type: Some("port".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(buildings_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }

    #[test]
    fn test_build_action_rejected_max_per_region() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Pre-place a barracks (max_per_region = 1)
        regions.get_mut("A").unwrap().building_instances.push(
            BuildingInstance { building_type: "barracks".into(), level: 1 }
        );
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "build".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            building_type: Some("barracks".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(buildings_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }

    // -------------------------------------------------------------------------
    // 6. Unit production action
    // -------------------------------------------------------------------------

    #[test]
    fn test_produce_unit_action_enqueues_and_deducts_energy() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Add a factory to region A so tanks can be produced
        regions.get_mut("A").unwrap().building_instances.push(
            BuildingInstance { building_type: "factory".into(), level: 1 }
        );
        // Tank costs 15 energy, manpower_cost = 3, region A has 20 infantry
        players.get_mut("p1").unwrap().energy = 100;
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "produce_unit".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            unit_type: Some("tank".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );

        assert_eq!(unit_queue.len(), 1);
        assert_eq!(unit_queue[0].unit_type, "tank");
        assert_eq!(players["p1"].energy, 85); // 100 - 15
        assert!(has_event(&events, |e| matches!(e, Event::UnitProductionStarted { .. })));
    }

    #[test]
    fn test_produce_unit_rejected_without_building() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // No factory in region A
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "produce_unit".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            unit_type: Some("tank".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(unit_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }

    #[test]
    fn test_unit_queue_completion_adds_units_to_region() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Add factory so tank can station there
        regions.get_mut("A").unwrap().building_instances.push(
            BuildingInstance { building_type: "factory".into(), level: 1 }
        );
        // Region A has 20 infantry which is enough to satisfy the manpower check (needs 3).
        let unit_queue = vec![UnitQueueItem {
            region_id: "A".into(),
            player_id: "p1".into(),
            unit_type: "tank".into(),
            quantity: Some(1),
            manpower_cost: Some(3),
            ticks_remaining: 1,
            total_ticks: 8,
        }];

        let (remaining, events) = engine.process_unit_queue(&mut players, &mut regions, &unit_queue);

        assert!(remaining.is_empty(), "Queue item should be consumed on completion");
        assert!(has_event(&events, |e| matches!(e, Event::UnitProductionComplete { unit_type, .. }
            if unit_type == "tank")),
            "Should emit UnitProductionComplete for tank");
        // The tank is added directly via add_units — the manpower check only gates
        // whether production succeeds, it does not deduct infantry at queue completion.
        assert_eq!(regions["A"].units.get("tank").copied().unwrap_or(0), 1,
            "Region A should now have 1 tank");
        assert_eq!(players["p1"].total_units_produced, 1,
            "Player's total_units_produced stat should be incremented");
    }

    #[test]
    fn test_unit_queue_production_failed_not_enough_manpower() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Add factory, but deplete infantry
        regions.get_mut("A").unwrap().building_instances.push(
            BuildingInstance { building_type: "factory".into(), level: 1 }
        );
        regions.get_mut("A").unwrap().units.insert("infantry".into(), 1); // only 1, need 3

        let unit_queue = vec![UnitQueueItem {
            region_id: "A".into(),
            player_id: "p1".into(),
            unit_type: "tank".into(),
            quantity: Some(1),
            manpower_cost: Some(3),
            ticks_remaining: 1,
            total_ticks: 8,
        }];

        let (remaining, events) = engine.process_unit_queue(&mut players, &mut regions, &unit_queue);
        assert!(remaining.is_empty()); // Item is consumed even on failure
        assert!(has_event(&events, |e| matches!(e, Event::UnitProductionFailed { .. })));
        assert_eq!(regions["A"].units.get("tank").copied().unwrap_or(0), 0);
    }

    // -------------------------------------------------------------------------
    // 7. Combat resolution
    // -------------------------------------------------------------------------

    #[test]
    fn test_attack_attacker_wins_overwhelmingly() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // p1 sends 100 units to p2's region C which only has 1 unit
        // With combat_randomness=0.0 the result is deterministic
        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 100,
            ticks_remaining: 0,
            travel_ticks: 1,
        };
        // Give C only 1 unit
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 1);
        regions.get_mut("C").unwrap().unit_count = 1;

        let mut diplomacy = DiplomacyState::default();
        let events = engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        assert!(has_event(&events, |e| matches!(e, Event::AttackSuccess { target_region_id, .. }
            if target_region_id == "C")),
            "Should emit AttackSuccess");
        assert_eq!(regions["C"].owner_id.as_deref(), Some("p1"),
            "C should now belong to p1");
        assert!(players["p1"].total_regions_conquered > 0);
    }

    #[test]
    fn test_attack_defender_wins_overwhelmingly() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // p1 sends 1 unit to p2's region C which has 100 units
        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 1,
            ticks_remaining: 0,
            travel_ticks: 1,
        };
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 100);
        regions.get_mut("C").unwrap().unit_count = 100;

        let mut diplomacy = DiplomacyState::default();
        let events = engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        assert!(has_event(&events, |e| matches!(e, Event::AttackFailed { target_region_id, .. }
            if target_region_id == "C")),
            "Should emit AttackFailed");
        assert_eq!(regions["C"].owner_id.as_deref(), Some("p2"),
            "C should remain p2's");
        assert_eq!(players["p1"].total_units_lost, 1);
    }

    #[test]
    fn test_attack_success_removes_previous_owner() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 100,
            ticks_remaining: 0,
            travel_ticks: 1,
        };
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 1);

        let mut diplomacy = DiplomacyState::default();
        engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        // Defender's units_lost should be recorded
        assert!(players["p2"].total_units_lost >= 1);
    }

    #[test]
    fn test_attack_success_on_capital_emits_capital_captured() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Make C a capital belonging to p2
        regions.get_mut("C").unwrap().is_capital = true;
        players.get_mut("p2").unwrap().capital_region_id = Some("C".into());

        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 100,
            ticks_remaining: 0,
            travel_ticks: 1,
        };
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 1);

        let mut diplomacy = DiplomacyState::default();
        let events = engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        assert!(has_event(&events, |e| matches!(e, Event::CapitalCaptured { region_id, lost_by, .. }
            if region_id == "C" && lost_by == "p2")),
            "Should emit CapitalCaptured");
    }

    #[test]
    fn test_defense_bonus_from_buildings_matters() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Give C a strong defense bonus via building
        regions.get_mut("C").unwrap().defense_bonus = 5.0; // very high
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 10);

        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 10, // equal units but defender has 5.0 bonus
            ticks_remaining: 0,
            travel_ticks: 1,
        };

        let mut diplomacy = DiplomacyState::default();
        let events = engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        // With randomness=0, the massive defense bonus ensures defender wins
        assert!(has_event(&events, |e| matches!(e, Event::AttackFailed { .. })),
            "Defender should win with extreme defense bonus");
    }

    #[test]
    fn test_attack_with_tank_unit_type() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Add tanks to B (attacker) and factory so they can station
        regions.get_mut("B").unwrap().building_instances.push(
            BuildingInstance { building_type: "factory".into(), level: 1 }
        );
        regions.get_mut("B").unwrap().units.insert("tank".into(), 5);
        regions.get_mut("B").unwrap().units.insert("infantry".into(), 35); // 5 tanks * 3 manpower = 15 reserved

        regions.get_mut("C").unwrap().units.insert("infantry".into(), 2);

        let item = TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "tank".into(),
            units: 5,
            ticks_remaining: 0,
            travel_ticks: 1,
        };

        let mut diplomacy = DiplomacyState::default();
        let events = engine.resolve_attack_arrival(&item, &mut players, &mut regions, &mut diplomacy, 1);

        // 5 tanks vs 2 infantry — tanks should overwhelm
        assert!(has_event(&events, |e| matches!(e, Event::AttackSuccess { unit_type, .. }
            if unit_type == "tank")),
            "Tank attack should succeed");
    }

    // -------------------------------------------------------------------------
    // 8. Movement / transit
    // -------------------------------------------------------------------------

    #[test]
    fn test_attack_action_creates_transit_item() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "attack".into(),
            player_id: Some("p1".into()),
            source_region_id: Some("A".into()),
            target_region_id: Some("B".into()),
            units: Some(5),
            ..Default::default()
        };
        // B belongs to p1; change B to p2 so it's a valid attack target
        regions.get_mut("B").unwrap().owner_id = Some("p2".into());

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );

        assert_eq!(transit_queue.len(), 1);
        assert_eq!(transit_queue[0].action_type, "attack");
        assert_eq!(transit_queue[0].units, 5);
        assert!(has_event(&events, |e| matches!(e, Event::TroopsSent { action_type, .. }
            if action_type == "attack")));
    }

    #[test]
    fn test_move_action_creates_transit_item() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        // Both A and B owned by p1
        let action = Action {
            action_type: "move".into(),
            player_id: Some("p1".into()),
            source_region_id: Some("A".into()),
            target_region_id: Some("B".into()),
            units: Some(5),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );

        assert_eq!(transit_queue.len(), 1);
        assert_eq!(transit_queue[0].action_type, "move");
        assert!(has_event(&events, |e| matches!(e, Event::TroopsSent { action_type, .. }
            if action_type == "move")));
    }

    #[test]
    fn test_transit_move_arrival_delivers_units() {
        let (engine, mut regions, _players) = make_linear_engine();
        let initial_b = regions["B"].units.get("infantry").copied().unwrap_or(0);

        let item = TransitQueueItem {
            action_type: "move".into(),
            source_region_id: "A".into(),
            target_region_id: "B".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 5,
            ticks_remaining: 0,
            travel_ticks: 1,
        };

        let events = engine.resolve_move_arrival(&item, &mut regions);

        assert!(has_event(&events, |e| matches!(e, Event::UnitsMoved { .. })));
        assert_eq!(
            regions["B"].units.get("infantry").copied().unwrap_or(0),
            initial_b + 5
        );
    }

    #[test]
    fn test_transit_queue_tick_decrement() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut transit_queue = vec![TransitQueueItem {
            action_type: "move".into(),
            source_region_id: "A".into(),
            target_region_id: "B".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 5,
            ticks_remaining: 3,
            travel_ticks: 3,
        }];

        let mut diplomacy = DiplomacyState::default();
        let (remaining, _events) = engine.process_transit_queue_with_shield(
            &mut players, &mut regions, &transit_queue, &[], &mut diplomacy, 1,
        );
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].ticks_remaining, 2);
        transit_queue = remaining;

        // Two more ticks to arrival
        for tick in 2..=3 {
            let (rem, _) = engine.process_transit_queue_with_shield(
                &mut players, &mut regions, &transit_queue, &[], &mut diplomacy, tick,
            );
            transit_queue = rem;
        }
        assert!(transit_queue.is_empty(), "After 3 total ticks queue should be empty");
    }

    // -------------------------------------------------------------------------
    // 9. Active effects — tick-down and expiry
    // -------------------------------------------------------------------------

    #[test]
    fn test_active_effect_ticks_down() {
        let (engine, mut regions, _) = make_linear_engine();
        let mut active_effects = vec![ActiveEffect {
            effect_type: "ab_shield".into(),
            source_player_id: "p1".into(),
            target_region_id: "A".into(),
            affected_region_ids: vec![],
            ticks_remaining: 3,
            total_ticks: 3,
            params: serde_json::json!({}),
        }];

        engine.process_active_effects(&mut regions, &mut active_effects);
        assert_eq!(active_effects.len(), 1);
        assert_eq!(active_effects[0].ticks_remaining, 2);
    }

    #[test]
    fn test_active_effect_expires_and_emits_event() {
        let (engine, mut regions, _) = make_linear_engine();
        let mut active_effects = vec![ActiveEffect {
            effect_type: "ab_shield".into(),
            source_player_id: "p1".into(),
            target_region_id: "A".into(),
            affected_region_ids: vec![],
            ticks_remaining: 1,
            total_ticks: 3,
            params: serde_json::json!({}),
        }];

        let events = engine.process_active_effects(&mut regions, &mut active_effects);
        assert!(active_effects.is_empty(), "Expired effect should be removed");
        assert!(has_event(&events, |e| matches!(e, Event::AbilityEffectExpired {
            effect_type, target_region_id
        } if effect_type == "ab_shield" && target_region_id == "A")));
    }

    #[test]
    fn test_multiple_active_effects_only_expired_removed() {
        let (engine, mut regions, _) = make_linear_engine();
        let mut active_effects = vec![
            ActiveEffect {
                effect_type: "ab_shield".into(),
                source_player_id: "p1".into(),
                target_region_id: "A".into(),
                affected_region_ids: vec![],
                ticks_remaining: 1, // expires this tick
                total_ticks: 3,
                params: serde_json::json!({}),
            },
            ActiveEffect {
                effect_type: "ab_shield".into(),
                source_player_id: "p1".into(),
                target_region_id: "B".into(),
                affected_region_ids: vec![],
                ticks_remaining: 5, // still alive
                total_ticks: 5,
                params: serde_json::json!({}),
            },
        ];

        engine.process_active_effects(&mut regions, &mut active_effects);
        assert_eq!(active_effects.len(), 1, "Only B's shield should remain");
        assert_eq!(active_effects[0].target_region_id, "B");
        assert_eq!(active_effects[0].ticks_remaining, 4);
    }

    #[test]
    fn test_nuke_effect_applies_damage_on_expiry() {
        let (engine, mut regions, _) = make_linear_engine();
        // Place 100 infantry in C (owned by p2)
        regions.get_mut("C").unwrap().units.insert("infantry".into(), 100);
        regions.get_mut("C").unwrap().unit_count = 100;

        let mut active_effects = vec![ActiveEffect {
            effect_type: "ab_province_nuke".into(),
            source_player_id: "p1".into(),
            target_region_id: "C".into(),
            affected_region_ids: vec![],
            ticks_remaining: 1,
            total_ticks: 8,
            params: serde_json::json!({ "damage": 100 }), // 100% kill
        }];

        engine.process_active_effects(&mut regions, &mut active_effects);

        // At 100 damage, 100% of units killed (but capital keeps 1 — C is not capital so can go to 0)
        let remaining = regions["C"].units.get("infantry").copied().unwrap_or(0);
        assert!(remaining < 100, "Nuke should kill units; remaining: {}", remaining);
        assert!(active_effects.is_empty());
    }

    #[test]
    fn test_shield_blocks_attack() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let active_effects = vec![ActiveEffect {
            effect_type: "ab_shield".into(),
            source_player_id: "p2".into(),
            target_region_id: "C".into(),
            affected_region_ids: vec![],
            ticks_remaining: 5,
            total_ticks: 5,
            params: serde_json::json!({}),
        }];

        // Deploy units from A to B first, then attack C from transit queue
        let transit_queue = vec![TransitQueueItem {
            action_type: "attack".into(),
            source_region_id: "B".into(),
            target_region_id: "C".into(),
            player_id: "p1".into(),
            unit_type: "infantry".into(),
            units: 10,
            ticks_remaining: 1,
            travel_ticks: 1,
        }];

        let mut diplomacy = DiplomacyState::default();
        let (remaining, events) = engine.process_transit_queue_with_shield(
            &mut players, &mut regions, &transit_queue, &active_effects, &mut diplomacy, 1,
        );

        assert!(remaining.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ShieldBlocked { target_region_id, .. }
            if target_region_id == "C")),
            "Attack should be blocked by shield");
        // Units should be returned to source
        assert_eq!(regions["C"].owner_id.as_deref(), Some("p2"), "C should still belong to p2");
    }

    // -------------------------------------------------------------------------
    // 10. Player elimination via capital loss
    // -------------------------------------------------------------------------

    #[test]
    fn test_player_eliminated_when_capital_lost() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Set C as p2's capital
        regions.get_mut("C").unwrap().is_capital = true;
        players.get_mut("p2").unwrap().capital_region_id = Some("C".into());

        // Simulate p1 capturing C
        regions.get_mut("C").unwrap().owner_id = Some("p1".into());

        let mut air_transit_queue = vec![];
        let events = engine.check_conditions(&mut players, &mut regions, &mut air_transit_queue);

        assert!(has_event(&events, |e| matches!(e, Event::PlayerEliminated { player_id, .. }
            if player_id == "p2")),
            "p2 should be eliminated after capital lost");
        assert!(!players["p2"].is_alive);
        assert_eq!(players["p2"].eliminated_reason.as_deref(), Some("capital_lost"));
    }

    #[test]
    fn test_eliminated_player_regions_are_cleared() {
        let (engine, mut regions, mut players) = make_linear_engine();
        regions.get_mut("C").unwrap().is_capital = true;
        players.get_mut("p2").unwrap().capital_region_id = Some("C".into());
        regions.get_mut("C").unwrap().owner_id = Some("p1".into());

        let mut air_transit_queue = vec![];
        engine.check_conditions(&mut players, &mut regions, &mut air_transit_queue);

        // D was owned by p2; should now be unowned and empty
        let region_d = &regions["D"];
        assert!(region_d.owner_id.is_none(), "D should be unowned after p2 eliminated");
        assert!(region_d.units.is_empty(), "D's units should be cleared");
        assert_eq!(region_d.unit_count, 0);
    }

    #[test]
    fn test_alive_players_not_eliminated_without_capital_loss() {
        let (engine, mut regions, mut players) = make_linear_engine();
        players.get_mut("p1").unwrap().capital_region_id = Some("A".into());
        regions.get_mut("A").unwrap().is_capital = true;
        // A still owned by p1

        let mut air_transit_queue = vec![];
        let events = engine.check_conditions(&mut players, &mut regions, &mut air_transit_queue);

        assert!(!has_event(&events, |e| matches!(e, Event::PlayerEliminated { .. })));
        assert!(players["p1"].is_alive);
    }

    #[test]
    fn test_game_over_when_one_player_remains() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Eliminate p2 by capturing their capital
        regions.get_mut("C").unwrap().is_capital = true;
        players.get_mut("p2").unwrap().capital_region_id = Some("C".into());
        regions.get_mut("C").unwrap().owner_id = Some("p1".into());

        let mut air_transit_queue = vec![];
        let events = engine.check_conditions(&mut players, &mut regions, &mut air_transit_queue);

        assert!(has_event(&events, |e| matches!(e, Event::GameOver { winner_id: Some(w) }
            if w == "p1")),
            "GameOver should be emitted with p1 as winner");
    }

    // -------------------------------------------------------------------------
    // 11. Full process_tick integration
    // -------------------------------------------------------------------------

    #[test]
    fn test_process_tick_no_actions_returns_no_elimination_events() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];
        let mut air_transit_queue = vec![];
        let mut active_effects = vec![];

        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_tick(
            &mut players,
            &mut regions,
            &[],
            &mut buildings_queue,
            &mut unit_queue,
            &mut transit_queue,
            &mut air_transit_queue,
            1,
            &mut active_effects,
            &mut diplomacy,
        );

        assert!(!has_event(&events, |e| matches!(e, Event::PlayerEliminated { .. })));
    }

    #[test]
    fn test_process_tick_building_completes_in_tick() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![BuildingQueueItem {
            region_id: "A".into(),
            building_type: "barracks".into(),
            player_id: "p1".into(),
            ticks_remaining: 1,
            total_ticks: 5,
            is_upgrade: false,
            target_level: 0,
        }];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];
        let mut air_transit_queue = vec![];
        let mut active_effects = vec![];

        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_tick(
            &mut players, &mut regions, &[],
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, 1, &mut active_effects, &mut diplomacy,
        );

        assert!(buildings_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::BuildingComplete { .. })));
        assert_eq!(GameEngine::count_buildings(&regions["A"].building_instances, "barracks"), 1);
    }

    #[test]
    fn test_process_tick_with_attack_action_creates_transit() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];
        let mut active_effects = vec![];

        // Change B to p2 so p1 can attack it
        regions.get_mut("B").unwrap().owner_id = Some("p2".into());

        let actions = vec![Action {
            action_type: "attack".into(),
            player_id: Some("p1".into()),
            source_region_id: Some("A".into()),
            target_region_id: Some("B".into()),
            units: Some(5),
            ..Default::default()
        }];

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_tick(
            &mut players, &mut regions, &actions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, 1, &mut active_effects, &mut diplomacy,
        );

        assert_eq!(transit_queue.len(), 1);
        assert!(has_event(&events, |e| matches!(e, Event::TroopsSent { .. })));
    }

    // -------------------------------------------------------------------------
    // 12. Building upgrade
    // -------------------------------------------------------------------------

    #[test]
    fn test_upgrade_building_queue_completes_bumps_level() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // Pre-place a level-1 barracks
        regions.get_mut("A").unwrap().building_instances.push(
            BuildingInstance { building_type: "barracks".into(), level: 1 }
        );
        // Set player deck max level = 3 so upgrade is allowed
        players.get_mut("p1").unwrap().building_levels.insert("barracks".into(), 3);

        let buildings_queue = vec![BuildingQueueItem {
            region_id: "A".into(),
            building_type: "barracks".into(),
            player_id: "p1".into(),
            ticks_remaining: 1,
            total_ticks: 10,
            is_upgrade: true,
            target_level: 2,
        }];

        let (remaining, events) = engine.process_buildings(&mut players, &mut regions, &buildings_queue);
        assert!(remaining.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::BuildingUpgraded {
            region_id, building_type, new_level, ..
        } if region_id == "A" && building_type == "barracks" && *new_level == 2)));

        let inst = GameEngine::get_building_instance(&regions["A"].building_instances, "barracks", 0);
        assert_eq!(inst.unwrap().level, 2);
    }

    #[test]
    fn test_upgrade_action_rejected_without_existing_building() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // No barracks exists
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "upgrade_building".into(),
            player_id: Some("p1".into()),
            region_id: Some("A".into()),
            building_type: Some("barracks".into()),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
        assert!(buildings_queue.is_empty());
    }

    // -------------------------------------------------------------------------
    // 13. process_tick sync — unit_count updated at end of tick
    // -------------------------------------------------------------------------

    #[test]
    fn test_unit_count_synced_after_tick() {
        let (engine, mut regions, mut players) = make_linear_engine();
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];
        let mut active_effects = vec![];

        // Manually corrupt unit_count to verify it gets resynced
        regions.get_mut("A").unwrap().unit_count = 999;

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        engine.process_tick(
            &mut players, &mut regions, &[],
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, 1, &mut active_effects, &mut diplomacy,
        );

        // After tick, unit_count should reflect actual units in the map
        let actual_infantry = regions["A"].units.get("infantry").copied().unwrap_or(0);
        // unit_count should no longer be 999
        assert_ne!(regions["A"].unit_count, 999,
            "unit_count should be resynced; infantry in map = {}", actual_infantry);
    }

    // -------------------------------------------------------------------------
    // 14. Move rejection — target not owned by same player
    // -------------------------------------------------------------------------

    #[test]
    fn test_move_action_rejected_when_target_not_owned() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // C is owned by p2; p1 cannot move there
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "move".into(),
            player_id: Some("p1".into()),
            source_region_id: Some("B".into()),
            target_region_id: Some("C".into()),
            units: Some(5),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );

        assert!(transit_queue.is_empty());
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }

    // -------------------------------------------------------------------------
    // 15. Attack out-of-range rejection
    // -------------------------------------------------------------------------

    #[test]
    fn test_attack_action_rejected_out_of_range() {
        let (engine, mut regions, mut players) = make_linear_engine();
        // infantry has attack_range=1; A to C is 2 hops — should be out of range
        // A→B→C, infantry range 1, so A can only reach B directly
        regions.get_mut("B").unwrap().owner_id = Some("p2".into()); // B is enemy so BFS can't pass through
        let mut buildings_queue = vec![];
        let mut unit_queue = vec![];
        let mut transit_queue = vec![];

        let action = Action {
            action_type: "attack".into(),
            player_id: Some("p1".into()),
            source_region_id: Some("A".into()),
            target_region_id: Some("C".into()),
            units: Some(5),
            ..Default::default()
        };

        let mut air_transit_queue = vec![];
        let mut diplomacy = DiplomacyState::default();
        let events = engine.process_action(
            &action, &mut players, &mut regions,
            &mut buildings_queue, &mut unit_queue, &mut transit_queue,
            &mut air_transit_queue, &mut diplomacy, 1,
        );
        assert!(transit_queue.is_empty(), "Should not create transit for out-of-range attack");
        assert!(has_event(&events, |e| matches!(e, Event::ActionRejected { .. })));
    }
}
