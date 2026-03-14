from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.inventory.models import Deck, DeckItem, Item, UserInventory, Wallet

User = get_user_model()

# All 6 building blueprints Lvl 1 + Tarcza Lvl 1 (free ability)
STARTER_ITEMS = [
    'pkg-shield-1',    # Pakiet: Tarcza Lvl 1
    'bp-barracks-1',   # Blueprint: Koszary Lvl 1
    'bp-factory-1',    # Blueprint: Fabryka Lvl 1
    'bp-tower-1',      # Blueprint: Wieża Lvl 1
    'bp-port-1',       # Blueprint: Port Lvl 1
    'bp-carrier-1',    # Blueprint: Lotnisko Lvl 1
    'bp-radar-1',      # Blueprint: Elektrownia Lvl 1
]
STARTER_GOLD = 100
DEFAULT_DECK_NAME = 'Domyślna talia'


class Command(BaseCommand):
    help = "Give all non-bot players default starter items, gold, and a default deck"

    def handle(self, *args, **options):
        users = User.objects.filter(is_bot=False)
        items = {slug: Item.objects.filter(slug=slug).first() for slug in STARTER_ITEMS}
        items = {slug: item for slug, item in items.items() if item is not None}

        if not items:
            self.stdout.write("No starter items found — run seed_economy_data first")
            return

        provisioned = 0
        for user in users:
            changed = False

            # Wallet
            wallet, created = Wallet.objects.get_or_create(user=user, defaults={'gold': STARTER_GOLD})
            if created:
                changed = True
            elif wallet.gold < STARTER_GOLD:
                wallet.gold = STARTER_GOLD
                wallet.save(update_fields=['gold'])
                changed = True

            # Starter items in inventory
            for slug, item in items.items():
                _, created = UserInventory.objects.get_or_create(
                    user=user, item=item,
                    defaults={'quantity': 1},
                )
                if created:
                    changed = True

            # Default deck — create if user has none, or update existing default
            deck = Deck.objects.filter(user=user, is_default=True).first()
            if not deck:
                deck = Deck.objects.create(user=user, name=DEFAULT_DECK_NAME, is_default=True)
                changed = True

            # Ensure all starter items are in the deck
            for slug, item in items.items():
                _, created = DeckItem.objects.get_or_create(
                    deck=deck, item=item,
                    defaults={'quantity': 1},
                )
                if created:
                    changed = True

            if changed:
                provisioned += 1

        self.stdout.write(
            f"Provisioned {provisioned} player(s) with default items "
            f"({len(items)} items, {STARTER_GOLD} gold, default deck)"
        )
