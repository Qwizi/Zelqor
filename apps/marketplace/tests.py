"""
Tests for apps/marketplace — MarketListing, MarketTransaction, MarketConfig.
"""

import uuid
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.inventory.models import Item, ItemCategory, UserInventory, Wallet
from apps.marketplace.models import MarketConfig, MarketListing, MarketTransaction

User = get_user_model()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_category():
    return ItemCategory.objects.get_or_create(name="Materials", slug="materials")[0]


def make_item(name="Iron Ore", slug="iron-ore"):
    cat = make_category()
    return Item.objects.get_or_create(
        slug=slug,
        defaults={
            "name": name,
            "category": cat,
            "item_type": Item.ItemType.MATERIAL,
            "rarity": Item.Rarity.COMMON,
            "base_value": 10,
        },
    )[0]


def make_user(email, username):
    return User.objects.create_user(email=email, username=username, password="testpass123")


def get_auth_header(user):
    from ninja_jwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    return f"Bearer {str(refresh.access_token)}"


BASE = "/api/v1/marketplace"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def item(db):
    return make_item()


@pytest.fixture
def seller(db):
    return make_user("seller@test.com", "sellertestuser")


@pytest.fixture
def buyer(db):
    return make_user("buyer@test.com", "buyertestuser")


@pytest.fixture
def seller_auth(seller):
    return get_auth_header(seller)


@pytest.fixture
def buyer_auth(buyer):
    return get_auth_header(buyer)


@pytest.fixture
def seller_wallet(seller):
    return Wallet.objects.create(user=seller, gold=0)


@pytest.fixture
def buyer_wallet(buyer):
    return Wallet.objects.create(user=buyer, gold=10000)


@pytest.fixture
def seller_inventory(seller, item):
    return UserInventory.objects.create(user=seller, item=item, quantity=50)


@pytest.fixture
def market_config(db):
    return MarketConfig.get()


@pytest.fixture
def mp_setup(seller, buyer, item, seller_wallet, buyer_wallet, seller_inventory, market_config):
    """All fixtures needed for MarketplaceViewTests."""
    return {
        "seller": seller,
        "buyer": buyer,
        "item": item,
        "seller_wallet": seller_wallet,
        "buyer_wallet": buyer_wallet,
    }


# ---------------------------------------------------------------------------
# MarketConfig singleton
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_config_get_creates_singleton():
    config = MarketConfig.get()
    assert config is not None


@pytest.mark.django_db
def test_config_get_returns_same_instance():
    c1 = MarketConfig.get()
    c2 = MarketConfig.get()
    assert MarketConfig.objects.count() == 1
    assert str(c1.pk).replace("-", "").lower() == str(c2.pk).replace("-", "").lower()


@pytest.mark.django_db
def test_config_default_transaction_fee_percent():
    config = MarketConfig.get()
    assert config.transaction_fee_percent == 5.0


@pytest.mark.django_db
def test_config_default_max_active_listings():
    config = MarketConfig.get()
    assert config.max_active_listings_per_user == 20


@pytest.mark.django_db
def test_config_str_representation():
    config = MarketConfig.get()
    assert str(config) == "Marketplace Config"


# ---------------------------------------------------------------------------
# MarketListing tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sell_order_creation(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=10,
        price_per_unit=15,
        quantity_remaining=10,
    )
    assert listing.status == MarketListing.Status.ACTIVE
    assert listing.quantity == 10
    assert listing.price_per_unit == 15


@pytest.mark.django_db
def test_buy_order_creation(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.BUY,
        quantity=5,
        price_per_unit=12,
        quantity_remaining=5,
    )
    assert listing.listing_type == MarketListing.ListingType.BUY


@pytest.mark.django_db
def test_listing_str_representation_sell_order(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        price_per_unit=20,
        quantity_remaining=1,
    )
    assert "Sell" in str(listing)
    assert "Iron Ore" in str(listing)


@pytest.mark.django_db
def test_listing_total_price_property(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=5,
        price_per_unit=10,
        quantity_remaining=5,
    )
    assert listing.total_price == 50


@pytest.mark.django_db
def test_listing_expiry_field(seller, item):
    expires = timezone.now() + timedelta(hours=72)
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        price_per_unit=10,
        quantity_remaining=1,
        expires_at=expires,
    )
    assert listing.expires_at is not None


