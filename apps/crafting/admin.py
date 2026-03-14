from django.contrib import admin
from apps.crafting.models import Recipe, RecipeIngredient, CraftingLog


class RecipeIngredientInline(admin.TabularInline):
    model = RecipeIngredient
    extra = 1
    raw_id_fields = ('item',)


@admin.register(Recipe)
class RecipeAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'result_item', 'result_quantity', 'gold_cost', 'is_active', 'order')
    list_filter = ('is_active', 'result_item__item_type', 'result_item__rarity')
    search_fields = ('name', 'slug')
    prepopulated_fields = {'slug': ('name',)}
    raw_id_fields = ('result_item',)
    inlines = [RecipeIngredientInline]
    list_editable = ('is_active', 'order')


@admin.register(CraftingLog)
class CraftingLogAdmin(admin.ModelAdmin):
    list_display = ('user', 'recipe', 'result_item', 'result_quantity', 'gold_spent', 'created_at')
    list_filter = ('result_item__item_type',)
    search_fields = ('user__username', 'recipe__name')
    raw_id_fields = ('user', 'recipe', 'result_item')
