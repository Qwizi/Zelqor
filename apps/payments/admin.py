from django.contrib import admin
from unfold.admin import ModelAdmin

from apps.payments.models import GemPackage, GemTransaction, GemWallet, PurchaseOrder, ShopItem, ShopPurchase


@admin.register(GemWallet)
class GemWalletAdmin(ModelAdmin):
    list_display = ["user", "gems", "total_purchased", "total_spent", "updated_at"]
    search_fields = ["user__username"]
    readonly_fields = ["total_purchased", "total_spent"]


@admin.register(GemPackage)
class GemPackageAdmin(ModelAdmin):
    list_display = [
        "name",
        "slug",
        "gems",
        "bonus_gems",
        "price_cents",
        "currency",
        "is_active",
        "is_featured",
        "order",
    ]
    list_filter = ["is_active", "is_featured", "currency"]
    prepopulated_fields = {"slug": ("name",)}
    list_editable = ["is_active", "is_featured", "order"]


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(ModelAdmin):
    list_display = ["user", "gem_package", "status", "gems_credited", "price_cents", "created_at", "completed_at"]
    list_filter = ["status"]
    search_fields = ["user__username", "stripe_checkout_session_id"]
    readonly_fields = [
        "stripe_checkout_session_id",
        "stripe_payment_intent_id",
        "idempotency_key",
        "gems_credited",
        "completed_at",
        "refunded_at",
    ]


@admin.register(GemTransaction)
class GemTransactionAdmin(ModelAdmin):
    list_display = ["user", "amount", "reason", "balance_after", "created_at"]
    list_filter = ["reason"]
    search_fields = ["user__username", "reference_id"]
    readonly_fields = ["user", "amount", "reason", "reference_id", "balance_after", "note"]


@admin.register(ShopItem)
class ShopItemAdmin(ModelAdmin):
    list_display = [
        "item",
        "gem_price",
        "original_gem_price",
        "shop_category",
        "is_active",
        "available_from",
        "available_until",
        "order",
    ]
    list_filter = ["shop_category", "is_active"]
    list_editable = ["gem_price", "is_active", "order"]
    autocomplete_fields = ["item"]


@admin.register(ShopPurchase)
class ShopPurchaseAdmin(ModelAdmin):
    list_display = ["user", "item", "quantity", "gems_spent", "created_at"]
    search_fields = ["user__username"]
    readonly_fields = ["user", "shop_item", "item", "quantity", "gems_spent", "instance"]
