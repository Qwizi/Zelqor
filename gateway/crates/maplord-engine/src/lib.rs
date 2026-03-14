mod types;

pub use types::*;

use rand::Rng;
use std::collections::{HashMap, VecDeque};

const MAX_BUILD_QUEUE_PER_REGION: usize = 3;
const MAX_UNIT_QUEUE_PER_REGION: usize = 4;

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
    m
}

/// Pure game logic engine — no I/O, no state management.
pub struct GameEngine {
    pub settings: GameSettings,
    pub neighbor_map: HashMap<String, Vec<String>>,
    default_units: HashMap<String, UnitConfig>,
}

impl GameEngine {
    pub fn new(settings: GameSettings, neighbor_map: HashMap<String, Vec<String>>) -> Self {
        Self {
            settings,
            neighbor_map,
            default_units: default_unit_types(),
        }
    }

    pub fn process_tick(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        actions: &[Action],
        buildings_queue: &mut Vec<BuildingQueueItem>,
        unit_queue: &mut Vec<UnitQueueItem>,
        transit_queue: &mut Vec<TransitQueueItem>,
        current_tick: i64,
        active_effects: &mut Vec<ActiveEffect>,
    ) -> Vec<Event> {
        let mut events = Vec::new();

        // Process persistent effects (virus damage, etc.)
        events.extend(self.process_active_effects(regions, active_effects));

        events.extend(self.generate_energy(players, regions));
        events.extend(self.generate_units_with_effects(players, regions, active_effects));

        let (remaining_buildings, build_events) =
            self.process_buildings(players, regions, buildings_queue);
        *buildings_queue = remaining_buildings;
        events.extend(build_events);

        let (remaining_units, unit_events) = self.process_unit_queue(players, regions, unit_queue);
        *unit_queue = remaining_units;
        events.extend(unit_events);

        let (remaining_transit, transit_events) =
            self.process_transit_queue_with_shield(players, regions, transit_queue, active_effects);
        *transit_queue = remaining_transit;
        events.extend(transit_events);

        for action in actions {
            if action.action_type == "use_ability" {
                events.extend(self.process_ability(
                    action,
                    players,
                    regions,
                    current_tick,
                    active_effects,
                ));
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
                ));
            }
        }

        // Tick down in-match boosts and emit expiry events.
        events.extend(self.tick_match_boosts(players));

        events.extend(self.check_conditions(players, regions));

        // Sync unit_count for all regions to reflect changes from generation, combat, etc.
        for region in regions.values_mut() {
            sync_region_unit_meta(region, self);
        }

        events
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
                // Upgrade: advance the building level and recompute stats.
                region.building_levels.insert(
                    building.building_type.clone(),
                    building.target_level,
                );
                self.recompute_region_building_stats(region);

                events.push(Event::BuildingUpgraded {
                    region_id: building.region_id.clone(),
                    building_type: building.building_type.clone(),
                    player_id: building.player_id.clone(),
                    new_level: building.target_level,
                });
            } else {
                // New construction: increment count and initialise level to 1 if not set.
                let count = region
                    .buildings
                    .entry(building.building_type.clone())
                    .or_insert(0);
                *count += 1;
                let building_count = *count;
                region.building_levels
                    .entry(building.building_type.clone())
                    .or_insert(1);
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

        for (rid, region) in regions.iter() {
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
                        events.extend(self.resolve_attack_arrival(&item, players, regions));
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
            // Capital must keep at least 1 unit to prevent losing via nuke
            if is_capital && total_remaining == 0 {
                if let Some(unit_type) = region.units.keys().next().cloned() {
                    new_units.insert(unit_type, 1);
                }
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

            if active_effects[i].effect_type == "ab_virus" {
                let kill_percent = active_effects[i].params.get("unit_kill_percent")
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.05);

                let all_affected: Vec<String> = std::iter::once(active_effects[i].target_region_id.clone())
                    .chain(active_effects[i].affected_region_ids.clone())
                    .collect();

                for rid in &all_affected {
                    if let Some(region) = regions.get_mut(rid) {
                        let mut new_units: HashMap<String, i64> = HashMap::new();
                        for (unit_type, count) in &region.units {
                            let killed = (*count as f64 * kill_percent).ceil() as i64;
                            let remaining = (*count - killed).max(0);
                            if remaining > 0 {
                                new_units.insert(unit_type.clone(), remaining);
                            }
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
                let expired = active_effects.remove(i);

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
    ) -> Vec<Event> {
        match action.action_type.as_str() {
            "attack" => self.process_attack(action, players, regions, transit_queue),
            "move" => self.process_move(action, regions, transit_queue),
            "build" => self.process_build(action, players, regions, buildings_queue),
            "produce_unit" => self.process_unit_production(action, players, regions, unit_queue),
            _ => Vec::new(),
        }
    }

    fn process_attack(
        &self,
        action: &Action,
        _players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        transit_queue: &mut Vec<TransitQueueItem>,
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

        let unit_config = self.get_unit_config(&unit_type);
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

        vec![Event::TroopsSent {
            action_type: "attack".into(),
            source_region_id: source_id.clone(),
            target_region_id: target_id.clone(),
            player_id: player_id.clone(),
            units,
            unit_type,
            travel_ticks,
        }]
    }

    fn process_move(
        &self,
        action: &Action,
        regions: &mut HashMap<String, Region>,
        transit_queue: &mut Vec<TransitQueueItem>,
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

        let unit_type = action
            .unit_type
            .clone()
            .unwrap_or_else(|| get_region_unit_type(source, self));

        if units <= 0 || get_available_units(source, &unit_type, self) < units {
            return Vec::new();
        }

        if !can_station_unit(target, &unit_type, self) {
            return vec![reject_action(
                player_id,
                "Ten region nie moze przyjac tego typu jednostki",
                action,
            )];
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

        let current_count = region.buildings.get(building_type).copied().unwrap_or(0);
        let current_level = region.building_levels.get(building_type).copied().unwrap_or(1);
        let deck_max = player.building_levels.get(building_type).copied().unwrap_or(1);
        let config_max = config.max_level;
        let max_allowed_level = deck_max.min(config_max);

        // A queued upgrade for the same building type already in flight counts as a pending level change.
        let upgrade_queued = buildings_queue
            .iter()
            .any(|q| q.region_id == *region_id && q.building_type == *building_type && q.is_upgrade);

        // Determine whether this is an upgrade or a new build.
        let is_upgrade = current_count > 0
            && current_level < max_allowed_level
            && !upgrade_queued;

        let queued_new_count = buildings_queue
            .iter()
            .filter(|q| q.region_id == *region_id && q.building_type == *building_type && !q.is_upgrade)
            .count() as i64;
        let is_new_build = current_count == 0
            || (current_count + queued_new_count < config.max_per_region as i64);

        let total_region_queue = buildings_queue
            .iter()
            .filter(|q| q.region_id == *region_id)
            .count();
        if total_region_queue >= MAX_BUILD_QUEUE_PER_REGION {
            return vec![reject_action(
                player_id,
                "Region ma juz maksymalna liczbe budow w kolejce",
                action,
            )];
        }

        if is_upgrade {
            let next_level = current_level + 1;
            if next_level > max_allowed_level {
                return vec![reject_action(
                    player_id,
                    "Osiągnieto maksymalny poziom budynku",
                    action,
                )];
            }
            let upgrade_cost = get_level_stat_i64(&config.level_stats, next_level, "energy_cost")
                .unwrap_or(config.energy_cost * next_level);
            if player.energy < upgrade_cost {
                return vec![reject_action(
                    player_id,
                    "Za mało energii na ulepszenie",
                    action,
                )];
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
        } else if is_new_build {
            let energy_cost = get_level_stat_i64(&config.level_stats, 1, "energy_cost")
                .unwrap_or(config.energy_cost);
            if player.energy < energy_cost {
                return vec![reject_action(
                    player_id,
                    "Za malo waluty na budowe",
                    action,
                )];
            }

            player.energy -= energy_cost;
            let build_time = get_level_stat_i64(&config.level_stats, 1, "build_time_ticks")
                .unwrap_or(config.build_time_ticks);

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
        } else {
            vec![reject_action(
                player_id,
                "Osiagnieto limit tego budynku w regionie",
                action,
            )]
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

        if region.buildings.get(&produced_by_slug).copied().unwrap_or(0) < 1 {
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
        if total_region_queue >= MAX_UNIT_QUEUE_PER_REGION as i64 {
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

        // If target now belongs to attacker, just move units there
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
        let randomness = self.settings.combat_randomness;

        // Snapshot defending unit total and owner before any mutation.
        let defender_total_before: i64 = target.units.values().sum();
        let old_owner_id: Option<String> = target.owner_id.clone();

        let mut defender_bonus = self.settings.defender_advantage;
        // Apply in-match defense_bonus boosts for the defending player.
        if let Some(ref defender_player_id) = old_owner_id {
            if let Some(defender_player) = players.get(defender_player_id.as_str()) {
                for boost in &defender_player.active_match_boosts {
                    if boost.effect_type == "defense_bonus" {
                        defender_bonus += boost.value;
                    }
                }
            }
        }

        let attacker_attack = unit_config.attack;
        let unit_scale = self.get_unit_scale(&item.unit_type);
        let attacker_power =
            item.units as f64 * unit_scale as f64 * attacker_attack * (1.0 + attacker_bonus);
        let defender_power =
            self.get_region_defender_power(target, defender_bonus + defense_building);

        let mut rng = rand::thread_rng();
        let attacker_roll =
            attacker_power * (1.0 + rng.gen_range(-randomness..=randomness));
        let defender_roll =
            defender_power * (1.0 + rng.gen_range(-randomness..=randomness));

        if attacker_roll > defender_roll {
            let surviving_effective = (unit_scale as f64).max(
                (item.units as f64
                    * unit_scale as f64
                    * (1.0 - defender_power / attacker_power.max(1.0) * 0.5))
                    as f64,
            );
            let surviving =
                1i64.max((surviving_effective / unit_scale as f64).round() as i64);

            let target = regions.get_mut(&item.target_region_id).unwrap();
            target.owner_id = Some(item.player_id.clone());
            target.units.clear();
            receive_units_in_region(target, &item.unit_type, surviving, self);

            // Attacker: all defending units were wiped out; record losses for both sides.
            let attacker_lost = (item.units - surviving).max(0) as u32;
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
                (1.0 - attacker_power / defender_power.max(1.0) * 0.5).max(0.0);

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

        events
    }

    // --- Win condition ---

    fn check_conditions(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
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

        // Clear provinces owned by eliminated players
        for eliminated_id in &eliminated_ids {
            for region in regions.values_mut() {
                if region.owner_id.as_deref() == Some(eliminated_id) {
                    region.owner_id = None;
                    region.units.clear();
                    region.unit_count = 0;
                    region.unit_type = None;
                    region.is_capital = false;
                    region.buildings.clear();
                    region.building_levels.clear();
                    region.building_type = None;
                    region.defense_bonus = 0.0;
                    region.vision_range = 0;
                    region.unit_generation_bonus = 0.0;
                    region.energy_generation_bonus = 0.0;
                }
            }
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

    fn recompute_region_building_stats(&self, region: &mut Region) {
        region.defense_bonus = 0.0;
        region.vision_range = 0;
        region.unit_generation_bonus = 0.0;
        region.energy_generation_bonus = 0.0;

        let mut primary_slug: Option<String> = None;
        let mut primary_order: i64 = i64::MAX;

        for (slug, &count) in &region.buildings.clone() {
            if count <= 0 {
                continue;
            }
            let Some(config) = self.settings.building_types.get(slug) else { continue };
            let level = region.building_levels.get(slug).copied().unwrap_or(1);

            // Use level_stats if available; otherwise fall back to base config values.
            let defense = get_level_stat(&config.level_stats, level, "defense_bonus")
                .unwrap_or(config.defense_bonus);
            let vision = get_level_stat_i64(&config.level_stats, level, "vision_range")
                .unwrap_or(config.vision_range);
            let unit_gen = get_level_stat(&config.level_stats, level, "unit_generation_bonus")
                .unwrap_or(config.unit_generation_bonus);
            let energy_gen = get_level_stat(&config.level_stats, level, "energy_generation_bonus")
                .unwrap_or(config.energy_generation_bonus);

            region.defense_bonus += defense * count as f64;
            region.vision_range += vision * count;
            region.unit_generation_bonus += unit_gen * count as f64;
            region.energy_generation_bonus += energy_gen * count as f64;

            let order = config.order;
            if primary_slug.is_none() || order < primary_order {
                primary_slug = Some(slug.clone());
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

    fn get_region_defender_power(&self, region: &Region, defense_bonus: f64) -> f64 {
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
        if total > 0.0 {
            return total;
        }
        let fallback_config = self.get_unit_config(&get_region_unit_type(region, self));
        region.unit_count as f64 * fallback_config.defense * (1.0 + defense_bonus)
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
    if config.movement_type == "sea" && !region.is_coastal {
        return false;
    }
    // Special units require their production building to station;
    // without one they are dropped and their infantry backing remains.
    if let Some(ref produced_by) = config.produced_by_slug {
        let building_count = region.buildings.get(produced_by).copied().unwrap_or(0);
        if building_count <= 0 {
            return false;
        }
    }
    true
}

fn get_travel_ticks(distance: usize, unit_config: &UnitConfig) -> i64 {
    let speed = unit_config.speed.max(1) as i64;
    let dist = (distance.max(1)) as i64;
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
