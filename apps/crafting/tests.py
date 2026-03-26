"""
Tests for apps/crafting — Recipe, RecipeIngredient, CraftingLog.
"""

import json

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

from apps.crafting.models import CraftingLog, Recipe, RecipeIngredient
from apps.inventory.models import Item, ItemCategory, UserInventory

User = get_user_model()


# ---------------------------------------------------------------------------
# Shared test helpers
# ---------------------------------------------------------------------------


def make_category(name="Materials", slug="materials"):
    return ItemCategory.objects.get_or_create(name=name, slug=slug)[0]


def make_item(name="Iron Ore", slug="iron-ore", item_type=Item.ItemType.MATERIAL, rarity=Item.Rarity.COMMON):
    cat = make_category()
    return Item.objects.get_or_create(
        slug=slug,
        defaults={
            "name": name,
            "category": cat,
            "item_type": item_type,
            "rarity": rarity,
            "is_stackable": True,
            "base_value": 5,
        },
    )[0]


def make_user(email="crafter@test.com", username="crafteruser"):
    return User.objects.create_user(email=email, username=username, password="testpass123")


def make_recipe(
    result_item, name="Basic Recipe", slug="basic-recipe", gold_cost=0, result_quantity=1, crafting_time_seconds=0
):
    return Recipe.objects.create(
        name=name,
        slug=slug,
        result_item=result_item,
        result_quantity=result_quantity,
        gold_cost=gold_cost,
        crafting_time_seconds=crafting_time_seconds,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def output_item():
    return make_item(name="Steel Bar", slug="steel-bar", item_type=Item.ItemType.MATERIAL)


@pytest.fixture
def input_item():
    return make_item(name="Iron Ore", slug="iron-ore-ing")


@pytest.fixture
def iron_bar():
    return make_item(name="Iron Bar", slug="iron-bar-ing")


@pytest.fixture
def smelt_iron_recipe(iron_bar):
    return make_recipe(iron_bar, name="Smelt Iron", slug="smelt-iron")


@pytest.fixture
def crafter_user():
    return make_user()


@pytest.fixture
def wood_item():
    return make_item(name="Wood", slug="wood")


@pytest.fixture
def plank_item():
    return make_item(name="Plank", slug="plank", item_type=Item.ItemType.MATERIAL)


@pytest.fixture
def cut_planks_recipe(plank_item, wood_item):
    recipe = make_recipe(plank_item, name="Cut Planks", slug="cut-planks")
    RecipeIngredient.objects.create(recipe=recipe, item=wood_item, quantity=5)
    return recipe


@pytest.fixture
def helper_user():
    return make_user(email="helper@test.com", username="helperuser")


@pytest.fixture
def stone_item():
    return make_item(name="Stone", slug="stone")


# ---------------------------------------------------------------------------
# Recipe model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_recipe_creation(output_item):
    recipe = make_recipe(output_item, name="Smelt Steel", slug="smelt-steel")
    assert recipe.name == "Smelt Steel"
    assert recipe.slug == "smelt-steel"
    assert recipe.result_item == output_item


@pytest.mark.django_db
def test_recipe_str_representation(output_item):
    recipe = make_recipe(output_item, name="Smelt Steel", slug="smelt-steel-str", result_quantity=3)
    s = str(recipe)
    assert "Smelt Steel" in s
    assert "Steel Bar" in s
    assert "3" in s


@pytest.mark.django_db
def test_is_active_default_true(output_item):
    recipe = make_recipe(output_item, slug="active-recipe")
    assert recipe.is_active is True


@pytest.mark.django_db
def test_gold_cost_default_zero(output_item):
    recipe = make_recipe(output_item, slug="free-recipe")
    assert recipe.gold_cost == 0


@pytest.mark.django_db
def test_crafting_time_seconds_default_zero(output_item):
    recipe = make_recipe(output_item, slug="instant-recipe")
    assert recipe.crafting_time_seconds == 0


@pytest.mark.django_db
def test_recipe_with_gold_cost(output_item):
    recipe = make_recipe(output_item, slug="paid-recipe", gold_cost=50)
    assert recipe.gold_cost == 50


@pytest.mark.django_db
def test_recipe_with_nonzero_crafting_time(output_item):
    recipe = make_recipe(output_item, slug="slow-recipe", crafting_time_seconds=120)
    assert recipe.crafting_time_seconds == 120


@pytest.mark.django_db
def test_recipe_result_quantity(output_item):
    recipe = make_recipe(output_item, slug="batch-recipe", result_quantity=5)
    assert recipe.result_quantity == 5


@pytest.mark.django_db
def test_recipe_unique_slug(output_item):
    make_recipe(output_item, name="Dup Recipe 1", slug="dup-slug")
    with pytest.raises(IntegrityError):
        make_recipe(output_item, name="Dup Recipe 2", slug="dup-slug")


@pytest.mark.django_db
def test_recipe_inactive(output_item):
    recipe = make_recipe(output_item, slug="inactive-recipe")
    recipe.is_active = False
    recipe.save()
    recipe.refresh_from_db()
    assert recipe.is_active is False


@pytest.mark.django_db
def test_recipe_ordering_by_order_then_name(output_item):
    r1 = make_recipe(output_item, slug="z-recipe", name="Z Recipe")
    r2 = make_recipe(output_item, slug="a-recipe", name="A Recipe")
    r1.order = 2
    r1.save()
    r2.order = 1
    r2.save()
    recipes = list(Recipe.objects.all())
    assert recipes[0] == r2


@pytest.mark.django_db
def test_produced_by_recipes_related_name(output_item):
    make_recipe(output_item, slug="rel-recipe")
    assert output_item.produced_by_recipes.count() == 1


# ---------------------------------------------------------------------------
# RecipeIngredient model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_ingredient_creation(smelt_iron_recipe, input_item):
    ingredient = RecipeIngredient.objects.create(
        recipe=smelt_iron_recipe,
        item=input_item,
        quantity=3,
    )
    assert ingredient.recipe == smelt_iron_recipe
    assert ingredient.item == input_item
    assert ingredient.quantity == 3


@pytest.mark.django_db
def test_ingredient_str_representation(smelt_iron_recipe, input_item):
    ingredient = RecipeIngredient.objects.create(
        recipe=smelt_iron_recipe,
        item=input_item,
        quantity=2,
    )
    s = str(ingredient)
    assert "Iron Ore" in s
    assert "2" in s
    assert "Smelt Iron" in s


@pytest.mark.django_db
def test_ingredient_quantity_default_one(smelt_iron_recipe, input_item):
    ingredient = RecipeIngredient.objects.create(
        recipe=smelt_iron_recipe,
        item=input_item,
    )
    assert ingredient.quantity == 1


@pytest.mark.django_db
def test_unique_together_recipe_item(smelt_iron_recipe, input_item):
    RecipeIngredient.objects.create(recipe=smelt_iron_recipe, item=input_item, quantity=1)
    with pytest.raises(IntegrityError):
        RecipeIngredient.objects.create(recipe=smelt_iron_recipe, item=input_item, quantity=5)


@pytest.mark.django_db
def test_multiple_ingredients_per_recipe(smelt_iron_recipe, input_item):
    extra_input = make_item(name="Coal", slug="coal")
    RecipeIngredient.objects.create(recipe=smelt_iron_recipe, item=input_item, quantity=2)
    RecipeIngredient.objects.create(recipe=smelt_iron_recipe, item=extra_input, quantity=1)
    assert smelt_iron_recipe.ingredients.count() == 2


@pytest.mark.django_db
def test_used_in_recipes_related_name(smelt_iron_recipe, input_item):
    RecipeIngredient.objects.create(recipe=smelt_iron_recipe, item=input_item, quantity=1)
    assert input_item.used_in_recipes.count() == 1


# ---------------------------------------------------------------------------
# CraftingLog model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_crafting_log_creation(crafter_user, cut_planks_recipe, plank_item):
    log = CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
        gold_spent=0,
    )
    assert log.user == crafter_user
    assert log.recipe == cut_planks_recipe
    assert log.result_item == plank_item
    assert log.result_quantity == 1


