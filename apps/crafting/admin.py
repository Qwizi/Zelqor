from django.contrib import admin
from unfold.admin import ModelAdmin, TabularInline
from unfold.decorators import display

from apps.crafting.models import CraftingLog, Recipe, RecipeIngredient


class RecipeIngredientInline(TabularInline):
    model = RecipeIngredient
    extra = 1
    raw_id_fields = ("item",)


@admin.register(Recipe)
class RecipeAdmin(ModelAdmin):
    list_display = ("name", "slug", "result_item", "result_quantity", "gold_cost", "display_active", "order")
    list_filter = ("is_active", "result_item__item_type", "result_item__rarity")
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    raw_id_fields = ("result_item",)
    inlines = [RecipeIngredientInline]
    list_editable = ("order",)
    warn_unsaved_form = True

    @display(description="Active", label=True)
    def display_active(self, obj):
        return "ACTIVE" if obj.is_active else "INACTIVE"


@admin.register(CraftingLog)
class CraftingLogAdmin(ModelAdmin):
    list_display = ("user", "recipe", "result_item", "result_quantity", "gold_spent", "created_at")
    list_filter = ("result_item__item_type",)
    list_filter_submit = True
    list_fullwidth = True
    search_fields = ("user__username", "recipe__name")
    raw_id_fields = ("user", "recipe", "result_item")
