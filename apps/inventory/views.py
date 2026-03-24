import logging
import random

from django.db import transaction
from django.shortcuts import get_object_or_404
from ninja_extra import api_controller, route

from apps.accounts.auth import ActiveUserJWTAuth
from apps.game_config.decorators import require_module_controller
from apps.inventory.models import Deck, DeckItem, EquippedCosmetic, Item, ItemCategory, ItemDrop, UserInventory, Wallet
from apps.inventory.schemas import (
    DeckCreateSchema,
    DeckOutSchema,
    DeckUpdateSchema,
    EquipCosmeticInSchema,
    EquippedCosmeticOutSchema,
    ItemCategoryOutSchema,
    ItemDropOutSchema,
    ItemInstanceOutSchema,
    ItemOutSchema,
    OpenCrateInSchema,
    RenameInstanceInSchema,
    UnequipCosmeticInSchema,
    WalletOutSchema,
)
from apps.pagination import paginate_qs

logger = logging.getLogger(__name__)


def get_or_create_wallet(user):
    wallet, _ = Wallet.objects.get_or_create(user=user)
    return wallet


def create_item_instance(item, owner, *, stattrak=False, crafted_by=None, dropped_from_match=None):
    """Create a new unique ItemInstance with random pattern seed and wear."""
    from apps.inventory.models import ItemInstance

    pattern_seed = random.randint(0, 999)

    # Wear ranges vary by rarity: rarer items get lower average wear
    wear_ranges = {
        "legendary": (0.0, 0.15),
        "epic": (0.0, 0.25),
        "rare": (0.0, 0.38),
        "uncommon": (0.0, 0.45),
        "common": (0.0, 0.80),
    }
    min_w, max_w = wear_ranges.get(item.rarity, (0.0, 1.0))
    wear = round(random.uniform(min_w, max_w), 4)

    # StatTrak chance if not explicitly set
    if not stattrak:
        stattrak_chance = {
            "legendary": 0.20,
            "epic": 0.15,
            "rare": 0.10,
            "uncommon": 0.05,
            "common": 0.01,
        }
        stattrak = random.random() < stattrak_chance.get(item.rarity, 0.01)

    return ItemInstance.objects.create(
        item=item,
        owner=owner,
        pattern_seed=pattern_seed,
        wear=wear,
        stattrak=stattrak,
        first_owner=owner,
        crafted_by=crafted_by,
        dropped_from_match=dropped_from_match,
    )


def add_item_to_inventory(user, item, quantity=1, **instance_kwargs):
    """Add items to user inventory.

    Stackable items: increment UserInventory.quantity.
    Non-stackable items: create ItemInstance(s).
    Returns UserInventory for stackable, ItemInstance (or list) for non-stackable.
    """
    if item.is_stackable:
        inv, created = UserInventory.objects.get_or_create(
            user=user,
            item=item,
            defaults={"quantity": quantity},
        )
        if not created:
            inv.quantity = min(inv.quantity + quantity, item.max_stack)
            inv.save(update_fields=["quantity"])
        return inv
    else:
        instances = []
        for _ in range(quantity):
            instances.append(create_item_instance(item, user, **instance_kwargs))
        return instances[0] if len(instances) == 1 else instances


def remove_item_from_inventory(user, item, quantity=1):
    """Remove items from user inventory.

    Stackable: decrement quantity. Non-stackable: delete oldest instances.
    Returns True on success, False if insufficient.
    """
    if item.is_stackable:
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
            inv.save(update_fields=["quantity"])
        return True
    else:
        from apps.inventory.models import ItemInstance

        instances = list(ItemInstance.objects.filter(owner=user, item=item).order_by("created_at")[:quantity])
        if len(instances) < quantity:
            return False
        for inst in instances:
            inst.delete()
        return True


