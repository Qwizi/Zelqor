import uuid
from django.contrib.gis.db import models as gis_models
from django.db import models


class Country(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=3, unique=True)  # ISO 3166-1 alpha-3
    geometry = gis_models.MultiPolygonField(srid=4326, null=True, blank=True)

    class Meta:
        verbose_name_plural = 'countries'
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.code})"


class Region(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    country = models.ForeignKey(Country, on_delete=models.CASCADE, related_name='regions')
    map_source_id = models.PositiveIntegerField(null=True, blank=True, db_index=True)
    geometry = gis_models.MultiPolygonField(srid=4326)
    centroid = gis_models.PointField(srid=4326, null=True, blank=True)
    neighbors = models.ManyToManyField('self', symmetrical=True, blank=True)
    is_coastal = models.BooleanField(default=False)
    sea_distances = models.JSONField(default=list, blank=True)
    population_weight = models.FloatField(default=1.0, help_text='Weight for unit generation rate')

    class Meta:
        ordering = ['country__name', 'name']

    def __str__(self):
        return f"{self.name}, {self.country.name}"

    def save(self, *args, **kwargs):
        if self.geometry and not self.centroid:
            self.centroid = self.geometry.centroid
        super().save(*args, **kwargs)
