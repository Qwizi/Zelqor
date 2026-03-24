"""
Test-only geo migration that replaces spatial fields with simple text fields.
This lets tests run without PostGIS or GDAL installed.
"""

import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Country",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("code", models.CharField(max_length=3, unique=True)),
                # geometry replaced with TextField so no PostGIS needed in tests
                ("geometry", models.TextField(blank=True, null=True)),
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
                # geometry/centroid replaced with TextField
                ("geometry", models.TextField(blank=True, null=True)),
                ("centroid", models.TextField(blank=True, null=True)),
                ("is_coastal", models.BooleanField(default=False)),
                ("sea_distances", models.JSONField(default=list, blank=True)),
                ("population_weight", models.FloatField(default=1.0)),
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
