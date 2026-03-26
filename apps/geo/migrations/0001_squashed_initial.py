"""
Squashed migration replacing 0001–0004.

On production databases where 0001–0004 are already applied, Django sees
the `replaces` list and marks this migration as applied automatically —
no manual fake-migrate needed.

On fresh databases this creates the final schema directly (JSONField,
no PostGIS dependency).
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    replaces = [
        ("geo", "0001_initial"),
        ("geo", "0002_region_map_source_id_region_sea_distances"),
        ("geo", "0003_region_game_map_fields"),
        ("geo", "0004_remove_postgis_fields"),
    ]

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Country",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("code", models.CharField(max_length=3, unique=True)),
                ("geometry", models.JSONField(blank=True, default=dict, help_text="GeoJSON geometry (MultiPolygon)")),
            ],
            options={
                "verbose_name_plural": "countries",
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="Region",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("map_source_id", models.PositiveIntegerField(null=True, blank=True, db_index=True)),
                ("geometry", models.JSONField(blank=True, default=dict, help_text="GeoJSON geometry (MultiPolygon)")),
                ("centroid", models.JSONField(blank=True, default=list, help_text="[lon, lat] coordinate pair")),
                ("is_coastal", models.BooleanField(default=False)),
                ("sea_distances", models.JSONField(default=list, blank=True)),
                ("population_weight", models.FloatField(default=1.0, help_text="Weight for unit generation rate")),
                (
                    "polygons_data",
                    models.JSONField(
                        blank=True,
                        default=list,
                        help_text='Polygon rings in game pixel coords: [{"name": ..., "points": [...]}, ...]',
                    ),
                ),
                (
                    "centroid_game",
                    models.JSONField(blank=True, default=list, help_text="Centroid [x, y] in game pixel coords"),
                ),
                ("tiles", models.JSONField(blank=True, default=list, help_text='Grid tile positions: ["x,y", ...]')),
                (
                    "tile_chunks",
                    models.JSONField(blank=True, default=list, help_text='Texture chunk coords: ["cx,cy", ...]'),
                ),
                ("border_tiles", models.JSONField(blank=True, default=list, help_text="Border tile positions")),
                (
                    "buildings_data",
                    models.JSONField(blank=True, default=dict, help_text="Building placement data from source map"),
                ),
                ("capital_data", models.JSONField(blank=True, default=dict, help_text="Capital position and UI data")),
                ("e_points", models.IntegerField(default=0, help_text="Economy/energy points")),
                ("coast_port_tile", models.CharField(blank=True, default="", max_length=20)),
                ("is_zone", models.BooleanField(default=False)),
                ("is_enabled", models.BooleanField(default=True)),
                (
                    "country",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="regions",
                        to="geo.country",
                    ),
                ),
                ("neighbors", models.ManyToManyField(blank=True, to="geo.region")),
            ],
            options={
                "ordering": ["country__name", "name"],
            },
        ),
    ]