@api_controller("/inventory", tags=["Inventory"])
@require_module_controller("inventory")
class InventoryController:
    @route.get("/items/", response=list[ItemCategoryOutSchema], auth=None)
    def list_items(self):
        """List all available item types grouped by category."""
        return list(ItemCategory.objects.filter(is_active=True).prefetch_related("items"))

    @route.get("/my/", response=dict, auth=ActiveUserJWTAuth())
    def my_inventory(self, request, limit: int = 50, offset: int = 0, item_type: str = None):
        """List user's inventory: stackable stacks + unique instances."""
        from apps.inventory.models import ItemInstance

        # Stackable items only
        stacks_qs = UserInventory.objects.filter(
            user=request.user,
            item__is_stackable=True,
        ).select_related("item", "item__category")

        # Unique instances
        instances_qs = ItemInstance.objects.filter(
            owner=request.user,
        ).select_related("item", "item__category", "first_owner", "crafted_by")

        if item_type:
            stacks_qs = stacks_qs.filter(item__item_type=item_type)
            instances_qs = instances_qs.filter(item__item_type=item_type)

        stacks = list(stacks_qs)
        instances = list(instances_qs)

        # Build unified entries
        entries = []
        for inv in stacks:
            entries.append(
                {
                    "id": str(inv.id),
                    "item": ItemOutSchema.from_orm(inv.item).dict(),
                    "quantity": inv.quantity,
                    "is_instance": False,
                    "instance": None,
                }
            )
        for inst in instances:
            entries.append(
                {
                    "id": str(inst.id),
                    "item": ItemOutSchema.from_orm(inst.item).dict(),
                    "quantity": 1,
                    "is_instance": True,
                    "instance": ItemInstanceOutSchema.from_orm(inst).dict(),
                }
            )

        # Sort by item type, rarity, name
        entries.sort(
            key=lambda e: (
                e["item"].get("item_type", ""),
                e["item"].get("rarity", ""),
                e["item"].get("name", ""),
            )
        )

        total = len(entries)
        page = entries[offset : offset + limit]

        return {
            "items": page,
            "count": total,
        }

    @route.get("/instances/{instance_id}/", response={200: ItemInstanceOutSchema, 404: dict}, auth=ActiveUserJWTAuth())
    def get_instance(self, request, instance_id: str):
        """Get details of a specific item instance."""
        from apps.inventory.models import ItemInstance

        try:
            instance = ItemInstance.objects.select_related("item", "first_owner", "crafted_by").get(id=instance_id)
        except ItemInstance.DoesNotExist:
            return 404, {"detail": "Instance not found."}
        return 200, instance

    @route.post(
        "/instances/{instance_id}/rename/",
        response={200: ItemInstanceOutSchema, 400: dict, 404: dict},
        auth=ActiveUserJWTAuth(),
    )
    def rename_instance(self, request, instance_id: str, payload: RenameInstanceInSchema):
        """Set or clear a nametag on an owned instance."""
        from apps.inventory.models import ItemInstance

        try:
            instance = ItemInstance.objects.select_related("item", "first_owner", "crafted_by").get(
                id=instance_id,
                owner=request.user,
            )
        except ItemInstance.DoesNotExist:
            return 404, {"detail": "Instance not found or not owned by you."}
        if len(payload.nametag) > 50:
            return 400, {"detail": "Nametag too long (max 50 characters)."}
        instance.nametag = payload.nametag
        instance.save(update_fields=["nametag"])
        return 200, instance

    @route.get("/wallet/", response=WalletOutSchema, auth=ActiveUserJWTAuth())
    def my_wallet(self, request):
        """Get current user's gold wallet."""
        return get_or_create_wallet(request.user)

    @route.get("/drops/", response=dict, auth=ActiveUserJWTAuth())
    def my_drops(self, request, limit: int = 50, offset: int = 0):
        """Get recent item drops for current user."""
        qs = ItemDrop.objects.filter(user=request.user).select_related("item", "item__category")
        return paginate_qs(qs, limit, offset, schema=ItemDropOutSchema)

    @route.post("/open-crate/", auth=ActiveUserJWTAuth())
    def open_crate(self, request, payload: OpenCrateInSchema):
        """Open a crate using a key. Returns dropped items."""
        crate = get_object_or_404(Item, slug=payload.crate_item_slug, item_type=Item.ItemType.CRATE)
        key = get_object_or_404(Item, slug=payload.key_item_slug, item_type=Item.ItemType.KEY)

        if key.opens_crate_id != crate.id:
            return self.create_response({"error": "This key does not open this crate"}, status_code=400)

        with transaction.atomic():
            if not remove_item_from_inventory(request.user, crate, 1):
                return self.create_response({"error": "You do not have this crate"}, status_code=400)
            if not remove_item_from_inventory(request.user, key, 1):
                # Return the crate
                add_item_to_inventory(request.user, crate, 1)
                return self.create_response({"error": "You do not have this key"}, status_code=400)

            # Roll loot from crate_loot_table
            loot_table = crate.crate_loot_table or []
            if not loot_table:
                return self.create_response({"error": "Crate has no loot table"}, status_code=400)

            drops = _roll_crate_loot(loot_table)
            result_drops = []
            for item_slug, qty in drops:
                try:
                    drop_item = Item.objects.get(slug=item_slug)
                except Item.DoesNotExist:
                    continue
                add_item_to_inventory(request.user, drop_item, qty)
                ItemDrop.objects.create(
                    user=request.user,
                    item=drop_item,
                    quantity=qty,
                    source=ItemDrop.DropSource.CRATE_OPEN,
                )
                result_drops.append(
                    {
                        "item_name": drop_item.name,
                        "item_slug": drop_item.slug,
                        "rarity": drop_item.rarity,
                        "quantity": qty,
                    }
                )

        return {"drops": result_drops}

    @route.get("/cosmetics/equipped/", response=list[EquippedCosmeticOutSchema], auth=ActiveUserJWTAuth())
    def equipped_cosmetics(self, request):
        """List currently equipped cosmetics."""
        return EquippedCosmetic.objects.filter(user=request.user).select_related("item", "item__cosmetic_asset")

    @route.post(
        "/cosmetics/equip/", response={200: EquippedCosmeticOutSchema, 400: dict, 404: dict}, auth=ActiveUserJWTAuth()
    )
    def equip_cosmetic(self, request, payload: EquipCosmeticInSchema):
        """Equip a cosmetic item."""
        from apps.inventory.models import ItemInstance

        item = None
        instance = None

        if payload.instance_id:
            # Look up specific instance
            inst = (
                ItemInstance.objects.filter(id=payload.instance_id, owner=request.user)
                .select_related("item", "item__cosmetic_asset")
                .first()
            )
            if inst:
                item = inst.item
                instance = inst
        else:
            # Look up by slug - try instances first (cosmetics are always instances)
            inst = (
                ItemInstance.objects.filter(owner=request.user, item__slug=payload.item_slug)
                .select_related("item", "item__cosmetic_asset")
                .first()
            )
            if inst:
                item = inst.item
                instance = inst
            else:
                # Fallback to stackable inventory
                inv = (
                    UserInventory.objects.filter(user=request.user, item__slug=payload.item_slug)
                    .select_related("item", "item__cosmetic_asset")
                    .first()
                )
                if inv:
                    item = inv.item

        if not item:
            return 404, {"detail": "Item not found in inventory."}

        if item.item_type != Item.ItemType.COSMETIC:
            return 400, {"detail": "Item is not a cosmetic."}

        if not item.cosmetic_slot:
            return 400, {"detail": "Item has no cosmetic_slot configured."}

        defaults = {"item": item}
        if instance:
            defaults["instance"] = instance
        equipped, _ = EquippedCosmetic.objects.update_or_create(
            user=request.user,
            slot=item.cosmetic_slot,
            defaults=defaults,
        )
        return 200, equipped

    @route.post("/cosmetics/unequip/", response={200: dict, 404: dict}, auth=ActiveUserJWTAuth())
    def unequip_cosmetic(self, request, payload: UnequipCosmeticInSchema):
        """Unequip a cosmetic from a slot."""
        deleted, _ = EquippedCosmetic.objects.filter(user=request.user, slot=payload.slot).delete()
        if not deleted:
            return 404, {"detail": "No cosmetic equipped in this slot."}
        return 200, {"detail": "Unequipped."}


