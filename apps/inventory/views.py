import logging
import random
from ninja_extra import api_controller, route
from ninja_jwt.authentication import JWTAuth
from django.db import transaction
from django.shortcuts import get_object_or_404

from apps.inventory.models import Item, ItemCategory, ItemDrop, UserInventory, Wallet
from apps.inventory.schemas import (
    InventoryItemOutSchema,
    ItemCategoryOutSchema,
    ItemDropOutSchema,
    OpenCrateInSchema,
    WalletOutSchema,
)

logger = logging.getLogger(__name__)


def get_or_create_wallet(user):
    wallet, _ = Wallet.objects.get_or_create(user=user)
    return wallet


def add_item_to_inventory(user, item, quantity=1):
    """Add items to user inventory, respecting stack limits."""
    inv, created = UserInventory.objects.get_or_create(
        user=user, item=item,
        defaults={'quantity': quantity},
    )
    if not created:
        inv.quantity = min(inv.quantity + quantity, item.max_stack)
        inv.save(update_fields=['quantity'])
    return inv


def remove_item_from_inventory(user, item, quantity=1):
    """Remove items from inventory. Returns True if successful."""
    try:
        inv = UserInventory.objects.get(user=user, item=item)
    except UserInventory.DoesNotExist:
        return False
    if inv.quantity < quantity:
        return False
    inv.quantity -= quantity
    if inv.quantity == 0:
        inv.delete()
    else:
        inv.save(update_fields=['quantity'])
    return True


@api_controller('/inventory', tags=['Inventory'])
class InventoryController:

    @route.get('/items/', response=list[ItemCategoryOutSchema], auth=None)
    def list_items(self):
        """List all available item types grouped by category."""
        return list(
            ItemCategory.objects.filter(is_active=True)
            .prefetch_related('items')
        )

    @route.get('/my/', response=list[InventoryItemOutSchema], auth=JWTAuth())
    def my_inventory(self, request):
        """Get current user's inventory."""
        return list(
            UserInventory.objects.filter(user=request.user)
            .select_related('item', 'item__category')
        )

    @route.get('/wallet/', response=WalletOutSchema, auth=JWTAuth())
    def my_wallet(self, request):
        """Get current user's gold wallet."""
        return get_or_create_wallet(request.user)

    @route.get('/drops/', response=list[ItemDropOutSchema], auth=JWTAuth())
    def my_drops(self, request):
        """Get recent item drops for current user."""
        return list(
            ItemDrop.objects.filter(user=request.user)
            .select_related('item', 'item__category')[:50]
        )

    @route.post('/open-crate/', auth=JWTAuth())
    def open_crate(self, request, payload: OpenCrateInSchema):
        """Open a crate using a key. Returns dropped items."""
        crate = get_object_or_404(Item, slug=payload.crate_item_slug, item_type=Item.ItemType.CRATE)
        key = get_object_or_404(Item, slug=payload.key_item_slug, item_type=Item.ItemType.KEY)

        if key.opens_crate_id != crate.id:
            return self.create_response(request, {'error': 'This key does not open this crate'}, status=400)

        with transaction.atomic():
            if not remove_item_from_inventory(request.user, crate, 1):
                return self.create_response(request, {'error': 'You do not have this crate'}, status=400)
            if not remove_item_from_inventory(request.user, key, 1):
                # Return the crate
                add_item_to_inventory(request.user, crate, 1)
                return self.create_response(request, {'error': 'You do not have this key'}, status=400)

            # Roll loot from crate_loot_table
            loot_table = crate.crate_loot_table or []
            if not loot_table:
                return self.create_response(request, {'error': 'Crate has no loot table'}, status=400)

            drops = _roll_crate_loot(loot_table)
            result_drops = []
            for item_slug, qty in drops:
                try:
                    drop_item = Item.objects.get(slug=item_slug)
                except Item.DoesNotExist:
                    continue
                add_item_to_inventory(request.user, drop_item, qty)
                drop_record = ItemDrop.objects.create(
                    user=request.user, item=drop_item, quantity=qty,
                    source=ItemDrop.DropSource.CRATE_OPEN,
                )
                result_drops.append({
                    'item_name': drop_item.name,
                    'item_slug': drop_item.slug,
                    'rarity': drop_item.rarity,
                    'quantity': qty,
                })

        return {'drops': result_drops}


def _roll_crate_loot(loot_table, num_rolls=3):
    """Roll items from a crate loot table. Returns list of (item_slug, quantity)."""
    if not loot_table:
        return []

    items = []
    weights = []
    for entry in loot_table:
        items.append(entry)
        weights.append(entry.get('weight', 1))

    results = []
    for _ in range(num_rolls):
        chosen = random.choices(items, weights=weights, k=1)[0]
        min_qty = chosen.get('min_qty', 1)
        max_qty = chosen.get('max_qty', 1)
        qty = random.randint(min_qty, max_qty)
        results.append((chosen['item_slug'], qty))

    # Merge duplicates
    merged = {}
    for slug, qty in results:
        merged[slug] = merged.get(slug, 0) + qty
    return list(merged.items())
