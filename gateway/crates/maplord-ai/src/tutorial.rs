use crate::BotStrategy;
use maplord_engine::{Action, GameSettings, Player, Region};
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

        // ── Phase 3 (tick 80): Build barracks on capital ──
        if current_tick == 80 {
            if let Some(capital_id) = &player.capital_region_id {
                if let Some(capital) = regions.get(capital_id) {
                    let barracks_count =
                        capital.buildings.get("barracks").copied().unwrap_or(0);
                    if barracks_count < 1 {
                        if let Some(cfg) = settings.building_types.get("barracks") {
                            if player.currency >= cfg.currency_cost {
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
                                });
                            }
                        }
                    }
                }
            }
            return actions;
        }

        // ── Phase 4 (ticks 80-130): Keep capturing neutrals + one attack on player ──
        if current_tick < 130 {
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
        })
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
