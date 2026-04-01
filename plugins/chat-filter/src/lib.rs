wit_bindgen::generate!({
    world: "zelqor-plugin",
    path: "../zelqor-plugin-sdk/wit/plugin.wit",
});

use exports::zelqor::plugin::game_hooks::*;

struct ChatFilterPlugin;

export!(ChatFilterPlugin);

/// Built-in word list for the chat filter. In production this would be
/// loaded from plugin config, but for the seed plugin we ship defaults.
const BLOCKED_WORDS: &[&str] = &[
    "fuck", "shit", "ass", "bitch", "dick", "cunt", "damn",
    "bastard", "idiot", "stupid", "moron", "retard",
];

fn contains_blocked_word(message: &str) -> bool {
    let lower = message.to_lowercase();
    BLOCKED_WORDS.iter().any(|w| lower.contains(w))
}

/// Chat Filter Plugin — blocks messages containing profanity.
impl Guest for ChatFilterPlugin {
    fn on_chat_message(event: ChatEvent) -> ActionVerdict {
        if contains_blocked_word(&event.message) {
            zelqor::plugin::plugin_api::log(
                "info",
                &format!(
                    "Chat message blocked from user {} in channel {}",
                    event.user_id, event.channel
                ),
            );
            ActionVerdict::Deny
        } else {
            ActionVerdict::Allow
        }
    }

    // ── Passthrough / no-op hooks ──────────────────────────────────

    fn on_tick(_ctx: TickContext) -> Vec<String> { vec![] }
    fn on_combat(event: CombatEvent) -> Option<CombatEvent> { Some(event) }
    fn on_player_action(_action: PlayerAction) -> ActionVerdict { ActionVerdict::Allow }
    fn on_match_start(_match_id: String, _player_ids: Vec<String>) {}
    fn on_match_end(_match_id: String, _winner_id: Option<String>) {}
    fn on_player_join(_match_id: String, _user_id: String) {}
    fn on_player_leave(_match_id: String, _user_id: String) {}
    fn on_player_eliminate(_match_id: String, _user_id: String, _eliminated_by: Option<String>) {}
    fn on_economy_tick(ctx: EconomyContext) -> Option<EconomyContext> { Some(ctx) }
    fn on_energy_spend(_event: EnergyEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_unit_produce(event: UnitEvent) -> Option<UnitEvent> { Some(event) }
    fn on_unit_move(event: UnitMoveEvent) -> Option<UnitMoveEvent> { Some(event) }
    fn on_building_construct(event: BuildingEvent) -> Option<BuildingEvent> { Some(event) }
    fn on_building_upgrade(event: BuildingEvent) -> Option<BuildingEvent> { Some(event) }
    fn on_building_destroy(_event: BuildingEvent) {}
    fn on_region_capture(_event: RegionEvent) {}
    fn on_region_lose(_event: RegionEvent) {}
    fn on_diplomacy_propose(_event: DiplomacyEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_diplomacy_accept(_event: DiplomacyEvent) {}
    fn on_diplomacy_reject(_event: DiplomacyEvent) {}
    fn on_capital_select(_match_id: String, _user_id: String, _region_id: String) -> ActionVerdict { ActionVerdict::Allow }
    fn on_ability_use(event: AbilityEvent) -> Option<AbilityEvent> { Some(event) }
    fn on_nuke_launch(_event: SpecialEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_bomber_launch(_event: SpecialEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_weather_change(_match_id: String, _old_weather: String, new_weather: String) -> Option<String> { Some(new_weather) }
    fn on_day_night_change(_match_id: String, _phase: String) {}
    fn on_vote_start(_event: VoteEvent) {}
    fn on_vote_end(_event: VoteEvent) {}
    fn on_config_reload(_match_id: String, config_json: String) -> Option<String> { Some(config_json) }
}
