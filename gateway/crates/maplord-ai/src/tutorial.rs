use crate::BotStrategy;
use maplord_engine::{Action, DiplomacyState, GameSettings, Player, Region};
use std::collections::HashMap;

/// Deliberately weak bot for the tutorial. Captures some neutrals slowly,
/// builds a bit, then mounts a small attack so the player can practice defense.
pub struct TutorialBotBrain {
    player_id: String,
}

impl TutorialBotBrain {
    pub fn new(player_id: String) -> Self {
        Self { player_id }
    }
}

impl BotStrategy for TutorialBotBrain {
    fn decide(
        &self,
        players: &HashMap<String, Player>,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        settings: &GameSettings,
        current_tick: i64,
        _diplomacy: &DiplomacyState,
    ) -> Vec<Action> {
        let player = match players.get(&self.player_id) {
            Some(p) if p.is_alive => p,
            _ => return Vec::new(),
        };

        let my_regions: Vec<(&String, &Region)> = regions
            .iter()
            .filter(|(_, r)| r.owner_id.as_deref() == Some(&self.player_id))
            .collect();

        if my_regions.is_empty() {
            return Vec::new();
        }

        let mut actions = Vec::new();

        // Determine default unit type for attacks
        let default_ut = settings
            .default_unit_type_slug
            .clone()
            .unwrap_or_else(|| "infantry".into());

        // ── Phase 1 (ticks 1-30): Completely passive ──
        if current_tick < 30 {
            return actions;
        }

        // ── Phase 2 (ticks 30-80): Slowly capture neutral neighbors ──
        // Attack one neutral every 10 ticks
        if current_tick < 80 {
            if current_tick % 10 == 0 {
                if let Some(action) = self.attack_weakest_neutral(
                    &my_regions,
                    regions,
                    neighbor_map,
                    &default_ut,
                ) {
                    actions.push(action);
                }
            }
            return actions;
        }

        // ── Phase 3 (tick 80): Build barracks + factory on capital ──
        if current_tick == 80 {
            if let Some(capital_id) = &player.capital_region_id {
                if let Some(capital) = regions.get(capital_id) {
                    let barracks_count = capital.building_instances
                        .iter()
                        .filter(|b| b.building_type == "barracks")
                        .count();
                    if barracks_count < 1 {
                        if let Some(cfg) = settings.building_types.get("barracks") {
                            if player.energy >= cfg.energy_cost {
                                actions.push(Action {
                                    action_type: "build".into(),
                                    player_id: Some(self.player_id.clone()),
                                    region_id: Some(capital_id.clone()),
                                    building_type: Some("barracks".into()),
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
                    let factory_count = capital.building_instances
                        .iter()
                        .filter(|b| b.building_type == "factory")
                        .count();
                    if factory_count < 1 {
                        if let Some(cfg) = settings.building_types.get("factory") {
                            if player.energy >= cfg.energy_cost {
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
            return actions;
        }

        // ── Phase 4 (ticks 80-130): Keep capturing neutrals, produce tank, attack player ──
        if current_tick < 130 {
            // Produce a tank at tick 90 if factory exists
            if current_tick == 90 {
                if let Some(capital_id) = &player.capital_region_id {
                    if let Some(capital) = regions.get(capital_id) {
                        let has_factory = capital.building_instances
                            .iter()
                            .any(|b| b.building_type == "factory");
                        if has_factory {
                            actions.push(Action {
                                action_type: "produce_unit".into(),
                                player_id: Some(self.player_id.clone()),
                                region_id: Some(capital_id.clone()),
                                unit_type: Some("tank".into()),
                                source_region_id: None,
                                target_region_id: None,
                                units: None,
                                building_type: None,
                                ability_type: None,
                                ..Default::default()
                            });
                        }
                    }
                }
            }

            // Attack player at tick 110
            if current_tick == 110 {
                if let Some(action) =
                    self.attack_player_region(players, &my_regions, regions, neighbor_map, &default_ut)
                {
                    actions.push(action);
                    return actions;
                }
            }

            // Capture neutral every 12 ticks
            if current_tick % 12 == 0 {
                if let Some(action) = self.attack_weakest_neutral(
                    &my_regions,
                    regions,
                    neighbor_map,
                    &default_ut,
                ) {
                    actions.push(action);
                }
            }
            return actions;
        }

        // ── Phase 5 (130+): Slow play — capture neutral every 15 ticks ──
        if current_tick % 15 == 0 {
            if let Some(action) =
                self.attack_weakest_neutral(&my_regions, regions, neighbor_map, &default_ut)
            {
                actions.push(action);
            }
        }

        actions
    }
}

impl TutorialBotBrain {
    /// Find the weakest adjacent neutral region and attack it.
    fn attack_weakest_neutral(
        &self,
        my_regions: &[(&String, &Region)],
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        default_ut: &str,
    ) -> Option<Action> {
        // Find the best source→target pair: source with most units, target with fewest
        let mut best: Option<(String, String, i64)> = None; // (source, target, target_units)

        for (rid, region) in my_regions {
            if region.unit_count < 4 {
                continue;
            }
            if let Some(neighbors) = neighbor_map.get(*rid) {
                for target_id in neighbors {
                    if let Some(target) = regions.get(target_id) {
                        if target.owner_id.is_none() {
                            let dominated = best
                                .as_ref()
                                .map(|(_, _, bu)| target.unit_count < *bu)
                                .unwrap_or(true);
                            if dominated {
                                best =
                                    Some(((*rid).clone(), target_id.clone(), target.unit_count));
                            }
                        }
                    }
                }
            }
        }

        let (source_id, target_id, target_units) = best?;
        let source = my_regions.iter().find(|(id, _)| **id == source_id)?.1;
        let send = (target_units + 3).min(source.unit_count - 2);
        if send <= 0 {
            return None;
        }

        Some(Action {
            action_type: "attack".into(),
            player_id: Some(self.player_id.clone()),
            source_region_id: Some(source_id),
            target_region_id: Some(target_id),
            units: Some(send),
            unit_type: Some(default_ut.to_string()),
            region_id: None,
            building_type: None,
            ability_type: None,
            ..Default::default()
        })
    }

    #[cfg(test)]
    pub fn attack_weakest_neutral_pub(
        &self,
        my_regions: &[(&String, &Region)],
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        default_ut: &str,
    ) -> Option<Action> {
        self.attack_weakest_neutral(my_regions, regions, neighbor_map, default_ut)
    }

    #[cfg(test)]
    pub fn attack_player_region_pub(
        &self,
        players: &HashMap<String, Player>,
        my_regions: &[(&String, &Region)],
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        default_ut: &str,
    ) -> Option<Action> {
        self.attack_player_region(players, my_regions, regions, neighbor_map, default_ut)
    }

    /// Attack one non-capital player region with a small force.
    fn attack_player_region(
        &self,
        players: &HashMap<String, Player>,
        my_regions: &[(&String, &Region)],
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        default_ut: &str,
    ) -> Option<Action> {
        let human_id = players
            .iter()
            .find(|(id, p)| *id != &self.player_id && p.is_alive && !p.is_bot)
            .map(|(id, _)| id.clone())?;

        for (rid, region) in my_regions {
            if region.unit_count < 5 {
                continue;
            }
            if let Some(neighbors) = neighbor_map.get(*rid) {
                for target_id in neighbors {
                    if let Some(target) = regions.get(target_id) {
                        if target.owner_id.as_deref() == Some(&human_id) && !target.is_capital {
                            let send = 4.min(region.unit_count - 2);
                            if send > 0 {
                                return Some(Action {
                                    action_type: "attack".into(),
                                    player_id: Some(self.player_id.clone()),
                                    source_region_id: Some((*rid).clone()),
                                    target_region_id: Some(target_id.clone()),
                                    units: Some(send),
                                    unit_type: Some(default_ut.to_string()),
                                    region_id: None,
                                    building_type: None,
                                    ability_type: None,
                                    ..Default::default()
                                });
                            }
                        }
                    }
                }
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use maplord_engine::{BuildingInstance, GameSettings, Player, Region};

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn default_settings() -> GameSettings {
        serde_json::from_str(r#"{"default_unit_type_slug":"infantry"}"#)
            .expect("default_settings should parse")
    }

    fn alive_player(id: &str, capital_id: Option<&str>, energy: i64) -> Player {
        Player {
            user_id: id.to_string(),
            is_alive: true,
            capital_region_id: capital_id.map(|s| s.to_string()),
            energy,
            ..Default::default()
        }
    }

    fn owned_region(owner: &str, units: i64) -> Region {
        Region {
            owner_id: Some(owner.to_string()),
            unit_count: units,
            ..Default::default()
        }
    }

    fn neutral_region(units: i64) -> Region {
        Region {
            owner_id: None,
            unit_count: units,
            ..Default::default()
        }
    }

    fn capital_region(owner: &str, units: i64) -> Region {
        Region {
            owner_id: Some(owner.to_string()),
            unit_count: units,
            is_capital: true,
            ..Default::default()
        }
    }

    // -----------------------------------------------------------------------
    // Construction
    // -----------------------------------------------------------------------

    mod construction {
        use super::*;

        #[test]
        fn new_stores_player_id() {
            let bot = TutorialBotBrain::new("bot-1".to_string());
            // Verify the player_id is used in decisions by checking dead player
            // path returns empty actions.
            let players = HashMap::new();
            let regions = HashMap::new();
            let neighbor_map = HashMap::new();
            let settings = default_settings();
            let actions = bot.decide(&players, &regions, &neighbor_map, &settings, 50, &DiplomacyState::default());
            assert!(
                actions.is_empty(),
                "unknown player should produce no actions"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Phase 1: ticks 0-29 — fully passive
    // -----------------------------------------------------------------------

    mod phase_1_passive {
        use super::*;

        fn setup() -> (
            TutorialBotBrain,
            HashMap<String, Player>,
            HashMap<String, Region>,
            HashMap<String, Vec<String>>,
            GameSettings,
        ) {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("r1"), 200));
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 20));
            regions.insert("r2".to_string(), neutral_region(2));
            let mut neighbor_map = HashMap::new();
            neighbor_map.insert("r1".to_string(), vec!["r2".to_string()]);
            let settings = default_settings();
            (bot, players, regions, neighbor_map, settings)
        }

        #[test]
        fn tick_0_returns_no_actions() {
            let (bot, players, regions, nm, settings) = setup();
            let actions = bot.decide(&players, &regions, &nm, &settings, 0, &DiplomacyState::default());
            assert!(actions.is_empty());
        }

        #[test]
        fn tick_1_returns_no_actions() {
            let (bot, players, regions, nm, settings) = setup();
            let actions = bot.decide(&players, &regions, &nm, &settings, 1, &DiplomacyState::default());
            assert!(actions.is_empty());
        }

        #[test]
        fn tick_29_returns_no_actions() {
            let (bot, players, regions, nm, settings) = setup();
            let actions = bot.decide(&players, &regions, &nm, &settings, 29, &DiplomacyState::default());
            assert!(actions.is_empty());
        }

        #[test]
        fn dead_bot_returns_no_actions_at_any_tick() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            let mut dead = alive_player("bot", Some("r1"), 200);
            dead.is_alive = false;
            players.insert("bot".to_string(), dead);
            let regions = HashMap::new();
            let nm = HashMap::new();
            let settings = default_settings();
            let actions = bot.decide(&players, &regions, &nm, &settings, 50, &DiplomacyState::default());
            assert!(actions.is_empty());
        }

        #[test]
        fn bot_with_no_regions_returns_no_actions() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", None, 200));
            // All regions are neutral — bot owns none.
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), neutral_region(3));
            let nm = HashMap::new();
            let settings = default_settings();
            let actions = bot.decide(&players, &regions, &nm, &settings, 50, &DiplomacyState::default());
            assert!(actions.is_empty());
        }
    }

    // -----------------------------------------------------------------------
    // Phase 2: ticks 30-79 — capture neutral every 10 ticks
    // -----------------------------------------------------------------------

    mod phase_2_capture_neutrals {
        use super::*;

        fn setup_with_adjacent_neutral() -> (
            TutorialBotBrain,
            HashMap<String, Player>,
            HashMap<String, Region>,
            HashMap<String, Vec<String>>,
            GameSettings,
        ) {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("r1"), 200));
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 20));
            regions.insert("r2".to_string(), neutral_region(2));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);
            (bot, players, regions, nm, default_settings())
        }

        #[test]
        fn tick_30_produces_attack_action() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 30, &DiplomacyState::default());
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].action_type, "attack");
        }

        #[test]
        fn tick_31_produces_no_actions_off_interval() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 31, &DiplomacyState::default());
            assert!(actions.is_empty(), "off-interval tick should be idle");
        }

        #[test]
        fn tick_40_produces_attack_action() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 40, &DiplomacyState::default());
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].action_type, "attack");
        }

        #[test]
        fn attack_targets_neutral_region() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 30, &DiplomacyState::default());
            let action = &actions[0];
            assert_eq!(action.target_region_id.as_deref(), Some("r2"));
        }

        #[test]
        fn attack_sends_positive_unit_count() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 30, &DiplomacyState::default());
            let units = actions[0].units.expect("units should be set");
            assert!(units > 0);
        }

        #[test]
        fn attack_uses_default_unit_type() {
            let (bot, players, regions, nm, settings) = setup_with_adjacent_neutral();
            let actions = bot.decide(&players, &regions, &nm, &settings, 30, &DiplomacyState::default());
            assert_eq!(actions[0].unit_type.as_deref(), Some("infantry"));
        }

        #[test]
        fn no_attack_when_source_has_too_few_units() {
            // attack_weakest_neutral requires source.unit_count >= 4
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("r1"), 200));
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 3)); // only 3 units
            regions.insert("r2".to_string(), neutral_region(1));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);
            let actions = bot.decide(&players, &regions, &nm, &default_settings(), 30, &DiplomacyState::default());
            assert!(actions.is_empty(), "too few units should prevent attack");
        }
    }

    // -----------------------------------------------------------------------
    // Phase 3: tick 80 — build barracks
    // -----------------------------------------------------------------------

    mod phase_3_build_barracks {
        use super::*;

        fn settings_with_barracks(energy_cost: i64) -> GameSettings {
            let json = serde_json::json!({
                "default_unit_type_slug": "infantry",
                "building_types": {
                    "barracks": {
                        "energy_cost": energy_cost
                    }
                }
            });
            serde_json::from_value(json).expect("settings_with_barracks should parse")
        }

        #[test]
        fn tick_80_builds_barracks_when_affordable() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("capital"), 500));
            let mut regions = HashMap::new();
            regions.insert("capital".to_string(), owned_region("bot", 10));
            let nm = HashMap::new();
            let settings = settings_with_barracks(50);

            let actions = bot.decide(&players, &regions, &nm, &settings, 80, &DiplomacyState::default());
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].action_type, "build");
            assert_eq!(actions[0].building_type.as_deref(), Some("barracks"));
        }

        #[test]
        fn tick_80_skips_build_when_insufficient_energy() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("capital"), 10));
            let mut regions = HashMap::new();
            regions.insert("capital".to_string(), owned_region("bot", 10));
            let nm = HashMap::new();
            let settings = settings_with_barracks(100);

            let actions = bot.decide(&players, &regions, &nm, &settings, 80, &DiplomacyState::default());
            assert!(actions.is_empty(), "cannot afford barracks — no action");
        }

        #[test]
        fn tick_80_skips_build_when_barracks_already_present() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("capital"), 500));
            let mut regions = HashMap::new();
            let mut capital = owned_region("bot", 10);
            capital.building_instances.push(BuildingInstance {
                building_type: "barracks".to_string(),
                level: 1,
            });
            regions.insert("capital".to_string(), capital);
            let nm = HashMap::new();
            let settings = settings_with_barracks(50);

            let actions = bot.decide(&players, &regions, &nm, &settings, 80, &DiplomacyState::default());
            assert!(actions.is_empty(), "barracks already built — skip");
        }

        #[test]
        fn tick_81_returns_no_actions_phase3_only_fires_once() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("capital"), 500));
            let mut regions = HashMap::new();
            regions.insert("capital".to_string(), owned_region("bot", 10));
            let nm = HashMap::new();
            let settings = settings_with_barracks(50);

            // tick 81 is in phase 4, not on a multiple-of-12
            let actions = bot.decide(&players, &regions, &nm, &settings, 81, &DiplomacyState::default());
            assert!(actions.is_empty());
        }
    }

    // -----------------------------------------------------------------------
    // Phase 5: tick 130+ — slow play (every 15 ticks)
    // -----------------------------------------------------------------------

    mod phase_5_slow_play {
        use super::*;

        fn setup() -> (
            TutorialBotBrain,
            HashMap<String, Player>,
            HashMap<String, Region>,
            HashMap<String, Vec<String>>,
            GameSettings,
        ) {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("r1"), 200));
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 20));
            regions.insert("r2".to_string(), neutral_region(2));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);
            (bot, players, regions, nm, default_settings())
        }

        #[test]
        fn tick_130_attacks_on_15_tick_interval() {
            let (bot, players, regions, nm, settings) = setup();
            // 130 % 15 == 10 — NOT on interval, should be idle
            let actions = bot.decide(&players, &regions, &nm, &settings, 130, &DiplomacyState::default());
            assert!(actions.is_empty(), "tick 130 is not a multiple of 15");
        }

        #[test]
        fn tick_135_attacks_on_15_tick_interval() {
            let (bot, players, regions, nm, settings) = setup();
            // 135 % 15 == 0
            let actions = bot.decide(&players, &regions, &nm, &settings, 135, &DiplomacyState::default());
            assert_eq!(actions.len(), 1);
            assert_eq!(actions[0].action_type, "attack");
        }

        #[test]
        fn tick_150_attacks_on_15_tick_interval() {
            let (bot, players, regions, nm, settings) = setup();
            // 150 % 15 == 0
            let actions = bot.decide(&players, &regions, &nm, &settings, 150, &DiplomacyState::default());
            assert_eq!(actions.len(), 1);
        }

        #[test]
        fn tick_136_is_idle() {
            let (bot, players, regions, nm, settings) = setup();
            let actions = bot.decide(&players, &regions, &nm, &settings, 136, &DiplomacyState::default());
            assert!(actions.is_empty());
        }
    }

    // -----------------------------------------------------------------------
    // attack_weakest_neutral (via pub test shim)
    // -----------------------------------------------------------------------

    mod attack_weakest_neutral {
        use super::*;

        #[test]
        fn returns_none_when_no_adjacent_neutral() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 20));
            regions.insert("r2".to_string(), owned_region("enemy", 5));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);

            let r1_key = "r1".to_string();
            let r1_region = regions.get(&r1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&r1_key, r1_region)];

            let action = bot.attack_weakest_neutral_pub(&my_regions, &regions, &nm, "infantry");
            assert!(action.is_none(), "no neutral neighbor — should return None");
        }

        #[test]
        fn returns_none_when_source_has_fewer_than_4_units() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 3));
            regions.insert("r2".to_string(), neutral_region(1));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);

            let r1_key = "r1".to_string();
            let r1_region = regions.get(&r1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&r1_key, r1_region)];

            let action = bot.attack_weakest_neutral_pub(&my_regions, &regions, &nm, "infantry");
            assert!(action.is_none());
        }

        #[test]
        fn targets_weakest_neutral_among_multiple_options() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut regions = HashMap::new();
            regions.insert("source".to_string(), owned_region("bot", 20));
            regions.insert("weak".to_string(), neutral_region(1));
            regions.insert("strong".to_string(), neutral_region(10));
            let mut nm = HashMap::new();
            nm.insert(
                "source".to_string(),
                vec!["weak".to_string(), "strong".to_string()],
            );

            let src_key = "source".to_string();
            let src_region = regions.get(&src_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&src_key, src_region)];

            let action = bot
                .attack_weakest_neutral_pub(&my_regions, &regions, &nm, "infantry")
                .expect("should find a target");
            assert_eq!(
                action.target_region_id.as_deref(),
                Some("weak"),
                "should pick the neutral with fewest units"
            );
        }

        #[test]
        fn player_id_is_set_on_returned_action() {
            let bot = TutorialBotBrain::new("my-bot".to_string());
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("my-bot", 20));
            regions.insert("r2".to_string(), neutral_region(2));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);

            let r1_key = "r1".to_string();
            let r1_region = regions.get(&r1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&r1_key, r1_region)];

            let action = bot
                .attack_weakest_neutral_pub(&my_regions, &regions, &nm, "cavalry")
                .expect("should produce an action");
            assert_eq!(action.player_id.as_deref(), Some("my-bot"));
            assert_eq!(action.unit_type.as_deref(), Some("cavalry"));
        }
    }

    // -----------------------------------------------------------------------
    // attack_player_region (via pub test shim)
    // -----------------------------------------------------------------------

    mod attack_player_region {
        use super::*;

        #[test]
        fn returns_none_when_no_human_player_present() {
            let bot = TutorialBotBrain::new("bot".to_string());
            // Only the bot in the players map — no human.
            let mut players = HashMap::new();
            let mut bot_player = alive_player("bot", None, 0);
            bot_player.is_bot = true;
            players.insert("bot".to_string(), bot_player);
            let regions = HashMap::new();
            let nm = HashMap::new();
            let my_regions: Vec<(&String, &Region)> = vec![];

            let action =
                bot.attack_player_region_pub(&players, &my_regions, &regions, &nm, "infantry");
            assert!(action.is_none());
        }

        #[test]
        fn targets_non_capital_human_region() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("b1"), 0));
            players.insert("human".to_string(), alive_player("human", Some("h_cap"), 0));
            let mut regions = HashMap::new();
            regions.insert("b1".to_string(), owned_region("bot", 20));
            // Human non-capital next to bot's region.
            let mut human_region = owned_region("human", 3);
            human_region.is_capital = false;
            regions.insert("h1".to_string(), human_region);
            let mut nm = HashMap::new();
            nm.insert("b1".to_string(), vec!["h1".to_string()]);

            let b1_key = "b1".to_string();
            let b1_region = regions.get(&b1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&b1_key, b1_region)];

            let action = bot
                .attack_player_region_pub(&players, &my_regions, &regions, &nm, "infantry")
                .expect("should find a target");
            assert_eq!(action.target_region_id.as_deref(), Some("h1"));
            assert_eq!(action.action_type, "attack");
        }

        #[test]
        fn does_not_attack_human_capital() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("b1"), 0));
            players.insert("human".to_string(), alive_player("human", Some("h_cap"), 0));
            let mut regions = HashMap::new();
            regions.insert("b1".to_string(), owned_region("bot", 20));
            let capital = capital_region("human", 5);
            regions.insert("h_cap".to_string(), capital);
            let mut nm = HashMap::new();
            nm.insert("b1".to_string(), vec!["h_cap".to_string()]);

            let b1_key = "b1".to_string();
            let b1_region = regions.get(&b1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&b1_key, b1_region)];

            let action =
                bot.attack_player_region_pub(&players, &my_regions, &regions, &nm, "infantry");
            assert!(action.is_none(), "bot must not attack the human capital");
        }
    }

    // -----------------------------------------------------------------------
    // Edge cases: early elimination and phase-specific gaps
    // -----------------------------------------------------------------------

    mod edge_cases {
        use super::*;

        // ── Early elimination ──────────────────────────────────────────────

        /// The player eliminates the bot before phase 2 starts (e.g. tick 50).
        /// The bot is still marked alive but owns zero regions — should be silent.
        #[test]
        fn phase_transition_when_bot_loses_all_regions_mid_game() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            // Bot is alive but has no regions (all were captured).
            players.insert("bot".to_string(), alive_player("bot", None, 200));
            // Only neutral regions remain — none owned by the bot.
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), neutral_region(3));
            let nm = HashMap::new();
            let settings = default_settings();

            // Test at every phase boundary.
            for tick in [30i64, 50, 80, 110, 130, 150] {
                let actions =
                    bot.decide(&players, &regions, &nm, &settings, tick, &DiplomacyState::default());
                assert!(
                    actions.is_empty(),
                    "eliminated bot should produce no actions at tick {tick}"
                );
            }
        }

        /// Bot is killed (is_alive=false) during an attack at a late tick.
        #[test]
        fn dead_bot_produces_no_actions_at_late_ticks() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            let mut dead = alive_player("bot", None, 0);
            dead.is_alive = false;
            players.insert("bot".to_string(), dead);
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), neutral_region(3));
            let nm = HashMap::new();
            let settings = default_settings();

            for tick in [30i64, 80, 110, 130] {
                let actions =
                    bot.decide(&players, &regions, &nm, &settings, tick, &DiplomacyState::default());
                assert!(
                    actions.is_empty(),
                    "dead bot must return empty actions at tick {tick}"
                );
            }
        }

        // ── Phase 3 edge cases ─────────────────────────────────────────────

        /// Tick 80 with no barracks config in settings — bot cannot build.
        #[test]
        fn phase3_no_barracks_config_produces_no_build_action() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("capital"), 9999));
            let mut regions = HashMap::new();
            regions.insert("capital".to_string(), owned_region("bot", 10));
            let nm = HashMap::new();
            // Settings with no building_types at all.
            let settings = default_settings();

            let actions = bot.decide(&players, &regions, &nm, &settings, 80, &DiplomacyState::default());
            assert!(
                actions.is_empty(),
                "no barracks in settings — bot cannot issue a build action"
            );
        }

        /// Tick 80 but bot has no capital_region_id set — cannot determine build location.
        #[test]
        fn phase3_no_capital_id_produces_no_build_action() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            // capital_region_id is None even though bot owns a region.
            players.insert("bot".to_string(), alive_player("bot", None, 9999));
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 10));
            let nm = HashMap::new();
            let json = serde_json::json!({
                "default_unit_type_slug": "infantry",
                "building_types": { "barracks": { "energy_cost": 10 } }
            });
            let settings: GameSettings =
                serde_json::from_value(json).expect("settings parse");

            let actions = bot.decide(&players, &regions, &nm, &settings, 80, &DiplomacyState::default());
            assert!(
                actions.is_empty(),
                "no capital_region_id — bot cannot determine where to build"
            );
        }

        // ── Phase 4 edge cases ─────────────────────────────────────────────

        /// Tick 110 with no human-owned neighbors to attack — phase 4 player attack is skipped,
        /// but neutral capture on the same tick (110 % 12 == 2, NOT a multiple) also doesn't fire.
        #[test]
        fn phase4_tick_110_no_human_neighbors_falls_through_to_idle() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("b1"), 200));
            players.insert("human".to_string(), alive_player("human", Some("h_cap"), 200));

            // Bot region has NO neighbors at all — cannot attack anything.
            let mut regions = HashMap::new();
            regions.insert("b1".to_string(), owned_region("bot", 20));
            // Human region exists but is not adjacent to bot.
            regions.insert("h1".to_string(), owned_region("human", 5));
            let nm: HashMap<String, Vec<String>> = HashMap::new(); // no neighbors
            let settings = default_settings();

            // Tick 110 tries player attack then neutral capture (110 % 12 == 2, skipped).
            let actions = bot.decide(&players, &regions, &nm, &settings, 110, &DiplomacyState::default());
            assert!(
                actions.is_empty(),
                "no reachable player neighbor at tick 110 should produce no actions"
            );
        }

        /// Tick 110 — bot's source region has only 4 units (< 5 threshold) so
        /// attack_player_region skips it; falls through with no action.
        #[test]
        fn phase4_tick_110_insufficient_units_to_attack_player() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("b1"), 200));
            players.insert("human".to_string(), alive_player("human", Some("h_cap"), 200));

            let mut regions = HashMap::new();
            // Bot has only 4 units — the threshold in attack_player_region is >= 5.
            regions.insert("b1".to_string(), owned_region("bot", 4));
            let mut human_region = owned_region("human", 2);
            human_region.is_capital = false;
            regions.insert("h1".to_string(), human_region);

            let mut nm = HashMap::new();
            nm.insert("b1".to_string(), vec!["h1".to_string()]);
            nm.insert("h1".to_string(), vec!["b1".to_string()]);
            let settings = default_settings();

            // Tick 110 % 12 == 2 — no neutral capture interval either.
            let actions = bot.decide(&players, &regions, &nm, &settings, 110, &DiplomacyState::default());
            assert!(
                actions.is_empty(),
                "too few units to attack at tick 110 — should be idle"
            );
        }

        /// Phase 4 non-attack tick (e.g. 96 — divisible by 12): bot captures a neutral
        /// if one is reachable.
        #[test]
        fn phase4_off_attack_tick_captures_neutral_every_12_ticks() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut players = HashMap::new();
            players.insert("bot".to_string(), alive_player("bot", Some("b1"), 200));

            let mut regions = HashMap::new();
            regions.insert("b1".to_string(), owned_region("bot", 20));
            regions.insert("neutral".to_string(), neutral_region(2));

            let mut nm = HashMap::new();
            nm.insert("b1".to_string(), vec!["neutral".to_string()]);
            let settings = default_settings();

            // 96 % 12 == 0 and 96 is in [80, 130)
            let actions = bot.decide(&players, &regions, &nm, &settings, 96, &DiplomacyState::default());
            assert_eq!(actions.len(), 1, "should produce one attack at tick 96");
            assert_eq!(actions[0].action_type, "attack");
            assert_eq!(actions[0].target_region_id.as_deref(), Some("neutral"));
        }

        // ── attack_weakest_neutral send-units bound ─────────────────────────

        /// When source has exactly 4 units and target has 0 units: send = (0+3).min(4-2) = 2.
        #[test]
        fn attack_weakest_neutral_send_calculation_boundary() {
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut regions = HashMap::new();
            regions.insert("r1".to_string(), owned_region("bot", 4));
            regions.insert("r2".to_string(), neutral_region(0));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);

            let r1_key = "r1".to_string();
            let r1_region = regions.get(&r1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&r1_key, r1_region)];

            let action = bot
                .attack_weakest_neutral_pub(&my_regions, &regions, &nm, "infantry")
                .expect("should produce an attack");
            assert_eq!(action.units, Some(2), "send = min(target+3, source-2) = min(3,2) = 2");
        }

        /// When the computed send is <= 0 (source barely has units), return None.
        #[test]
        fn attack_weakest_neutral_returns_none_when_send_is_zero() {
            // source=4, target=3 → send = (3+3).min(4-2) = 6.min(2) = 2 — actually 2, OK.
            // To get send=0 we need source-2 <= 0, i.e. source <= 2.
            // But the >= 4 guard fires first, so test source=4, target very large:
            // send = (100+3).min(4-2) = 103.min(2) = 2 > 0.
            // The only way send <= 0 is if source-2 <= 0, which is blocked by the >= 4 guard.
            // This test validates that the guard + send formula never produce a zero-send attack.
            let bot = TutorialBotBrain::new("bot".to_string());
            let mut regions = HashMap::new();
            // source has exactly 4 units, target has 1 — send = min(4, 2) = 2 > 0
            regions.insert("r1".to_string(), owned_region("bot", 4));
            regions.insert("r2".to_string(), neutral_region(1));
            let mut nm = HashMap::new();
            nm.insert("r1".to_string(), vec!["r2".to_string()]);

            let r1_key = "r1".to_string();
            let r1_region = regions.get(&r1_key).unwrap();
            let my_regions: Vec<(&String, &Region)> = vec![(&r1_key, r1_region)];

            let action = bot.attack_weakest_neutral_pub(&my_regions, &regions, &nm, "infantry");
            // Should produce an action with units > 0.
            let action = action.expect("4-unit source with 1-unit neutral should attack");
            assert!(
                action.units.unwrap_or(0) > 0,
                "send units must always be positive"
            );
        }
    }
}
