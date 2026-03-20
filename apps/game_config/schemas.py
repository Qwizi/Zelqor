import uuid
from typing import Optional, List
from ninja import Schema


def _resolve_game_asset_url(asset_key: str) -> Optional[str]:
    """Look up a GameAsset by key and return its file URL, or None."""
    if not asset_key:
        return None
    from apps.assets.models import GameAsset
    try:
        asset = GameAsset.objects.get(key=asset_key, is_active=True)
        return asset.file.url if asset.file else None
    except GameAsset.DoesNotExist:
        return None


def _resolve_asset(obj) -> Optional[str]:
    """Resolve asset URL via GameAsset lookup by asset_key."""
    return _resolve_game_asset_url(obj.asset_key)


class GameSettingsOutSchema(Schema):
    max_players: int
    min_players: int
    tick_interval_ms: int
    capital_selection_time_seconds: int
    match_duration_limit_minutes: int
    base_unit_generation_rate: float
    capital_generation_bonus: float
    starting_energy: int
    base_energy_per_tick: float
    region_energy_per_tick: float
    attacker_advantage: float
    defender_advantage: float
    combat_randomness: float
    starting_units: int
    starting_regions: int
    weather_enabled: bool
    day_night_enabled: bool
    night_defense_modifier: float
    dawn_dusk_defense_modifier: float
    storm_randomness_modifier: float
    fog_randomness_modifier: float
    rain_randomness_modifier: float
    storm_energy_modifier: float
    rain_energy_modifier: float
    storm_unit_gen_modifier: float
    rain_unit_gen_modifier: float
    disconnect_grace_seconds: int
    max_build_queue_per_region: int
    max_unit_queue_per_region: int
    casualty_factor: float
    snapshot_interval_ticks: int

    class Config:
        from_attributes = True


class BuildingTypeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    asset_key: str
    description: str
    icon: str
    cost: int = 0
    energy_cost: int = 0
    build_time_ticks: int = 1
    max_per_region: int
    requires_coastal: bool
    defense_bonus: float
    vision_range: int
    unit_generation_bonus: float
    energy_generation_bonus: float
    max_level: int
    level_stats: dict
    order: int

    @staticmethod
    def resolve_cost(obj):
        return (obj.level_stats or {}).get('1', {}).get('cost', 0)

    @staticmethod
    def resolve_energy_cost(obj):
        return (obj.level_stats or {}).get('1', {}).get('energy_cost', 0)

    @staticmethod
    def resolve_build_time_ticks(obj):
        return (obj.level_stats or {}).get('1', {}).get('build_time_ticks', 1)
    asset_url: Optional[str] = None

    @staticmethod
    def resolve_asset_url(obj):
        return _resolve_asset(obj)

    class Config:
        from_attributes = True


class UnitTypeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    asset_key: str
    description: str
    icon: str
    attack: float
    defense: float
    speed: int
    attack_range: int
    sea_range: int
    sea_hop_distance_km: int
    produced_by_id: Optional[uuid.UUID] = None
    produced_by_slug: Optional[str] = None
    production_cost: int = 0
    production_time_ticks: int = 0
    manpower_cost: int = 1
    movement_type: str
    max_level: int
    level_stats: dict
    is_stealth: bool

    @staticmethod
    def resolve_production_cost(obj):
        return (obj.level_stats or {}).get('1', {}).get('production_cost', 0)

    @staticmethod
    def resolve_production_time_ticks(obj):
        return (obj.level_stats or {}).get('1', {}).get('production_time_ticks', 0)

    @staticmethod
    def resolve_manpower_cost(obj):
        return (obj.level_stats or {}).get('1', {}).get('manpower_cost', 1)
    path_damage: float
    aoe_damage: float
    blockade_port: bool
    intercept_air: bool
    can_station_anywhere: bool
    lifetime_ticks: int
    combat_target: str
    ticks_per_hop: int
    air_speed_ticks_per_hop: int
    order: int
    asset_url: Optional[str] = None

    @staticmethod
    def resolve_asset_url(obj):
        return _resolve_asset(obj)

    class Config:
        from_attributes = True


class MapConfigOutSchema(Schema):
    id: uuid.UUID
    name: str
    description: str
    country_codes: List[str]
    is_active: bool

    class Config:
        from_attributes = True


class GameModeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    max_players: int
    min_players: int
    tick_interval_ms: int
    capital_selection_time_seconds: int
    match_duration_limit_minutes: int
    base_unit_generation_rate: float
    capital_generation_bonus: float
    starting_energy: int
    base_energy_per_tick: float
    region_energy_per_tick: float
    attacker_advantage: float
    defender_advantage: float
    combat_randomness: float
    starting_units: int
    starting_regions: int
    neutral_region_units: int
    weather_enabled: bool
    day_night_enabled: bool
    night_defense_modifier: float
    dawn_dusk_defense_modifier: float
    storm_randomness_modifier: float
    fog_randomness_modifier: float
    rain_randomness_modifier: float
    storm_energy_modifier: float
    rain_energy_modifier: float
    storm_unit_gen_modifier: float
    rain_unit_gen_modifier: float
    disconnect_grace_seconds: int
    max_build_queue_per_region: int
    max_unit_queue_per_region: int
    casualty_factor: float
    snapshot_interval_ticks: int
    elo_k_factor: int
    map_config_id: Optional[uuid.UUID] = None
    is_active: bool
    is_default: bool
    order: int

    class Config:
        from_attributes = True


class GameModeListSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    max_players: int
    min_players: int
    is_default: bool
    order: int

    class Config:
        from_attributes = True


class AbilityTypeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    asset_key: str
    description: str
    icon: str
    sound_key: str
    target_type: str
    range: int
    energy_cost: int
    cooldown_ticks: int
    damage: int
    effect_duration_ticks: int
    effect_params: dict
    max_level: int
    level_stats: dict
    order: int
    asset_url: Optional[str] = None
    sound_url: Optional[str] = None

    @staticmethod
    def resolve_asset_url(obj):
        return _resolve_asset(obj)

    @staticmethod
    def resolve_sound_url(obj):
        return _resolve_game_asset_url(obj.sound_key)

    class Config:
        from_attributes = True


class SystemModuleOutSchema(Schema):
    id: uuid.UUID
    slug: str
    name: str
    description: str
    icon: str
    module_type: str
    enabled: bool
    config: dict
    config_schema: list
    affects_backend: bool
    affects_frontend: bool
    affects_gateway: bool
    is_core: bool
    order: int
    # Game module fields
    default_enabled: bool
    default_config: dict
    field_mapping: dict

    class Config:
        from_attributes = True


class GameModuleOutSchema(Schema):
    """Backward-compatible schema for game-type modules."""
    id: uuid.UUID
    slug: str
    name: str
    description: str
    icon: str
    default_enabled: bool
    default_config: dict
    config_schema: list
    order: int

    class Config:
        from_attributes = True


class FullConfigOutSchema(Schema):
    settings: GameSettingsOutSchema
    buildings: List[BuildingTypeOutSchema]
    units: List[UnitTypeOutSchema]
    abilities: List[AbilityTypeOutSchema]
    maps: List[MapConfigOutSchema]
    game_modes: List[GameModeListSchema]
    modules: List[GameModuleOutSchema]
    system_modules: List[SystemModuleOutSchema]
