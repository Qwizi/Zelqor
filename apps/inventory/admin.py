from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.contrib.filters.admin import RangeNumericFilter
from unfold.decorators import display

from apps.inventory.models import (
    Deck,
    DeckItem,
    EquippedCosmetic,
    Item,
    ItemCategory,
    ItemDrop,
    ItemInstance,
    UserInventory,
    Wallet,
)

# ── Inlines ──────────────────────────────────────────────────


class UserInventoryInline(TabularInline):
    """Inline on User admin — manage inventory directly from user page."""

    model = UserInventory
    extra = 1
    autocomplete_fields = ["item"]
    fields = ["item", "quantity", "acquired_at"]
    readonly_fields = ["acquired_at"]


class EquippedCosmeticInline(TabularInline):
    """Inline on User admin — equip/unequip cosmetics from user page."""

    model = EquippedCosmetic
    extra = 1
    autocomplete_fields = ["item"]
    fields = ["slot", "item", "equipped_at"]
    readonly_fields = ["equipped_at"]


class EquippedByInline(TabularInline):
    """Inline on Item admin — see which users have this item equipped."""

    model = EquippedCosmetic
    extra = 0
    fk_name = "item"
    fields = ["user", "slot", "equipped_at"]
    readonly_fields = ["user", "slot", "equipped_at"]

    def has_add_permission(self, request, obj=None):
        return False


class ItemInventoryInline(TabularInline):
    """Inline on Item admin — see which users own this item."""

    model = UserInventory
    extra = 0
    fk_name = "item"
    fields = ["user", "quantity", "acquired_at"]
    readonly_fields = ["user", "quantity", "acquired_at"]

    def has_add_permission(self, request, obj=None):
        return False


class DeckItemInline(TabularInline):
    """Inline on Deck admin — manage items in a deck."""

    model = DeckItem
    extra = 1
    autocomplete_fields = ["item"]
    fields = ["item", "quantity"]


class DeckInline(TabularInline):
    """Inline on User admin — see/manage user's decks."""

    model = Deck
    extra = 0
    fields = ["name", "is_default", "created_at"]
    readonly_fields = ["created_at"]
    show_change_link = True


class ItemInstanceInline(TabularInline):
    """Inline on User admin — view item instances owned by the user."""

    model = ItemInstance
    extra = 0
    fk_name = "owner"
    fields = ["item", "pattern_seed", "wear", "stattrak", "nametag", "created_at"]
    readonly_fields = ["created_at"]
    autocomplete_fields = ["item"]


# ── Model Admins ─────────────────────────────────────────────


@admin.register(ItemCategory)
class ItemCategoryAdmin(ModelAdmin):
    list_display = ("name", "slug", "order", "display_active")
    list_fullwidth = True
    prepopulated_fields = {"slug": ("name",)}
    list_editable = ("order",)

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(Item)
class ItemAdmin(ModelAdmin):
    list_display = (
        "icon",
        "name",
        "slug",
        "category",
        "item_type",
        "display_rarity",
        "base_value",
        "is_tradeable",
        "display_active",
    )
    list_filter = (
        "category",
        "item_type",
        "rarity",
        "is_active",
        "is_tradeable",
        ("base_value", RangeNumericFilter),
    )
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    raw_id_fields = ("cosmetic_asset", "opens_crate")
    inlines = [EquippedByInline, ItemInventoryInline]
    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "slug",
                    "description",
                    "category",
                    "item_type",
                    "rarity",
                    "icon",
                    "cosmetic_slot",
                    "cosmetic_asset",
                    "cosmetic_params",
                )
            },
        ),
        ("Properties", {"fields": ("is_stackable", "is_tradeable", "is_consumable", "max_stack", "base_value")}),
        ("Crate / Key", {"classes": ("collapse",), "fields": ("crate_loot_table", "opens_crate")}),
        ("Boost / Blueprint", {"classes": ("collapse",), "fields": ("boost_params", "blueprint_ref")}),
        ("Status", {"fields": ("is_active",)}),
    )

    @display(
        description="Rarity",
        label={
            "common": "info",
            "uncommon": "success",
            "rare": "primary",
            "epic": "warning",
            "legendary": "danger",
        },
    )
    def display_rarity(self, obj):
        return obj.rarity

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(UserInventory)
class UserInventoryAdmin(ModelAdmin):
    list_display = ("user", "item", "quantity", "acquired_at")
    list_filter = ("item__category", "item__rarity")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("user__username", "item__name")
    autocomplete_fields = ["user", "item"]


@admin.register(ItemDrop)
class ItemDropAdmin(ModelAdmin):
    list_display = ("user", "item", "quantity", "display_source", "match", "created_at")
    list_filter = ("source", "item__rarity")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("user__username", "item__name")
    raw_id_fields = ("user", "item", "match")

    @display(
        description="Source",
        label={
            "match_reward": "success",
            "crate_open": "warning",
            "crafting": "info",
        },
    )
    def display_source(self, obj):
        return obj.source


@admin.register(Wallet)
class WalletAdmin(ModelAdmin):
    list_display = ("user", "gold", "total_earned", "total_spent", "updated_at")
    list_filter = (("gold", RangeNumericFilter),)
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("user__username",)
    raw_id_fields = ("user",)


@admin.register(EquippedCosmetic)
class EquippedCosmeticAdmin(ModelAdmin):
    list_display = ["user", "slot", "item", "display_item_type", "equipped_at"]
    list_filter = ["slot", "item__item_type"]
    search_fields = ["user__username", "item__name", "slot"]
    autocomplete_fields = ["user", "item"]
    readonly_fields = ["equipped_at"]

    @display(description="Type")
    def display_item_type(self, obj):
        return obj.item.get_item_type_display()


@admin.register(ItemInstance)
class ItemInstanceAdmin(ModelAdmin):
    list_display = ("item", "owner", "display_wear", "pattern_seed", "display_stattrak", "nametag", "created_at")
    list_filter = ("item__item_type", "item__rarity", "stattrak")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("owner__username", "item__name", "nametag")
    raw_id_fields = ("owner", "item", "first_owner", "crafted_by", "dropped_from_match")
    readonly_fields = ("created_at",)
    fieldsets = (
        (None, {"fields": ("item", "owner")}),
        ("Properties", {"fields": ("pattern_seed", "wear", "nametag")}),
        ("StatTrak", {"fields": ("stattrak", "stattrak_matches", "stattrak_kills", "stattrak_units_produced")}),
        ("Provenance", {"fields": ("first_owner", "crafted_by", "dropped_from_match", "created_at")}),
    )

    @display(description="Wear")
    def display_wear(self, obj):
        return f"{obj.wear_condition.label} ({obj.wear:.4f})"

    @display(description="ST", label=True)
    def display_stattrak(self, obj):
        return "ST" if obj.stattrak else "-"


@admin.register(Deck)
class DeckAdmin(ModelAdmin):
    list_display = ("name", "user", "is_default", "display_item_count", "created_at")
    list_filter = ("is_default",)
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "user__username")
    autocomplete_fields = ["user"]
    inlines = [DeckItemInline]
    readonly_fields = ["created_at", "updated_at"]
    fieldsets = (
        (None, {"fields": ("user", "name", "is_default")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )

    def display_item_count(self, obj):
        return obj.items.count()

    display_item_count.short_description = "Items"
