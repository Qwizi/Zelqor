mod strategy;
mod tutorial;

pub use strategy::BotBrain;
pub use tutorial::TutorialBotBrain;

use maplord_engine::{Action, DiplomacyState, GameSettings, Player, Region};
use std::collections::HashMap;

pub trait BotStrategy: Send + Sync {
    fn decide(
        &self,
        players: &HashMap<String, Player>,
        regions: &HashMap<String, Region>,
        neighbor_map: &HashMap<String, Vec<String>>,
        settings: &GameSettings,
        current_tick: i64,
        diplomacy: &DiplomacyState,
    ) -> Vec<Action>;
}
