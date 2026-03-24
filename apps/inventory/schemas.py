import uuid
from datetime import datetime

from ninja import Schema


class RenameInstanceInSchema(Schema):
    nametag: str = ""


class DeckItemSlotSchema(Schema):
    """Input schema for a single item slot when updating a deck."""

    item_slug: str
    quantity: int


class DeckCreateSchema(Schema):
    name: str


class DeckUpdateSchema(Schema):
    name: str | None = None
    items: list[DeckItemSlotSchema] | None = None


class ItemOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    item_type: str
    rarity: str
    icon: str
    cosmetic_slot: str
    is_stackable: bool
    is_tradeable: bool
    is_consumable: bool
    base_value: int
    level: int
    blueprint_ref: str = ""
    boost_params: dict | None = None
    cosmetic_params: dict | None = None
    crate_loot_table: list | None = None

    class Config:
        from_attributes = True


class ItemInstanceOutSchema(Schema):
    id: uuid.UUID
    item: ItemOutSchema
    pattern_seed: int
    wear: float
    wear_condition: str
    stattrak: bool
    stattrak_matches: int = 0
    stattrak_kills: int = 0
    stattrak_units_produced: int = 0
    nametag: str = ""
    is_rare_pattern: bool
    first_owner_username: str | None = None
    crafted_by_username: str | None = None
    created_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_wear_condition(obj):
        return obj.wear_condition.value if hasattr(obj.wear_condition, "value") else obj.wear_condition

    @staticmethod
    def resolve_is_rare_pattern(obj):
        return obj.is_rare_pattern

    @staticmethod
    def resolve_first_owner_username(obj):
        return obj.first_owner.username if obj.first_owner else None

    @staticmethod
    def resolve_crafted_by_username(obj):
        return obj.crafted_by.username if obj.crafted_by else None


class ItemCategoryOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    items: list[ItemOutSchema] = []

    class Config:
        from_attributes = True


class InventoryItemOutSchema(Schema):
    id: uuid.UUID
    item: ItemOutSchema
    quantity: int

    class Config:
        from_attributes = True


class WalletOutSchema(Schema):
    gold: int
    total_earned: int
    total_spent: int

    class Config:
        from_attributes = True


class ItemDropOutSchema(Schema):
    id: uuid.UUID
    item: ItemOutSchema
    quantity: int
    source: str
    match_id: uuid.UUID | None = None
    instance: ItemInstanceOutSchema | None = None
    created_at: datetime

    class Config:
        from_attributes = True


class OpenCrateInSchema(Schema):
    crate_item_slug: str
    key_item_slug: str


class DeckItemOutSchema(Schema):
    item: ItemOutSchema
    quantity: int
    instance: ItemInstanceOutSchema | None = None

    class Config:
        from_attributes = True


class DeckOutSchema(Schema):
    id: uuid.UUID
    name: str
    is_default: bool
    is_editable: bool
    items: list[DeckItemOutSchema] = []

    class Config:
        from_attributes = True


class EquipCosmeticInSchema(Schema):
    item_slug: str
    instance_id: str | None = None


class UnequipCosmeticInSchema(Schema):
    slot: str


class EquippedCosmeticOutSchema(Schema):
    slot: str
    item_slug: str
    item_name: str
    asset_url: str | None = None
    cosmetic_params: dict | None = None
    instance: ItemInstanceOutSchema | None = None

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_item_slug(obj):
        return obj.item.slug

    @staticmethod
    def resolve_item_name(obj):
        return obj.item.name

    @staticmethod
    def resolve_asset_url(obj):
        if obj.item.cosmetic_asset and obj.item.cosmetic_asset.file:
            return obj.item.cosmetic_asset.file.url
        return None

    @staticmethod
    def resolve_cosmetic_params(obj):
        return obj.item.cosmetic_params

    @staticmethod
    def resolve_instance(obj):
        return obj.instance if obj.instance_id else None