@pytest.mark.django_db
def test_crafting_log_str_representation(crafter_user, cut_planks_recipe, plank_item):
    log = CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=2,
    )
    s = str(log)
    assert "crafteruser" in s
    assert "Plank" in s
    assert "2" in s


@pytest.mark.django_db
def test_gold_spent_default_zero(crafter_user, cut_planks_recipe, plank_item):
    log = CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    assert log.gold_spent == 0


@pytest.mark.django_db
def test_crafting_log_with_gold_cost(crafter_user, cut_planks_recipe, plank_item):
    paid_recipe = make_recipe(
        plank_item,
        name="Refined Planks",
        slug="refined-planks",
        gold_cost=25,
    )
    log = CraftingLog.objects.create(
        user=crafter_user,
        recipe=paid_recipe,
        result_item=plank_item,
        result_quantity=1,
        gold_spent=25,
    )
    assert log.gold_spent == 25


@pytest.mark.django_db
def test_crafting_log_ordering_newest_first(crafter_user, cut_planks_recipe, plank_item):
    CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    log2 = CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=2,
    )
    logs = list(CraftingLog.objects.filter(user=crafter_user))
    assert logs[0] == log2


@pytest.mark.django_db
def test_crafting_logs_related_name_on_user(crafter_user, cut_planks_recipe, plank_item):
    CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    assert crafter_user.crafting_logs.count() == 1


