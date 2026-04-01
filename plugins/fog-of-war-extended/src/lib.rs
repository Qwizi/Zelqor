wit_bindgen::generate!({
    world: "zelqor-plugin",
    path: "../zelqor-plugin-sdk/wit/plugin.wit",
});

use exports::zelqor::plugin::game_hooks::*;

struct FogOfWarExtendedPlugin;

export!(FogOfWarExtendedPlugin);

/// Fog of War Extended — emits visibility zone events on region capture
/// and periodically broadcasts fog state updates.
impl Guest for FogOfWarExtendedPlugin {
    fn on_tick(ctx: TickContext) -> Vec<String> {
        // Every 10 ticks, emit a fog recalculation event.
        if ctx.tick % 10 == 0 {
            vec!["fog_recalculate".into()]
        } else {
            vec![]
        }
    }

    fn on_region_capture(event: RegionEvent) {
        // When a region is captured, broadcast visibility update.
        if let Some(new_owner) = &event.new_owner {
            let radius = zelqor::plugin::plugin_api::get_config("visibility_radius")
                .unwrap_or_else(|| "2".into());
            let payload = format!(
                r#"{{"region":"{}","owner":"{}","radius":{}}}"#,
                event.region_id, new_owner, radius
            );
            zelqor::plugin::plugin_api::send_event("fog_visibility_update", &payload);
        }
    }

    fn on_region_lose(event: RegionEvent) {
        // When a region is lost, shrink visibility.
        if let Some(old_owner) = &event.old_owner {
            let payload = format!(
                r#"{{"region":"{}","owner":"{}","action":"shrink"}}"#,
                event.region_id, old_owner
            );
            zelqor::plugin::plugin_api::send_event("fog_visibility_update", &payload);
        }
    }

    fn on_combat(event: CombatEvent) -> Option<CombatEvent> {
        // Apply fog accuracy penalty: defender gets slight advantage if
        // attacker is attacking into fog.
        let penalty: f64 = zelqor::plugin::plugin_api::get_config("fog_accuracy_penalty")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.3);

        // Reduce attacker effective units by the fog penalty (simulate
        // accuracy loss). We floor to at least 1 unit.
        let reduction = (event.attacker_units as f64 * penalty) as u32;
        let adjusted_attackers = event.attacker_units.saturating_sub(reduction).max(1);
        Some(CombatEvent {
            attacker_units: adjusted_attackers,
            ..event
        })
    }

    // ── Passthrough / no-op hooks ──────────────────────────────────

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
