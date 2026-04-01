wit_bindgen::generate!({
    world: "zelqor-plugin",
    path: "../zelqor-plugin-sdk/wit/plugin.wit",
});

use exports::zelqor::plugin::game_hooks::*;

struct AutoBalancePlugin;

export!(AutoBalancePlugin);

/// Auto Balance Plugin — logs team composition on match start and
/// emits rebalance events when new players join.
impl Guest for AutoBalancePlugin {
    fn on_match_start(match_id: String, player_ids: Vec<String>) {
        zelqor::plugin::plugin_api::log(
            "info",
            &format!(
                "AutoBalance: match {} starting with {} players — requesting ELO data",
                match_id,
                player_ids.len()
            ),
        );

        // Request player data for ELO-based balancing.
        for pid in &player_ids {
            let _data = zelqor::plugin::plugin_api::get_player_data(pid);
        }

        // Emit a balance event so the engine can reshuffle teams.
        let payload = format!(
            r#"{{"match_id":"{}","player_count":{}}}"#,
            match_id,
            player_ids.len()
        );
        zelqor::plugin::plugin_api::send_event("auto_balance_request", &payload);
    }

    fn on_player_join(match_id: String, user_id: String) {
        zelqor::plugin::plugin_api::log(
            "info",
            &format!(
                "AutoBalance: player {} joined match {} — rebalancing",
                user_id, match_id
            ),
        );
        let payload = format!(
            r#"{{"match_id":"{}","new_player":"{}"}}"#,
            match_id, user_id
        );
        zelqor::plugin::plugin_api::send_event("auto_balance_rebalance", &payload);
    }

    // ── Passthrough / no-op hooks ──────────────────────────────────

    fn on_tick(_ctx: TickContext) -> Vec<String> { vec![] }
    fn on_combat(event: CombatEvent) -> Option<CombatEvent> { Some(event) }
    fn on_player_action(_action: PlayerAction) -> ActionVerdict { ActionVerdict::Allow }
    fn on_match_end(_match_id: String, _winner_id: Option<String>) {}
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
    fn on_chat_message(_event: ChatEvent) -> ActionVerdict { ActionVerdict::Allow }
    fn on_vote_start(_event: VoteEvent) {}
    fn on_vote_end(_event: VoteEvent) {}
    fn on_config_reload(_match_id: String, config_json: String) -> Option<String> { Some(config_json) }
}
