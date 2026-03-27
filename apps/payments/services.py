import logging

from django.db import transaction
from django.utils import timezone

from apps.payments.models import GemTransaction, ShopItem, ShopPurchase
from apps.payments.stripe_service import get_or_create_gem_wallet

logger = logging.getLogger(__name__)


class InsufficientGemsError(Exception):
    pass


class ShopItemUnavailableError(Exception):
    pass


class PurchaseLimitReachedError(Exception):
    pass


def buy_shop_item(user, shop_item_id) -> ShopPurchase:
    """Buy a ShopItem with gems. Returns the ShopPurchase record."""
    with transaction.atomic():
        try:
            shop_item = ShopItem.objects.select_related("item").get(id=shop_item_id, is_active=True)
        except ShopItem.DoesNotExist as e:
            raise ShopItemUnavailableError("Item not found or inactive") from e

        now = timezone.now()
        if shop_item.available_from and now < shop_item.available_from:
            raise ShopItemUnavailableError("Item not yet available")
        if shop_item.available_until and now > shop_item.available_until:
            raise ShopItemUnavailableError("Item no longer available")

        if shop_item.max_purchases_per_user is not None:
            purchase_count = ShopPurchase.objects.filter(user=user, shop_item=shop_item).count()
            if purchase_count >= shop_item.max_purchases_per_user:
                raise PurchaseLimitReachedError("Purchase limit reached for this item")

        wallet = get_or_create_gem_wallet(user)
        # Lock wallet row
        wallet = type(wallet).objects.select_for_update().get(pk=wallet.pk)

        if wallet.gems < shop_item.gem_price:
            raise InsufficientGemsError(f"Need {shop_item.gem_price} gems, have {wallet.gems}")

        wallet.gems -= shop_item.gem_price
        wallet.total_spent += shop_item.gem_price
        wallet.save(update_fields=["gems", "total_spent", "updated_at"])

        # Add item to inventory using existing utility
        instance = _add_item_to_inventory(user, shop_item.item, shop_item.quantity)

        purchase = ShopPurchase.objects.create(
            user=user,
            shop_item=shop_item,
            item=shop_item.item,
            quantity=shop_item.quantity,
            gems_spent=shop_item.gem_price,
            instance=instance,
        )

        GemTransaction.objects.create(
            user=user,
            amount=-shop_item.gem_price,
            reason=GemTransaction.Reason.SHOP_BUY,
            reference_id=str(purchase.id),
            balance_after=wallet.gems,
            note=f"Bought {shop_item.item.name}",
        )

    logger.info("User %s bought %s for %d gems", user.username, shop_item.item.name, shop_item.gem_price)
    return purchase


def _add_item_to_inventory(user, item, quantity):
    """Add item to user's inventory. Returns ItemInstance for non-stackable items."""
    from apps.inventory.models import UserInventory
    from apps.inventory.views import create_item_instance

    if item.is_stackable:
        inv, _ = UserInventory.objects.get_or_create(user=user, item=item)
        inv.quantity += quantity
        inv.save(update_fields=["quantity"])
        return None

    # Non-stackable: create unique instance
    instance = create_item_instance(item, owner=user)
    return instance
