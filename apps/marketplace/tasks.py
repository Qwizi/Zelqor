import logging
import random
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from apps.inventory.models import Item
from apps.marketplace.models import MarketConfig, MarketListing

logger = logging.getLogger(__name__)


@shared_task
def bot_restock_marketplace():
    """Bot seeder: ensure marketplace has listings for all tradeable items.

    Creates sell listings from a bot user for items that have few or no active listings.
    """
    from apps.accounts.models import User

    bot_user, _ = User.objects.get_or_create(
        username="MarketBot",
        defaults={
            "email": "marketbot@maplord.internal",
            "is_bot": True,
            "is_active": True,
        },
    )

    config = MarketConfig.get()
    variance = config.bot_price_variance_percent / 100.0

    tradeable_items = Item.objects.filter(is_active=True, is_tradeable=True)

    for item in tradeable_items:
        if item.base_value <= 0:
            continue

        # Check existing active sell listings
        active_count = MarketListing.objects.filter(
            item=item,
            listing_type=MarketListing.ListingType.SELL,
            status=MarketListing.Status.ACTIVE,
        ).count()

        # Bot keeps at least 3 listings per item
        target_listings = 3
        if active_count >= target_listings:
            continue

        to_create = target_listings - active_count
        for _ in range(to_create):
            # Randomize price around base_value
            price_modifier = 1.0 + random.uniform(-variance, variance)
            price = max(1, int(item.base_value * price_modifier))

            # Randomize quantity based on rarity
            if item.rarity in ("epic", "legendary"):
                qty = 1
            elif item.rarity == "rare":
                qty = random.randint(1, 3)
            elif item.rarity == "uncommon":
                qty = random.randint(2, 5)
            else:
                qty = random.randint(3, 10)

            MarketListing.objects.create(
                seller=bot_user,
                item=item,
                listing_type=MarketListing.ListingType.SELL,
                quantity=qty,
                quantity_remaining=qty,
                price_per_unit=price,
                is_bot_listing=True,
                expires_at=timezone.now() + timedelta(hours=config.listing_duration_hours),
            )

    logger.info("Bot marketplace restock completed")


@shared_task
def expire_old_listings():
    """Mark expired listings and return items/gold to owners."""
    from apps.inventory.views import add_item_to_inventory, get_or_create_wallet

    now = timezone.now()
    expired = MarketListing.objects.filter(
        status=MarketListing.Status.ACTIVE,
        expires_at__lte=now,
    ).select_related("seller", "item")

    count = 0
    for listing in expired:
        with transaction.atomic():
            listing.status = MarketListing.Status.EXPIRED
            listing.save(update_fields=["status"])

            if listing.is_bot_listing:
                # Bot listings just disappear
                continue

            if listing.listing_type == MarketListing.ListingType.SELL:
                # Return unsold items
                add_item_to_inventory(listing.seller, listing.item, listing.quantity_remaining)
            else:
                # Return escrowed gold
                refund = listing.price_per_unit * listing.quantity_remaining
                wallet = get_or_create_wallet(listing.seller)
                wallet.gold += refund
                wallet.save(update_fields=["gold"])

            count += 1

    if count:
        logger.info("Expired %d marketplace listings", count)
