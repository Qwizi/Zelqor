from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.inventory.models import Item, ItemInstance, UserInventory
from apps.inventory.views import create_item_instance

User = get_user_model()

STACKABLE_QUANTITY = 10

# Non-stackable item types that should be given as ItemInstance
NON_STACKABLE_TYPES = {
    Item.ItemType.COSMETIC,
    Item.ItemType.BLUEPRINT_BUILDING,
    Item.ItemType.BLUEPRINT_UNIT,
    Item.ItemType.BOOST,
    Item.ItemType.TACTICAL_PACKAGE,
}


class Command(BaseCommand):
    help = "Give all active items to a specific user."

    def add_arguments(self, parser):
        parser.add_argument("username", type=str, help="Username of the target user")

    def handle(self, *args, **options):
        username = options["username"]

        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f'User "{username}" does not exist.') from None

        self.stdout.write(f"Giving all items to user: {user.username} ({user.email})")

        items = (
            Item.objects.filter(is_active=True).select_related("category").order_by("category__order", "rarity", "name")
        )

        if not items.exists():
            self.stdout.write(self.style.WARNING("No active items found. Run seed_economy_data first."))
            return

        stackable_added = 0
        stackable_updated = 0
        instance_added = 0
        instance_skipped = 0

        for item in items:
            if item.is_stackable:
                inv, created = UserInventory.objects.get_or_create(
                    user=user,
                    item=item,
                    defaults={"quantity": STACKABLE_QUANTITY},
                )
                if created:
                    stackable_added += 1
                    self.stdout.write(f"  [STACK +{STACKABLE_QUANTITY}] {item.name}")
                else:
                    if inv.quantity < STACKABLE_QUANTITY:
                        inv.quantity = STACKABLE_QUANTITY
                        inv.save(update_fields=["quantity"])
                        stackable_updated += 1
                        self.stdout.write(f"  [STACK SET={STACKABLE_QUANTITY}] {item.name}")
                    else:
                        self.stdout.write(
                            self.style.WARNING(f"  [STACK SKIP] {item.name} (already has {inv.quantity})")
                        )
            else:
                already_owns = ItemInstance.objects.filter(owner=user, item=item).exists()
                if already_owns:
                    instance_skipped += 1
                    self.stdout.write(self.style.WARNING(f"  [INSTANCE SKIP] {item.name} (already owned)"))
                else:
                    create_item_instance(item, user)
                    instance_added += 1
                    self.stdout.write(f"  [INSTANCE +1] {item.name}")

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Done. Summary:"))
        self.stdout.write(f"  Stackable stacks created : {stackable_added}")
        self.stdout.write(f"  Stackable stacks updated : {stackable_updated}")
        self.stdout.write(f"  Instances created        : {instance_added}")
        self.stdout.write(f"  Instances skipped        : {instance_skipped}")
