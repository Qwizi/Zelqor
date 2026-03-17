"""
Tests for apps/crafting — Recipe, RecipeIngredient, CraftingLog.
"""
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from django.test import TestCase

from apps.crafting.models import CraftingLog, Recipe, RecipeIngredient
from apps.inventory.models import Item, ItemCategory, UserInventory, Wallet

User = get_user_model()


# ---------------------------------------------------------------------------
# Shared test helpers
# ---------------------------------------------------------------------------

def make_category(name='Materials', slug='materials'):
    return ItemCategory.objects.get_or_create(name=name, slug=slug)[0]


def make_item(name='Iron Ore', slug='iron-ore', item_type=Item.ItemType.MATERIAL, rarity=Item.Rarity.COMMON):
    cat = make_category()
    return Item.objects.get_or_create(
        slug=slug,
        defaults={
            'name': name,
            'category': cat,
            'item_type': item_type,
            'rarity': rarity,
            'is_stackable': True,
            'base_value': 5,
        },
    )[0]


def make_user(email='crafter@test.com', username='crafteruser'):
    return User.objects.create_user(email=email, username=username, password='testpass123')


def make_recipe(result_item, name='Basic Recipe', slug='basic-recipe', gold_cost=0, result_quantity=1, crafting_time_seconds=0):
    return Recipe.objects.create(
        name=name,
        slug=slug,
        result_item=result_item,
        result_quantity=result_quantity,
        gold_cost=gold_cost,
        crafting_time_seconds=crafting_time_seconds,
    )


# ---------------------------------------------------------------------------
# Recipe model tests
# ---------------------------------------------------------------------------

class RecipeModelTests(TestCase):

    def setUp(self):
        self.output_item = make_item(name='Steel Bar', slug='steel-bar', item_type=Item.ItemType.MATERIAL)

    def test_recipe_creation(self):
        recipe = make_recipe(self.output_item, name='Smelt Steel', slug='smelt-steel')
        self.assertEqual(recipe.name, 'Smelt Steel')
        self.assertEqual(recipe.slug, 'smelt-steel')
        self.assertEqual(recipe.result_item, self.output_item)

    def test_recipe_str_representation(self):
        recipe = make_recipe(self.output_item, name='Smelt Steel', slug='smelt-steel-str', result_quantity=3)
        s = str(recipe)
        self.assertIn('Smelt Steel', s)
        self.assertIn('Steel Bar', s)
        self.assertIn('3', s)

    def test_is_active_default_true(self):
        recipe = make_recipe(self.output_item, slug='active-recipe')
        self.assertTrue(recipe.is_active)

    def test_gold_cost_default_zero(self):
        recipe = make_recipe(self.output_item, slug='free-recipe')
        self.assertEqual(recipe.gold_cost, 0)

    def test_crafting_time_seconds_default_zero(self):
        recipe = make_recipe(self.output_item, slug='instant-recipe')
        self.assertEqual(recipe.crafting_time_seconds, 0)

    def test_recipe_with_gold_cost(self):
        recipe = make_recipe(self.output_item, slug='paid-recipe', gold_cost=50)
        self.assertEqual(recipe.gold_cost, 50)

    def test_recipe_with_nonzero_crafting_time(self):
        recipe = make_recipe(self.output_item, slug='slow-recipe', crafting_time_seconds=120)
        self.assertEqual(recipe.crafting_time_seconds, 120)

    def test_recipe_result_quantity(self):
        recipe = make_recipe(self.output_item, slug='batch-recipe', result_quantity=5)
        self.assertEqual(recipe.result_quantity, 5)

    def test_recipe_unique_slug(self):
        make_recipe(self.output_item, name='Dup Recipe 1', slug='dup-slug')
        with self.assertRaises(Exception):
            make_recipe(self.output_item, name='Dup Recipe 2', slug='dup-slug')

    def test_recipe_inactive(self):
        recipe = make_recipe(self.output_item, slug='inactive-recipe')
        recipe.is_active = False
        recipe.save()
        recipe.refresh_from_db()
        self.assertFalse(recipe.is_active)

    def test_recipe_ordering_by_order_then_name(self):
        r1 = make_recipe(self.output_item, slug='z-recipe', name='Z Recipe')
        r2 = make_recipe(self.output_item, slug='a-recipe', name='A Recipe')
        r1.order = 2
        r1.save()
        r2.order = 1
        r2.save()
        recipes = list(Recipe.objects.all())
        self.assertEqual(recipes[0], r2)

    def test_produced_by_recipes_related_name(self):
        recipe = make_recipe(self.output_item, slug='rel-recipe')
        self.assertEqual(self.output_item.produced_by_recipes.count(), 1)


