from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display
from apps.game_config.models import GameSettings, BuildingType, UnitType, MapConfig, GameMode, AbilityType


@admin.register(GameSettings)
class GameSettingsAdmin(ModelAdmin):
    warn_unsaved_form = True
    compressed_fields = True
    fieldsets = (
        ('Match Settings', {'fields': ('max_players', 'min_players')}),
        ('Timing', {'fields': ('tick_interval_ms', 'capital_selection_time_seconds', 'match_duration_limit_minutes')}),
        ('Unit Generation', {'fields': ('base_unit_generation_rate', 'capital_generation_bonus')}),
        ('Combat', {'fields': ('attacker_advantage', 'defender_advantage', 'combat_randomness')}),
        ('Starting Conditions', {'fields': ('starting_units', 'starting_regions')}),
        ('ELO', {'fields': ('elo_k_factor',)}),
    )

    def has_add_permission(self, request):
        return not GameSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(GameMode)
class GameModeAdmin(ModelAdmin):
    list_display = ('name', 'slug', 'min_players', 'max_players', 'display_active', 'is_default', 'order')
    list_filter = ('is_active', 'is_default')
    list_filter_submit = True
    list_fullwidth = True
    list_editable = ('is_default', 'order')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    warn_unsaved_form = True
    compressed_fields = True
    fieldsets = (
        (None, {'fields': ('name', 'slug', 'description', 'map_config', 'is_active', 'is_default', 'order')}),
        ('Match Settings', {'fields': ('max_players', 'min_players')}),
        ('Timing', {'fields': ('tick_interval_ms', 'capital_selection_time_seconds', 'match_duration_limit_minutes')}),
        ('Economy', {'fields': ('starting_energy', 'base_energy_per_tick', 'region_energy_per_tick', 'base_unit_generation_rate', 'capital_generation_bonus')}),
        ('Combat', {'fields': ('attacker_advantage', 'defender_advantage', 'combat_randomness')}),
        ('Starting Conditions', {'fields': ('starting_units', 'starting_regions', 'neutral_region_units')}),
        ('ELO', {'fields': ('elo_k_factor',)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


class UnitTypeInline(TabularInline):
    model = UnitType
    extra = 0
    fields = ('name', 'slug', 'icon', 'attack', 'defense', 'speed', 'attack_range', 'sea_range', 'sea_hop_distance_km', 'movement_type', 'production_cost', 'production_time_ticks', 'is_active')


@admin.register(BuildingType)
class BuildingTypeAdmin(ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'cost', 'build_time_ticks', 'requires_coastal', 'defense_bonus', 'max_level', 'display_active', 'order')
    list_filter = ('is_active', 'requires_coastal')
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    warn_unsaved_form = True
    inlines = [UnitTypeInline]
    fieldsets = (
        (None, {'fields': ('name', 'slug', 'asset_key', 'description', 'icon', 'is_active', 'order')}),
        ('Costs & Timing', {'fields': ('cost', 'energy_cost', 'build_time_ticks', 'max_per_region', 'requires_coastal')}),
        ('Passive Bonuses', {'fields': ('defense_bonus', 'vision_range', 'unit_generation_bonus', 'energy_generation_bonus')}),
        ('Poziomy (Level System)', {'fields': ('max_level', 'level_stats'), 'classes': ('collapse',)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(UnitType)
class UnitTypeAdmin(ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'attack', 'defense', 'speed', 'attack_range', 'sea_range', 'sea_hop_distance_km', 'movement_type', 'produced_by', 'production_cost', 'max_level', 'display_active', 'order')
    list_filter = ('is_active', 'movement_type', 'produced_by')
    list_filter_submit = True
    list_fullwidth = True
    list_horizontal_scrollbar_top = True
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    warn_unsaved_form = True
    fieldsets = (
        (None, {'fields': ('name', 'slug', 'asset_key', 'description', 'icon', 'is_active', 'order')}),
        ('Stats', {'fields': ('attack', 'defense', 'speed', 'attack_range', 'sea_range', 'sea_hop_distance_km', 'movement_type')}),
        ('Production', {'fields': ('produced_by', 'production_cost', 'production_time_ticks', 'manpower_cost')}),
        ('Poziomy (Level System)', {'fields': ('max_level', 'level_stats'), 'classes': ('collapse',)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(AbilityType)
class AbilityTypeAdmin(ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'target_type', 'range', 'energy_cost', 'cooldown_ticks', 'damage', 'effect_duration_ticks', 'max_level', 'display_active', 'order')
    list_filter = ('is_active', 'target_type')
    list_filter_submit = True
    list_fullwidth = True
    list_horizontal_scrollbar_top = True
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    list_editable = ('order',)
    warn_unsaved_form = True
    fieldsets = (
        (None, {'fields': ('name', 'slug', 'asset_key', 'description', 'icon', 'sound_key', 'is_active', 'order')}),
        ('Targeting', {'fields': ('target_type', 'range')}),
        ('Costs & Timing', {'fields': ('energy_cost', 'cooldown_ticks')}),
        ('Effects', {'fields': ('damage', 'effect_duration_ticks', 'effect_params')}),
        ('Poziomy (Level System)', {'fields': ('max_level', 'level_stats'), 'classes': ('collapse',)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(MapConfig)
class MapConfigAdmin(ModelAdmin):
    list_display = ('name', 'display_active', 'created_at')
    list_filter = ('is_active',)
    list_fullwidth = True
    search_fields = ('name',)
    warn_unsaved_form = True

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"