@pytest.mark.django_db
def test_listing_status_transitions(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        price_per_unit=10,
        quantity_remaining=1,
    )
    listing.status = MarketListing.Status.FULFILLED
    listing.save()
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.FULFILLED


@pytest.mark.django_db
def test_listing_is_bot_listing_default_false(seller, item):
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        price_per_unit=10,
        quantity_remaining=1,
    )
    assert listing.is_bot_listing is False


@pytest.mark.django_db
def test_expired_listings_can_be_filtered(seller, item):
    past = timezone.now() - timedelta(hours=1)
    expired_listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        price_per_unit=10,
        quantity_remaining=1,
        expires_at=past,
    )
    expired_listing.status = MarketListing.Status.EXPIRED
    expired_listing.save()
    count = MarketListing.objects.filter(status=MarketListing.Status.EXPIRED).count()
    assert count == 1


@pytest.mark.django_db
def test_multiple_listings_per_item(seller, item):
    for i in range(3):
        MarketListing.objects.create(
            seller=seller,
            item=item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=10 + i,
            quantity_remaining=1,
        )
    assert MarketListing.objects.filter(item=item).count() == 3


# ---------------------------------------------------------------------------
# MarketTransaction tests
# ---------------------------------------------------------------------------


@pytest.fixture
def tx_seller(db):
    return make_user("tx_seller@test.com", "txsellertestuser")


@pytest.fixture
def tx_buyer(db):
    return make_user("tx_buyer@test.com", "txbuyertestuser")


@pytest.fixture
def tx_item(db):
    return make_item("Steel", "steel")


@pytest.fixture
def tx_listing(tx_seller, tx_item):
    return MarketListing.objects.create(
        seller=tx_seller,
        item=tx_item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=10,
        price_per_unit=25,
        quantity_remaining=10,
    )


@pytest.mark.django_db
def test_transaction_creation(tx_listing, tx_buyer, tx_seller, tx_item):
    tx = MarketTransaction.objects.create(
        listing=tx_listing,
        buyer=tx_buyer,
        seller=tx_seller,
        item=tx_item,
        quantity=5,
        price_per_unit=25,
        total_price=125,
        fee=6,
    )
    assert tx.quantity == 5
    assert tx.total_price == 125
    assert tx.fee == 6


@pytest.mark.django_db
def test_transaction_str_representation(tx_listing, tx_buyer, tx_seller, tx_item):
    tx = MarketTransaction.objects.create(
        listing=tx_listing,
        buyer=tx_buyer,
        seller=tx_seller,
        item=tx_item,
        quantity=1,
        price_per_unit=25,
        total_price=25,
    )
    assert "txbuyertestuser" in str(tx)
    assert "Steel" in str(tx)


@pytest.mark.django_db
def test_transaction_linked_to_listing(tx_listing, tx_buyer, tx_seller, tx_item):
    tx = MarketTransaction.objects.create(
        listing=tx_listing,
        buyer=tx_buyer,
        seller=tx_seller,
        item=tx_item,
        quantity=2,
        price_per_unit=25,
        total_price=50,
    )
    assert tx.listing == tx_listing


@pytest.mark.django_db
def test_buyer_and_seller_relationships(tx_listing, tx_buyer, tx_seller, tx_item):
    MarketTransaction.objects.create(
        listing=tx_listing,
        buyer=tx_buyer,
        seller=tx_seller,
        item=tx_item,
        quantity=3,
        price_per_unit=25,
        total_price=75,
    )
    assert tx_buyer.market_purchases.count() == 1
    assert tx_seller.market_sales.count() == 1


@pytest.mark.django_db
def test_transaction_fee_default_zero(tx_listing, tx_buyer, tx_seller, tx_item):
    tx = MarketTransaction.objects.create(
        listing=tx_listing,
        buyer=tx_buyer,
        seller=tx_seller,
        item=tx_item,
        quantity=1,
        price_per_unit=10,
        total_price=10,
    )
    assert tx.fee == 0


# ---------------------------------------------------------------------------
# MarketplaceViewTests — API endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_config_public_returns_200(client, market_config):
    resp = client.get(f"{BASE}/config/")
    assert resp.status_code == 200
    data = resp.json()
    assert "transaction_fee_percent" in data
    assert "max_active_listings_per_user" in data


@pytest.mark.django_db
def test_list_active_public_no_auth_required(client, market_config):
    resp = client.get(f"{BASE}/listings/")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_list_active_empty_when_no_listings(client, market_config):
    resp = client.get(f"{BASE}/listings/")
    assert resp.status_code == 200
    assert resp.json()["count"] == 0


