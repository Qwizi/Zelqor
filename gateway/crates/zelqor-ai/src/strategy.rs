use crate::BotStrategy;
use zelqor_engine::{Action, DiplomacyState, GameSettings, Player, Region};
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
        diplomacy: &DiplomacyState,
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

        // ── DIPLOMACY DECISIONS ──────────────────────────────────────────────

        // A. Auto-accept NAP proposals (80% chance if not at war with proposer)
        for proposal in &diplomacy.proposals {
            if proposal.to_player_id == self.player_id
                && proposal.status == "pending"
                && proposal.proposal_type == "nap"
                && !diplomacy.are_at_war(&self.player_id, &proposal.from_player_id)
            {
                let accept = rng.gen_range(0..100) < 80;
                actions.push(Action {
                    action_type: "respond_pact".into(),
                    player_id: Some(self.player_id.clone()),
                    proposal_id: Some(proposal.id.clone()),
                    accept: Some(accept),
                    ..Default::default()
                });
            }
        }

        // B. Auto-respond to peace proposals
        for proposal in &diplomacy.proposals {
            if proposal.to_player_id == self.player_id
                && proposal.status == "pending"
                && proposal.proposal_type == "peace"
            {
                let my_regions_count = regions
                    .values()
                    .filter(|r| r.owner_id.as_deref() == Some(&self.player_id))
                    .count();
                let enemy_regions_count = regions
                    .values()
                    .filter(|r| r.owner_id.as_deref() == Some(proposal.from_player_id.as_str()))
                    .count();
                let accept = my_regions_count < enemy_regions_count
                    || (my_regions_count == enemy_regions_count && rng.gen_range(0..100) < 50);
                actions.push(Action {
                    action_type: "respond_peace".into(),
                    player_id: Some(self.player_id.clone()),
                    proposal_id: Some(proposal.id.clone()),
                    accept: Some(accept),
                    ..Default::default()
                });
            }
        }

        // C. Propose peace when losing badly (< 30% of opponent's regions)
        for war in &diplomacy.wars {
            let opponent_id = if war.player_a == self.player_id {
                &war.player_b
            } else if war.player_b == self.player_id {
                &war.player_a
            } else {
                continue;
            };

            let my_regions_count = regions
                .values()
                .filter(|r| r.owner_id.as_deref() == Some(&self.player_id))
                .count();
            let enemy_regions_count = regions
                .values()
                .filter(|r| r.owner_id.as_deref() == Some(opponent_id.as_str()))
                .count();

            if enemy_regions_count > 0
                && (my_regions_count as f64 / enemy_regions_count as f64) < 0.3
                && current_tick % 30 == 0
                && rng.gen_range(0..100) < 40
            {
                let has_pending = diplomacy.proposals.iter().any(|p| {
                    p.from_player_id == self.player_id
                        && p.to_player_id == *opponent_id
                        && p.status == "pending"
                        && p.proposal_type == "peace"
                });
                if !has_pending {
                    actions.push(Action {
                        action_type: "propose_peace".into(),
                        player_id: Some(self.player_id.clone()),
                        target_player_id: Some(opponent_id.clone()),
                        condition_type: Some("status_quo".into()),
                        ..Default::default()
                    });
                }
            }
        }

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
                        // D. Respect NAP pacts — skip NAP partners 90% of the time
                        if let Some(owner) = &target.owner_id {
                            if diplomacy.have_pact(&self.player_id, owner)
                                && rng.gen_range(0..100) < 90
                            {
                                continue; // respect the NAP
                            }
                        }

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
                                    ..Default::default()
                                });
                                break 'attack; // Only one attack per decision
                            }
                        }
                    }
                }
            }
        }

        // 2. BUILD: Rarely, and only when flush with energy (20% chance)
        if player.energy >= 100 && rng.gen_bool(0.2) {
            // Try to build factory on capital
            if let Some(capital_id) = &player.capital_region_id {
                if let Some(capital) = regions.get(capital_id) {
                    let factory_count = capital.building_instances.iter().filter(|b| b.building_type == "factory").count();
                    if factory_count < 1 {
                        if let Some(factory_cfg) = settings.building_types.get("factory") {
                            if player.energy >= factory_cfg.energy_cost {
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
                                    ..Default::default()
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
                let factory_count = region.building_instances.iter().filter(|b| b.building_type == "factory").count();
                if factory_count > 0 {
                    for (unit_slug, unit_cfg) in &settings.unit_types {
                        if unit_cfg.produced_by_slug.as_deref() == Some("factory")
                            && player.energy >= unit_cfg.production_cost as i64
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
                                ..Default::default()
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
                                    ..Default::default()
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
        diplomacy: &DiplomacyState,
    ) -> Vec<Action> {
        self.decide(players, regions, neighbor_map, settings, current_tick, diplomacy)
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
            building_instances: Vec::new(),
            defense_bonus: 0.0,
            vision_range: 0,
            unit_generation_bonus: 0.0,
            energy_generation_bonus: 0.0,
            is_coastal: false,
            sea_distances: Vec::new(),
            units: {
                let mut m = HashMap::new();
                m.insert("infantry".into(), units);
                m
            },
            unit_accum: 0.0,
            action_cooldowns: HashMap::new(),
            fatigue_until: None,
            fatigue_modifier: 0.0,
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
                energy: 100,
                energy_accum: 0.0,
                ability_cooldowns: HashMap::new(),
                is_bot: true,
                total_units_produced: 0,
                total_units_lost: 0,
                total_regions_conquered: 0,
                total_buildings_built: 0,
                unlocked_buildings: vec![],
                unlocked_units: vec![],
                ability_scrolls: HashMap::new(),
                active_boosts: vec![],
                ..Default::default()
            },
        );

        let settings = GameSettings {
            tick_interval_ms: 1000,
            capital_selection_time_seconds: 30,
            base_unit_generation_rate: 1.0,
            capital_generation_bonus: 2.0,
            starting_energy: 100,
            base_energy_per_tick: 2.0,
            region_energy_per_tick: 0.35,
            attacker_advantage: 0.0,
            defender_advantage: 0.1,
            combat_randomness: 0.2,
            starting_units: 10,
            neutral_region_units: 3,
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            ..Default::default()
        };

        let brain = BotBrain {
            player_id: bot_id.into(),
            action_interval: 1, // act every tick for testing
        };

        // Bot has 50% hesitation chance, so run multiple ticks to get an attack
        let mut found_attack = false;
        for tick in 1..=50 {
            let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
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
                energy: 0,
                energy_accum: 0.0,
                ability_cooldowns: HashMap::new(),
                is_bot: true,
                total_units_produced: 0,
                total_units_lost: 0,
                total_regions_conquered: 0,
                total_buildings_built: 0,
                unlocked_buildings: vec![],
                unlocked_units: vec![],
                ability_scrolls: HashMap::new(),
                active_boosts: vec![],
                ..Default::default()
            },
        );

        let settings = GameSettings {
            tick_interval_ms: 1000,
            capital_selection_time_seconds: 30,
            base_unit_generation_rate: 1.0,
            capital_generation_bonus: 2.0,
            starting_energy: 100,
            base_energy_per_tick: 2.0,
            region_energy_per_tick: 0.35,
            attacker_advantage: 0.0,
            defender_advantage: 0.1,
            combat_randomness: 0.2,
            starting_units: 10,
            neutral_region_units: 3,
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            ..Default::default()
        };

        let brain = BotBrain {
            player_id: bot_id.into(),
            action_interval: 1,
        };

        let actions = brain.decide(&players, &regions, &neighbor_map, &settings, 1, &DiplomacyState::default());
        assert!(actions.is_empty());
    }

    // -----------------------------------------------------------------------
    // Shared helpers for expanded tests
    // -----------------------------------------------------------------------

    fn make_player(id: &str, is_alive: bool, energy: i64, capital: Option<&str>) -> Player {
        Player {
            user_id: id.to_string(),
            username: id.to_string(),
            color: "#FF0000".to_string(),
            is_alive,
            connected: true,
            is_bot: true,
            capital_region_id: capital.map(str::to_string),
            energy,
            ..Default::default()
        }
    }

    fn default_settings() -> GameSettings {
        GameSettings {
            tick_interval_ms: 1000,
            capital_selection_time_seconds: 30,
            base_unit_generation_rate: 1.0,
            capital_generation_bonus: 2.0,
            starting_energy: 100,
            base_energy_per_tick: 2.0,
            region_energy_per_tick: 0.35,
            attacker_advantage: 0.0,
            defender_advantage: 0.1,
            combat_randomness: 0.2,
            starting_units: 10,
            neutral_region_units: 3,
            building_types: HashMap::new(),
            unit_types: HashMap::new(),
            ability_types: HashMap::new(),
            default_unit_type_slug: Some("infantry".into()),
            ..Default::default()
        }
    }

    fn brain_always_acts(id: &str) -> BotBrain {
        BotBrain {
            player_id: id.to_string(),
            action_interval: 1,
        }
    }

    // -----------------------------------------------------------------------
    // pick_capital — edge cases
    // -----------------------------------------------------------------------

    mod pick_capital {
        use super::*;

        #[test]
        fn returns_none_when_all_regions_are_owned() {
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some("other"), 5, true));
            regions.insert("B".into(), make_region(Some("other"), 5, false));

            let neighbor_map = HashMap::new();
            let brain = BotBrain::new("bot1".into());

            let result = brain.pick_capital(&regions, &neighbor_map, 3);

            // All owned — no unowned candidate. Fallback also finds none.
            assert!(result.is_none(), "should return None when no unowned regions exist");
        }

        #[test]
        fn returns_some_when_single_unowned_region_exists() {
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(None, 3, false));

            let neighbor_map = HashMap::new();
            let brain = BotBrain::new("bot1".into());

            let result = brain.pick_capital(&regions, &neighbor_map, 3);

            assert_eq!(result.as_deref(), Some("A"), "the only unowned region should be chosen");
        }

        #[test]
        fn respects_min_distance_from_existing_capitals() {
            // Layout: cap — A — B — C — D
            // min_distance=3 means a candidate's BFS from itself must not reach a capital
            // within 3 hops. D is 4 hops from cap so it qualifies (cap never visited before
            // depth=3 cutoff from D's BFS), while A(1), B(2), C(3) are all too close.
            let mut regions = HashMap::new();
            regions.insert("cap".into(), make_region(Some("player1"), 5, true));
            regions.insert("A".into(), make_region(None, 3, false)); // 1 hop from cap
            regions.insert("B".into(), make_region(None, 3, false)); // 2 hops from cap
            regions.insert("C".into(), make_region(None, 3, false)); // 3 hops from cap
            regions.insert("D".into(), make_region(None, 3, false)); // 4 hops from cap

            let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            neighbor_map.insert("cap".into(), vec!["A".into()]);
            neighbor_map.insert("A".into(), vec!["cap".into(), "B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into(), "C".into()]);
            neighbor_map.insert("C".into(), vec!["B".into(), "D".into()]);
            neighbor_map.insert("D".into(), vec!["C".into()]);

            let brain = BotBrain::new("bot2".into());
            let choice = brain.pick_capital(&regions, &neighbor_map, 3);

            // D is the only region that is >3 hops from the existing capital
            assert_eq!(
                choice.as_deref(),
                Some("D"),
                "should pick the only candidate far enough from the existing capital"
            );
        }

        #[test]
        fn falls_back_to_any_unowned_when_all_too_close() {
            // All unowned regions are within min_distance of an existing capital
            let mut regions = HashMap::new();
            regions.insert("cap".into(), make_region(Some("player1"), 5, true));
            regions.insert("A".into(), make_region(None, 3, false)); // 1 hop
            regions.insert("B".into(), make_region(None, 3, false)); // 2 hops

            let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            neighbor_map.insert("cap".into(), vec!["A".into()]);
            neighbor_map.insert("A".into(), vec!["cap".into(), "B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into()]);

            let brain = BotBrain::new("bot3".into());
            // min_distance=5 — no unowned region is far enough. Fallback should trigger.
            let choice = brain.pick_capital(&regions, &neighbor_map, 5);

            assert!(
                choice.is_some(),
                "fallback should pick any unowned region when all are too close"
            );
        }

        #[test]
        fn works_with_empty_map() {
            let regions: HashMap<String, Region> = HashMap::new();
            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let brain = BotBrain::new("bot1".into());

            let result = brain.pick_capital(&regions, &neighbor_map, 3);

            assert!(result.is_none(), "empty map should return None");
        }
    }

    // -----------------------------------------------------------------------
    // decide — early game (few regions, low tick)
    // -----------------------------------------------------------------------

    mod decide_early_game {
        use super::*;

        #[test]
        fn returns_empty_when_no_owned_regions() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, None));

            // No owned regions
            let regions: HashMap<String, Region> = HashMap::new();
            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            let actions = brain.decide(&players, &regions, &neighbor_map, &settings, 1, &DiplomacyState::default());

            assert!(actions.is_empty(), "bot with no regions should produce no actions");
        }

        #[test]
        fn skips_turn_when_action_interval_not_reached() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));

            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 20, true));
            regions.insert("B".into(), make_region(None, 3, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into()]);

            let settings = default_settings();
            // action_interval = 10: tick 7 should be skipped
            let brain = BotBrain {
                player_id: bot_id.into(),
                action_interval: 10,
            };

            let actions = brain.decide(&players, &regions, &neighbor_map, &settings, 7, &DiplomacyState::default());

            assert!(actions.is_empty(), "bot should skip ticks that don't align with action_interval");
        }

        #[test]
        fn does_not_attack_neutral_without_sufficient_advantage() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));

            // Bot has 10 units, neutral has 5 — 10 <= 5+8=13, so can_attack is false
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 10, true));
            regions.insert("B".into(), make_region(None, 5, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            // Run many ticks — bot should never attack (insufficient advantage)
            for tick in 1..=100 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let attacks: Vec<_> = actions.iter().filter(|a| a.action_type == "attack").collect();
                assert!(
                    attacks.is_empty(),
                    "bot should not attack when unit advantage is insufficient (tick {tick})"
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // decide — mid game (multiple regions, expansion in progress)
    // -----------------------------------------------------------------------

    mod decide_mid_game {
        use super::*;

        #[test]
        fn attacks_at_most_one_target_per_decision() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));

            // Bot owns A with 30 units. Three weak neighbors: B, C, D.
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 30, true));
            regions.insert("B".into(), make_region(None, 2, false));
            regions.insert("C".into(), make_region(None, 2, false));
            regions.insert("D".into(), make_region(None, 2, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into(), "C".into(), "D".into()]);
            neighbor_map.insert("B".into(), vec!["A".into()]);
            neighbor_map.insert("C".into(), vec!["A".into()]);
            neighbor_map.insert("D".into(), vec!["A".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            // Over many ticks, never more than one attack per decision
            for tick in 1..=100 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let attack_count = actions.iter().filter(|a| a.action_type == "attack").count();
                assert!(
                    attack_count <= 1,
                    "bot should attack at most 1 target per decision (tick {tick}, got {attack_count})"
                );
            }
        }

        #[test]
        fn consolidation_move_does_not_exceed_available_units() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));

            // Interior region A (5 units) → border region B
            // A has no non-owned neighbors (C is owned), so B is the border
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, false)); // interior
            regions.insert("B".into(), make_region(Some(bot_id), 3, true));  // border (has neighbor C)
            regions.insert("C".into(), make_region(None, 2, false));          // neutral — makes B a border

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into(), "C".into()]);
            neighbor_map.insert("C".into(), vec!["B".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            // Find a consolidation move
            let mut found_move = false;
            for tick in 1..=100 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                for action in actions.iter().filter(|a| a.action_type == "move") {
                    let units_moved = action.units.unwrap_or(0);
                    let source_units = regions
                        .get(action.source_region_id.as_deref().unwrap_or(""))
                        .map(|r| r.unit_count)
                        .unwrap_or(0);
                    assert!(
                        units_moved < source_units,
                        "move should not exceed available units minus reserve (moved {units_moved}, source has {source_units})"
                    );
                    found_move = true;
                }
                if found_move {
                    break;
                }
            }
            // If no move was generated in 100 ticks that's ok (30% probability per tick)
        }
    }

    // -----------------------------------------------------------------------
    // decide — building and unit production
    // -----------------------------------------------------------------------

    mod decide_building_and_production {
        use super::*;
        use zelqor_engine::{BuildingConfig, UnitConfig};

        fn settings_with_factory(factory_energy_cost: i64) -> GameSettings {
            let mut s = default_settings();
            s.building_types.insert(
                "factory".into(),
                BuildingConfig {
                    energy_cost: factory_energy_cost,
                    cost: 0,
                    build_time_ticks: 10,
                    max_per_region: 1,
                    defense_bonus: 0.0,
                    vision_range: 0,
                    unit_generation_bonus: 0.0,
                    energy_generation_bonus: 0.0,
                    requires_coastal: false,
                    icon: String::new(),
                    name: "Factory".into(),
                    asset_key: String::new(),
                    order: 0,
                    produced_unit_slug: None,
                    max_level: 3,
                    level_stats: HashMap::new(),
                },
            );
            s
        }

        fn settings_with_unit(production_cost: i64) -> GameSettings {
            let mut s = default_settings();
            s.unit_types.insert(
                "infantry".into(),
                UnitConfig {
                    produced_by_slug: Some("factory".into()),
                    production_cost,
                    production_time_ticks: 5,
                    ..Default::default()
                },
            );
            s
        }

        #[test]
        fn does_not_build_factory_when_energy_is_insufficient() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            // Energy 50, factory costs 200 — cannot afford
            players.insert(
                bot_id.into(),
                make_player(bot_id, true, 50, Some("A")),
            );

            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = settings_with_factory(200);
            let brain = brain_always_acts(bot_id);

            for tick in 1..=200 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let builds: Vec<_> = actions.iter().filter(|a| a.action_type == "build").collect();
                assert!(
                    builds.is_empty(),
                    "should not build when energy is insufficient (tick {tick})"
                );
            }
        }

        #[test]
        fn does_not_produce_units_without_factory() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 500, Some("A")));

            // Region A has no factory buildings
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = settings_with_unit(10);
            let brain = brain_always_acts(bot_id);

            for tick in 1..=200 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let productions: Vec<_> = actions
                    .iter()
                    .filter(|a| a.action_type == "produce_unit")
                    .collect();
                assert!(
                    productions.is_empty(),
                    "should not produce units without a factory (tick {tick})"
                );
            }
        }

        #[test]
        fn can_build_factory_when_conditions_are_met() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            // High energy, affordable factory
            players.insert(bot_id.into(), make_player(bot_id, true, 500, Some("A")));

            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = settings_with_factory(50);
            let brain = brain_always_acts(bot_id);

            // Build action has 20% probability per tick; expect it within 200 tries
            let mut found_build = false;
            for tick in 1..=200 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                if actions.iter().any(|a| a.action_type == "build") {
                    found_build = true;
                    break;
                }
            }

            assert!(
                found_build,
                "bot should eventually build a factory when it can afford one"
            );
        }
    }

    // -----------------------------------------------------------------------
    // decide — late game (consolidation with interior units)
    // -----------------------------------------------------------------------

    mod decide_late_game {
        use super::*;

        #[test]
        fn consolidates_interior_units_toward_border() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));

            // Interior: A (10 units, only neighbor is B)
            // Border: B (5 units, has neutral neighbor C)
            // Neutral: C
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 10, false));
            regions.insert("B".into(), make_region(Some(bot_id), 5, false));
            regions.insert("C".into(), make_region(None, 2, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into(), "C".into()]);
            neighbor_map.insert("C".into(), vec!["B".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            // Consolidation has 30% probability; should trigger within 200 ticks
            let mut found_consolidation = false;
            for tick in 1..=200 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                for action in &actions {
                    if action.action_type == "move"
                        && action.source_region_id.as_deref() == Some("A")
                        && action.target_region_id.as_deref() == Some("B")
                    {
                        found_consolidation = true;
                        break;
                    }
                }
                if found_consolidation {
                    break;
                }
            }

            assert!(
                found_consolidation,
                "bot should eventually consolidate interior units to border region"
            );
        }

        #[test]
        fn skips_consolidation_when_interior_region_has_too_few_units() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));

            // Interior A has only 2 units — below the threshold of 3 needed to move
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 2, false)); // <=3 units
            regions.insert("B".into(), make_region(Some(bot_id), 5, false));
            regions.insert("C".into(), make_region(None, 2, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into(), "C".into()]);
            neighbor_map.insert("C".into(), vec!["B".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            for tick in 1..=200 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let moves_from_a: Vec<_> = actions
                    .iter()
                    .filter(|a| a.action_type == "move" && a.source_region_id.as_deref() == Some("A"))
                    .collect();
                assert!(
                    moves_from_a.is_empty(),
                    "bot should not move from A when it has only 2 units (tick {tick})"
                );
            }
        }

        #[test]
        fn produces_at_most_one_move_per_decision() {
            let bot_id = "bot1";
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("Border1")));

            // Multiple interior regions each with enough units
            let mut regions = HashMap::new();
            regions.insert("Interior1".into(), make_region(Some(bot_id), 10, false));
            regions.insert("Interior2".into(), make_region(Some(bot_id), 10, false));
            regions.insert("Border1".into(), make_region(Some(bot_id), 5, false));
            regions.insert("Neutral".into(), make_region(None, 2, false));

            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("Interior1".into(), vec!["Border1".into()]);
            neighbor_map.insert("Interior2".into(), vec!["Border1".into()]);
            neighbor_map.insert("Border1".into(), vec!["Interior1".into(), "Interior2".into(), "Neutral".into()]);
            neighbor_map.insert("Neutral".into(), vec!["Border1".into()]);

            let settings = default_settings();
            let brain = brain_always_acts(bot_id);

            for tick in 1..=100 {
                let actions = brain.decide(&players, &regions, &neighbor_map, &settings, tick, &DiplomacyState::default());
                let move_count = actions.iter().filter(|a| a.action_type == "move").count();
                assert!(
                    move_count <= 1,
                    "bot should produce at most one move per decision (tick {tick}, got {move_count})"
                );
            }
        }
    }

    // -----------------------------------------------------------------------
    // decide — diplomacy edge cases
    // -----------------------------------------------------------------------

    mod decide_diplomacy {
        use super::*;
        use zelqor_engine::{DiplomacyProposal, DiplomacyState, Pact, War};

        fn make_war(a: &str, b: &str, aggressor: &str) -> War {
            // DiplomacyState stores (player_a, player_b) in lexicographic order.
            let (pa, pb) = if a < b {
                (a.to_string(), b.to_string())
            } else {
                (b.to_string(), a.to_string())
            };
            War {
                player_a: pa,
                player_b: pb,
                started_tick: 1,
                aggressor_id: aggressor.to_string(),
                provinces_changed: Vec::new(),
            }
        }

        fn make_nap_proposal(id: &str, from: &str, to: &str) -> DiplomacyProposal {
            DiplomacyProposal {
                id: id.to_string(),
                proposal_type: "nap".to_string(),
                from_player_id: from.to_string(),
                to_player_id: to.to_string(),
                created_tick: 1,
                conditions: None,
                status: "pending".to_string(),
                rejected_tick: None,
                expires_tick: None,
            }
        }

        fn make_peace_proposal(id: &str, from: &str, to: &str) -> DiplomacyProposal {
            DiplomacyProposal {
                id: id.to_string(),
                proposal_type: "peace".to_string(),
                from_player_id: from.to_string(),
                to_player_id: to.to_string(),
                created_tick: 1,
                conditions: None,
                status: "pending".to_string(),
                rejected_tick: None,
                expires_tick: None,
            }
        }

        fn make_pact(id: &str, a: &str, b: &str) -> Pact {
            let (pa, pb) = if a < b {
                (a.to_string(), b.to_string())
            } else {
                (b.to_string(), a.to_string())
            };
            Pact {
                id: id.to_string(),
                pact_type: "nap".to_string(),
                player_a: pa,
                player_b: pb,
                created_tick: 1,
                expires_tick: None,
            }
        }

        // A. NAP proposal — bot receives a pending NAP while NOT at war with proposer.
        //    Over many ticks the bot must eventually emit respond_pact with the correct
        //    proposal_id (80% acceptance probability ensures convergence fast).
        #[test]
        fn bot_responds_to_nap_proposal_when_not_at_war() {
            let bot_id = "bot1";
            let enemy_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(enemy_id.into(), make_player(enemy_id, true, 100, Some("E")));

            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.proposals.push(make_nap_proposal("prop-1", enemy_id, bot_id));

            let brain = brain_always_acts(bot_id);

            let mut found_response = false;
            for tick in 1..=100 {
                let actions =
                    brain.decide(&players, &regions, &neighbor_map, &settings, tick, &diplomacy);
                for action in &actions {
                    if action.action_type == "respond_pact"
                        && action.proposal_id.as_deref() == Some("prop-1")
                    {
                        assert_eq!(action.player_id.as_deref(), Some(bot_id));
                        assert!(
                            action.accept.is_some(),
                            "respond_pact must carry an accept field"
                        );
                        found_response = true;
                        break;
                    }
                }
                if found_response {
                    break;
                }
            }
            assert!(found_response, "bot must eventually respond to a pending NAP proposal");
        }

        // A (negative). NAP proposal already at war — bot must NOT respond_pact for it.
        #[test]
        fn bot_ignores_nap_proposal_when_already_at_war_with_proposer() {
            let bot_id = "bot1";
            let enemy_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(enemy_id.into(), make_player(enemy_id, true, 100, Some("E")));

            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.proposals.push(make_nap_proposal("prop-war", enemy_id, bot_id));
            diplomacy.wars.push(make_war(bot_id, enemy_id, enemy_id));

            let brain = brain_always_acts(bot_id);

            for tick in 1..=100 {
                let actions =
                    brain.decide(&players, &regions, &neighbor_map, &settings, tick, &diplomacy);
                let has_nap_response = actions.iter().any(|a| {
                    a.action_type == "respond_pact"
                        && a.proposal_id.as_deref() == Some("prop-war")
                });
                assert!(
                    !has_nap_response,
                    "bot must not respond to NAP when already at war with proposer (tick {tick})"
                );
            }
        }

        // B. Peace proposal — bot should REJECT peace when it is stronger (more regions).
        //    The accept field must be false every time (deterministic: my_regions > enemy_regions).
        #[test]
        fn bot_rejects_peace_when_dominant() {
            let bot_id = "bot1";
            let weak_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(weak_id.into(), make_player(weak_id, true, 100, Some("E")));

            // Bot owns 5 regions, weak enemy owns only 1.
            let mut regions = HashMap::new();
            for name in ["A", "B", "C", "D", "F"] {
                regions.insert(name.into(), make_region(Some(bot_id), 5, name == "A"));
            }
            regions.insert("E".into(), make_region(Some(weak_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.proposals.push(make_peace_proposal("peace-1", weak_id, bot_id));
            diplomacy.wars.push(make_war(bot_id, weak_id, weak_id));

            let brain = brain_always_acts(bot_id);

            // In every tick the bot must respond to the peace proposal with accept=false.
            let actions =
                brain.decide(&players, &regions, &neighbor_map, &settings, 1, &diplomacy);
            let peace_response = actions
                .iter()
                .find(|a| a.action_type == "respond_peace" && a.proposal_id.as_deref() == Some("peace-1"))
                .expect("bot must respond to a pending peace proposal");
            assert_eq!(
                peace_response.accept,
                Some(false),
                "stronger bot must reject peace from a weaker enemy"
            );
        }

        // B (positive). Peace proposal — bot should ACCEPT when it is losing badly.
        #[test]
        fn bot_accepts_peace_when_losing() {
            let bot_id = "bot1";
            let strong_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(strong_id.into(), make_player(strong_id, true, 100, Some("S")));

            // Bot owns 1 region, strong enemy owns 10.
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));
            for i in 0..10 {
                let key = format!("S{i}");
                regions.insert(key, make_region(Some(strong_id), 5, i == 0));
            }

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.proposals.push(make_peace_proposal("peace-2", strong_id, bot_id));
            diplomacy.wars.push(make_war(bot_id, strong_id, strong_id));

            let brain = brain_always_acts(bot_id);

            let actions =
                brain.decide(&players, &regions, &neighbor_map, &settings, 1, &diplomacy);
            let peace_response = actions
                .iter()
                .find(|a| a.action_type == "respond_peace" && a.proposal_id.as_deref() == Some("peace-2"))
                .expect("bot must respond to a pending peace proposal");
            assert_eq!(
                peace_response.accept,
                Some(true),
                "losing bot must accept peace from a dominant enemy"
            );
        }

        // C. Propose peace when badly losing in an active war.
        //    Condition: my_regions < 30% of enemy_regions, tick divisible by 30, 40% RNG.
        //    We run enough ticks that the random gate fires at least once.
        #[test]
        fn bot_proposes_peace_when_severely_losing_in_war() {
            let bot_id = "bot1";
            let strong_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(strong_id.into(), make_player(strong_id, true, 100, Some("S")));

            // Bot has 1 region, enemy has 10 — ratio = 0.1 < 0.3.
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));
            for i in 0..10 {
                let key = format!("S{i}");
                regions.insert(key, make_region(Some(strong_id), 5, i == 0));
            }

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.wars.push(make_war(bot_id, strong_id, strong_id));

            let brain = brain_always_acts(bot_id);

            // Only ticks divisible by 30 can trigger, 40% RNG — expect hit in 500 attempts
            // across ticks 30, 60, 90, … (17 opportunities per 500 ticks, P(miss all) < 0.02).
            let mut found_proposal = false;
            for tick in 1..=500 {
                let actions =
                    brain.decide(&players, &regions, &neighbor_map, &settings, tick, &diplomacy);
                if actions.iter().any(|a| {
                    a.action_type == "propose_peace"
                        && a.target_player_id.as_deref() == Some(strong_id)
                }) {
                    found_proposal = true;
                    break;
                }
            }
            assert!(
                found_proposal,
                "bot should eventually propose peace when severely outmatched in war"
            );
        }

        // D. NAP pact respected: bot skips attacks on a NAP partner 90% of the time.
        //    With 100 ticks and action_interval=1, the bot must NOT attack the NAP partner
        //    on EVERY tick (only 10% chance to break the pact each time).  We verify the
        //    NAP is respected in at least some ticks rather than blindly attacking every tick.
        #[test]
        fn bot_respects_nap_pact_mostly() {
            let bot_id = "bot1";
            let partner_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 50, Some("A")));
            players.insert(partner_id.into(), make_player(partner_id, true, 50, Some("B")));

            // Bot has a massive advantage but has an NAP with partner.
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 50, true));
            regions.insert("B".into(), make_region(Some(partner_id), 2, true));

            let mut neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            neighbor_map.insert("A".into(), vec!["B".into()]);
            neighbor_map.insert("B".into(), vec!["A".into()]);

            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.pacts.push(make_pact("pact-1", bot_id, partner_id));

            let brain = brain_always_acts(bot_id);

            let mut attack_count = 0u32;
            for tick in 1..=100 {
                let actions =
                    brain.decide(&players, &regions, &neighbor_map, &settings, tick, &diplomacy);
                if actions.iter().any(|a| {
                    a.action_type == "attack"
                        && a.target_region_id.as_deref() == Some("B")
                }) {
                    attack_count += 1;
                }
            }
            // With 50% hesitation AND 10% pact-break: expected attacks ≈ 5.
            // We verify it doesn't attack on all 100 ticks (that would mean the pact is ignored).
            assert!(
                attack_count < 100,
                "bot attacked NAP partner every tick — NAP pact logic is not working"
            );
        }

        // bot with no regions still emits diplomacy actions (peace/nap responses).
        #[test]
        fn eliminated_bot_still_emits_diplomacy_actions_then_stops() {
            let bot_id = "bot1";
            let enemy_id = "player2";

            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            players.insert(enemy_id.into(), make_player(enemy_id, true, 100, Some("E")));

            // Bot is alive but owns NO regions.
            let mut regions = HashMap::new();
            regions.insert("E".into(), make_region(Some(enemy_id), 5, true));

            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            let settings = default_settings();

            let mut diplomacy = DiplomacyState::default();
            diplomacy.proposals.push(make_nap_proposal("prop-elim", enemy_id, bot_id));

            let brain = brain_always_acts(bot_id);

            // Even with no regions the bot must still respond to pending proposals
            // (diplomacy decisions happen BEFORE the my_regions.is_empty() early-return).
            let actions =
                brain.decide(&players, &regions, &neighbor_map, &settings, 1, &diplomacy);
            let has_response = actions
                .iter()
                .any(|a| a.action_type == "respond_pact" && a.proposal_id.as_deref() == Some("prop-elim"));
            assert!(
                has_response,
                "bot with no regions must still respond to pending diplomacy proposals"
            );
        }
    }

    // -----------------------------------------------------------------------
    // BotStrategy trait — both implementations satisfy the trait contract
    // -----------------------------------------------------------------------

    mod trait_contract {
        use super::*;
        use crate::{BotBrain, BotStrategy, TutorialBotBrain};

        fn call_via_trait(
            strategy: &dyn BotStrategy,
            players: &HashMap<String, Player>,
            regions: &HashMap<String, Region>,
            neighbor_map: &HashMap<String, Vec<String>>,
            settings: &GameSettings,
            tick: i64,
            diplomacy: &DiplomacyState,
        ) -> Vec<Action> {
            strategy.decide(players, regions, neighbor_map, settings, tick, diplomacy)
        }

        fn minimal_setup(bot_id: &str) -> (
            HashMap<String, Player>,
            HashMap<String, Region>,
            HashMap<String, Vec<String>>,
            GameSettings,
        ) {
            let mut players = HashMap::new();
            players.insert(bot_id.into(), make_player(bot_id, true, 100, Some("A")));
            let mut regions = HashMap::new();
            regions.insert("A".into(), make_region(Some(bot_id), 5, true));
            let neighbor_map: HashMap<String, Vec<String>> = HashMap::new();
            (players, regions, neighbor_map, default_settings())
        }

        #[test]
        fn bot_brain_satisfies_bot_strategy_trait() {
            let bot_id = "trait-bot";
            let (players, regions, nm, settings) = minimal_setup(bot_id);
            let brain: Box<dyn BotStrategy> = Box::new(BotBrain {
                player_id: bot_id.to_string(),
                action_interval: 1,
            });
            // Should not panic and must return a Vec<Action> (even if empty).
            let actions = call_via_trait(
                brain.as_ref(),
                &players,
                &regions,
                &nm,
                &settings,
                1,
                &DiplomacyState::default(),
            );
            // Just verify the return type is well-formed.
            let _ = actions.len();
        }

        #[test]
        fn tutorial_bot_brain_satisfies_bot_strategy_trait() {
            let bot_id = "trait-tutorial-bot";
            let (players, regions, nm, settings) = minimal_setup(bot_id);
            let brain: Box<dyn BotStrategy> = Box::new(TutorialBotBrain::new(bot_id.to_string()));
            let actions = call_via_trait(
                brain.as_ref(),
                &players,
                &regions,
                &nm,
                &settings,
                1,
                &DiplomacyState::default(),
            );
            let _ = actions.len();
        }

        #[test]
        fn both_implementations_are_send_sync() {
            fn assert_send_sync<T: Send + Sync>() {}
            assert_send_sync::<BotBrain>();
            assert_send_sync::<TutorialBotBrain>();
        }

        #[test]
        fn dead_player_produces_no_actions_via_trait() {
            let bot_id = "dead-trait-bot";
            let (mut players, regions, nm, settings) = minimal_setup(bot_id);
            players.get_mut(bot_id).unwrap().is_alive = false;

            let brain: Box<dyn BotStrategy> = Box::new(BotBrain {
                player_id: bot_id.to_string(),
                action_interval: 1,
            });
            let actions = call_via_trait(
                brain.as_ref(),
                &players,
                &regions,
                &nm,
                &settings,
                1,
                &DiplomacyState::default(),
            );
            assert!(actions.is_empty(), "dead player must produce no actions through the trait");
        }
    }
}
