import uuid

from django.conf import settings
from django.db import models


class GemWallet(models.Model):
    """Premium currency wallet — separate from the gold Wallet in inventory."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gem_wallet")
    gems = models.PositiveIntegerField(default=0)
    total_purchased = models.PositiveIntegerField(default=0)
    total_spent = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.username}: {self.gems} gems"


class GemPackage(models.Model):
    """A purchasable bundle of gems (e.g. 100 gems for $0.99)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=100, unique=True)
    gems = models.PositiveIntegerField()
    bonus_gems = models.PositiveIntegerField(default=0)
    price_cents = models.PositiveIntegerField(help_text="Price in smallest currency unit (e.g. cents)")
    currency = models.CharField(max_length=3, default="usd")
    stripe_price_id = models.CharField(max_length=100, blank=True, help_text="Optional pre-created Stripe Price ID")
    icon = models.CharField(max_length=100, blank=True)
    is_active = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order", "price_cents"]

    def __str__(self):
        return f"{self.name} ({self.gems}+{self.bonus_gems} gems, {self.price_cents}¢)"

    @property
    def total_gems(self):
        return self.gems + self.bonus_gems


class PurchaseOrder(models.Model):
    """Tracks a Stripe Checkout session for gem purchase."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="purchase_orders")
    gem_package = models.ForeignKey(GemPackage, on_delete=models.CASCADE, related_name="orders")
    gems_credited = models.PositiveIntegerField(default=0)
    price_cents = models.PositiveIntegerField()
    currency = models.CharField(max_length=3, default="usd")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    stripe_checkout_session_id = models.CharField(max_length=200, unique=True, db_index=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    idempotency_key = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order {self.id} ({self.status}) — {self.gem_package.name} for {self.user.username}"


class GemTransaction(models.Model):
    """Audit log entry for every gem credit or debit."""

    class Reason(models.TextChoices):
        PURCHASE = "purchase", "Gem Purchase"
        SHOP_BUY = "shop_buy", "Shop Purchase"
        CRATE_KEY = "crate_key", "Crate Key Purchase"
        REFUND = "refund", "Refund"
        ADMIN = "admin", "Admin Adjustment"
        GIFT = "gift", "Gift / Promotional"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="gem_transactions")
    amount = models.IntegerField(help_text="Positive = credit, negative = debit")
    reason = models.CharField(max_length=20, choices=Reason.choices)
    reference_id = models.CharField(max_length=200, blank=True, help_text="PurchaseOrder or ShopPurchase ID")
    balance_after = models.PositiveIntegerField()
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        sign = "+" if self.amount >= 0 else ""
        return f"{sign}{self.amount} gems ({self.reason}) — {self.user.username}"


class ShopItem(models.Model):
    """An item available for gem purchase in the shop."""

    class ShopCategory(models.TextChoices):
        FEATURED = "featured", "Featured"
        DAILY_DEAL = "daily_deal", "Daily Deal"
        KEYS = "keys", "Keys"
        COSMETICS = "cosmetics", "Cosmetics"
        CONVENIENCE = "convenience", "Convenience"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    item = models.ForeignKey("inventory.Item", on_delete=models.CASCADE, related_name="shop_listings")
    gem_price = models.PositiveIntegerField()
    original_gem_price = models.PositiveIntegerField(
        null=True, blank=True, help_text="Show crossed-out price for discounts"
    )
    shop_category = models.CharField(max_length=20, choices=ShopCategory.choices, default=ShopCategory.COSMETICS)
    quantity = models.PositiveIntegerField(default=1, help_text="How many of the item you get per purchase")
    is_active = models.BooleanField(default=True)
    available_from = models.DateTimeField(null=True, blank=True)
    available_until = models.DateTimeField(null=True, blank=True)
    max_purchases_per_user = models.PositiveIntegerField(null=True, blank=True, help_text="None = unlimited")
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order", "-created_at"]

    def __str__(self):
        return f"{self.item.name} — {self.gem_price} gems ({self.shop_category})"


class ShopPurchase(models.Model):
    """Log of a gem shop purchase."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="shop_purchases")
    shop_item = models.ForeignKey(ShopItem, on_delete=models.CASCADE, related_name="purchases")
    item = models.ForeignKey("inventory.Item", on_delete=models.CASCADE)
    quantity = models.PositiveIntegerField(default=1)
    gems_spent = models.PositiveIntegerField()
    instance = models.ForeignKey(
        "inventory.ItemInstance", on_delete=models.SET_NULL, null=True, blank=True, related_name="shop_purchases"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} bought {self.item.name} for {self.gems_spent} gems"
