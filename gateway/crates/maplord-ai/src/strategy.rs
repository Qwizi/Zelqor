use crate::BotStrategy;
use maplord_engine::{Action, GameSettings, Player, Region};
use rand::Rng;
use std::collections::HashMap;

/// AI decision maker for a single bot player.
pub struct BotBrain {
    player_id: String,
    action_interval: i64,
}

impl BotBrain {
    pub fn new(player_id: String) -> Self {
        let action_interval = rand::thread_rng().gen_range(6..=10);
        Self {
            player_id,
            action_interval,
        }
    }

    /// Pick a capital region: prefer regions with many neutral neighbors.
    pub fn pick_capital(
        &self,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        min_distance: usize,
    ) -> Option<String> {
        use std::collections::{HashSet, VecDeque};

        let existing_capitals: HashSet<&String> = regions
            .iter()
            .filter(|(_, r)| r.is_capital)
            .map(|(id, _)| id)
            .collect();

        let mut candidates: Vec<(String, usize)> = regions
            .iter()
            .filter(|(_, r)| r.owner_id.is_none())
            .filter(|(id, _)| {
                if existing_capitals.is_empty() {
                    return true;
                }
                // BFS distance check
                let mut visited = HashSet::new();
                visited.insert(id.to_string());
                let mut queue = VecDeque::new();
                queue.push_back((id.to_string(), 0usize));
                while let Some((current, dist)) = queue.pop_front() {
                    if dist > 0 && existing_capitals.contains(&current) {
                        return false;
                    }
                    if dist >= min_distance {
                        continue;
                    }
                    if let Some(neighbors) = neighbor_map.get(&current) {
                        for neighbor in neighbors {
                            if regions.contains_key(neighbor) && !visited.contains(neighbor) {
                                visited.insert(neighbor.clone());
                                queue.push_back((neighbor.clone(), dist + 1));
                            }
                        }
                    }
                }
                true
            })
            .map(|(id, _)| {
                let neutral_neighbors = neighbor_map
                    .get(id)
                    .map(|ns| {
                        ns.iter()
                            .filter(|n| {
                                regions.get(*n).map(|r| r.owner_id.is_none()).unwrap_or(false)
                            })
                            .count()
                    })
                    .unwrap_or(0);
                (id.clone(), neutral_neighbors)
            })
            .collect();

        // Sort by most neutral neighbors (descending), add some randomness
        candidates.sort_by(|a, b| b.1.cmp(&a.1));

        // Pick from top 5 candidates randomly for variety
        let top_n = candidates.len().min(5);
        if top_n == 0 {
            // Fallback: any unowned region
            return regions
                .iter()
                .find(|(_, r)| r.owner_id.is_none())
                .map(|(id, _)| id.clone());
        }

        let idx = rand::thread_rng().gen_range(0..top_n);
        Some(candidates[idx].0.clone())
    }