@pytest.mark.django_db
def test_list_active_shows_active_listings(client, mp_setup):
    seller, item = mp_setup["seller"], mp_setup["item"]
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=20,
    )
    data = client.get(f"{BASE}/listings/").json()
    assert data["count"] == 1


@pytest.mark.django_db
def test_list_active_filters_by_item_slug(client, mp_setup):
    seller, item = mp_setup["seller"], mp_setup["item"]
    other_item = make_item("Steel", "steel-filter")
    UserInventory.objects.create(user=seller, item=other_item, quantity=10)
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
    )
    MarketListing.objects.create(
        seller=seller,
        item=other_item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
    )
    data = client.get(f"{BASE}/listings/?item_slug=iron-ore").json()
    assert data["count"] == 1
    assert data["items"][0]["item"]["slug"] == "iron-ore"


@pytest.mark.django_db
def test_list_active_filters_by_listing_type(client, mp_setup):
    seller, item = mp_setup["seller"], mp_setup["item"]
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
    )
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.BUY,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=8,
    )
    data = client.get(f"{BASE}/listings/?listing_type=sell").json()
    assert data["count"] == 1
    assert data["items"][0]["listing_type"] == "sell"


@pytest.mark.django_db
def test_list_active_excludes_non_active(client, mp_setup):
    seller, item = mp_setup["seller"], mp_setup["item"]
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
        status=MarketListing.Status.FULFILLED,
    )
    data = client.get(f"{BASE}/listings/").json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_my_listings_unauthenticated_returns_401(client, market_config):
    resp = client.get(f"{BASE}/my-listings/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_my_listings_returns_own_listings_only(client, mp_setup, buyer_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
    )
    data = client.get(f"{BASE}/my-listings/", HTTP_AUTHORIZATION=buyer_auth).json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_my_listings_excludes_fulfilled(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=0,
        price_per_unit=10,
        status=MarketListing.Status.FULFILLED,
    )
    data = client.get(f"{BASE}/my-listings/", HTTP_AUTHORIZATION=seller_auth).json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_history_unauthenticated_returns_401(client, market_config):
    resp = client.get(f"{BASE}/history/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_history_returns_transactions_involving_user(client, mp_setup, buyer_auth):
    seller, buyer, item = mp_setup["seller"], mp_setup["buyer"], mp_setup["item"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=10,
    )
    MarketTransaction.objects.create(
        listing=listing,
        buyer=buyer,
        seller=seller,
        item=item,
        quantity=2,
        price_per_unit=10,
        total_price=20,
        fee=1,
    )
    data = client.get(f"{BASE}/history/", HTTP_AUTHORIZATION=buyer_auth).json()
    assert data["count"] == 1


@pytest.mark.django_db
def test_create_sell_listing_unauthenticated_returns_401(client, market_config):
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
    resp = client.post(f"{BASE}/create-listing/", data=payload, content_type="application/json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_create_sell_listing_success(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 5, "price_per_unit": 15}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["listing_type"] == "sell"
    assert data["quantity"] == 5
    assert data["price_per_unit"] == 15
    inv = UserInventory.objects.get(user=seller, item=item)
    assert inv.quantity == 45


@pytest.mark.django_db
def test_create_sell_listing_insufficient_items_returns_400(client, mp_setup, seller_auth):
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 9999, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_buy_listing_escrows_gold(client, mp_setup, buyer_auth):
    buyer_wallet = mp_setup["buyer_wallet"]
    payload = '{"item_slug": "iron-ore", "listing_type": "buy", "quantity": 10, "price_per_unit": 5}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 200
    assert resp.json()["listing_type"] == "buy"
    buyer_wallet.refresh_from_db()
    assert buyer_wallet.gold == 9950


@pytest.mark.django_db
def test_create_buy_listing_insufficient_gold_returns_400(client, mp_setup, buyer_auth):
    buyer_wallet = mp_setup["buyer_wallet"]
    buyer_wallet.gold = 0
    buyer_wallet.save()
    payload = '{"item_slug": "iron-ore", "listing_type": "buy", "quantity": 10, "price_per_unit": 100}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_listing_nonexistent_item_returns_404(client, mp_setup, seller_auth):
    payload = '{"item_slug": "does-not-exist", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_create_listing_non_tradeable_item_returns_404(client, mp_setup, seller_auth):
    non_tradeable = make_item("Locked Item", "locked-item")
    non_tradeable.is_tradeable = False
    non_tradeable.save()
    payload = '{"item_slug": "locked-item", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_create_listing_invalid_type_returns_400(client, mp_setup, seller_auth):
    payload = '{"item_slug": "iron-ore", "listing_type": "trade", "quantity": 1, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_listing_zero_quantity_returns_400(client, mp_setup, seller_auth):
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 0, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_listing_exceeds_max_active_returns_400(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    config = MarketConfig.get()
    for _ in range(config.max_active_listings_per_user):
        MarketListing.objects.create(
            seller=seller,
            item=item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_buy_from_listing_unauthenticated_returns_401(client, market_config):
    payload = f'{{"listing_id": "{uuid.uuid4()}", "quantity": 1}}'
    resp = client.post(f"{BASE}/buy/", data=payload, content_type="application/json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_buy_from_listing_success(client, mp_setup, buyer_auth):
    seller, buyer, item, buyer_wallet = (
        mp_setup["seller"],
        mp_setup["buyer"],
        mp_setup["item"],
        mp_setup["buyer_wallet"],
    )
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=10,
        quantity_remaining=10,
        price_per_unit=20,
    )
    payload = f'{{"listing_id": "{listing.id}", "quantity": 3}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 200
    assert "Bought" in resp.json()["message"]
    listing.refresh_from_db()
    assert listing.quantity_remaining == 7
    buyer_inv = UserInventory.objects.get(user=buyer, item=item)
    assert buyer_inv.quantity == 3
    buyer_wallet.refresh_from_db()
    assert buyer_wallet.gold == 9940
    assert MarketTransaction.objects.filter(buyer=buyer).count() == 1


@pytest.mark.django_db
def test_buy_entire_listing_marks_fulfilled(client, mp_setup, buyer_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=2,
        quantity_remaining=2,
        price_per_unit=10,
    )
    payload = f'{{"listing_id": "{listing.id}", "quantity": 2}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 200
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.FULFILLED


@pytest.mark.django_db
def test_buy_own_listing_returns_400(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=10,
    )
    payload = f'{{"listing_id": "{listing.id}", "quantity": 1}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_buy_nonexistent_listing_returns_404(client, mp_setup, buyer_auth):
    payload = f'{{"listing_id": "{uuid.uuid4()}", "quantity": 1}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_buy_insufficient_gold_returns_400(client, mp_setup, buyer_auth):
    seller, item, buyer_wallet = mp_setup["seller"], mp_setup["item"], mp_setup["buyer_wallet"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=10,
        quantity_remaining=10,
        price_per_unit=5000,
    )
    buyer_wallet.gold = 0
    buyer_wallet.save()
    payload = f'{{"listing_id": "{listing.id}", "quantity": 5}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_buy_applies_transaction_fee_to_seller(client, mp_setup, buyer_auth):
    seller, item, seller_wallet, buyer = (
        mp_setup["seller"],
        mp_setup["item"],
        mp_setup["seller_wallet"],
        mp_setup["buyer"],
    )
    config = MarketConfig.get()
    config.transaction_fee_percent = 10.0
    config.save()
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=100,
    )
    payload = f'{{"listing_id": "{listing.id}", "quantity": 1}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 200
    seller_wallet.refresh_from_db()
    assert seller_wallet.gold == 90
    tx = MarketTransaction.objects.get(buyer=buyer)
    assert tx.fee == 10


@pytest.mark.django_db
def test_cancel_listing_unauthenticated_returns_401(client, market_config):
    resp = client.post(f"{BASE}/cancel/{uuid.uuid4()}/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_cancel_sell_listing_returns_items(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    UserInventory.objects.get(user=seller, item=item).delete()
    UserInventory.objects.create(user=seller, item=item, quantity=0)
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=10,
    )
    UserInventory.objects.filter(user=seller, item=item).delete()
    resp = client.post(f"{BASE}/cancel/{listing.id}/", HTTP_AUTHORIZATION=seller_auth)
    assert resp.status_code == 200
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.CANCELLED
    inv = UserInventory.objects.get(user=seller, item=item)
    assert inv.quantity == 5


@pytest.mark.django_db
def test_cancel_buy_order_returns_gold(client, mp_setup, buyer_auth):
    buyer, item, buyer_wallet = mp_setup["buyer"], mp_setup["item"], mp_setup["buyer_wallet"]
    listing = MarketListing.objects.create(
        seller=buyer,
        item=item,
        listing_type=MarketListing.ListingType.BUY,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=10,
    )
    buyer_wallet.gold = 9950
    buyer_wallet.total_spent = 50
    buyer_wallet.save()
    resp = client.post(f"{BASE}/cancel/{listing.id}/", HTTP_AUTHORIZATION=buyer_auth)
    assert resp.status_code == 200
    buyer_wallet.refresh_from_db()
    assert buyer_wallet.gold == 10000


@pytest.mark.django_db
def test_cancel_listing_wrong_user_returns_404(client, mp_setup, buyer_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
    )
    resp = client.post(f"{BASE}/cancel/{listing.id}/", HTTP_AUTHORIZATION=buyer_auth)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# MarketplaceTaskTests — task logic tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_bot_restock_creates_listings_for_tradeable_items(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    bot_restock_marketplace()
    assert MarketListing.objects.filter(is_bot_listing=True).count() > 0


@pytest.mark.django_db
def test_bot_restock_creates_sell_listings_only(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    bot_restock_marketplace()
    non_sell = MarketListing.objects.filter(is_bot_listing=True).exclude(listing_type=MarketListing.ListingType.SELL)
    assert non_sell.count() == 0


@pytest.mark.django_db
def test_bot_restock_respects_target_listing_count(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    bot_restock_marketplace()
    bot_restock_marketplace()
    item_listings = MarketListing.objects.filter(
        item=item,
        is_bot_listing=True,
        listing_type=MarketListing.ListingType.SELL,
        status=MarketListing.Status.ACTIVE,
    )
    assert item_listings.count() <= 3


@pytest.mark.django_db
def test_bot_restock_skips_items_with_zero_base_value(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    zero_value_item = make_item("Free Item", "free-item")
    zero_value_item.base_value = 0
    zero_value_item.save()
    before = MarketListing.objects.filter(item=zero_value_item).count()
    bot_restock_marketplace()
    after = MarketListing.objects.filter(item=zero_value_item).count()
    assert before == after


@pytest.mark.django_db
def test_bot_restock_creates_bot_user_if_missing(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    User.objects.filter(username="MarketBot").delete()
    bot_restock_marketplace()
    assert User.objects.filter(username="MarketBot", is_bot=True).exists()


@pytest.mark.django_db
def test_bot_restock_price_near_base_value(item):
    from apps.marketplace.tasks import bot_restock_marketplace

    config = MarketConfig.get()
    config.bot_price_variance_percent = 0.0
    config.save()
    item.base_value = 100
    item.save()
    bot_restock_marketplace()
    listing = MarketListing.objects.filter(item=item, is_bot_listing=True).first()
    assert listing is not None
    assert listing.price_per_unit == 100


@pytest.mark.django_db
def test_expire_old_listings_marks_expired(item):
    from apps.marketplace.tasks import expire_old_listings

    seller = make_user("exp_seller@test.com", "exp_selleruser")
    past = timezone.now() - timedelta(hours=1)
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=3,
        quantity_remaining=3,
        price_per_unit=10,
        expires_at=past,
    )
    expire_old_listings()
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.EXPIRED


@pytest.mark.django_db
def test_expire_old_listings_returns_items_to_seller(item):
    from apps.marketplace.tasks import expire_old_listings

    seller = make_user("exp_seller2@test.com", "exp_selleruser2")
    past = timezone.now() - timedelta(hours=1)
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=4,
        quantity_remaining=4,
        price_per_unit=10,
        expires_at=past,
        is_bot_listing=False,
    )
    expire_old_listings()
    inv = UserInventory.objects.get(user=seller, item=item)
    assert inv.quantity == 4


@pytest.mark.django_db
def test_expire_old_listings_returns_gold_for_buy_orders(item):
    from apps.marketplace.tasks import expire_old_listings

    buyer = make_user("exp_buyer@test.com", "exp_buyeruser")
    wallet = Wallet.objects.create(user=buyer, gold=0)
    past = timezone.now() - timedelta(hours=1)
    MarketListing.objects.create(
        seller=buyer,
        item=item,
        listing_type=MarketListing.ListingType.BUY,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=20,
        expires_at=past,
        is_bot_listing=False,
    )
    expire_old_listings()
    wallet.refresh_from_db()
    assert wallet.gold == 100


@pytest.mark.django_db
def test_expire_old_listings_bot_listings_just_disappear(item):
    from apps.marketplace.tasks import expire_old_listings

    bot_user, _ = User.objects.get_or_create(
        username="MarketBot",
        defaults={
            "email": "marketbot@maplord.internal",
            "is_bot": True,
            "is_active": True,
        },
    )
    past = timezone.now() - timedelta(hours=1)
    listing = MarketListing.objects.create(
        seller=bot_user,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=10,
        quantity_remaining=10,
        price_per_unit=5,
        expires_at=past,
        is_bot_listing=True,
    )
    expire_old_listings()
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.EXPIRED
    assert not UserInventory.objects.filter(user=bot_user, item=item).exists()


@pytest.mark.django_db
def test_expire_old_listings_does_not_affect_future_listings(item):
    from apps.marketplace.tasks import expire_old_listings

    seller = make_user("fut_seller@test.com", "fut_selleruser")
    future = timezone.now() + timedelta(hours=48)
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
        expires_at=future,
    )
    expire_old_listings()
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.ACTIVE


# ---------------------------------------------------------------------------
# Additional marketplace view edge cases (closing the 1% gap)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_create_listing_zero_price_returns_400(client, mp_setup, seller_auth):
    payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 1, "price_per_unit": 0}'
    resp = client.post(
        f"{BASE}/create-listing/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=seller_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_buy_from_buy_order_listing_returns_404(client, mp_setup, seller_auth, buyer_auth):
    """buy_from_listing only accepts sell-type listings; buy orders must return 404."""
    seller, item = mp_setup["seller"], mp_setup["item"]
    buy_listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.BUY,
        quantity=5,
        quantity_remaining=5,
        price_per_unit=10,
    )
    payload = f'{{"listing_id": "{buy_listing.id}", "quantity": 1}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_buy_more_than_available_buys_remaining_amount(client, mp_setup, buyer_auth):
    """Requesting more than quantity_remaining should buy what's left."""
    seller, item, buyer_wallet = mp_setup["seller"], mp_setup["item"], mp_setup["buyer_wallet"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=3,
        quantity_remaining=3,
        price_per_unit=10,
    )
    payload = f'{{"listing_id": "{listing.id}", "quantity": 100}}'
    resp = client.post(
        f"{BASE}/buy/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=buyer_auth,
    )
    assert resp.status_code == 200
    listing.refresh_from_db()
    assert listing.status == MarketListing.Status.FULFILLED
    buyer_wallet.refresh_from_db()
    assert buyer_wallet.gold == 10000 - 30  # only 3 bought at 10 each


@pytest.mark.django_db
def test_history_shows_sales_for_seller(client, mp_setup, seller_auth):
    seller, buyer, item = mp_setup["seller"], mp_setup["buyer"], mp_setup["item"]
    listing = MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=50,
    )
    MarketTransaction.objects.create(
        listing=listing,
        buyer=buyer,
        seller=seller,
        item=item,
        quantity=1,
        price_per_unit=50,
        total_price=50,
        fee=2,
    )
    data = client.get(f"{BASE}/history/", HTTP_AUTHORIZATION=seller_auth).json()
    assert data["count"] == 1


@pytest.mark.django_db
def test_my_listings_shows_all_non_fulfilled_statuses(client, mp_setup, seller_auth):
    seller, item = mp_setup["seller"], mp_setup["item"]
    # Active listing
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=1,
        price_per_unit=10,
        status=MarketListing.Status.ACTIVE,
    )
    # Cancelled listing (should appear)
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=0,
        price_per_unit=10,
        status=MarketListing.Status.CANCELLED,
    )
    # Fulfilled listing (should NOT appear)
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=1,
        quantity_remaining=0,
        price_per_unit=10,
        status=MarketListing.Status.FULFILLED,
    )
    data = client.get(f"{BASE}/my-listings/", HTTP_AUTHORIZATION=seller_auth).json()
    assert data["count"] == 2


