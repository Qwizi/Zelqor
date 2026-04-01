wit_bindgen::generate!({
    world: "zelqor-plugin",
    path: "../zelqor-plugin-sdk/wit/plugin.wit",
});

use exports::zelqor::plugin::game_hooks::*;

struct SpeedBoostPlugin;

export!(SpeedBoostPlugin);

/// Speed Boost Plugin — increases unit movement count during the first
/// 30 ticks of each match by modifying the `on_unit_move` event.
impl Guest for SpeedBoostPlugin {
    fn on_tick(ctx: TickContext) -> Vec<String> {
        // Emit a speed-boost-active event while within the boost window.
        if ctx.tick <= 30 {
            vec!["speed_boost_active".into()]
        } else {
            vec![]
        }
    }

    fn on_unit_move(event: UnitMoveEvent) -> Option<UnitMoveEvent> {
        // During the first 30 seconds a move carries 50% more units.
        // The tick isn't available here, so we use host config to check
        // if the boost is still active (set by on_tick).
        let boosted = zelqor::plugin::plugin_api::get_config("speed_boost_active");
        if boosted.is_some() {
            let extra = event.count / 2; // +50%
            Some(UnitMoveEvent {
                count: event.count + extra,
                ..event
            })
        } else {
            Some(event)
        }
    }

    // ── Passthrough / no-op hooks ──────────────────────────────────

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
    fn on_chat_message(_event: ChatEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_vote_start(_event: VoteEvent) {}
    fn on_vote_end(_event: VoteEvent) {}
    fn on_config_reload(_match_id: String, config_json: String) -> Option<String> { Some(config_json) }
}
