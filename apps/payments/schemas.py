import uuid
from datetime import datetime

from ninja import Schema

from apps.inventory.schemas import ItemOutSchema


class GemWalletOutSchema(Schema):
    gems: int
    total_purchased: int
    total_spent: int

    class Config:
        from_attributes = True


class GemPackageOutSchema(Schema):
    id: uuid.UUID
    name: str
    slug: str
    gems: int
    bonus_gems: int
    total_gems: int
    price_cents: int
    currency: str
    icon: str
    is_featured: bool
    order: int

    class Config:
        from_attributes = True


class CreateCheckoutInSchema(Schema):
    package_slug: str
    idempotency_key: str


class CreateCheckoutOutSchema(Schema):
    session_url: str
    order_id: str


class ShopItemOutSchema(Schema):
    id: uuid.UUID
    item: ItemOutSchema
    gem_price: int
    original_gem_price: int | None = None
    shop_category: str
    quantity: int
    available_until: datetime | None = None
    order: int = 0

    class Config:
        from_attributes = True


class BuyShopItemInSchema(Schema):
    shop_item_id: uuid.UUID


class BuyShopItemOutSchema(Schema):
    id: uuid.UUID
    item: ItemOutSchema
    quantity: int
    gems_spent: int
    gem_balance: int
    created_at: datetime

    class Config:
        from_attributes = True


class GemTransactionOutSchema(Schema):
    id: uuid.UUID
    amount: int
    reason: str
    balance_after: int
    note: str
    created_at: datetime

    class Config:
        from_attributes = True


class PurchaseOrderOutSchema(Schema):
    id: uuid.UUID
    gem_package: GemPackageOutSchema
    gems_credited: int
    price_cents: int
    currency: str
    status: str
    created_at: datetime
    completed_at: datetime | None = None

    class Config:
        from_attributes = True
