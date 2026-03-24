from django.contrib import admin
from unfold.admin import ModelAdmin
from unfold.contrib.filters.admin import RangeNumericFilter
from unfold.decorators import display

from apps.marketplace.models import MarketConfig, MarketListing, MarketTransaction


@admin.register(MarketListing)
class MarketListingAdmin(ModelAdmin):
    list_display = (
        "item",
        "display_listing_type",
        "seller",
        "quantity",
        "quantity_remaining",
        "price_per_unit",
        "display_status",
        "is_bot_listing",
        "created_at",
    )
    list_filter = (
        "listing_type",
        "status",
        "is_bot_listing",
        "item__category",
        ("price_per_unit", RangeNumericFilter),
    )
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("seller__username", "item__name")
    raw_id_fields = ("seller", "item")

    @display(
        description="Type",
        label={
            "sell": "warning",
            "buy": "success",
        },
    )
    def display_listing_type(self, obj):
        return obj.listing_type

    @display(
        description="Status",
        label={
            "active": "success",
            "fulfilled": "info",
            "cancelled": "danger",
            "expired": "warning",
        },
    )
    def display_status(self, obj):
        return obj.status


@admin.register(MarketTransaction)
class MarketTransactionAdmin(ModelAdmin):
    list_display = ("buyer", "seller", "item", "quantity", "price_per_unit", "total_price", "fee", "created_at")
    list_filter = (
        "item__category",
        ("total_price", RangeNumericFilter),
    )
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("buyer__username", "seller__username", "item__name")
    raw_id_fields = ("buyer", "seller", "item", "listing")


@admin.register(MarketConfig)
class MarketConfigAdmin(ModelAdmin):
    list_display = (
        "transaction_fee_percent",
        "listing_duration_hours",
        "max_active_listings_per_user",
        "bot_restock_interval_minutes",
    )
    warn_unsaved_form = True

    def has_add_permission(self, request):
        return not MarketConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