@pytest.mark.django_db
def test_crafting_logs_related_name_on_recipe(crafter_user, cut_planks_recipe, plank_item):
    CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    assert cut_planks_recipe.crafting_logs.count() == 1


@pytest.mark.django_db
def test_instance_field_nullable(crafter_user, cut_planks_recipe, plank_item):
    log = CraftingLog.objects.create(
        user=crafter_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    assert log.instance is None


# ---------------------------------------------------------------------------
# Crafting business logic tests (add_item / remove_item helpers)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_add_stackable_item_creates_inventory_entry(helper_user, stone_item):
    from apps.inventory.views import add_item_to_inventory

    inv = add_item_to_inventory(helper_user, stone_item, 10)
    assert inv.quantity == 10


@pytest.mark.django_db
def test_add_stackable_item_increments_existing(helper_user, stone_item):
    from apps.inventory.views import add_item_to_inventory

    add_item_to_inventory(helper_user, stone_item, 5)
    add_item_to_inventory(helper_user, stone_item, 3)
    inv = UserInventory.objects.get(user=helper_user, item=stone_item)
    assert inv.quantity == 8


@pytest.mark.django_db
def test_remove_stackable_item_decrements_quantity(helper_user, stone_item):
    from apps.inventory.views import add_item_to_inventory, remove_item_from_inventory

    add_item_to_inventory(helper_user, stone_item, 10)
    result = remove_item_from_inventory(helper_user, stone_item, 4)
    assert result is True
    inv = UserInventory.objects.get(user=helper_user, item=stone_item)
    assert inv.quantity == 6


@pytest.mark.django_db
def test_remove_stackable_item_deletes_when_zero(helper_user, stone_item):
    from apps.inventory.views import add_item_to_inventory, remove_item_from_inventory

    add_item_to_inventory(helper_user, stone_item, 5)
    remove_item_from_inventory(helper_user, stone_item, 5)
    assert not UserInventory.objects.filter(user=helper_user, item=stone_item).exists()


@pytest.mark.django_db
def test_remove_returns_false_when_insufficient(helper_user, stone_item):
    from apps.inventory.views import remove_item_from_inventory

    result = remove_item_from_inventory(helper_user, stone_item, 1)
    assert result is False


# ---------------------------------------------------------------------------
# Crafting API endpoint tests — GET /crafting/recipes/
# ---------------------------------------------------------------------------


_User = get_user_model()


def _get_token(client, email, password):
    resp = client.post(
        "/api/v1/token/pair",
        data=json.dumps({"email": email, "password": password}),
        content_type="application/json",
    )
    return resp.json().get("access", "")


def _bearer(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def api_user(db):
    return _User.objects.create_user(email="craftapi@test.com", username="craftapiuser", password="testpass123")


@pytest.mark.django_db
def test_list_recipes_returns_200(client):
    resp = client.get("/api/v1/crafting/recipes/")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.django_db
def test_list_recipes_no_auth_required(client):
    """GET /crafting/recipes/ is public (auth=None)."""
    resp = client.get("/api/v1/crafting/recipes/")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_list_recipes_only_active(client, output_item):
    make_recipe(output_item, name="Active", slug="active-r")
    inactive = make_recipe(output_item, name="Inactive", slug="inactive-r")
    inactive.is_active = False
    inactive.save()
    resp = client.get("/api/v1/crafting/recipes/")
    slugs = [r["slug"] for r in resp.json()]
    assert "active-r" in slugs
    assert "inactive-r" not in slugs


@pytest.mark.django_db
def test_list_recipes_includes_ingredients(client, cut_planks_recipe):
    resp = client.get("/api/v1/crafting/recipes/")
    recipes = resp.json()
    cut = next((r for r in recipes if r["slug"] == "cut-planks"), None)
    assert cut is not None
    assert len(cut["ingredients"]) == 1
    assert cut["ingredients"][0]["quantity"] == 5


# ---------------------------------------------------------------------------
# Crafting API endpoint tests — POST /crafting/craft/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_craft_item_requires_auth(client, cut_planks_recipe):
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": cut_planks_recipe.slug}),
        content_type="application/json",
    )
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_craft_item_success(client, api_user, cut_planks_recipe, wood_item, plank_item):
    from apps.inventory.views import add_item_to_inventory

    # Give user enough wood
    add_item_to_inventory(api_user, wood_item, 10)
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": cut_planks_recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["item_slug"] == plank_item.slug
    assert data["quantity"] == cut_planks_recipe.result_quantity


@pytest.mark.django_db
def test_craft_item_logs_crafting(client, api_user, cut_planks_recipe, wood_item):
    from apps.crafting.models import CraftingLog
    from apps.inventory.views import add_item_to_inventory

    add_item_to_inventory(api_user, wood_item, 10)
    token = _get_token(client, "craftapi@test.com", "testpass123")
    client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": cut_planks_recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    assert CraftingLog.objects.filter(user=api_user).count() == 1


@pytest.mark.django_db
def test_craft_item_consumes_ingredients(client, api_user, cut_planks_recipe, wood_item):
    from apps.inventory.models import UserInventory
    from apps.inventory.views import add_item_to_inventory

    add_item_to_inventory(api_user, wood_item, 10)
    token = _get_token(client, "craftapi@test.com", "testpass123")
    client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": cut_planks_recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    remaining = UserInventory.objects.filter(user=api_user, item=wood_item).first()
    # 10 - 5 (ingredient quantity) = 5
    assert remaining is not None
    assert remaining.quantity == 5


@pytest.mark.django_db
def test_craft_item_insufficient_ingredient(client, api_user, cut_planks_recipe, wood_item):
    from apps.inventory.views import add_item_to_inventory

    # Only 2 wood, need 5
    add_item_to_inventory(api_user, wood_item, 2)
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": cut_planks_recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_craft_item_recipe_not_found(client, api_user):
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": "nonexistent-recipe"}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_craft_item_insufficient_gold(client, api_user, plank_item, wood_item):
    from apps.inventory.views import add_item_to_inventory

    paid_recipe = make_recipe(plank_item, name="Gold Recipe", slug="gold-recipe-test", gold_cost=999)
    ingredient_item = make_item(name="TwoByFour", slug="twobyfourtesting")
    from apps.crafting.models import RecipeIngredient

    RecipeIngredient.objects.create(recipe=paid_recipe, item=ingredient_item, quantity=1)
    add_item_to_inventory(api_user, ingredient_item, 5)

    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": "gold-recipe-test"}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_craft_item_inactive_recipe_returns_404(client, api_user, output_item):
    inactive = make_recipe(output_item, name="Dead Recipe", slug="dead-recipe")
    inactive.is_active = False
    inactive.save()
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": "dead-recipe"}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Crafting API endpoint tests — GET /crafting/history/
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_crafting_history_requires_auth(client):
    resp = client.get("/api/v1/crafting/history/")
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_crafting_history_empty(client, api_user):
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.get("/api/v1/crafting/history/", **_bearer(token))
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_crafting_history_after_craft(client, api_user, cut_planks_recipe, wood_item, plank_item):
    from apps.crafting.models import CraftingLog

    CraftingLog.objects.create(
        user=api_user,
        recipe=cut_planks_recipe,
        result_item=plank_item,
        result_quantity=1,
    )
    token = _get_token(client, "craftapi@test.com", "testpass123")
    resp = client.get("/api/v1/crafting/history/", **_bearer(token))
    assert resp.status_code == 200
    assert resp.json()["count"] == 1


# ---------------------------------------------------------------------------
# crafting/views.py — missing lines: recipe not found, insufficient gold,
# insufficient ingredients
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_craft_recipe_not_found_returns_404(client):
    """POST /craft/ with a non-existent recipe slug should return 404."""
    make_user("cr404@test.com", "cr404_user")
    token = _get_token(client, "cr404@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": "does-not-exist"}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_craft_insufficient_gold_returns_400(client):
    """POST /craft/ when user has less gold than required should return 400."""
    from apps.inventory.models import Wallet

    result_item = make_item("Gold Result", "gold-result", Item.ItemType.MATERIAL)
    recipe = make_recipe(result_item, "Gold Recipe", "gold-recipe", gold_cost=9999, result_quantity=1)

    user = make_user("cr_nogold@test.com", "cr_nogold_user")
    Wallet.objects.create(user=user, gold=0)

    token = _get_token(client, "cr_nogold@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_craft_insufficient_ingredient_returns_400(client):
    """POST /craft/ when user lacks an ingredient should return 400."""
    from apps.inventory.models import Wallet

    ingredient_item = make_item("Rare Ore", "rare-ore-cr", Item.ItemType.MATERIAL)
    ingredient_item.is_stackable = True
    ingredient_item.save()
    result_item = make_item("Rare Bar", "rare-bar-cr", Item.ItemType.MATERIAL)

    recipe = make_recipe(result_item, "Rare Recipe", "rare-recipe-cr", gold_cost=0, result_quantity=1)
    RecipeIngredient.objects.create(recipe=recipe, item=ingredient_item, quantity=5)

    user = make_user("cr_noing@test.com", "cr_noing_user")
    Wallet.objects.create(user=user, gold=1000)
    # User has 0 of the ingredient

    token = _get_token(client, "cr_noing@test.com", "testpass123")
    resp = client.post(
        "/api/v1/crafting/craft/",
        data=json.dumps({"recipe_slug": recipe.slug}),
        content_type="application/json",
        **_bearer(token),
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# crafting/admin.py — list views
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestCraftingAdmin:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        from django.test import Client

        from apps.accounts.models import User

        self.client = Client()
        su = User.objects.create_superuser(
            username="crafting_admin", email="crafting_admin@test.local", password="adminpass"
        )
        self.client.force_login(su)

    def test_recipe_list(self):
        r = self.client.get("/admin/crafting/recipe/")
        assert r.status_code == 200

    def test_craftinglog_list(self):
        r = self.client.get("/admin/crafting/craftinglog/")
        assert r.status_code == 200
