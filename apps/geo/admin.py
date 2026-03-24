from django.contrib import admin
from django.contrib.gis.admin import GISModelAdmin
from django.db.models import Count
from unfold.admin import ModelAdmin

from apps.geo.models import Country, Region


class RegionInline(admin.TabularInline):
    model = Region
    extra = 0
    fields = ("name", "is_coastal", "population_weight")
    readonly_fields = ("name",)


@admin.register(Country)
class CountryAdmin(ModelAdmin, GISModelAdmin):
    list_display = ("name", "code", "region_count")
    list_fullwidth = True
    search_fields = ("name", "code")
    inlines = [RegionInline]

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(region_count=Count("regions"))

    def region_count(self, obj):
        return obj.region_count

    region_count.short_description = "Regions"


@admin.register(Region)
class RegionAdmin(ModelAdmin, GISModelAdmin):
    list_display = ("name", "country", "map_source_id", "is_coastal", "population_weight", "neighbor_count")
    list_filter = ("country", "is_coastal")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "country__name")
    readonly_fields = ("centroid", "sea_distances")
    filter_horizontal = ("neighbors",)

    def neighbor_count(self, obj):
        return obj.neighbors.count()

    neighbor_count.short_description = "Neighbors"
