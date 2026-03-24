from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.game_config.forms import SystemModuleForm
from apps.game_config.models import (
    AbilityType,
    BuildingType,
    GameMode,
    GameModeModuleOverride,
    GameSettings,
    GameSettingsModuleOverride,
    MapConfig,
    SystemModule,
    UnitType,
)


class GameSettingsModuleOverrideInline(TabularInline):
    model = GameSettingsModuleOverride
    extra = 0
    fields = ("module", "enabled", "config")
    autocomplete_fields = ("module",)


class GameModeModuleOverrideInline(TabularInline):
    model = GameModeModuleOverride
    extra = 0
    fields = ("module", "enabled", "config")
    autocomplete_fields = ("module",)


@admin.register(GameSettings)
class GameSettingsAdmin(ModelAdmin):
    warn_unsaved_form = True
    compressed_fields = True
    inlines = [GameSettingsModuleOverrideInline]
    fieldsets = (
        ("Match Settings", {"fields": ("max_players", "min_players")}),
        ("Timing", {"fields": ("tick_interval_ms", "capital_selection_time_seconds", "match_duration_limit_minutes")}),
        ("Unit Generation", {"fields": ("base_unit_generation_rate", "capital_generation_bonus")}),
        ("Combat", {"fields": ("attacker_advantage", "defender_advantage", "combat_randomness")}),
        ("Starting Conditions", {"fields": ("starting_units", "starting_regions")}),
        ("Weather & Day/Night", {"fields": ("weather_enabled", "day_night_enabled")}),
        (
            "Weather Modifiers",
            {
                "fields": (
                    "night_defense_modifier",
                    "dawn_dusk_defense_modifier",
                    "storm_randomness_modifier",
                    "fog_randomness_modifier",
                    "rain_randomness_modifier",
                    "storm_energy_modifier",
                    "rain_energy_modifier",
                    "storm_unit_gen_modifier",
                    "rain_unit_gen_modifier",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Gameplay Limits",
            {
                "fields": (
                    "disconnect_grace_seconds",
                    "max_build_queue_per_region",
                    "max_unit_queue_per_region",
                    "casualty_factor",
                    "snapshot_interval_ticks",
                )
            },
        ),
        ("ELO", {"fields": ("elo_k_factor",)}),
        (
            "Action Points",
            {
                "fields": (
                    "max_action_points",
                    "ap_regen_interval",
                    "ap_cost_attack",
                    "ap_cost_move",
                    "ap_cost_build",
                    "ap_cost_produce",
                    "ap_cost_ability",
                ),
            },
        ),
        ("Region Cooldowns", {"fields": ("region_attack_cooldown", "region_move_cooldown")}),
        (
            "Combat Fatigue",
            {
                "fields": (
                    "fatigue_attack_modifier",
                    "fatigue_defense_modifier",
                    "fatigue_attack_ticks",
                    "fatigue_defense_ticks",
                ),
            },
        ),
    )

    def has_add_permission(self, request):
        return not GameSettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(GameMode)
class GameModeAdmin(ModelAdmin):
    list_display = ("name", "slug", "min_players", "max_players", "display_active", "is_default", "order")
    list_filter = ("is_active", "is_default")
    list_filter_submit = True
    list_fullwidth = True
    list_editable = ("is_default", "order")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    warn_unsaved_form = True
    compressed_fields = True
    inlines = [GameModeModuleOverrideInline]
    fieldsets = (
        (None, {"fields": ("name", "slug", "description", "map_config", "is_active", "is_default", "order")}),
        ("Match Settings", {"fields": ("max_players", "min_players")}),
        ("Timing", {"fields": ("tick_interval_ms", "capital_selection_time_seconds", "match_duration_limit_minutes")}),
        (
            "Economy",
            {
                "fields": (
                    "starting_energy",
                    "base_energy_per_tick",
                    "region_energy_per_tick",
                    "base_unit_generation_rate",
                    "capital_generation_bonus",
                )
            },
        ),
        ("Combat", {"fields": ("attacker_advantage", "defender_advantage", "combat_randomness")}),
        ("Starting Conditions", {"fields": ("starting_units", "starting_regions", "neutral_region_units")}),
        ("Weather & Day/Night", {"fields": ("weather_enabled", "day_night_enabled")}),
        (
            "Weather Modifiers",
            {
                "fields": (
                    "night_defense_modifier",
                    "dawn_dusk_defense_modifier",
                    "storm_randomness_modifier",
                    "fog_randomness_modifier",
                    "rain_randomness_modifier",
                    "storm_energy_modifier",
                    "rain_energy_modifier",
                    "storm_unit_gen_modifier",
                    "rain_unit_gen_modifier",
                ),
                "classes": ("collapse",),
            },
        ),
        (
            "Gameplay Limits",
            {
                "fields": (
                    "disconnect_grace_seconds",
                    "max_build_queue_per_region",
                    "max_unit_queue_per_region",
                    "casualty_factor",
                    "snapshot_interval_ticks",
                )
            },
        ),
        ("ELO", {"fields": ("elo_k_factor",)}),
        (
            "Action Points",
            {
                "fields": (
                    "max_action_points",
                    "ap_regen_interval",
                    "ap_cost_attack",
                    "ap_cost_move",
                    "ap_cost_build",
                    "ap_cost_produce",
                    "ap_cost_ability",
                ),
            },
        ),
        ("Region Cooldowns", {"fields": ("region_attack_cooldown", "region_move_cooldown")}),
        (
            "Combat Fatigue",
            {
                "fields": (
                    "fatigue_attack_modifier",
                    "fatigue_defense_modifier",
                    "fatigue_attack_ticks",
                    "fatigue_defense_ticks",
                ),
            },
        ),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


class UnitTypeInline(TabularInline):
    model = UnitType
    extra = 0
    fields = (
        "name",
        "slug",
        "icon",
        "attack",
        "defense",
        "speed",
        "attack_range",
        "sea_range",
        "sea_hop_distance_km",
        "movement_type",
        "is_active",
        "combat_target",
        "is_stealth",
        "can_station_anywhere",
        "intercept_air",
    )


@admin.register(BuildingType)
class BuildingTypeAdmin(ModelAdmin):
    list_display = ("icon", "name", "slug", "requires_coastal", "defense_bonus", "max_level", "display_active", "order")
    list_filter = ("is_active", "requires_coastal")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    warn_unsaved_form = True
    inlines = [UnitTypeInline]
    fieldsets = (
        (None, {"fields": ("name", "slug", "asset_key", "description", "icon", "is_active", "order")}),
        ("Constraints", {"fields": ("max_per_region", "requires_coastal")}),
        (
            "Passive Bonuses",
            {"fields": ("defense_bonus", "vision_range", "unit_generation_bonus", "energy_generation_bonus")},
        ),
        ("Poziomy (Level System)", {"fields": ("max_level", "level_stats"), "classes": ("collapse",)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(UnitType)
class UnitTypeAdmin(ModelAdmin):
    list_display = (
        "icon",
        "name",
        "slug",
        "attack",
        "defense",
        "speed",
        "attack_range",
        "sea_range",
        "sea_hop_distance_km",
        "movement_type",
        "produced_by",
        "max_level",
        "display_active",
        "order",
    )
    list_filter = ("is_active", "movement_type", "produced_by")
    list_filter_submit = True
    list_fullwidth = True
    list_horizontal_scrollbar_top = True
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    warn_unsaved_form = True
    fieldsets = (
        (None, {"fields": ("name", "slug", "asset_key", "description", "icon", "is_active", "order")}),
        (
            "Stats",
            {
                "fields": (
                    "attack",
                    "defense",
                    "speed",
                    "attack_range",
                    "sea_range",
                    "sea_hop_distance_km",
                    "movement_type",
                    "ticks_per_hop",
                    "air_speed_ticks_per_hop",
                )
            },
        ),
        ("Production", {"fields": ("produced_by",)}),
        ("Poziomy (Level System)", {"fields": ("max_level", "level_stats"), "classes": ("collapse",)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(AbilityType)
class AbilityTypeAdmin(ModelAdmin):
    list_display = (
        "icon",
        "name",
        "slug",
        "target_type",
        "range",
        "energy_cost",
        "cooldown_ticks",
        "damage",
        "effect_duration_ticks",
        "max_level",
        "display_active",
        "order",
    )
    list_filter = ("is_active", "target_type")
    list_filter_submit = True
    list_fullwidth = True
    list_horizontal_scrollbar_top = True
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    list_editable = ("order",)
    warn_unsaved_form = True
    fieldsets = (
        (None, {"fields": ("name", "slug", "asset_key", "description", "icon", "sound_key", "is_active", "order")}),
        ("Targeting", {"fields": ("target_type", "range")}),
        ("Costs & Timing", {"fields": ("energy_cost", "cooldown_ticks")}),
        ("Effects", {"fields": ("damage", "effect_duration_ticks", "effect_params")}),
        ("Poziomy (Level System)", {"fields": ("max_level", "level_stats"), "classes": ("collapse",)}),
    )

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(MapConfig)
class MapConfigAdmin(ModelAdmin):
    list_display = ("name", "display_active", "created_at")
    list_filter = ("is_active",)
    list_fullwidth = True
    search_fields = ("name",)
    warn_unsaved_form = True

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(SystemModule)
class SystemModuleAdmin(ModelAdmin):
    form = SystemModuleForm
    list_display = (
        "icon",
        "name",
        "slug",
        "display_type",
        "enabled",
        "display_enabled",
        "display_layers",
        "display_core",
        "order",
    )
    list_filter = ("module_type", "enabled", "is_core", "affects_backend", "affects_frontend", "affects_gateway")
    list_filter_submit = True
    list_fullwidth = True
    list_editable = ("enabled", "order")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    warn_unsaved_form = True

    # All real model fields — used by get_form to avoid FieldError on dynamic cfg__ fields
    _model_fields = [
        "name",
        "slug",
        "description",
        "icon",
        "module_type",
        "order",
        "enabled",
        "is_core",
        "affects_backend",
        "affects_frontend",
        "affects_gateway",
        "config",
        "config_schema",
        "default_enabled",
        "default_config",
        "field_mapping",
    ]

    def get_form(self, request, obj=None, **kwargs):
        kwargs["fields"] = self._model_fields
        return super().get_form(request, obj, **kwargs)

    def get_fieldsets(self, request, obj=None):
        is_game = obj and obj.module_type == "game"

        base = [
            (None, {"fields": ("name", "slug", "description", "icon", "module_type", "order")}),
            ("State", {"fields": ("enabled", "is_core")}),
            ("Affected Layers", {"fields": ("affects_backend", "affects_frontend", "affects_gateway")}),
        ]
        if obj and obj.config_schema:
            cfg_fields = [f"cfg__{f['key']}" for f in obj.config_schema if f.get("key")]
            if cfg_fields:
                base.append(("Module Configuration", {"fields": cfg_fields}))
        if is_game:
            base.append(
                (
                    "Game Module Defaults",
                    {
                        "fields": ("default_enabled", "field_mapping"),
                        "classes": ("collapse",),
                    },
                )
            )
        raw_fields = ("config", "config_schema") if not is_game else ("default_config", "config_schema")
        base.append(
            (
                "Raw JSON (advanced)",
                {
                    "fields": raw_fields,
                    "classes": ("collapse",),
                },
            )
        )
        return base

    @display(
        description="Type",
        label={
            "SYSTEM": "info",
            "GAME": "warning",
        },
    )
    def display_type(self, obj):
        return obj.module_type.upper()

    @display(
        description="Status",
        label={
            "ON": "success",
            "OFF": "danger",
        },
    )
    def display_enabled(self, obj):
        return "ON" if obj.enabled else "OFF"

    @display(description="Layers")
    def display_layers(self, obj):
        layers = []
        if obj.affects_backend:
            layers.append("BE")
        if obj.affects_frontend:
            layers.append("FE")
        if obj.affects_gateway:
            layers.append("GW")
        return ", ".join(layers) or "-"

    @display(
        description="Core",
        label={
            "CORE": "warning",
            "-": "info",
        },
    )
    def display_core(self, obj):
        return "CORE" if obj.is_core else "-"