# ---------------------------------------------------------------------------
# RecipeIngredient model tests
# ---------------------------------------------------------------------------

class RecipeIngredientTests(TestCase):

    def setUp(self):
        self.input_item = make_item(name='Iron Ore', slug='iron-ore-ing')
        self.output_item = make_item(name='Iron Bar', slug='iron-bar-ing')
        self.recipe = make_recipe(self.output_item, name='Smelt Iron', slug='smelt-iron')

    def test_ingredient_creation(self):
        ingredient = RecipeIngredient.objects.create(
            recipe=self.recipe,
            item=self.input_item,
            quantity=3,
        )
        self.assertEqual(ingredient.recipe, self.recipe)
        self.assertEqual(ingredient.item, self.input_item)
        self.assertEqual(ingredient.quantity, 3)

    def test_ingredient_str_representation(self):
        ingredient = RecipeIngredient.objects.create(
            recipe=self.recipe,
            item=self.input_item,
            quantity=2,
        )
        s = str(ingredient)
        self.assertIn('Iron Ore', s)
        self.assertIn('2', s)
        self.assertIn('Smelt Iron', s)

    def test_ingredient_quantity_default_one(self):
        ingredient = RecipeIngredient.objects.create(
            recipe=self.recipe,
            item=self.input_item,
        )
        self.assertEqual(ingredient.quantity, 1)

    def test_unique_together_recipe_item(self):
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            item=self.input_item,
            quantity=1,
        )
        with self.assertRaises(IntegrityError):
            RecipeIngredient.objects.create(
                recipe=self.recipe,
                item=self.input_item,
                quantity=5,
            )

    def test_multiple_ingredients_per_recipe(self):
        extra_input = make_item(name='Coal', slug='coal')
        RecipeIngredient.objects.create(recipe=self.recipe, item=self.input_item, quantity=2)
        RecipeIngredient.objects.create(recipe=self.recipe, item=extra_input, quantity=1)
        self.assertEqual(self.recipe.ingredients.count(), 2)

    def test_used_in_recipes_related_name(self):
        RecipeIngredient.objects.create(
            recipe=self.recipe,
            item=self.input_item,
            quantity=1,
        )
        self.assertEqual(self.input_item.used_in_recipes.count(), 1)


# ---------------------------------------------------------------------------
# CraftingLog model tests
# ---------------------------------------------------------------------------