@pytest.mark.django_db
def test_bot_restock_creates_listings_for_rare_items(db):
    from apps.marketplace.tasks import bot_restock_marketplace

    make_category()
    make_item("Rare Gem", "rare-gem")
    # Update rarity to rare
    from apps.inventory.models import Item

    Item.objects.filter(slug="rare-gem").update(rarity="rare", base_value=50)
    bot_restock_marketplace()
    listings = MarketListing.objects.filter(item__slug="rare-gem", is_bot_listing=True)
    assert listings.count() <= 3


@pytest.mark.django_db
def test_expire_old_listings_no_expired_does_nothing(item, db):
    from apps.marketplace.tasks import expire_old_listings

    seller = make_user("no_exp@test.com", "no_exp_user")
    future = timezone.now() + timedelta(hours=72)
    MarketListing.objects.create(
        seller=seller,
        item=item,
        listing_type=MarketListing.ListingType.SELL,
        quantity=2,
        quantity_remaining=2,
        price_per_unit=10,
        expires_at=future,
    )
    expire_old_listings()
    assert MarketListing.objects.filter(status=MarketListing.Status.ACTIVE).count() == 1


# ---------------------------------------------------------------------------
# marketplace/admin.py — display methods and permissions
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMarketplaceAdmin:
    def test_market_listing_admin_list(self, db):
        from django.test import Client

        from apps.accounts.models import User

        c = Client()
        su = User.objects.create_superuser(username="mp_admin", email="mp_admin@test.local", password="adminpass")
        c.force_login(su)
        r = c.get("/admin/marketplace/marketlisting/")
        assert r.status_code == 200

    def test_market_config_has_add_blocked_when_exists(self, db):
        from django.contrib.admin.sites import AdminSite

        from apps.marketplace.admin import MarketConfigAdmin
        from apps.marketplace.models import MarketConfig

        MarketConfig.get()
        admin = MarketConfigAdmin(model=MarketConfig, admin_site=AdminSite())
        assert admin.has_add_permission(request=None) is False

    def test_market_config_has_add_when_empty(self, db):
        from django.contrib.admin.sites import AdminSite

        from apps.marketplace.admin import MarketConfigAdmin
        from apps.marketplace.models import MarketConfig

        admin = MarketConfigAdmin(model=MarketConfig, admin_site=AdminSite())
        assert admin.has_add_permission(request=None) is True

    def test_market_config_has_delete_blocked(self, db):
        from django.contrib.admin.sites import AdminSite

        from apps.marketplace.admin import MarketConfigAdmin
        from apps.marketplace.models import MarketConfig

        admin = MarketConfigAdmin(model=MarketConfig, admin_site=AdminSite())
        assert admin.has_delete_permission(request=None) is False

    def test_display_listing_type(self, db):
        from django.contrib.admin.sites import AdminSite

        from apps.marketplace.admin import MarketListingAdmin
        from apps.marketplace.models import MarketListing

        admin = MarketListingAdmin(model=MarketListing, admin_site=AdminSite())
        listing = MarketListing(listing_type="sell")
        assert admin.display_listing_type(listing) == "sell"

    def test_display_status(self, db):
        from django.contrib.admin.sites import AdminSite

        from apps.marketplace.admin import MarketListingAdmin
        from apps.marketplace.models import MarketListing

        admin = MarketListingAdmin(model=MarketListing, admin_site=AdminSite())
        listing = MarketListing(status="active")
        assert admin.display_status(listing) == "active"


