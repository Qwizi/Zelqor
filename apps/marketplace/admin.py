from django.contrib import admin
from apps.marketplace.models import MarketListing, MarketTransaction, MarketConfig


@admin.register(MarketListing)
class MarketListingAdmin(admin.ModelAdmin):
    list_display = ('item', 'listing_type', 'seller', 'quantity', 'quantity_remaining', 'price_per_unit', 'status', 'is_bot_listing', 'created_at')
    list_filter = ('listing_type', 'status', 'is_bot_listing', 'item__category')
    search_fields = ('seller__username', 'item__name')
    raw_id_fields = ('seller', 'item')


@admin.register(MarketTransaction)
class MarketTransactionAdmin(admin.ModelAdmin):
    list_display = ('buyer', 'seller', 'item', 'quantity', 'price_per_unit', 'total_price', 'fee', 'created_at')
    list_filter = ('item__category',)
    search_fields = ('buyer__username', 'seller__username', 'item__name')
    raw_id_fields = ('buyer', 'seller', 'item', 'listing')


@admin.register(MarketConfig)
class MarketConfigAdmin(admin.ModelAdmin):
    list_display = ('transaction_fee_percent', 'listing_duration_hours', 'max_active_listings_per_user', 'bot_restock_interval_minutes')

    def has_add_permission(self, request):
        return not MarketConfig.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False
