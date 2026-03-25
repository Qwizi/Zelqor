import uuid

from django.db import models


class Country(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=3, unique=True)  # ISO 3166-1 alpha-3
    geometry = models.JSONField(default=dict, blank=True, help_text="GeoJSON geometry (MultiPolygon)")

    class Meta:
        verbose_name_plural = "countries"
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} ({self.code})"


class Region(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    country = models.ForeignKey(Country, on_delete=models.CASCADE, related_name="regions")
    map_source_id = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    geometry = models.JSONField(default=dict, blank=True, help_text="GeoJSON geometry (MultiPolygon)")
    centroid = models.JSONField(default=list, blank=True, help_text="[lon, lat] coordinate pair")
    neighbors = models.ManyToManyField("self", symmetrical=True, blank=True)
    is_coastal = models.BooleanField(default=False)
    sea_distances = models.JSONField(default=list, blank=True)
    population_weight = models.FloatField(default=1.0, help_text="Weight for unit generation rate")

    # Native game map data (from provinces_source_v2.json)
    polygons_data = models.JSONField(
        default=list,
        blank=True,
        help_text='Polygon rings in game pixel coords: [{"name": ..., "points": [...]}, ...]',
    )
    centroid_game = models.JSONField(
        default=list,
        blank=True,
        help_text="Centroid [x, y] in game pixel coords",
    )
    tiles = models.JSONField(
        default=list,
        blank=True,
        help_text='Grid tile positions: ["x,y", ...]',
    )
    tile_chunks = models.JSONField(
        default=list,
        blank=True,
        help_text='Texture chunk coords: ["cx,cy", ...]',
    )
    border_tiles = models.JSONField(
        default=list,
        blank=True,
        help_text="Border tile positions",
    )
    buildings_data = models.JSONField(
        default=dict,
        blank=True,
        help_text="Building placement data from source map",
    )
    capital_data = models.JSONField(
        default=dict,
        blank=True,
        help_text="Capital position and UI data",
    )
    e_points = models.IntegerField(default=0, help_text="Economy/energy points")
    coast_port_tile = models.CharField(max_length=20, blank=True, default="")
    is_zone = models.BooleanField(default=False)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["country__name", "name"]

    def __str__(self):
        return f"{self.name}, {self.country.name}"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
