from django.contrib import admin
from apps.game_config.models import GameSettings, BuildingType, UnitType, MapConfig


@admin.register(GameSettings)
class GameSettingsAdmin(admin.ModelAdmin):
    fieldsets = (
        ('Match Settings', {
            'fields': ('max_players', 'min_players'),
        }),
        ('Timing', {
            'fields': ('tick_interval_ms', 'capital_selection_time_seconds', 'match_duration_limit_minutes'),
        }),
        ('Unit Generation', {
            'fields': ('base_unit_generation_rate', 'capital_generation_bonus'),
        }),
        ('Combat', {
            'fields': ('attacker_advantage', 'defender_advantage', 'combat_randomness'),
        }),
        ('Starting Conditions', {
            'fields': ('starting_units', 'starting_regions'),
        }),
        ('ELO', {
            'fields': ('elo_k_factor',),
        }),
    )

    def has_add_permission(self, request):
        return not GameSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


class UnitTypeInline(admin.TabularInline):
    model = UnitType
    extra = 0
    fields = ('name', 'slug', 'icon', 'attack', 'defense', 'speed', 'attack_range', 'sea_range', 'sea_hop_distance_km', 'movement_type', 'production_cost', 'production_time_ticks', 'is_active')


@admin.register(BuildingType)
class BuildingTypeAdmin(admin.ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'cost', 'build_time_ticks', 'requires_coastal', 'defense_bonus', 'is_active', 'order')
    list_filter = ('is_active', 'requires_coastal')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    inlines = [UnitTypeInline]


@admin.register(UnitType)
class UnitTypeAdmin(admin.ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'attack', 'defense', 'speed', 'attack_range', 'sea_range', 'sea_hop_distance_km', 'movement_type', 'produced_by', 'production_cost', 'is_active', 'order')
    list_filter = ('is_active', 'movement_type', 'produced_by')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}


@admin.register(MapConfig)
class MapConfigAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('name',)
