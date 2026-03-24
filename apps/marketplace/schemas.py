import uuid
from datetime import datetime

from ninja import Schema

from apps.inventory.schemas import ItemOutSchema


class MarketListingOutSchema(Schema):
    id: uuid.UUID
    seller_username: str
    item: ItemOutSchema
    listing_type: str
    quantity: int
    quantity_remaining: int
    price_per_unit: int
    status: str
    is_bot_listing: bool
    created_at: datetime
    expires_at: datetime | None = None

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_seller_username(obj):
        return obj.seller.username


class CreateListingInSchema(Schema):
    item_slug: str
    listing_type: str  # 'sell' or 'buy'
    quantity: int
    price_per_unit: int


class BuyFromListingInSchema(Schema):
    listing_id: uuid.UUID
    quantity: int


class MarketTransactionOutSchema(Schema):
    id: uuid.UUID
    buyer_username: str
    seller_username: str
    item: ItemOutSchema
    quantity: int
    price_per_unit: int
    total_price: int
    fee: int
    created_at: datetime

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_buyer_username(obj):
        return obj.buyer.username

    @staticmethod
    def resolve_seller_username(obj):
        return obj.seller.username


class MarketConfigOutSchema(Schema):
    transaction_fee_percent: float
    listing_duration_hours: int
    max_active_listings_per_user: int

    class Config:
        from_attributes = True