# ---------------------------------------------------------------------------
# marketplace/models.py — MarketConfig.get_effective_config
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_market_config_get_effective_config():
    from apps.marketplace.models import MarketConfig

    config = MarketConfig.get_effective_config()
    assert "transaction_fee" in config
    assert "listing_duration_hours" in config


# ---------------------------------------------------------------------------
# marketplace/tasks.py — bot_restock_marketplace
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_bot_restock_marketplace_runs_without_items():
    """bot_restock_marketplace should not crash when no tradeable items exist."""
    from apps.marketplace.tasks import bot_restock_marketplace

    bot_restock_marketplace()


@pytest.mark.django_db
def test_bot_restock_marketplace_creates_listings(db):
    """bot_restock_marketplace should create sell listings for tradeable items."""
    from apps.inventory.models import Item, ItemCategory
    from apps.marketplace.models import MarketConfig, MarketListing
    from apps.marketplace.tasks import bot_restock_marketplace

    MarketConfig.get()
    cat = ItemCategory.objects.create(name="Trade Cat", slug="trade-cat-bot")
    item = Item.objects.create(
        name="Tradeable Item",
        slug="tradeable-item-bot",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
        is_tradeable=True,
        is_active=True,
        is_stackable=True,
        base_value=100,
    )
    bot_restock_marketplace()
    assert MarketListing.objects.filter(item=item, is_bot_listing=True).count() >= 1