def _roll_crate_loot(loot_table, num_rolls=3):
    """Roll items from a crate loot table. Returns list of (item_slug, quantity)."""
    if not loot_table:
        return []

    items = []
    weights = []
    for entry in loot_table:
        items.append(entry)
        weights.append(entry.get("weight", 1))

    results = []
    for _ in range(num_rolls):
        chosen = random.choices(items, weights=weights, k=1)[0]
        min_qty = chosen.get("min_qty", 1)
        max_qty = chosen.get("max_qty", 1)
        qty = random.randint(min_qty, max_qty)
        results.append((chosen["item_slug"], qty))

    # Merge duplicates
    merged = {}
    for slug, qty in results:
        merged[slug] = merged.get(slug, 0) + qty
    return list(merged.items())


# Item types permitted inside a deck
_DECK_ALLOWED_TYPES = {
    Item.ItemType.BLUEPRINT_BUILDING,
    Item.ItemType.BLUEPRINT_UNIT,
    Item.ItemType.TACTICAL_PACKAGE,
    Item.ItemType.BOOST,
}


def _cleanup_stale_deck_items(user, deck):
    """Remove consumable items from a deck if the user no longer owns them."""
    from apps.inventory.models import ItemInstance

    for di in list(deck.items.select_related("item").all()):
        if di.item.is_consumable:
            if di.item.is_stackable:
                owns = UserInventory.objects.filter(
                    user=user,
                    item=di.item,
                    quantity__gte=1,
                ).exists()
            else:
                owns = ItemInstance.objects.filter(
                    owner=user,
                    item=di.item,
                ).exists()
            if not owns:
                di.delete()


