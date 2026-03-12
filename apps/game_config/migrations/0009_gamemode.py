import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("game_config", "0008_unittype_sea_range"),
    ]

    operations = [
        migrations.CreateModel(
            name="GameMode",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=100, unique=True)),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("description", models.TextField(blank=True)),
                ("max_players", models.PositiveIntegerField(default=2, help_text="Maximum players per match")),
                ("min_players", models.PositiveIntegerField(default=2, help_text="Minimum players to start match")),
                ("tick_interval_ms", models.PositiveIntegerField(default=1000, help_text="Game tick interval in milliseconds")),
                ("capital_selection_time_seconds", models.PositiveIntegerField(default=30, help_text="Time to select capital")),
                ("match_duration_limit_minutes", models.PositiveIntegerField(default=60, help_text="Max match duration (0=unlimited)")),
                ("base_unit_generation_rate", models.FloatField(default=1.0, help_text="Units generated per tick per region")),
                ("capital_generation_bonus", models.FloatField(default=2.0, help_text="Multiplier for capital region")),
                ("starting_currency", models.PositiveIntegerField(default=120, help_text="Starting strategic currency for each player")),
                ("base_currency_per_tick", models.FloatField(default=2.0, help_text="Base currency generated per tick for each player")),
                ("region_currency_per_tick", models.FloatField(default=0.35, help_text="Currency generated per owned region each tick")),
                ("attacker_advantage", models.FloatField(default=0.0, help_text="Bonus for attacker (e.g. 0.1 = 10%)")),
                ("defender_advantage", models.FloatField(default=0.1, help_text="Bonus for defender (e.g. 0.1 = 10%)")),
                ("combat_randomness", models.FloatField(default=0.2, help_text="Random factor in combat (0-1)")),
                ("starting_units", models.PositiveIntegerField(default=10, help_text="Units in capital at start")),
                ("starting_regions", models.PositiveIntegerField(default=1, help_text="Number of starting regions")),
                ("neutral_region_units", models.PositiveIntegerField(default=3, help_text="Garrison units in unowned (neutral) regions")),
                ("elo_k_factor", models.PositiveIntegerField(default=32, help_text="K-factor for ELO calculation")),
                (
                    "map_config",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="game_modes",
                        to="game_config.mapconfig",
                    ),
                ),
                ("is_active", models.BooleanField(default=True)),
                ("is_default", models.BooleanField(default=False, help_text="Default game mode shown first")),
                ("order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ["order", "name"],
            },
        ),
    ]
