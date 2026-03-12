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
    ) -> Vec<Event> {
        let mut events = Vec::new();

        events.extend(self.generate_currency(players, regions));
        events.extend(self.generate_units(regions));

        let (remaining_buildings, build_events) = self.process_buildings(regions, buildings_queue);
        *buildings_queue = remaining_buildings;
        events.extend(build_events);

        let (remaining_units, unit_events) = self.process_unit_queue(regions, unit_queue);
        *unit_queue = remaining_units;
        events.extend(unit_events);

        let (remaining_transit, transit_events) =
            self.process_transit_queue(players, regions, transit_queue);
        *transit_queue = remaining_transit;
        events.extend(transit_events);

        for action in actions {
            events.extend(self.process_action(
                action,
                players,
                regions,
                buildings_queue,
                unit_queue,
                transit_queue,
            ));
        }

        events.extend(self.check_conditions(players, regions));

        // Sync unit_count for all regions to reflect changes from generation, combat, etc.
        for region in regions.values_mut() {
            sync_region_unit_meta(region, self);
        }

        events
    }

    // --- Currency generation ---

    fn generate_currency(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &HashMap<String, Region>,
    ) -> Vec<Event> {
        let base_currency = self.settings.base_currency_per_tick;
        let region_currency = self.settings.region_currency_per_tick;

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
                regions.iter().map(|r| r.currency_generation_bonus).sum()
            });
            let income = base_currency + region_count as f64 * region_currency + passive_bonus;
            player.currency_accum += income;
            let whole = player.currency_accum as i64;
            if whole > 0 {
                player.currency += whole;
                player.currency_accum -= whole as f64;
            }
        }

        Vec::new()
    }

    // --- Unit generation ---

    fn generate_units(&self, regions: &mut HashMap<String, Region>) -> Vec<Event> {
        let base_rate = self.settings.base_unit_generation_rate;
        let capital_bonus = self.settings.capital_generation_bonus;
        let default_unit_type = self.default_unit_type_slug();

        // ── Phase 1: compute per-rate-group canonical accumulator ──
        // Group regions by (owner, effective rate) so that regions with the
        // same generation rate stay synchronised — they all tick up together
        // instead of drifting apart when newly-acquired regions start at 0.
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

            // Quantise rate to fixed-point key (avoids f64 hashing issues)
            let rate_key = (rate * 10000.0).round() as u64;
            let group_key = (owner, rate_key);

            // Use the highest accumulator in the group as the canonical value
            // so newly-acquired regions catch up to existing ones immediately.
            let entry = rate_group_accum.entry(group_key).or_insert(0.0_f64);
            if region.unit_accum > *entry {
                *entry = region.unit_accum;
            }

            region_rates.push((rid.clone(), rate));
        }

        // ── Phase 2: advance canonical accumulators ──
        for ((_owner, _rate_key), accum) in rate_group_accum.iter_mut() {
            // Recover rate from the quantised key
            let rate = *_rate_key as f64 / 10000.0;
            *accum += rate;
        }

        // ── Phase 3: distribute whole units, sync accumulators ──
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

            // Sync this region's accumulator to the group value
            region.unit_accum = canonical;
            let whole = region.unit_accum as i64;
            if whole > 0 {
                add_units(region, &default_unit_type, whole);
                region.unit_accum -= whole as f64;
            }
        }

        // Write back normalised accumulators so the group stays synced
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
                // All regions in the group should have the same remainder
                let remainder = *canonical - (*canonical as i64) as f64;
                region.unit_accum = remainder;
            }
        }

        Vec::new()
    }

    // --- Building queue ---

    fn process_buildings(
        &self,
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

            let count = region
                .buildings
                .entry(building.building_type.clone())
                .or_insert(0);
            *count += 1;
            let building_count = *count;
            self.recompute_region_building_stats(region);

            events.push(Event::BuildingComplete {
                region_id: building.region_id.clone(),
                building_type: building.building_type.clone(),
                player_id: building.player_id.clone(),
                building_count,
            });
        }

        (remaining, events)
    }

    // --- Unit production queue ---

    fn process_unit_queue(
        &self,
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

            add_units(region, &item.unit_type, item.quantity.unwrap_or(1));
            events.push(Event::UnitProductionComplete {
                region_id: item.region_id.clone(),
                unit_type: item.unit_type.clone(),
                player_id: item.player_id.clone(),
                quantity: item.quantity.unwrap_or(1),
            });
        }

        (remaining, events)
    }

    // --- Transit queue ---

    fn process_transit_queue(
        &self,
        players: &mut HashMap<String, Player>,
        regions: &mut HashMap<String, Region>,
        transit_queue: &[TransitQueueItem],
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
                "attack" => events.extend(self.resolve_attack_arrival(&item, players, regions)),
                _ => {}
            }
        }

        (remaining, events)
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

        if config.requires_coastal && !region.is_coastal {
            return vec![reject_action(
                player_id,
                "Ten budynek mozna postawic tylko w regionie przybrzeznym",
                action,
            )];
        }

        let current_count = region.buildings.get(building_type).copied().unwrap_or(0);
        let queued_count = buildings_queue
            .iter()
            .filter(|q| q.region_id == *region_id && q.building_type == *building_type)
            .count() as i64;
        if current_count + queued_count >= config.max_per_region as i64 {
            return vec![reject_action(
                player_id,
                "Osiagnieto limit tego budynku w regionie",
                action,
            )];
        }

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

        let currency_cost = config.currency_cost;
        if player.currency < currency_cost {
            return vec![reject_action(
                player_id,
                "Za malo waluty na budowe",
                action,
            )];
        }

        player.currency -= currency_cost;
        let build_time = config.build_time_ticks;

        buildings_queue.push(BuildingQueueItem {
            region_id: region_id.clone(),
            building_type: building_type.clone(),
            player_id: player_id.clone(),
            ticks_remaining: build_time as i64,
            total_ticks: build_time as i64,
        });

        vec![Event::BuildStarted {
            region_id: region_id.clone(),
            building_type: building_type.clone(),
            player_id: player_id.clone(),
            ticks_remaining: build_time as i64,
            currency_cost,
        }]
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

        let production_cost = unit_config.production_cost as i64;
        if player.currency < production_cost {
            return vec![reject_action(
                player_id,
                "Za malo waluty na produkcje jednostki",
                action,
            )];
        }

        let manpower_cost = unit_config.manpower_cost.max(1) as i64;
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

        player.currency -= production_cost;
        let production_time = unit_config.production_time_ticks.max(1) as i64;

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
            currency_cost: production_cost,
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

        if !can_station_unit(target, &item.unit_type, self) {
            if let Some(source) = regions.get_mut(&item.source_region_id) {
                receive_units_in_region(source, &item.unit_type, item.units, self);
            }
            return vec![Event::ActionRejected {
                player_id: item.player_id.clone(),
                message: "Ten region nie moze przyjac tego typu jednostki".into(),
                action_type: Some("move".into()),
                source_region_id: Some(item.source_region_id.clone()),
                target_region_id: Some(item.target_region_id.clone()),
                region_id: None,
                building_type: None,
                unit_type: Some(item.unit_type.clone()),
            }];
        }

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
        _players: &mut HashMap<String, Player>,
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
        let defender_bonus = self.settings.defender_advantage;
        let defense_building = target.defense_bonus;
        let randomness = self.settings.combat_randomness;

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

            let old_owner = target.owner_id.clone();
            let target = regions.get_mut(&item.target_region_id).unwrap();
            target.owner_id = Some(item.player_id.clone());
            target.units.clear();
            receive_units_in_region(target, &item.unit_type, surviving, self);

            events.push(Event::AttackSuccess {
                source_region_id: item.source_region_id.clone(),
                target_region_id: item.target_region_id.clone(),
                player_id: item.player_id.clone(),
                units: item.units,
                unit_type: item.unit_type.clone(),
                old_owner_id: old_owner.clone(),
                surviving_units: surviving,
            });

            let target = regions.get_mut(&item.target_region_id).unwrap();
            if target.is_capital && old_owner.is_some() {
                target.is_capital = false;
                events.push(Event::CapitalCaptured {
                    region_id: item.target_region_id.clone(),
                    captured_by: item.player_id.clone(),
                    lost_by: old_owner.unwrap(),
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
                    region.building_type = None;
                    region.defense_bonus = 0.0;
                    region.vision_range = 0;
                    region.unit_generation_bonus = 0.0;
                    region.currency_generation_bonus = 0.0;
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

    // --- Helper methods ---

    fn recompute_region_building_stats(&self, region: &mut Region) {
        let mut defense_bonus = 0.0;
        let mut vision_range = 0;
        let mut unit_generation_bonus = 0.0;
        let mut currency_generation_bonus = 0.0;
        let mut primary_slug: Option<String> = None;
        let mut primary_order: i64 = i64::MAX;

        for (slug, raw_count) in &region.buildings {
            let count = *raw_count;
            if count <= 0 {
                continue;
            }
            if let Some(config) = self.settings.building_types.get(slug) {
                defense_bonus += config.defense_bonus * count as f64;
                vision_range += config.vision_range as i64 * count;
                unit_generation_bonus += config.unit_generation_bonus * count as f64;
                currency_generation_bonus += config.currency_generation_bonus * count as f64;
                let order = config.order as i64;
                if primary_slug.is_none() || order < primary_order {
                    primary_slug = Some(slug.clone());
                    primary_order = order;
                }
            }
        }

        region.building_type = primary_slug;
        region.defense_bonus = defense_bonus;
        region.vision_range = vision_range;
        region.unit_generation_bonus = unit_generation_bonus;
        region.currency_generation_bonus = currency_generation_bonus;
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
    }
    region.units = normalized;
}

fn can_station_unit(region: &Region, unit_type: &str, engine: &GameEngine) -> bool {
    let config = engine.get_unit_config(unit_type);
    if config.movement_type == "sea" && !region.is_coastal {
        return false;
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