@api_controller("/inventory/decks", tags=["Decks"])
@require_module_controller("cosmetics")
class DeckController:
    @route.get("/", response=dict, auth=ActiveUserJWTAuth())
    def list_decks(self, request, limit: int = 50, offset: int = 0):
        """List current user's decks with their items."""
        # Auto-cleanup consumed items from all decks
        for deck in Deck.objects.filter(user=request.user).prefetch_related("items__item"):
            _cleanup_stale_deck_items(request.user, deck)
        qs = Deck.objects.filter(user=request.user).prefetch_related("items__item", "items__item__category")
        return paginate_qs(qs, limit, offset, schema=DeckOutSchema)

    @route.post("/", response=DeckOutSchema, auth=ActiveUserJWTAuth())
    def create_deck(self, request, payload: DeckCreateSchema):
        """Create a new deck for the current user."""
        deck = Deck.objects.create(user=request.user, name=payload.name)
        return deck

    @route.get("/{deck_id}/", response=DeckOutSchema, auth=ActiveUserJWTAuth())
    def get_deck(self, request, deck_id: str):
        """Retrieve a single deck with its items."""
        deck = get_object_or_404(
            Deck.objects.prefetch_related("items__item", "items__item__category"),
            id=deck_id,
            user=request.user,
        )
        _cleanup_stale_deck_items(request.user, deck)
        return deck

    @route.put("/{deck_id}/", response=DeckOutSchema, auth=ActiveUserJWTAuth())
    def update_deck(self, request, deck_id: str, payload: DeckUpdateSchema):
        """Update a deck's name and/or item list.

        Validation:
        - Each item_slug must exist and be of type blueprint_building,
          blueprint_unit, ability_scroll, or boost.
        - User must have enough items in inventory to cover ALL decks combined
          (not just this one).
        """
        deck = get_object_or_404(Deck, id=deck_id, user=request.user)

        if not deck.is_editable:
            return self.create_response(
                {"error": "Domyślna talia nie może być edytowana. Utwórz nową talię."}, status_code=403
            )

        with transaction.atomic():
            if payload.name is not None:
                deck.name = payload.name
                deck.save(update_fields=["name", "updated_at"])

            if payload.items is not None:
                # Validate each slot
                validated_items: list[tuple] = []
                for slot in payload.items:
                    try:
                        item = Item.objects.get(slug=slot.item_slug, is_active=True)
                    except Item.DoesNotExist:
                        return self.create_response(
                            {"error": f"Item not found: {slot.item_slug}"},
                            status_code=400,
                        )
                    if item.item_type not in _DECK_ALLOWED_TYPES:
                        return self.create_response(
                            {"error": f'Item type "{item.item_type}" is not allowed in a deck: {slot.item_slug}'},
                            status_code=400,
                        )
                    validated_items.append((item, slot.quantity))

                # Non-consumable items (blueprints, tactical packages) must be
                # unique per deck — you can't add 3x pkg_shield. They also only
                # need to exist in inventory (qty >= 1), not be "spent".
                # Additionally, only one level per blueprint_ref is allowed
                # (e.g. barracks lvl 1 OR lvl 2, not both).
                for item, qty in validated_items:
                    if not item.is_consumable and qty > 1:
                        return self.create_response(
                            {"error": f'Non-consumable item "{item.name}" can only appear once in a deck'},
                            status_code=400,
                        )

                seen_refs: set = set()
                for item, _qty in validated_items:
                    if item.blueprint_ref:
                        if item.blueprint_ref in seen_refs:
                            return self.create_response(
                                {"error": f'Only one level of "{item.blueprint_ref}" is allowed per deck'},
                                status_code=400,
                            )
                        seen_refs.add(item.blueprint_ref)

                # Consumable items: check inventory coverage across all decks
                new_deck_requirements: dict = {}
                for item, qty in validated_items:
                    if item.is_consumable:
                        new_deck_requirements[item.id] = new_deck_requirements.get(item.id, 0) + qty

                if new_deck_requirements:
                    # Sum requirements from OTHER decks for the same user (consumables only)
                    other_requirements: dict = {}
                    for di in (
                        DeckItem.objects.filter(
                            deck__user=request.user,
                            item__is_consumable=True,
                        )
                        .exclude(deck_id=deck_id)
                        .select_related("item")
                    ):
                        other_requirements[di.item_id] = other_requirements.get(di.item_id, 0) + di.quantity

                    # Build combined requirement and validate against inventory
                    all_item_ids = set(new_deck_requirements) | set(other_requirements)
                    for item_id in all_item_ids:
                        total_required = new_deck_requirements.get(item_id, 0) + other_requirements.get(item_id, 0)
                        # Check both UserInventory (stackable) and ItemInstance (non-stackable)
                        item_obj = Item.objects.filter(id=item_id).first()
                        if item_obj and not item_obj.is_stackable:
                            from apps.inventory.models import ItemInstance

                            owned = ItemInstance.objects.filter(owner=request.user, item_id=item_id).count()
                        else:
                            owned = (
                                UserInventory.objects.filter(user=request.user, item_id=item_id)
                                .values_list("quantity", flat=True)
                                .first()
                                or 0
                            )
                        if owned < total_required:
                            try:
                                item_name = Item.objects.get(id=item_id).name
                            except Item.DoesNotExist:
                                item_name = str(item_id)
                            return self.create_response(
                                {
                                    "error": (
                                        f'Insufficient inventory for "{item_name}": '
                                        f"need {total_required} across all decks, have {owned}"
                                    )
                                },
                                status_code=400,
                            )

                # Replace deck items
                DeckItem.objects.filter(deck=deck).delete()
                for item, qty in validated_items:
                    instance = None
                    if not item.is_stackable:
                        from apps.inventory.models import ItemInstance

                        instance = ItemInstance.objects.filter(owner=request.user, item=item).first()
                    DeckItem.objects.create(deck=deck, item=item, quantity=qty, instance=instance)

        return Deck.objects.prefetch_related("items__item", "items__item__category").get(id=deck.id)

    @route.delete("/{deck_id}/", auth=ActiveUserJWTAuth())
    def delete_deck(self, request, deck_id: str):
        """Delete a deck."""
        deck = get_object_or_404(Deck, id=deck_id, user=request.user)
        if not deck.is_editable:
            return self.create_response({"error": "Domyślna talia nie może być usunięta."}, status_code=403)
        deck.delete()
        return {"ok": True}

    @route.post("/{deck_id}/set-default/", response=DeckOutSchema, auth=ActiveUserJWTAuth())
    def set_default_deck(self, request, deck_id: str):
        """Set this deck as the user's default deck."""
        deck = get_object_or_404(
            Deck.objects.prefetch_related("items__item", "items__item__category"),
            id=deck_id,
            user=request.user,
        )
        deck.is_default = True
        deck.save()  # triggers the unique-default enforcement in Deck.save()
        return deck
