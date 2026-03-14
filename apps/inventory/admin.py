from django.contrib import admin
from apps.inventory.models import ItemCategory, Item, UserInventory, ItemDrop, Wallet


@admin.register(ItemCategory)
class ItemCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'order', 'is_active')
    prepopulated_fields = {'slug': ('name',)}
    list_editable = ('order', 'is_active')


class ItemInline(admin.TabularInline):
    model = Item
    extra = 0
    fields = ('name', 'slug', 'item_type', 'rarity', 'icon', 'base_value', 'is_active')


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ('icon', 'name', 'slug', 'category', 'item_type', 'rarity', 'base_value', 'is_tradeable', 'is_active')
    list_filter = ('category', 'item_type', 'rarity', 'is_active', 'is_tradeable')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    fieldsets = (
        (None, {
            'fields': ('name', 'slug', 'description', 'category', 'item_type', 'rarity', 'icon', 'asset_key'),
        }),
        ('Properties', {
            'fields': ('is_stackable', 'is_tradeable', 'is_consumable', 'max_stack', 'base_value'),
        }),
        ('Crate / Key', {
            'classes': ('collapse',),
            'fields': ('crate_loot_table', 'opens_crate'),
        }),
        ('Boost / Blueprint', {
            'classes': ('collapse',),
            'fields': ('boost_params', 'blueprint_ref'),
        }),
        ('Status', {
            'fields': ('is_active',),
        }),
    )


@admin.register(UserInventory)
class UserInventoryAdmin(admin.ModelAdmin):
    list_display = ('user', 'item', 'quantity', 'acquired_at')
    list_filter = ('item__category', 'item__rarity')
    search_fields = ('user__username', 'item__name')
    raw_id_fields = ('user', 'item')


@admin.register(ItemDrop)
class ItemDropAdmin(admin.ModelAdmin):
    list_display = ('user', 'item', 'quantity', 'source', 'match', 'created_at')
    list_filter = ('source', 'item__rarity')
    search_fields = ('user__username', 'item__name')
    raw_id_fields = ('user', 'item', 'match')


@admin.register(Wallet)
class WalletAdmin(admin.ModelAdmin):
    list_display = ('user', 'gold', 'total_earned', 'total_spent', 'updated_at')
    search_fields = ('user__username',)
    raw_id_fields = ('user',)
