import logging
from django.db import transaction
from ninja_extra import api_controller, route
from apps.accounts.auth import ActiveUserJWTAuth
from apps.pagination import paginate_qs

from apps.crafting.models import CraftingLog, Recipe
from apps.crafting.schemas import CraftInSchema, CraftingLogOutSchema, RecipeOutSchema
from apps.inventory.models import ItemDrop
from apps.inventory.views import add_item_to_inventory, get_or_create_wallet, remove_item_from_inventory

logger = logging.getLogger(__name__)


@api_controller('/crafting', tags=['Crafting'])
class CraftingController:

    @route.get('/recipes/', response=list[RecipeOutSchema], auth=None)
    def list_recipes(self):
        """List all active crafting recipes."""
        return list(
            Recipe.objects.filter(is_active=True)
            .select_related('result_item', 'result_item__category')
            .prefetch_related('ingredients__item', 'ingredients__item__category')
        )

    @route.get('/history/', response=dict, auth=ActiveUserJWTAuth())
    def crafting_history(self, request, limit: int = 50, offset: int = 0):
        """Get user's crafting history."""
        qs = (
            CraftingLog.objects.filter(user=request.user)
            .select_related('recipe', 'result_item', 'result_item__category')
        )
        return paginate_qs(qs, limit, offset, schema=CraftingLogOutSchema)

    @route.post('/craft/', auth=ActiveUserJWTAuth())
    def craft_item(self, request, payload: CraftInSchema):
        """Craft an item using a recipe."""
        recipe = (
            Recipe.objects.filter(slug=payload.recipe_slug, is_active=True)
            .select_related('result_item')
            .prefetch_related('ingredients__item')
            .first()
        )
        if not recipe:
            return self.create_response({'error': 'Recipe not found'}, status_code=404)

        with transaction.atomic():
            # Check gold
            wallet = get_or_create_wallet(request.user)
            if wallet.gold < recipe.gold_cost:
                return self.create_response({'error': 'Insufficient gold'}, status_code=400)

            # Check and consume ingredients
            for ingredient in recipe.ingredients.all():
                if not remove_item_from_inventory(request.user, ingredient.item, ingredient.quantity):
                    return self.create_response(
                        {'error': f'Insufficient {ingredient.item.name} (need {ingredient.quantity})'},
                        status_code=400,
                    )

            # Deduct gold
            if recipe.gold_cost > 0:
                wallet.gold -= recipe.gold_cost
                wallet.total_spent += recipe.gold_cost
                wallet.save(update_fields=['gold', 'total_spent'])

            # Give result
            result = add_item_to_inventory(
                request.user,
                recipe.result_item,
                recipe.result_quantity,
                crafted_by=request.user,
            )

            # Determine if we got an ItemInstance (non-stackable item)
            instance = result if hasattr(result, 'pattern_seed') else None

            # Log
            ItemDrop.objects.create(
                user=request.user,
                item=recipe.result_item,
                quantity=recipe.result_quantity,
                source=ItemDrop.DropSource.CRAFTING,
                instance=instance,
            )
            CraftingLog.objects.create(
                user=request.user,
                recipe=recipe,
                result_item=recipe.result_item,
                result_quantity=recipe.result_quantity,
                gold_spent=recipe.gold_cost,
                instance=instance,
            )

        return {
            'message': f'Crafted {recipe.result_quantity}x {recipe.result_item.name}',
            'item_name': recipe.result_item.name,
            'item_slug': recipe.result_item.slug,
            'quantity': recipe.result_quantity,
        }
