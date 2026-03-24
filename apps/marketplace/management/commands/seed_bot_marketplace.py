import random

from django.core.management.base import BaseCommand

from apps.inventory.models import Item, UserInventory
from apps.marketplace.models import MarketConfig, MarketListing

EXCLUDED_ITEM_TYPES = {"crate", "key", "cosmetic"}


class Command(BaseCommand):
    help = "Seed the marketplace with bot listings for all tradeable non-crate/key/cosmetic items"

    def handle(self, *args, **options):
        from apps.accounts.models import User

        # 1. Ensure MarketConfig singleton exists with defaults
        market_config = MarketConfig.get()
        self.stdout.write(
            f"  MarketConfig: fee={market_config.transaction_fee_percent}%, "
            f"duration={market_config.listing_duration_hours}h"
        )

        # 2. Gather eligible items
        eligible_items = list(
            Item.objects.filter(
                is_tradeable=True,
                is_active=True,
            ).exclude(item_type__in=EXCLUDED_ITEM_TYPES)
        )

        if not eligible_items:
            self.stdout.write("  No eligible items found — skipping.")
            return

        # 3. Get all bot users
        bot_users = list(User.objects.filter(is_bot=True))
        if not bot_users:
            self.stdout.write("  No bot users found — skipping.")
            return

        self.stdout.write(f"  Found {len(bot_users)} bot(s) and {len(eligible_items)} eligible item(s).")

        # 4. Remove any existing bot listings so seeding is idempotent
        deleted_count, _ = MarketListing.objects.filter(is_bot_listing=True).delete()
        if deleted_count:
            self.stdout.write(f"  Removed {deleted_count} existing bot listing(s).")

        total_listings = 0
        total_inventory = 0

        for bot in bot_users:
            for item in eligible_items:
                # Add item to bot inventory
                inv_qty = random.randint(10, 50)
                inv_entry, created = UserInventory.objects.get_or_create(
                    user=bot,
                    item=item,
                    defaults={"quantity": inv_qty},
                )
                if not created:
                    inv_entry.quantity += inv_qty
                    inv_entry.save(update_fields=["quantity"])
                total_inventory += 1

                # Determine price with variance
                base = item.base_value if item.base_value > 0 else 10
                factor = random.uniform(0.8, 1.2)
                price = max(1, round(base * factor))

                # Create sell listing
                listing_qty = random.randint(5, 20)
                MarketListing.objects.create(
                    seller=bot,
                    item=item,
                    listing_type=MarketListing.ListingType.SELL,
                    quantity=listing_qty,
                    price_per_unit=price,
                    quantity_remaining=listing_qty,
                    status=MarketListing.Status.ACTIVE,
                    is_bot_listing=True,
                )
                total_listings += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"  Bot marketplace seeded: {total_listings} listing(s) "
                f"across {len(bot_users)} bot(s) for {len(eligible_items)} item(s)."
            )
        )
