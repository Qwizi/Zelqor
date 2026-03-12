import uuid
from typing import Optional, List
from ninja import Schema


class GameSettingsOutSchema(Schema):
    max_players: int
    min_players: int
    tick_interval_ms: int
    capital_selection_time_seconds: int
    match_duration_limit_minutes: int
    base_unit_generation_rate: float
    capital_generation_bonus: float
    starting_currency: int
    base_currency_per_tick: float
    region_currency_per_tick: float
    attacker_advantage: float
    defender_advantage: float
    combat_randomness: float
    starting_units: int
    starting_regions: int

    class Config:
        from_attributes = True


class BuildingTypeOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    asset_key: str
    description: str
    icon: str
    cost: int
    currency_cost: int
    build_time_ticks: int
    max_per_region: int
    requires_coastal: bool
    defense_bonus: float
    vision_range: int
    unit_generation_bonus: float
    currency_generation_bonus: float
    order: int

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
    production_cost: int
    production_time_ticks: int
    manpower_cost: int
    movement_type: str
    order: int

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
    starting_currency: int
    base_currency_per_tick: float
    region_currency_per_tick: float
    attacker_advantage: float
    defender_advantage: float
    combat_randomness: float
    starting_units: int
    starting_regions: int
    neutral_region_units: int
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
    currency_cost: int
    cooldown_ticks: int
    damage: int
    effect_duration_ticks: int
    effect_params: dict
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
