import uuid

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("game_config", "0021_seed_game_modules"),
    ]

    operations = [
        migrations.CreateModel(
            name="SystemModule",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("slug", models.SlugField(max_length=100, unique=True)),
                ("name", models.CharField(max_length=100)),
                ("description", models.TextField(blank=True)),
                ("icon", models.CharField(blank=True, default="", max_length=50)),
                ("enabled", models.BooleanField(default=True, help_text="Whether this module is currently active")),
                (
                    "config",
                    models.JSONField(blank=True, default=dict, help_text="Module-specific configuration as JSON"),
                ),
                (
                    "config_schema",
                    models.JSONField(
                        blank=True, default=list, help_text="Describes available config fields for admin UI"
                    ),
                ),
                ("affects_backend", models.BooleanField(default=True, help_text="Controls backend API endpoints")),
                ("affects_frontend", models.BooleanField(default=True, help_text="Controls frontend UI sections")),
                ("affects_gateway", models.BooleanField(default=False, help_text="Controls Rust gateway features")),
                ("is_core", models.BooleanField(default=False, help_text="Core modules cannot be disabled")),
                ("order", models.PositiveIntegerField(default=0)),
            ],
            options={
                "ordering": ["order", "name"],
            },
        ),
    ]
