"""
Tests for apps/marketplace — MarketListing, MarketTransaction, MarketConfig.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.inventory.models import Item, ItemCategory, UserInventory, Wallet
from apps.marketplace.models import MarketConfig, MarketListing, MarketTransaction

User = get_user_model()


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


# ---------------------------------------------------------------------------
# MarketConfig singleton
# ---------------------------------------------------------------------------


class MarketConfigTests(TestCase):
    def test_get_creates_singleton(self):
        config = MarketConfig.get()
        self.assertIsNotNone(config)

    def test_get_returns_same_instance(self):
        c1 = MarketConfig.get()
        c2 = MarketConfig.get()
        # Both calls should return the same singleton row
        self.assertEqual(MarketConfig.objects.count(), 1)
        # PKs should resolve to the same UUID value
        self.assertEqual(
            str(c1.pk).replace("-", "").lower(),
            str(c2.pk).replace("-", "").lower(),
        )

    def test_default_transaction_fee_percent(self):
        config = MarketConfig.get()
        self.assertEqual(config.transaction_fee_percent, 5.0)

    def test_default_max_active_listings(self):
        config = MarketConfig.get()
        self.assertEqual(config.max_active_listings_per_user, 20)

    def test_str_representation(self):
        config = MarketConfig.get()
        self.assertEqual(str(config), "Marketplace Config")


# ---------------------------------------------------------------------------
# MarketListing tests
# ---------------------------------------------------------------------------


class MarketListingTests(TestCase):
    def setUp(self):
        self.seller = make_user("seller@test.com", "sellertestuser")
        self.item = make_item()

    def test_sell_order_creation(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=10,
            price_per_unit=15,
            quantity_remaining=10,
        )
        self.assertEqual(listing.status, MarketListing.Status.ACTIVE)
        self.assertEqual(listing.quantity, 10)
        self.assertEqual(listing.price_per_unit, 15)

    def test_buy_order_creation(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.BUY,
            quantity=5,
            price_per_unit=12,
            quantity_remaining=5,
        )
        self.assertEqual(listing.listing_type, MarketListing.ListingType.BUY)

    def test_str_representation_sell_order(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=20,
            quantity_remaining=1,
        )
        self.assertIn("Sell", str(listing))
        self.assertIn("Iron Ore", str(listing))

    def test_total_price_property(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=5,
            price_per_unit=10,
            quantity_remaining=5,
        )
        self.assertEqual(listing.total_price, 50)

    def test_listing_expiry_field(self):
        expires = timezone.now() + timedelta(hours=72)
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=10,
            quantity_remaining=1,
            expires_at=expires,
        )
        self.assertIsNotNone(listing.expires_at)

    def test_status_transitions(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=10,
            quantity_remaining=1,
        )
        listing.status = MarketListing.Status.FULFILLED
        listing.save()
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.FULFILLED)

    def test_is_bot_listing_default_false(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=10,
            quantity_remaining=1,
        )
        self.assertFalse(listing.is_bot_listing)

    def test_expired_listings_can_be_filtered(self):
        """Items past expires_at can be queried."""
        past = timezone.now() - timedelta(hours=1)
        expired_listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            price_per_unit=10,
            quantity_remaining=1,
            expires_at=past,
        )
        expired_listing.status = MarketListing.Status.EXPIRED
        expired_listing.save()
        count = MarketListing.objects.filter(status=MarketListing.Status.EXPIRED).count()
        self.assertEqual(count, 1)

    def test_multiple_listings_per_item(self):
        make_user("buyer@test.com", "buyertestuser")
        for i in range(3):
            MarketListing.objects.create(
                seller=self.seller,
                item=self.item,
                listing_type=MarketListing.ListingType.SELL,
                quantity=1,
                price_per_unit=10 + i,
                quantity_remaining=1,
            )
        self.assertEqual(MarketListing.objects.filter(item=self.item).count(), 3)


# ---------------------------------------------------------------------------
# MarketTransaction tests
# ---------------------------------------------------------------------------


class MarketTransactionTests(TestCase):
    def setUp(self):
        self.seller = make_user("tx_seller@test.com", "txsellertestuser")
        self.buyer = make_user("tx_buyer@test.com", "txbuyertestuser")
        self.item = make_item("Steel", "steel")
        self.listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=10,
            price_per_unit=25,
            quantity_remaining=10,
        )

    def test_transaction_creation(self):
        tx = MarketTransaction.objects.create(
            listing=self.listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=5,
            price_per_unit=25,
            total_price=125,
            fee=6,
        )
        self.assertEqual(tx.quantity, 5)
        self.assertEqual(tx.total_price, 125)
        self.assertEqual(tx.fee, 6)

    def test_str_representation(self):
        tx = MarketTransaction.objects.create(
            listing=self.listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=1,
            price_per_unit=25,
            total_price=25,
        )
        self.assertIn("txbuyertestuser", str(tx))
        self.assertIn("Steel", str(tx))

    def test_transaction_linked_to_listing(self):
        tx = MarketTransaction.objects.create(
            listing=self.listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=2,
            price_per_unit=25,
            total_price=50,
        )
        self.assertEqual(tx.listing, self.listing)

    def test_buyer_and_seller_relationships(self):
        MarketTransaction.objects.create(
            listing=self.listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=3,
            price_per_unit=25,
            total_price=75,
        )
        self.assertEqual(self.buyer.market_purchases.count(), 1)
        self.assertEqual(self.seller.market_sales.count(), 1)

    def test_fee_default_zero(self):
        tx = MarketTransaction.objects.create(
            listing=self.listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=1,
            price_per_unit=10,
            total_price=10,
        )
        self.assertEqual(tx.fee, 0)


# ---------------------------------------------------------------------------
# Helper: obtain a JWT Bearer token without hitting the network
# ---------------------------------------------------------------------------


def _get_auth_header(user):
    from ninja_jwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    return f"Bearer {str(refresh.access_token)}"


# ---------------------------------------------------------------------------
# MarketplaceViewTests — API endpoint tests
# ---------------------------------------------------------------------------


class MarketplaceViewTests(TestCase):
    """HTTP-level tests for MarketplaceController endpoints."""

    BASE = "/api/v1/marketplace"

    def setUp(self):
        self.seller = make_user("mp_seller@test.com", "mp_selleruser")
        self.buyer = make_user("mp_buyer@test.com", "mp_buyeruser")
        self.seller_auth = _get_auth_header(self.seller)
        self.buyer_auth = _get_auth_header(self.buyer)
        self.item = make_item()
        # Give seller inventory and buyer gold
        UserInventory.objects.create(user=self.seller, item=self.item, quantity=50)
        self.seller_wallet = Wallet.objects.create(user=self.seller, gold=0)
        self.buyer_wallet = Wallet.objects.create(user=self.buyer, gold=10000)
        # Ensure config exists
        MarketConfig.get()

    # --- GET /config/ (public) -----------------------------------------------

    def test_get_config_public_returns_200(self):
        resp = self.client.get(f"{self.BASE}/config/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("transaction_fee_percent", data)
        self.assertIn("max_active_listings_per_user", data)

    # --- GET /listings/ (public) ---------------------------------------------

    def test_list_active_public_no_auth_required(self):
        resp = self.client.get(f"{self.BASE}/listings/")
        self.assertEqual(resp.status_code, 200)

    def test_list_active_empty_when_no_listings(self):
        resp = self.client.get(f"{self.BASE}/listings/")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["count"], 0)

    def test_list_active_shows_active_listings(self):
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=20,
        )
        resp = self.client.get(f"{self.BASE}/listings/")
        data = resp.json()
        self.assertEqual(data["count"], 1)

    def test_list_active_filters_by_item_slug(self):
        other_item = make_item("Steel", "steel-filter")
        UserInventory.objects.create(user=self.seller, item=other_item, quantity=10)
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
        MarketListing.objects.create(
            seller=self.seller,
            item=other_item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
        resp = self.client.get(f"{self.BASE}/listings/?item_slug=iron-ore")
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["items"][0]["item"]["slug"], "iron-ore")

    def test_list_active_filters_by_listing_type(self):
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.BUY,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=8,
        )
        resp = self.client.get(f"{self.BASE}/listings/?listing_type=sell")
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["items"][0]["listing_type"], "sell")

    def test_list_active_excludes_non_active(self):
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
            status=MarketListing.Status.FULFILLED,
        )
        resp = self.client.get(f"{self.BASE}/listings/")
        data = resp.json()
        self.assertEqual(data["count"], 0)

    # --- GET /my-listings/ (auth required) -----------------------------------

    def test_my_listings_unauthenticated_returns_401(self):
        resp = self.client.get(f"{self.BASE}/my-listings/")
        self.assertEqual(resp.status_code, 401)

    def test_my_listings_returns_own_listings_only(self):
        # seller has a listing; buyer should see 0
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
        resp = self.client.get(
            f"{self.BASE}/my-listings/",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        data = resp.json()
        self.assertEqual(data["count"], 0)

    def test_my_listings_excludes_fulfilled(self):
        MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=0,
            price_per_unit=10,
            status=MarketListing.Status.FULFILLED,
        )
        resp = self.client.get(
            f"{self.BASE}/my-listings/",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        data = resp.json()
        self.assertEqual(data["count"], 0)

    # --- GET /history/ (auth required) ---------------------------------------

    def test_history_unauthenticated_returns_401(self):
        resp = self.client.get(f"{self.BASE}/history/")
        self.assertEqual(resp.status_code, 401)

    def test_history_returns_transactions_involving_user(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=10,
        )
        MarketTransaction.objects.create(
            listing=listing,
            buyer=self.buyer,
            seller=self.seller,
            item=self.item,
            quantity=2,
            price_per_unit=10,
            total_price=20,
            fee=1,
        )
        resp = self.client.get(
            f"{self.BASE}/history/",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        data = resp.json()
        self.assertEqual(data["count"], 1)

    # --- POST /create-listing/ -----------------------------------------------

    def test_create_sell_listing_unauthenticated_returns_401(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_create_sell_listing_success(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 5, "price_per_unit": 15}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["listing_type"], "sell")
        self.assertEqual(data["quantity"], 5)
        self.assertEqual(data["price_per_unit"], 15)
        # Items should be escrowed (removed from inventory)
        inv = UserInventory.objects.get(user=self.seller, item=self.item)
        self.assertEqual(inv.quantity, 45)

    def test_create_sell_listing_insufficient_items_returns_400(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 9999, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_create_buy_listing_escrows_gold(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "buy", "quantity": 10, "price_per_unit": 5}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["listing_type"], "buy")
        # 10 * 5 = 50 gold escrowed
        self.buyer_wallet.refresh_from_db()
        self.assertEqual(self.buyer_wallet.gold, 9950)

    def test_create_buy_listing_insufficient_gold_returns_400(self):
        # Give buyer no gold
        self.buyer_wallet.gold = 0
        self.buyer_wallet.save()
        payload = '{"item_slug": "iron-ore", "listing_type": "buy", "quantity": 10, "price_per_unit": 100}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_create_listing_nonexistent_item_returns_404(self):
        payload = '{"item_slug": "does-not-exist", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_create_listing_non_tradeable_item_returns_404(self):
        non_tradeable = make_item("Locked Item", "locked-item")
        non_tradeable.is_tradeable = False
        non_tradeable.save()
        payload = '{"item_slug": "locked-item", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_create_listing_invalid_type_returns_400(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "trade", "quantity": 1, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_create_listing_zero_quantity_returns_400(self):
        payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 0, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_create_listing_exceeds_max_active_returns_400(self):
        config = MarketConfig.get()
        # Fill up to the limit
        for _i in range(config.max_active_listings_per_user):
            MarketListing.objects.create(
                seller=self.seller,
                item=self.item,
                listing_type=MarketListing.ListingType.SELL,
                quantity=1,
                quantity_remaining=1,
                price_per_unit=10,
            )
        payload = '{"item_slug": "iron-ore", "listing_type": "sell", "quantity": 1, "price_per_unit": 10}'
        resp = self.client.post(
            f"{self.BASE}/create-listing/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 400)

    # --- POST /buy/ ----------------------------------------------------------

    def test_buy_from_listing_unauthenticated_returns_401(self):
        import uuid

        payload = f'{{"listing_id": "{uuid.uuid4()}", "quantity": 1}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)

    def test_buy_from_listing_success(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=10,
            quantity_remaining=10,
            price_per_unit=20,
        )
        payload = f'{{"listing_id": "{listing.id}", "quantity": 3}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("Bought", data["message"])
        # Listing quantity should decrease
        listing.refresh_from_db()
        self.assertEqual(listing.quantity_remaining, 7)
        # Buyer should have the items
        buyer_inv = UserInventory.objects.get(user=self.buyer, item=self.item)
        self.assertEqual(buyer_inv.quantity, 3)
        # Buyer gold deducted: 3 * 20 = 60
        self.buyer_wallet.refresh_from_db()
        self.assertEqual(self.buyer_wallet.gold, 9940)
        # Transaction record created
        self.assertEqual(MarketTransaction.objects.filter(buyer=self.buyer).count(), 1)

    def test_buy_entire_listing_marks_fulfilled(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=2,
            quantity_remaining=2,
            price_per_unit=10,
        )
        payload = f'{{"listing_id": "{listing.id}", "quantity": 2}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 200)
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.FULFILLED)

    def test_buy_own_listing_returns_400(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=10,
        )
        payload = f'{{"listing_id": "{listing.id}", "quantity": 1}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_buy_nonexistent_listing_returns_404(self):
        import uuid

        payload = f'{{"listing_id": "{uuid.uuid4()}", "quantity": 1}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_buy_insufficient_gold_returns_400(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=10,
            quantity_remaining=10,
            price_per_unit=5000,
        )
        # Drain buyer wallet
        self.buyer_wallet.gold = 0
        self.buyer_wallet.save()
        payload = f'{{"listing_id": "{listing.id}", "quantity": 5}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_buy_applies_transaction_fee_to_seller(self):
        config = MarketConfig.get()
        config.transaction_fee_percent = 10.0
        config.save()
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=100,
        )
        payload = f'{{"listing_id": "{listing.id}", "quantity": 1}}'
        resp = self.client.post(
            f"{self.BASE}/buy/",
            data=payload,
            content_type="application/json",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 200)
        # Fee is 10% of 100 = 10; seller receives 90
        self.seller_wallet.refresh_from_db()
        self.assertEqual(self.seller_wallet.gold, 90)
        tx = MarketTransaction.objects.get(buyer=self.buyer)
        self.assertEqual(tx.fee, 10)

    # --- POST /cancel/{listing_id}/ ------------------------------------------

    def test_cancel_listing_unauthenticated_returns_401(self):
        import uuid

        resp = self.client.post(f"{self.BASE}/cancel/{uuid.uuid4()}/")
        self.assertEqual(resp.status_code, 401)

    def test_cancel_sell_listing_returns_items(self):
        UserInventory.objects.get(user=self.seller, item=self.item).delete()
        # Seller starts with 0 items; create a sell listing directly (bypassing view)
        UserInventory.objects.create(user=self.seller, item=self.item, quantity=0)
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=10,
        )
        # Remove the zero-quantity row so return lands cleanly
        UserInventory.objects.filter(user=self.seller, item=self.item).delete()

        resp = self.client.post(
            f"{self.BASE}/cancel/{listing.id}/",
            HTTP_AUTHORIZATION=self.seller_auth,
        )
        self.assertEqual(resp.status_code, 200)
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.CANCELLED)
        # Items returned
        inv = UserInventory.objects.get(user=self.seller, item=self.item)
        self.assertEqual(inv.quantity, 5)

    def test_cancel_buy_order_returns_gold(self):
        listing = MarketListing.objects.create(
            seller=self.buyer,
            item=self.item,
            listing_type=MarketListing.ListingType.BUY,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=10,
        )
        # Simulate escrowed gold
        self.buyer_wallet.gold = 9950
        self.buyer_wallet.total_spent = 50
        self.buyer_wallet.save()

        resp = self.client.post(
            f"{self.BASE}/cancel/{listing.id}/",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 200)
        self.buyer_wallet.refresh_from_db()
        self.assertEqual(self.buyer_wallet.gold, 10000)

    def test_cancel_listing_wrong_user_returns_404(self):
        listing = MarketListing.objects.create(
            seller=self.seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
        )
        resp = self.client.post(
            f"{self.BASE}/cancel/{listing.id}/",
            HTTP_AUTHORIZATION=self.buyer_auth,
        )
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# MarketplaceTaskTests — task logic tests
# ---------------------------------------------------------------------------


class MarketplaceTaskTests(TestCase):
    """Tests for marketplace Celery task logic (bot seeding, expiry)."""

    def setUp(self):
        self.item = make_item()

    # --- bot_restock_marketplace ---------------------------------------------

    def test_bot_restock_creates_listings_for_tradeable_items(self):
        from apps.marketplace.tasks import bot_restock_marketplace

        bot_restock_marketplace()
        bot_listings = MarketListing.objects.filter(is_bot_listing=True)
        self.assertGreater(bot_listings.count(), 0)

    def test_bot_restock_creates_sell_listings_only(self):
        from apps.marketplace.tasks import bot_restock_marketplace

        bot_restock_marketplace()
        non_sell = MarketListing.objects.filter(
            is_bot_listing=True,
        ).exclude(listing_type=MarketListing.ListingType.SELL)
        self.assertEqual(non_sell.count(), 0)

    def test_bot_restock_respects_target_listing_count(self):
        from apps.marketplace.tasks import bot_restock_marketplace

        # Run twice — second run should not create more than target_listings (3) per item
        bot_restock_marketplace()
        bot_restock_marketplace()
        item_listings = MarketListing.objects.filter(
            item=self.item,
            is_bot_listing=True,
            listing_type=MarketListing.ListingType.SELL,
            status=MarketListing.Status.ACTIVE,
        )
        self.assertLessEqual(item_listings.count(), 3)

    def test_bot_restock_skips_items_with_zero_base_value(self):
        from apps.marketplace.tasks import bot_restock_marketplace

        zero_value_item = make_item("Free Item", "free-item")
        zero_value_item.base_value = 0
        zero_value_item.save()
        before = MarketListing.objects.filter(item=zero_value_item).count()
        bot_restock_marketplace()
        after = MarketListing.objects.filter(item=zero_value_item).count()
        self.assertEqual(before, after)

    def test_bot_restock_creates_bot_user_if_missing(self):
        from django.contrib.auth import get_user_model

        from apps.marketplace.tasks import bot_restock_marketplace

        User = get_user_model()
        User.objects.filter(username="MarketBot").delete()
        bot_restock_marketplace()
        self.assertTrue(User.objects.filter(username="MarketBot", is_bot=True).exists())

    def test_bot_restock_price_near_base_value(self):
        from apps.marketplace.tasks import bot_restock_marketplace

        config = MarketConfig.get()
        config.bot_price_variance_percent = 0.0  # no variance
        config.save()
        # Ensure the item has a base_value
        self.item.base_value = 100
        self.item.save()
        bot_restock_marketplace()
        listing = MarketListing.objects.filter(
            item=self.item,
            is_bot_listing=True,
        ).first()
        self.assertIsNotNone(listing)
        # With 0% variance, price should equal base_value
        self.assertEqual(listing.price_per_unit, 100)

    # --- expire_old_listings -------------------------------------------------

    def test_expire_old_listings_marks_expired(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.marketplace.tasks import expire_old_listings

        seller = make_user("exp_seller@test.com", "exp_selleruser")
        past = timezone.now() - timedelta(hours=1)
        listing = MarketListing.objects.create(
            seller=seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=3,
            quantity_remaining=3,
            price_per_unit=10,
            expires_at=past,
        )
        expire_old_listings()
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.EXPIRED)

    def test_expire_old_listings_returns_items_to_seller(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.marketplace.tasks import expire_old_listings

        seller = make_user("exp_seller2@test.com", "exp_selleruser2")
        past = timezone.now() - timedelta(hours=1)
        MarketListing.objects.create(
            seller=seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=4,
            quantity_remaining=4,
            price_per_unit=10,
            expires_at=past,
            is_bot_listing=False,
        )
        expire_old_listings()
        inv = UserInventory.objects.get(user=seller, item=self.item)
        self.assertEqual(inv.quantity, 4)

    def test_expire_old_listings_returns_gold_for_buy_orders(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.inventory.models import Wallet
        from apps.marketplace.tasks import expire_old_listings

        buyer = make_user("exp_buyer@test.com", "exp_buyeruser")
        wallet = Wallet.objects.create(user=buyer, gold=0)
        past = timezone.now() - timedelta(hours=1)
        MarketListing.objects.create(
            seller=buyer,
            item=self.item,
            listing_type=MarketListing.ListingType.BUY,
            quantity=5,
            quantity_remaining=5,
            price_per_unit=20,
            expires_at=past,
            is_bot_listing=False,
        )
        expire_old_listings()
        wallet.refresh_from_db()
        # Should refund 5 * 20 = 100 gold
        self.assertEqual(wallet.gold, 100)

    def test_expire_old_listings_bot_listings_just_disappear(self):
        from datetime import timedelta

        from django.contrib.auth import get_user_model
        from django.utils import timezone

        from apps.marketplace.tasks import expire_old_listings

        User = get_user_model()
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
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=10,
            quantity_remaining=10,
            price_per_unit=5,
            expires_at=past,
            is_bot_listing=True,
        )
        expire_old_listings()
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.EXPIRED)
        # Bot user should NOT have items returned to inventory
        self.assertFalse(UserInventory.objects.filter(user=bot_user, item=self.item).exists())

    def test_expire_old_listings_does_not_affect_future_listings(self):
        from datetime import timedelta

        from django.utils import timezone

        from apps.marketplace.tasks import expire_old_listings

        seller = make_user("fut_seller@test.com", "fut_selleruser")
        future = timezone.now() + timedelta(hours=48)
        listing = MarketListing.objects.create(
            seller=seller,
            item=self.item,
            listing_type=MarketListing.ListingType.SELL,
            quantity=1,
            quantity_remaining=1,
            price_per_unit=10,
            expires_at=future,
        )
        expire_old_listings()
        listing.refresh_from_db()
        self.assertEqual(listing.status, MarketListing.Status.ACTIVE)
