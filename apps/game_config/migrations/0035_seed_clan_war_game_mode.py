import uuid
from django.db import migrations


def create_clan_war_game_mode(apps, schema_editor):
    GameMode = apps.get_model('game_config', 'GameMode')

    if GameMode.objects.filter(slug='clan-war').exists():
        return

    GameMode.objects.create(
        id=uuid.uuid4(),
        name='Wojna Klanowa',
        slug='clan-war',
        description='Mecz klanowy. Wszyscy gracze z klanu walczą razem.',
        max_players=6,
        min_players=4,
        is_active=True,
        is_default=False,
        # Timing — same sensible defaults as other modes
        tick_interval_ms=1000,
        capital_selection_time_seconds=30,
        match_duration_limit_minutes=60,
        # Unit generation
        base_unit_generation_rate=1.0,
        capital_generation_bonus=2.0,
        starting_energy=120,
        base_energy_per_tick=2.0,
        region_energy_per_tick=0.35,
        # Combat
        attacker_advantage=0.0,
        defender_advantage=0.1,
        combat_randomness=0.2,
        # Starting conditions
        starting_units=10,
        starting_regions=1,
        neutral_region_units=3,
        # Weather & day/night
        weather_enabled=True,
        day_night_enabled=True,
        # Weather gameplay modifiers
        night_defense_modifier=1.15,
        dawn_dusk_defense_modifier=1.05,
        storm_randomness_modifier=1.4,
        fog_randomness_modifier=1.25,
        rain_randomness_modifier=1.1,
        storm_energy_modifier=0.85,
        rain_energy_modifier=0.95,
        storm_unit_gen_modifier=0.90,
        rain_unit_gen_modifier=0.95,
        # Gameplay limits
        disconnect_grace_seconds=180,
        max_build_queue_per_region=3,
        max_unit_queue_per_region=4,
        casualty_factor=0.5,
        snapshot_interval_ticks=30,
        # ELO — higher K so clan wars matter more
        elo_k_factor=48,
        # Diplomacy
        capital_protection_ticks=300,
        nap_minimum_duration_ticks=300,
        peace_cooldown_ticks=120,
        proposal_timeout_ticks=60,
        diplomacy_enabled=True,
        # Action Points
        max_action_points=15,
        ap_regen_interval=2,
        ap_cost_attack=4,
        ap_cost_move=1,
        ap_cost_build=1,
        ap_cost_produce=0,
        ap_cost_ability=3,
        # Region Cooldowns
        region_attack_cooldown=0,
        region_move_cooldown=2,
        # Combat Fatigue
        fatigue_attack_modifier=0.30,
        fatigue_defense_modifier=0.20,
        fatigue_attack_ticks=5,
        fatigue_defense_ticks=3,
        order=10,
    )


def remove_clan_war_game_mode(apps, schema_editor):
    GameMode = apps.get_model('game_config', 'GameMode')
    GameMode.objects.filter(slug='clan-war').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('game_config', '0034_rebalance_ap_system'),
    ]

    operations = [
        migrations.RunPython(create_clan_war_game_mode, remove_clan_war_game_mode),
    ]
