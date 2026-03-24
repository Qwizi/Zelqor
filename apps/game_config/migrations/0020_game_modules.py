import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0019_configurable_weather_modifiers_and_gameplay_limits"),
    ]

    operations = [
        migrations.CreateModel(
            name="GameModule",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=100)),
                ("description", models.TextField(blank=True)),
                ("icon", models.CharField(blank=True, default="", max_length=50)),
                (
                    "default_enabled",
                    models.BooleanField(default=True, help_text="Default enabled state for new matches"),
                ),
                (
                    "default_config",
                    models.JSONField(blank=True, default=dict, help_text="Default configuration parameters as JSON"),
                ),
                ("config_schema", models.JSONField(blank=True, default=list, help_text="Describes available fields")),
                (
                    "field_mapping",
                    models.JSONField(blank=True, default=dict, help_text="Maps module to flat settings fields"),
                ),
                (
                    "is_active",
                    models.BooleanField(default=True, help_text="Whether this module is available in the system"),
                ),
                ("order", models.PositiveIntegerField(default=0)),
            ],
            options={
                "ordering": ["order", "name"],
            },
        ),
        migrations.CreateModel(
            name="GameSettingsModuleOverride",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("enabled", models.BooleanField(default=True)),
                (
                    "config",
                    models.JSONField(
                        blank=True, default=dict, help_text="Override config values (merged with module defaults)"
                    ),
                ),
                (
                    "game_settings",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="module_overrides",
                        to="game_config.gamesettings",
                    ),
                ),
                (
                    "module",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="settings_overrides",
                        to="game_config.gamemodule",
                    ),
                ),
            ],
            options={
                "ordering": ["module__order"],
                "unique_together": {("game_settings", "module")},
            },
        ),
        migrations.CreateModel(
            name="GameModeModuleOverride",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("enabled", models.BooleanField(default=True)),
                (
                    "config",
                    models.JSONField(
                        blank=True, default=dict, help_text="Override config values (merged with module defaults)"
                    ),
                ),
                (
                    "game_mode",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="module_overrides",
                        to="game_config.gamemode",
                    ),
                ),
                (
                    "module",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="mode_overrides",
                        to="game_config.gamemodule",
                    ),
                ),
            ],
            options={
                "ordering": ["module__order"],
                "unique_together": {("game_mode", "module")},
            },
        ),
    ]
