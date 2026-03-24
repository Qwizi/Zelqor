from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0018_weather_and_day_night_toggles"),
    ]

    operations = [
        # Weather modifiers - GameSettings
        migrations.AddField(
            model_name="gamesettings",
            name="night_defense_modifier",
            field=models.FloatField(default=1.15, help_text="Defense multiplier at night (e.g. 1.15 = +15%)"),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="dawn_dusk_defense_modifier",
            field=models.FloatField(default=1.05, help_text="Defense multiplier at dawn/dusk (e.g. 1.05 = +5%)"),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="storm_randomness_modifier",
            field=models.FloatField(
                default=1.4, help_text="Combat randomness multiplier during storms (e.g. 1.4 = +40%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="fog_randomness_modifier",
            field=models.FloatField(
                default=1.25, help_text="Combat randomness multiplier during fog (e.g. 1.25 = +25%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="rain_randomness_modifier",
            field=models.FloatField(
                default=1.1, help_text="Combat randomness multiplier during rain (e.g. 1.1 = +10%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="storm_energy_modifier",
            field=models.FloatField(
                default=0.85, help_text="Energy generation multiplier during storms (e.g. 0.85 = -15%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="rain_energy_modifier",
            field=models.FloatField(
                default=0.95, help_text="Energy generation multiplier during rain (e.g. 0.95 = -5%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="storm_unit_gen_modifier",
            field=models.FloatField(
                default=0.90, help_text="Unit generation multiplier during storms (e.g. 0.90 = -10%)"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="rain_unit_gen_modifier",
            field=models.FloatField(default=0.95, help_text="Unit generation multiplier during rain (e.g. 0.95 = -5%)"),
        ),
        # Gameplay limits - GameSettings
        migrations.AddField(
            model_name="gamesettings",
            name="disconnect_grace_seconds",
            field=models.PositiveIntegerField(
                default=180, help_text="Seconds before disconnected player is eliminated"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="max_build_queue_per_region",
            field=models.PositiveIntegerField(default=3, help_text="Max simultaneous build orders per region"),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="max_unit_queue_per_region",
            field=models.PositiveIntegerField(
                default=4, help_text="Max simultaneous unit production orders per region"
            ),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="casualty_factor",
            field=models.FloatField(default=0.5, help_text="Portion of power difference that kills units (0-1)"),
        ),
        migrations.AddField(
            model_name="gamesettings",
            name="snapshot_interval_ticks",
            field=models.PositiveIntegerField(default=30, help_text="Save state snapshot every N ticks"),
        ),
        # Weather modifiers - GameMode
        migrations.AddField(
            model_name="gamemode",
            name="night_defense_modifier",
            field=models.FloatField(default=1.15, help_text="Defense multiplier at night (e.g. 1.15 = +15%)"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="dawn_dusk_defense_modifier",
            field=models.FloatField(default=1.05, help_text="Defense multiplier at dawn/dusk (e.g. 1.05 = +5%)"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="storm_randomness_modifier",
            field=models.FloatField(
                default=1.4, help_text="Combat randomness multiplier during storms (e.g. 1.4 = +40%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="fog_randomness_modifier",
            field=models.FloatField(
                default=1.25, help_text="Combat randomness multiplier during fog (e.g. 1.25 = +25%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="rain_randomness_modifier",
            field=models.FloatField(
                default=1.1, help_text="Combat randomness multiplier during rain (e.g. 1.1 = +10%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="storm_energy_modifier",
            field=models.FloatField(
                default=0.85, help_text="Energy generation multiplier during storms (e.g. 0.85 = -15%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="rain_energy_modifier",
            field=models.FloatField(
                default=0.95, help_text="Energy generation multiplier during rain (e.g. 0.95 = -5%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="storm_unit_gen_modifier",
            field=models.FloatField(
                default=0.90, help_text="Unit generation multiplier during storms (e.g. 0.90 = -10%)"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="rain_unit_gen_modifier",
            field=models.FloatField(default=0.95, help_text="Unit generation multiplier during rain (e.g. 0.95 = -5%)"),
        ),
        # Gameplay limits - GameMode
        migrations.AddField(
            model_name="gamemode",
            name="disconnect_grace_seconds",
            field=models.PositiveIntegerField(
                default=180, help_text="Seconds before disconnected player is eliminated"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="max_build_queue_per_region",
            field=models.PositiveIntegerField(default=3, help_text="Max simultaneous build orders per region"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="max_unit_queue_per_region",
            field=models.PositiveIntegerField(
                default=4, help_text="Max simultaneous unit production orders per region"
            ),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="casualty_factor",
            field=models.FloatField(default=0.5, help_text="Portion of power difference that kills units (0-1)"),
        ),
        migrations.AddField(
            model_name="gamemode",
            name="snapshot_interval_ticks",
            field=models.PositiveIntegerField(default=30, help_text="Save state snapshot every N ticks"),
        ),
    ]
