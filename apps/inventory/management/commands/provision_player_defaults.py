from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from apps.inventory.models import Deck, DeckItem, Item, ItemInstance, UserInventory, Wallet

User = get_user_model()

# Building blueprints Lvl 1 + default unit blueprints + Tarcza Lvl 1
STARTER_ITEMS = [
    'pkg-shield-1',    # Pakiet: Tarcza Lvl 1
    'bp-barracks-1',   # Blueprint: Koszary Lvl 1
    'bp-factory-1',    # Blueprint: Fabryka Lvl 1
    'bp-tower-1',      # Blueprint: Wieża Lvl 1
    'bp-port-1',       # Blueprint: Port Lvl 1
    'bp-carrier-1',    # Blueprint: Lotnisko Lvl 1
    'bp-radar-1',      # Blueprint: Elektrownia Lvl 1
    'bp-tank-1',       # Blueprint: Czołg Lvl 1 (domyślna jednostka Fabryki)
    'bp-fighter-1',    # Blueprint: Myśliwiec Lvl 1 (domyślna jednostka Lotniska)
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
            # Check if current default deck was modified
            old_default = Deck.objects.filter(user=user, is_default=True).first()
            if old_default:
                old_item_slugs = set(
                    DeckItem.objects.filter(deck=old_default)
                    .values_list('item__slug', flat=True)
                )
                expected_slugs = set(items.keys())

                if old_item_slugs != expected_slugs:
                    # Modified — preserve as custom deck
                    old_default.name = 'Talia gracza'
                    old_default.is_default = False
                    old_default.is_editable = True
                    old_default.save(update_fields=['name', 'is_default', 'is_editable'])
                else:
                    # Unmodified — delete
                    DeckItem.objects.filter(deck=old_default).delete()
                    old_default.delete()

            # Clean up ALL non-editable decks with the default name (prevents duplicates
            # from repeated provisioning — old copies have is_default=False after Deck.save)
            Deck.objects.filter(user=user, is_editable=False).delete()

            # Ensure starter items in inventory
            instance_map = {}
            for slug, item in items.items():
                if item.is_stackable:
                    UserInventory.objects.get_or_create(user=user, item=item, defaults={'quantity': 1})
                else:
                    inst = ItemInstance.objects.filter(item=item, owner=user).first()
                    if not inst:
                        inst = ItemInstance.objects.create(
                            item=item, owner=user,
                            pattern_seed=0, wear=0.0, stattrak=False, first_owner=user,
                        )
                    instance_map[slug] = inst

            # Wallet
            wallet, _ = Wallet.objects.get_or_create(user=user, defaults={'gold': STARTER_GOLD})
            if wallet.gold < STARTER_GOLD:
                wallet.gold = STARTER_GOLD
                wallet.save(update_fields=['gold'])

            # Create or reuse locked default deck (idempotent)
            deck, created = Deck.objects.get_or_create(
                user=user, is_default=True, is_editable=False,
                defaults={'name': DEFAULT_DECK_NAME},
            )
            if not created:
                # Deck already exists — refresh its items
                DeckItem.objects.filter(deck=deck).delete()
                deck.name = DEFAULT_DECK_NAME
                deck.save(update_fields=['name'])
            for slug, item in items.items():
                DeckItem.objects.get_or_create(deck=deck, item=item, defaults={'quantity': 1, 'instance': instance_map.get(slug)})

            provisioned += 1

        self.stdout.write(self.style.SUCCESS(
            f"Provisioned {provisioned} player(s) with default items "
            f"({len(items)} items, {STARTER_GOLD} gold, default deck)"
        ))