class CraftingLogTests(TestCase):

    def setUp(self):
        self.user = make_user()
        self.input_item = make_item(name='Wood', slug='wood')
        self.output_item = make_item(name='Plank', slug='plank', item_type=Item.ItemType.MATERIAL)
        self.recipe = make_recipe(self.output_item, name='Cut Planks', slug='cut-planks')
        RecipeIngredient.objects.create(recipe=self.recipe, item=self.input_item, quantity=5)

    def test_crafting_log_creation(self):
        log = CraftingLog.objects.create(
            user=self.user,
            recipe=self.recipe,
            result_item=self.output_item,
            result_quantity=1,
            gold_spent=0,
        )
        self.assertEqual(log.user, self.user)
        self.assertEqual(log.recipe, self.recipe)
        self.assertEqual(log.result_item, self.output_item)
        self.assertEqual(log.result_quantity, 1)

    def test_crafting_log_str_representation(self):
        log = CraftingLog.objects.create(
            user=self.user,
            recipe=self.recipe,
            result_item=self.output_item,
            result_quantity=2,
        )
        s = str(log)
        self.assertIn('crafteruser', s)
        self.assertIn('Plank', s)
        self.assertIn('2', s)

    def test_gold_spent_default_zero(self):
        log = CraftingLog.objects.create(
            user=self.user,
            recipe=self.recipe,
            result_item=self.output_item,
            result_quantity=1,
        )
        self.assertEqual(log.gold_spent, 0)

    def test_crafting_log_with_gold_cost(self):
        paid_recipe = make_recipe(
            self.output_item, name='Refined Planks', slug='refined-planks', gold_cost=25,
        )
        log = CraftingLog.objects.create(
            user=self.user,
            recipe=paid_recipe,
            result_item=self.output_item,
            result_quantity=1,
            gold_spent=25,
        )
        self.assertEqual(log.gold_spent, 25)

    def test_crafting_log_ordering_newest_first(self):
        log1 = CraftingLog.objects.create(
            user=self.user, recipe=self.recipe,
            result_item=self.output_item, result_quantity=1,
        )
        log2 = CraftingLog.objects.create(
            user=self.user, recipe=self.recipe,
            result_item=self.output_item, result_quantity=2,
        )
        logs = list(CraftingLog.objects.filter(user=self.user))
        # Newest first
        self.assertEqual(logs[0], log2)

    def test_crafting_logs_related_name_on_user(self):
        CraftingLog.objects.create(
            user=self.user, recipe=self.recipe,
            result_item=self.output_item, result_quantity=1,
        )
        self.assertEqual(self.user.crafting_logs.count(), 1)

    def test_crafting_logs_related_name_on_recipe(self):
        CraftingLog.objects.create(
            user=self.user, recipe=self.recipe,
            result_item=self.output_item, result_quantity=1,
        )
        self.assertEqual(self.recipe.crafting_logs.count(), 1)

    def test_instance_field_nullable(self):
        log = CraftingLog.objects.create(
            user=self.user, recipe=self.recipe,
            result_item=self.output_item, result_quantity=1,
        )
        self.assertIsNone(log.instance)


# ---------------------------------------------------------------------------
# Crafting business logic tests (add_item / remove_item helpers)
# ---------------------------------------------------------------------------

class CraftingInventoryHelpersTests(TestCase):
    """Test the inventory helper functions used by the crafting flow."""

    def setUp(self):
        self.user = make_user(email='helper@test.com', username='helperuser')
        self.item = make_item(name='Stone', slug='stone')

    def test_add_stackable_item_creates_inventory_entry(self):
        from apps.inventory.views import add_item_to_inventory
        inv = add_item_to_inventory(self.user, self.item, 10)
        self.assertEqual(inv.quantity, 10)

    def test_add_stackable_item_increments_existing(self):
        from apps.inventory.views import add_item_to_inventory
        add_item_to_inventory(self.user, self.item, 5)
        add_item_to_inventory(self.user, self.item, 3)
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 8)

    def test_remove_stackable_item_decrements_quantity(self):
        from apps.inventory.views import add_item_to_inventory, remove_item_from_inventory
        add_item_to_inventory(self.user, self.item, 10)
        result = remove_item_from_inventory(self.user, self.item, 4)
        self.assertTrue(result)
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 6)

    def test_remove_stackable_item_deletes_when_zero(self):
        from apps.inventory.views import add_item_to_inventory, remove_item_from_inventory
        add_item_to_inventory(self.user, self.item, 5)
        remove_item_from_inventory(self.user, self.item, 5)
        self.assertFalse(UserInventory.objects.filter(user=self.user, item=self.item).exists())

    def test_remove_returns_false_when_insufficient(self):
        from apps.inventory.views import remove_item_from_inventory
        result = remove_item_from_inventory(self.user, self.item, 1)
        self.assertFalse(result)
