import uuid
from typing import Optional
from ninja import Schema


class ItemOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    description: str
    item_type: str
    rarity: str
    icon: str
    asset_key: str
    is_stackable: bool
    is_tradeable: bool
    is_consumable: bool
    base_value: int

    class Config:
        from_attributes = True


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
    match_id: Optional[uuid.UUID] = None
    created_at: str

    class Config:
        from_attributes = True


class OpenCrateInSchema(Schema):
    crate_item_slug: str
    key_item_slug: str
