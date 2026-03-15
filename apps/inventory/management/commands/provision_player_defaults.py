from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.inventory.models import Deck, DeckItem, Item, ItemInstance, UserInventory, Wallet

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
    help = "Reset and provision all non-bot players with default starter items, gold, and deck"

    def handle(self, *args, **options):
        users = User.objects.filter(is_bot=False)
        items = {slug: Item.objects.filter(slug=slug).first() for slug in STARTER_ITEMS}
        items = {slug: item for slug, item in items.items() if item is not None}

        if not items:
            self.stdout.write("No starter items found — run seed_economy_data first")
            return

        provisioned = 0
        for user in users:
            # ── Clean slate: remove old inventory/instances/decks for starter items ──
            starter_item_ids = [item.id for item in items.values()]
            UserInventory.objects.filter(user=user, item_id__in=starter_item_ids).delete()
            ItemInstance.objects.filter(owner=user, item_id__in=starter_item_ids).delete()

            # Remove old default deck and its items
            old_decks = Deck.objects.filter(user=user, is_default=True)
            for old_deck in old_decks:
                DeckItem.objects.filter(deck=old_deck).delete()
                old_deck.delete()

            # ── Wallet ──
            wallet, _ = Wallet.objects.get_or_create(user=user, defaults={'gold': STARTER_GOLD})
            if wallet.gold < STARTER_GOLD:
                wallet.gold = STARTER_GOLD
                wallet.save(update_fields=['gold'])

            # ── Create starter items ──
            instance_map = {}  # slug → ItemInstance (for non-stackable)
            for slug, item in items.items():
                if item.is_stackable:
                    UserInventory.objects.create(user=user, item=item, quantity=1)
                else:
                    inst = ItemInstance.objects.create(
                        item=item, owner=user,
                        pattern_seed=0, wear=0.0, stattrak=False,
                        first_owner=user,
                    )
                    instance_map[slug] = inst

            # ── Create default deck with all starter items ──
            deck = Deck.objects.create(user=user, name=DEFAULT_DECK_NAME, is_default=True)
            for slug, item in items.items():
                instance = instance_map.get(slug)
                DeckItem.objects.create(
                    deck=deck, item=item, quantity=1,
                    instance=instance,
                )

            provisioned += 1

        self.stdout.write(self.style.SUCCESS(
            f"Provisioned {provisioned} player(s) with default items "
            f"({len(items)} items, {STARTER_GOLD} gold, default deck)"
        ))