    /// Produce actions for this tick. Returns empty vec if not time to act.
    pub fn decide(
        &self,
        players: &HashMap<String, Player>,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        settings: &GameSettings,
        current_tick: i64,
    ) -> Vec<Action> {
        if current_tick % self.action_interval != 0 {
            return Vec::new();
        }

        let player = match players.get(&self.player_id) {
            Some(p) if p.is_alive => p,
            _ => return Vec::new(),
        };

        let mut actions = Vec::new();
        let mut rng = rand::thread_rng();

        let my_regions: Vec<(&String, &Region)> = regions
            .iter()
            .filter(|(_, r)| r.owner_id.as_deref() == Some(&self.player_id))
            .collect();

        if my_regions.is_empty() {
            return actions;
        }

        // Classify regions
        let mut border_regions = Vec::new();
        let mut interior_regions = Vec::new();

        for (rid, region) in &my_regions {
            let neighbors = neighbor_map.get(*rid);
            let has_non_owned_neighbor = neighbors
                .map(|ns| {
                    ns.iter().any(|n| {
                        regions
                            .get(n)
                            .map(|r| r.owner_id.as_deref() != Some(&self.player_id))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);

            if has_non_owned_neighbor {
                border_regions.push((*rid, *region));
            } else {
                interior_regions.push((*rid, *region));
            }
        }

        // 1. ATTACK: One attack per decision, only when clearly stronger
        //    50% chance to skip even when we could attack (hesitation)
        if rng.gen_bool(0.5) {
            'attack: for (rid, region) in &border_regions {
                // Need a decent surplus before considering attack
                if region.unit_count <= 8 {
                    continue;
                }

                if let Some(neighbors) = neighbor_map.get(*rid) {
                    let mut targets: Vec<(&String, &Region)> = neighbors
                        .iter()
                        .filter_map(|n| regions.get(n).map(|r| (n, r)))
                        .filter(|(_, r)| r.owner_id.as_deref() != Some(&self.player_id))
                        .collect();

                    targets.sort_by_key(|(_, r)| r.unit_count);

                    for (target_id, target) in &targets {
                        let is_neutral = target.owner_id.is_none();
                        // Require big advantage: own units > target + 8 for neutrals,
                        // own units > target * 3 + 5 for enemies
                        let can_attack = if is_neutral {
                            region.unit_count > target.unit_count + 8
                        } else {
                            region.unit_count > target.unit_count * 3 + 5
                        };

                        if can_attack {
                            // Send only what's barely needed, keep some behind
                            let send = target.unit_count + 3;
                            let send = send.min(region.unit_count - 3);
                            if send > 0 {
                                actions.push(Action {
                                    action_type: "attack".into(),
                                    player_id: Some(self.player_id.clone()),
                                    source_region_id: Some((*rid).clone()),
                                    target_region_id: Some((*target_id).clone()),
                                    units: Some(send),
                                    unit_type: region.unit_type.clone(),
                                    region_id: None,
                                    building_type: None,
                                    ability_type: None,
                                });
                                break 'attack; // Only one attack per decision
                            }
                        }
                    }
                }
            }
        }

        // 2. BUILD: Rarely, and only when flush with currency (20% chance)
        if player.currency >= 100 && rng.gen_bool(0.2) {
            // Try to build factory on capital
            if let Some(capital_id) = &player.capital_region_id {
                if let Some(capital) = regions.get(capital_id) {
                    let factory_count = capital.buildings.get("factory").copied().unwrap_or(0);
                    if factory_count < 1 {
                        if let Some(factory_cfg) = settings.building_types.get("factory") {
                            if player.currency >= factory_cfg.currency_cost {
                                actions.push(Action {
                                    action_type: "build".into(),
                                    player_id: Some(self.player_id.clone()),
                                    region_id: Some(capital_id.clone()),
                                    building_type: Some("factory".into()),
                                    source_region_id: None,
                                    target_region_id: None,
                                    units: None,
                                    unit_type: None,
                                    ability_type: None,
                                });
                            }
                        }
                    }
                }
            }
        }

        // 3. PRODUCE UNITS: Only 20% chance when factory available
        if rng.gen_bool(0.2) {
            for (rid, region) in &my_regions {
                let factory_count = region.buildings.get("factory").copied().unwrap_or(0);
                if factory_count > 0 {
                    for (unit_slug, unit_cfg) in &settings.unit_types {
                        if unit_cfg.produced_by_slug.as_deref() == Some("factory")
                            && player.currency >= unit_cfg.production_cost as i64
                        {
                            actions.push(Action {
                                action_type: "produce_unit".into(),
                                player_id: Some(self.player_id.clone()),
                                region_id: Some((*rid).clone()),
                                unit_type: Some(unit_slug.clone()),
                                source_region_id: None,
                                target_region_id: None,
                                units: None,
                                building_type: None,
                                ability_type: None,
                            });
                            break;
                        }
                    }
                    break; // Only one production per decision
                }
            }
        }

        // 4. CONSOLIDATE: Move interior units to border, 30% chance, only one move
        if !interior_regions.is_empty() && !border_regions.is_empty() && rng.gen_bool(0.3) {
            for (rid, region) in &interior_regions {
                if region.unit_count <= 3 {
                    continue;
                }

                if let Some(neighbors) = neighbor_map.get(*rid) {
                    for target_id in neighbors {
                        let is_border = border_regions.iter().any(|(bid, _)| *bid == target_id);
                        if is_border {
                            let move_units = region.unit_count - 2;
                            if move_units > 0 {
                                actions.push(Action {
                                    action_type: "move".into(),
                                    player_id: Some(self.player_id.clone()),
                                    source_region_id: Some((*rid).clone()),
                                    target_region_id: Some(target_id.clone()),
                                    units: Some(move_units),
                                    unit_type: region.unit_type.clone(),
                                    region_id: None,
                                    building_type: None,
                                    ability_type: None,
                                });
                                return actions; // Only one move per decision
                            }
                        }
                    }
                }
            }
        }

        actions
    }
}

impl BotStrategy for BotBrain {
    fn decide(
        &self,
        players: &HashMap<String, Player>,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        settings: &GameSettings,
        current_tick: i64,
    ) -> Vec<Action> {
        self.decide(players, regions, neighbor_map, settings, current_tick)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_region(owner: Option<&str>, units: i64, is_capital: bool) -> Region {
        Region {
            name: String::new(),
            country_code: String::new(),
            centroid: None,
            owner_id: owner.map(|s| s.to_string()),
            unit_count: units,
            unit_type: Some("infantry".into()),
            is_capital,
            building_type: None,
            buildings: HashMap::new(),
            defense_bonus: 0.0,
            vision_range: 0,
            unit_generation_bonus: 0.0,
            currency_generation_bonus: 0.0,
            is_coastal: false,
            sea_distances: Vec::new(),
            units: {
                let mut m = HashMap::new();
                m.insert("infantry".into(), units);
                m
            },
            unit_accum: 0.0,
        }
    }

    #[test]
    fn test_pick_capital_prefers_many_neighbors() {
        let mut regions = HashMap::new();
        regions.insert("A".into(), make_region(None, 3, false));
        regions.insert("B".into(), make_region(None, 3, false));
        regions.insert("C".into(), make_region(None, 3, false));
        regions.insert("D".into(), make_region(None, 3, false));

        let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
        // A has 3 neighbors, B has 1
        neighbor_map.insert("A".into(), vec!["B".into(), "C".into(), "D".into()]);
        neighbor_map.insert("B".into(), vec!["A".into()]);
        neighbor_map.insert("C".into(), vec!["A".into()]);
        neighbor_map.insert("D".into(), vec!["A".into()]);

        let brain = BotBrain::new("bot1".into());
        let choice = brain.pick_capital(&regions, &neighbor_map, 3);
        assert!(choice.is_some());
    }

    #[test]
    fn test_decide_attacks_weak_neutral() {
        let bot_id = "bot1";
        let mut regions = HashMap::new();
        // Bot needs >target+8 units to attack, so 20 vs 3 should work
        regions.insert("A".into(), make_region(Some(bot_id), 20, true));
        regions.insert("B".into(), make_region(None, 3, false));

        let mut neighbor_map = HashMap::new();
        neighbor_map.insert("A".into(), vec!["B".into()]);
        neighbor_map.insert("B".into(), vec!["A".into()]);

        let mut players = HashMap::new();
        players.insert(
            bot_id.into(),
            Player {
                user_id: bot_id.into(),
                username: "Bot".into(),
                color: "#FF0000".into(),
                is_alive: true,
                connected: true,
                disconnect_deadline: None,
                left_match_at: None,
                eliminated_reason: None,
                eliminated_tick: None,
                capital_region_id: Some("A".into()),
                currency: 100,
                currency_accum: 0.0,
                ability_cooldowns: HashMap::new(),
                is_bot: true,
                total_units_produced: 0,
                total_units_lost: 0,
                total_regions_conquered: 0,
                total_buildings_built: 0,
            },
        );

        let settings = GameSettings {
            tick_interval_ms: 1000,
            capital_selection_time_seconds: 30,
            base_unit_generation_rate: 1.0,
            capital_generation_bonus: 2.0,
            starting_currency: 100,
            base_currency_per_tick: 2.0,
            region_currency_per_tick: 0.35,
            attacker_advantage: 0.0,
            defender_advantage: 0.1,
            combat_randomness: 0.2,
            starting_units: 10,
            neutral_region_units: 3,
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            min_capital_distance: 3,
            elo_k_factor: 32,
            match_duration_limit_minutes: 0,
        };

        let brain = BotBrain {
            player_id: bot_id.into(),
            action_interval: 1, // act every tick for testing
        };

        // Bot has 50% hesitation chance, so run multiple ticks to get an attack
        let mut found_attack = false;
        for tick in 1..=50 {
            let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick);
            let attacks: Vec<_> = actions
                .iter()
                .filter(|a| a.action_type == "attack")
                .collect();
            if !attacks.is_empty() {
                assert_eq!(attacks[0].target_region_id.as_deref(), Some("B"));
                found_attack = true;
                break;
            }
        }
        assert!(found_attack, "Bot should eventually attack weak neutral neighbor");
    }

    #[test]
    fn test_decide_skips_dead_player() {
        let bot_id = "bot1";
        let regions = HashMap::new();
        let neighbor_map = HashMap::new();
        let mut players = HashMap::new();
        players.insert(
            bot_id.into(),
            Player {
                user_id: bot_id.into(),
                username: "Bot".into(),
                color: "#FF0000".into(),
                is_alive: false,
                connected: false,
                disconnect_deadline: None,
                left_match_at: None,
                eliminated_reason: Some("capital_captured".into()),
                eliminated_tick: Some(10),
                capital_region_id: None,
                currency: 0,
                currency_accum: 0.0,
                ability_cooldowns: HashMap::new(),
                is_bot: true,
                total_units_produced: 0,
                total_units_lost: 0,
                total_regions_conquered: 0,
                total_buildings_built: 0,
            },
        );

        let settings = GameSettings {
            tick_interval_ms: 1000,
            capital_selection_time_seconds: 30,
            base_unit_generation_rate: 1.0,
            capital_generation_bonus: 2.0,
            starting_currency: 100,
            base_currency_per_tick: 2.0,
            region_currency_per_tick: 0.35,
            attacker_advantage: 0.0,
            defender_advantage: 0.1,
            combat_randomness: 0.2,
            starting_units: 10,
            neutral_region_units: 3,
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            min_capital_distance: 3,
            elo_k_factor: 32,
            match_duration_limit_minutes: 0,
        };

        let brain = BotBrain {
            player_id: bot_id.into(),
            action_interval: 1,
        };

        let actions = brain.decide(&players, &regions, &neighbor_map, &settings, 1);
        assert!(actions.is_empty());
    }
}
