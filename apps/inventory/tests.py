"""
Tests for apps/inventory — Item, ItemCategory, UserInventory, Wallet, Deck, DeckItem, ItemInstance.
"""

import uuid

import pytest
from django.contrib.auth import get_user_model
from ninja_jwt.tokens import RefreshToken

from apps.inventory.models import (
    Deck,
    DeckItem,
    Item,
    ItemCategory,
    ItemDrop,
    ItemInstance,
    UserInventory,
    Wallet,
)

User = get_user_model()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def make_category(name="Materials", slug="materials"):
    return ItemCategory.objects.create(name=name, slug=slug)


def make_item(category, name="Iron Ore", slug="iron-ore", item_type=Item.ItemType.MATERIAL):
    return Item.objects.create(
        name=name,
        slug=slug,
        category=category,
        item_type=item_type,
        rarity=Item.Rarity.COMMON,
    )


def _get_auth_header(user):
    """Return an Authorization header value with a fresh access token."""
    refresh = RefreshToken.for_user(user)
    return f"Bearer {str(refresh.access_token)}"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def category(db):
    return make_category()


@pytest.fixture
def item(category):
    return make_item(category)


@pytest.fixture
def user(db):
    return User.objects.create_user(
        email="user@test.com",
        username="testuser",
        password="testpass123",
    )


@pytest.fixture
def other_user(db):
    return User.objects.create_user(
        email="other@test.com",
        username="othertestuser",
        password="testpass123",
    )


@pytest.fixture
def auth_header(user):
    return _get_auth_header(user)


BASE = "/api/v1"


# ---------------------------------------------------------------------------
# ItemCategory tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_category_creation():
    cat = make_category("Blueprints", "blueprints")
    assert cat.name == "Blueprints"
    assert cat.slug == "blueprints"


@pytest.mark.django_db
def test_category_str_representation():
    cat = make_category("Boosts", "boosts")
    assert str(cat) == "Boosts"


@pytest.mark.django_db
def test_category_is_active_default_true():
    cat = make_category()
    assert cat.is_active is True


@pytest.mark.django_db
def test_category_unique_slug():
    from django.db import IntegrityError

    make_category("Mats", "unique-slug")
    with pytest.raises(IntegrityError):
        make_category("Mats 2", "unique-slug")


# ---------------------------------------------------------------------------
# Item model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_item_creation_and_attributes(category, item):
    assert item.name == "Iron Ore"
    assert item.slug == "iron-ore"
    assert item.category == category
    assert item.item_type == Item.ItemType.MATERIAL
    assert item.rarity == Item.Rarity.COMMON


@pytest.mark.django_db
def test_item_str_representation(item):
    assert "Iron Ore" in str(item)
    assert "Common" in str(item)


@pytest.mark.django_db
def test_item_is_active_default_true(item):
    assert item.is_active is True


@pytest.mark.django_db
def test_item_is_stackable_default_true(item):
    assert item.is_stackable is True


@pytest.mark.django_db
def test_item_is_tradeable_default_true(item):
    assert item.is_tradeable is True


@pytest.mark.django_db
def test_item_is_consumable_default_false(item):
    assert item.is_consumable is False


@pytest.mark.django_db
def test_item_unique_slug_constraint(category):
    from django.db import IntegrityError

    make_item(category)
    with pytest.raises(IntegrityError):
        make_item(category, name="Iron Ore 2", slug="iron-ore")


@pytest.mark.django_db
def test_item_rarity_choices(category):
    for rarity in [
        Item.Rarity.COMMON,
        Item.Rarity.UNCOMMON,
        Item.Rarity.RARE,
        Item.Rarity.EPIC,
        Item.Rarity.LEGENDARY,
    ]:
        item = Item.objects.create(
            name=f"Item {rarity}",
            slug=f"item-{rarity}",
            category=category,
            item_type=Item.ItemType.MATERIAL,
            rarity=rarity,
        )
        item.refresh_from_db()
        assert item.rarity == rarity


@pytest.mark.django_db
def test_item_blueprint_item_type(category):
    bp = make_item(
        category,
        name="Barracks Blueprint",
        slug="bp-barracks",
        item_type=Item.ItemType.BLUEPRINT_BUILDING,
    )
    assert bp.item_type == Item.ItemType.BLUEPRINT_BUILDING


# ---------------------------------------------------------------------------
# UserInventory tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_userinventory_creation_with_quantity(user, item):
    inv = UserInventory.objects.create(user=user, item=item, quantity=5)
    assert inv.quantity == 5


@pytest.mark.django_db
def test_userinventory_str_representation(user, item):
    inv = UserInventory.objects.create(user=user, item=item, quantity=3)
    assert "testuser" in str(inv)
    assert "Iron Ore" in str(inv)
    assert "3" in str(inv)


@pytest.mark.django_db
def test_userinventory_unique_together_user_item(user, item):
    from django.db import IntegrityError

    UserInventory.objects.create(user=user, item=item, quantity=1)
    with pytest.raises(IntegrityError):
        UserInventory.objects.create(user=user, item=item, quantity=2)


@pytest.mark.django_db
def test_userinventory_quantity_tracking(user, item):
    inv = UserInventory.objects.create(user=user, item=item, quantity=10)
    inv.quantity -= 3
    inv.save()
    inv.refresh_from_db()
    assert inv.quantity == 7


@pytest.mark.django_db
def test_userinventory_related_name_on_user(user, item):
    UserInventory.objects.create(user=user, item=item, quantity=1)
    assert user.inventory.count() == 1


# ---------------------------------------------------------------------------
# Wallet tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_wallet_creation_with_gold(user):
    wallet = Wallet.objects.create(user=user, gold=100)
    assert wallet.gold == 100


@pytest.mark.django_db
def test_wallet_str_representation(user):
    wallet = Wallet.objects.create(user=user, gold=250)
    assert "testuser" in str(wallet)
    assert "250" in str(wallet)


@pytest.mark.django_db
def test_wallet_one_to_one_user_relationship(user):
    wallet = Wallet.objects.create(user=user, gold=0)
    assert wallet.user == user


@pytest.mark.django_db
def test_wallet_gold_update(user):
    wallet = Wallet.objects.create(user=user, gold=100)
    wallet.gold += 50
    wallet.total_earned += 50
    wallet.save()
    wallet.refresh_from_db()
    assert wallet.gold == 150
    assert wallet.total_earned == 50


# ---------------------------------------------------------------------------
# Deck model tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_deck_creation(user):
    deck = Deck.objects.create(user=user, name="My Deck")
    assert deck.name == "My Deck"
    assert deck.user == user


@pytest.mark.django_db
def test_deck_str_representation(user):
    deck = Deck.objects.create(user=user, name="Battle Deck")
    assert "testuser" in str(deck)
    assert "Battle Deck" in str(deck)


@pytest.mark.django_db
def test_deck_is_default_false_by_default(user):
    deck = Deck.objects.create(user=user, name="Not Default")
    assert deck.is_default is False


@pytest.mark.django_db
def test_deck_default_flag(user):
    deck = Deck.objects.create(user=user, name="Default", is_default=True)
    assert deck.is_default is True


@pytest.mark.django_db
def test_deck_only_one_default_per_user(user):
    """Setting a new deck as default should unset the previous default."""
    d1 = Deck.objects.create(user=user, name="D1", is_default=True)
    d2 = Deck.objects.create(user=user, name="D2", is_default=True)
    d1.refresh_from_db()
    assert d1.is_default is False
    assert d2.is_default is True


@pytest.mark.django_db
def test_deck_items_relationship(user, item):
    deck = Deck.objects.create(user=user, name="Deck with Items")
    DeckItem.objects.create(deck=deck, item=item, quantity=1)
    assert deck.items.count() == 1


@pytest.mark.django_db
def test_deck_item_str(user, item):
    deck = Deck.objects.create(user=user, name="Test Deck")
    di = DeckItem.objects.create(deck=deck, item=item, quantity=2)
    assert "Iron Ore" in str(di)
    assert "2" in str(di)


# ---------------------------------------------------------------------------
# ItemInstance tests
# ---------------------------------------------------------------------------


@pytest.fixture
def tactical_item(category):
    return make_item(
        category,
        name="Tactical Package",
        slug="tactical-pkg",
        item_type=Item.ItemType.TACTICAL_PACKAGE,
    )


@pytest.mark.django_db
def test_iteminstance_creation(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user)
    assert inst.item == tactical_item
    assert inst.owner == user


@pytest.mark.django_db
def test_iteminstance_wear_condition_factory_new(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user, wear=0.0)
    assert inst.wear_condition == ItemInstance.WearCondition.FACTORY_NEW


@pytest.mark.django_db
def test_iteminstance_wear_condition_battle_scarred(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user, wear=0.9)
    assert inst.wear_condition == ItemInstance.WearCondition.BATTLE_SCARRED


@pytest.mark.django_db
def test_iteminstance_is_rare_pattern_true_for_low_seed(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user, pattern_seed=5)
    assert inst.is_rare_pattern is True


@pytest.mark.django_db
def test_iteminstance_is_rare_pattern_false_for_high_seed(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user, pattern_seed=100)
    assert inst.is_rare_pattern is False


@pytest.mark.django_db
def test_iteminstance_stattrak_default_false(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user)
    assert inst.stattrak is False


@pytest.mark.django_db
def test_iteminstance_nametag_default_empty(tactical_item, user):
    inst = ItemInstance.objects.create(item=tactical_item, owner=user)
    assert inst.nametag == ""


# ---------------------------------------------------------------------------
# InventoryViewTests — API endpoint tests
# ---------------------------------------------------------------------------


@pytest.fixture
def view_category(db):
    return make_category("Materials", "materials-view")


@pytest.fixture
def view_item(view_category):
    return make_item(view_category, name="Copper Ore", slug="copper-ore")


@pytest.fixture
def view_user(db):
    return User.objects.create_user(
        email="viewtest@test.com",
        username="viewtestuser",
        password="testpass123",
    )


@pytest.fixture
def view_other_user(db):
    return User.objects.create_user(
        email="other@test.com",
        username="othertestuser",
        password="testpass123",
    )


@pytest.fixture
def view_auth(view_user):
    return _get_auth_header(view_user)


# --- /inventory/items/ (public) ------------------------------------------


@pytest.mark.django_db
def test_list_items_public_returns_200(client):
    resp = client.get(f"{BASE}/inventory/items/")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_list_items_returns_active_categories_only(client, view_item):
    ItemCategory.objects.create(name="Inactive Cat", slug="inactive-cat", is_active=False)
    resp = client.get(f"{BASE}/inventory/items/")
    data = resp.json()
    slugs = [c["slug"] for c in data]
    assert "inactive-cat" not in slugs


# --- /inventory/my/ (auth required) --------------------------------------


@pytest.mark.django_db
def test_my_inventory_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/my/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_my_inventory_empty_for_new_user(client, view_user, view_auth):
    resp = client.get(f"{BASE}/inventory/my/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert "items" in data
    assert "count" in data
    assert data["count"] == 0


@pytest.mark.django_db
def test_my_inventory_shows_stackable_item(client, view_user, view_item, view_auth):
    UserInventory.objects.create(user=view_user, item=view_item, quantity=7)
    resp = client.get(f"{BASE}/inventory/my/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    entry = data["items"][0]
    assert entry["quantity"] == 7
    assert entry["is_instance"] is False


@pytest.mark.django_db
def test_my_inventory_item_type_filter(client, view_user, view_item, view_category, view_auth):
    bp_item = Item.objects.create(
        name="Barracks BP",
        slug="bp-barracks-view",
        category=view_category,
        item_type=Item.ItemType.BLUEPRINT_BUILDING,
        rarity=Item.Rarity.UNCOMMON,
    )
    UserInventory.objects.create(user=view_user, item=view_item, quantity=3)
    UserInventory.objects.create(user=view_user, item=bp_item, quantity=1)
    resp = client.get(f"{BASE}/inventory/my/?item_type=material", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["items"][0]["item"]["item_type"] == "material"


@pytest.mark.django_db
def test_my_inventory_shows_instance_items(client, view_user, view_category, view_auth):
    non_stackable = Item.objects.create(
        name="Tactical Pkg",
        slug="tactical-pkg-view",
        category=view_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    ItemInstance.objects.create(item=non_stackable, owner=view_user)
    resp = client.get(f"{BASE}/inventory/my/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    entry = data["items"][0]
    assert entry["is_instance"] is True
    assert entry["instance"] is not None


@pytest.mark.django_db
def test_my_inventory_pagination(client, view_user, view_category, view_auth):
    for i in range(5):
        item = Item.objects.create(
            name=f"Ore {i}",
            slug=f"ore-pag-{i}",
            category=view_category,
            item_type=Item.ItemType.MATERIAL,
            rarity=Item.Rarity.COMMON,
        )
        UserInventory.objects.create(user=view_user, item=item, quantity=1)
    resp = client.get(f"{BASE}/inventory/my/?limit=2&offset=0", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 5
    assert len(data["items"]) == 2


# --- /inventory/wallet/ --------------------------------------------------


@pytest.mark.django_db
def test_wallet_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/wallet/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_wallet_returns_zero_for_new_user(client, view_user, view_auth):
    resp = client.get(f"{BASE}/inventory/wallet/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["gold"] == 0
    assert data["total_earned"] == 0
    assert data["total_spent"] == 0


@pytest.mark.django_db
def test_wallet_reflects_existing_gold(client, view_user, view_auth):
    Wallet.objects.create(user=view_user, gold=500, total_earned=600)
    resp = client.get(f"{BASE}/inventory/wallet/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["gold"] == 500
    assert data["total_earned"] == 600


# --- /inventory/drops/ ---------------------------------------------------


@pytest.mark.django_db
def test_drops_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/drops/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_drops_empty_for_new_user(client, view_user, view_auth):
    resp = client.get(f"{BASE}/inventory/drops/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_drops_shows_existing_drop_records(client, view_user, view_item, view_auth):
    ItemDrop.objects.create(
        user=view_user,
        item=view_item,
        quantity=3,
        source=ItemDrop.DropSource.MATCH_REWARD,
    )
    resp = client.get(f"{BASE}/inventory/drops/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 1
    assert data["items"][0]["quantity"] == 3


# --- /inventory/instances/{id}/ ------------------------------------------


@pytest.mark.django_db
def test_get_instance_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/instances/{uuid.uuid4()}/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_get_instance_returns_404_for_missing(client, view_user, view_auth):
    resp = client.get(
        f"{BASE}/inventory/instances/{uuid.uuid4()}/",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_instance_returns_details(client, view_user, view_category, view_auth):
    non_stackable = Item.objects.create(
        name="Special Pkg",
        slug="special-pkg-inst",
        category=view_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.EPIC,
        is_stackable=False,
    )
    inst = ItemInstance.objects.create(
        item=non_stackable,
        owner=view_user,
        wear=0.05,
        pattern_seed=3,
        stattrak=True,
        nametag="My Special",
    )
    resp = client.get(f"{BASE}/inventory/instances/{inst.id}/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["nametag"] == "My Special"
    assert data["stattrak"] is True
    assert data["is_rare_pattern"] is True


# --- /inventory/instances/{id}/rename/ -----------------------------------


@pytest.mark.django_db
def test_rename_instance_success(client, view_user, view_category, view_auth):
    non_stackable = Item.objects.create(
        name="Rename Pkg",
        slug="rename-pkg",
        category=view_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    inst = ItemInstance.objects.create(item=non_stackable, owner=view_user)
    resp = client.post(
        f"{BASE}/inventory/instances/{inst.id}/rename/",
        data='{"nametag": "Dragon Slayer"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["nametag"] == "Dragon Slayer"
    inst.refresh_from_db()
    assert inst.nametag == "Dragon Slayer"


@pytest.mark.django_db
def test_rename_instance_too_long_returns_400(client, view_user, view_category, view_auth):
    non_stackable = Item.objects.create(
        name="Long Nametag Pkg",
        slug="long-nametag-pkg",
        category=view_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    inst = ItemInstance.objects.create(item=non_stackable, owner=view_user)
    resp = client.post(
        f"{BASE}/inventory/instances/{inst.id}/rename/",
        data='{"nametag": "' + "x" * 51 + '"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_rename_instance_not_owned_returns_404(client, view_user, view_other_user, view_category, view_auth):
    non_stackable = Item.objects.create(
        name="Not Mine Pkg",
        slug="not-mine-pkg",
        category=view_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    inst = ItemInstance.objects.create(item=non_stackable, owner=view_other_user)
    resp = client.post(
        f"{BASE}/inventory/instances/{inst.id}/rename/",
        data='{"nametag": "Stolen"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 404


# --- /inventory/decks/ ---------------------------------------------------


@pytest.mark.django_db
def test_list_decks_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/decks/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_list_decks_empty_for_new_user(client, view_user, view_auth):
    resp = client.get(f"{BASE}/inventory/decks/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0


@pytest.mark.django_db
def test_create_deck_success(client, view_user, view_auth):
    resp = client.post(
        f"{BASE}/inventory/decks/",
        data='{"name": "My Attack Deck"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "My Attack Deck"
    assert data["is_default"] is False
    assert "id" in data


@pytest.mark.django_db
def test_create_deck_unauthenticated_returns_401(client):
    resp = client.post(
        f"{BASE}/inventory/decks/",
        data='{"name": "Fail Deck"}',
        content_type="application/json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_get_deck_returns_404_for_wrong_user(client, view_user, view_other_user, view_auth):
    other_deck = Deck.objects.create(user=view_other_user, name="Secret Deck")
    resp = client.get(f"{BASE}/inventory/decks/{other_deck.id}/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_deck_returns_own_deck(client, view_user, view_auth):
    deck = Deck.objects.create(user=view_user, name="My Deck")
    resp = client.get(f"{BASE}/inventory/decks/{deck.id}/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "My Deck"


@pytest.mark.django_db
def test_delete_deck_success(client, view_user, view_auth):
    deck = Deck.objects.create(user=view_user, name="Temp Deck")
    resp = client.delete(f"{BASE}/inventory/decks/{deck.id}/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    assert not Deck.objects.filter(id=deck.id).exists()


@pytest.mark.django_db
def test_delete_deck_wrong_user_returns_404(client, view_user, view_other_user, view_auth):
    other_deck = Deck.objects.create(user=view_other_user, name="Not Yours")
    resp = client.delete(f"{BASE}/inventory/decks/{other_deck.id}/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 404


@pytest.mark.django_db
def test_set_default_deck(client, view_user, view_auth):
    d1 = Deck.objects.create(user=view_user, name="D1", is_default=True)
    d2 = Deck.objects.create(user=view_user, name="D2")
    resp = client.post(f"{BASE}/inventory/decks/{d2.id}/set-default/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_default"] is True
    d1.refresh_from_db()
    assert d1.is_default is False


@pytest.mark.django_db
def test_update_deck_name(client, view_user, view_auth):
    deck = Deck.objects.create(user=view_user, name="Old Name")
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data='{"name": "New Name"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "New Name"


@pytest.mark.django_db
def test_update_deck_with_blueprint_item(client, view_user, view_category, view_auth):
    bp_item = Item.objects.create(
        name="Barracks Blueprint",
        slug="bp-barracks-deck",
        category=view_category,
        item_type=Item.ItemType.BLUEPRINT_BUILDING,
        rarity=Item.Rarity.UNCOMMON,
        is_stackable=True,
        blueprint_ref="barracks",
    )
    UserInventory.objects.create(user=view_user, item=bp_item, quantity=1)
    deck = Deck.objects.create(user=view_user, name="Blueprint Deck")
    payload = '{"items": [{"item_slug": "bp-barracks-deck", "quantity": 1}]}'
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == 1
    assert data["items"][0]["item"]["slug"] == "bp-barracks-deck"


@pytest.mark.django_db
def test_update_deck_with_nonexistent_item_returns_400(client, view_user, view_auth):
    deck = Deck.objects.create(user=view_user, name="Bad Deck")
    payload = '{"items": [{"item_slug": "does-not-exist", "quantity": 1}]}'
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_update_deck_with_disallowed_item_type_returns_400(client, view_user, view_item, view_auth):
    UserInventory.objects.create(user=view_user, item=view_item, quantity=5)
    deck = Deck.objects.create(user=view_user, name="Material Deck")
    payload = f'{{"items": [{{"item_slug": "{view_item.slug}", "quantity": 1}}]}}'
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_update_deck_insufficient_inventory_returns_400(client, view_user, view_category, view_auth):
    consumable = Item.objects.create(
        name="Speed Boost",
        slug="boost-speed-deck",
        category=view_category,
        item_type=Item.ItemType.BOOST,
        rarity=Item.Rarity.COMMON,
        is_stackable=True,
        is_consumable=True,
    )
    UserInventory.objects.create(user=view_user, item=consumable, quantity=1)
    deck = Deck.objects.create(user=view_user, name="Greedy Deck")
    payload = '{"items": [{"item_slug": "boost-speed-deck", "quantity": 3}]}'
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_duplicate_blueprint_ref_in_deck_returns_400(client, view_user, view_category, view_auth):
    bp1 = Item.objects.create(
        name="Barracks Lvl 1",
        slug="bp-barracks-lvl1",
        category=view_category,
        item_type=Item.ItemType.BLUEPRINT_BUILDING,
        rarity=Item.Rarity.UNCOMMON,
        blueprint_ref="barracks",
        level=1,
    )
    bp2 = Item.objects.create(
        name="Barracks Lvl 2",
        slug="bp-barracks-lvl2",
        category=view_category,
        item_type=Item.ItemType.BLUEPRINT_BUILDING,
        rarity=Item.Rarity.RARE,
        blueprint_ref="barracks",
        level=2,
    )
    UserInventory.objects.create(user=view_user, item=bp1, quantity=1)
    UserInventory.objects.create(user=view_user, item=bp2, quantity=1)
    deck = Deck.objects.create(user=view_user, name="Double Barracks")
    payload = (
        '{"items": [{"item_slug": "bp-barracks-lvl1", "quantity": 1},{"item_slug": "bp-barracks-lvl2", "quantity": 1}]}'
    )
    resp = client.put(
        f"{BASE}/inventory/decks/{deck.id}/",
        data=payload,
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


# --- /inventory/cosmetics/equipped/ --------------------------------------


@pytest.mark.django_db
def test_equipped_cosmetics_unauthenticated_returns_401(client):
    resp = client.get(f"{BASE}/inventory/cosmetics/equipped/")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_equipped_cosmetics_empty_by_default(client, view_user, view_auth):
    resp = client.get(f"{BASE}/inventory/cosmetics/equipped/", HTTP_AUTHORIZATION=view_auth)
    assert resp.status_code == 200
    assert resp.json() == []


# --- open-crate ----------------------------------------------------------


@pytest.mark.django_db
def test_open_crate_unauthenticated_returns_401(client):
    resp = client.post(
        f"{BASE}/inventory/open-crate/",
        data='{"crate_item_slug": "test-crate", "key_item_slug": "test-key"}',
        content_type="application/json",
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_open_crate_returns_400_when_key_doesnt_match(client, view_user, view_category, view_item, view_auth):
    crate1 = Item.objects.create(
        name="Crate A",
        slug="crate-a",
        category=view_category,
        item_type=Item.ItemType.CRATE,
        rarity=Item.Rarity.COMMON,
        crate_loot_table=[{"item_slug": view_item.slug, "weight": 10, "min_qty": 1, "max_qty": 1}],
    )
    crate2 = Item.objects.create(
        name="Crate B",
        slug="crate-b",
        category=view_category,
        item_type=Item.ItemType.CRATE,
        rarity=Item.Rarity.COMMON,
    )
    key_item = Item.objects.create(
        name="Key A",
        slug="key-a",
        category=view_category,
        item_type=Item.ItemType.KEY,
        rarity=Item.Rarity.COMMON,
        opens_crate=crate2,
    )
    UserInventory.objects.create(user=view_user, item=crate1, quantity=1)
    UserInventory.objects.create(user=view_user, item=key_item, quantity=1)
    resp = client.post(
        f"{BASE}/inventory/open-crate/",
        data=f'{{"crate_item_slug": "{crate1.slug}", "key_item_slug": "{key_item.slug}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_open_crate_returns_400_when_no_crate_in_inventory(client, view_user, view_category, view_item, view_auth):
    crate = Item.objects.create(
        name="Empty Crate",
        slug="empty-crate",
        category=view_category,
        item_type=Item.ItemType.CRATE,
        rarity=Item.Rarity.COMMON,
        crate_loot_table=[{"item_slug": view_item.slug, "weight": 10, "min_qty": 1, "max_qty": 1}],
    )
    key_item = Item.objects.create(
        name="Empty Key",
        slug="empty-key",
        category=view_category,
        item_type=Item.ItemType.KEY,
        rarity=Item.Rarity.COMMON,
        opens_crate=crate,
    )
    UserInventory.objects.create(user=view_user, item=key_item, quantity=1)
    resp = client.post(
        f"{BASE}/inventory/open-crate/",
        data=f'{{"crate_item_slug": "{crate.slug}", "key_item_slug": "{key_item.slug}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_open_crate_success_drops_items_and_reduces_inventory(client, view_user, view_category, view_item, view_auth):
    crate = Item.objects.create(
        name="Lucky Crate",
        slug="lucky-crate",
        category=view_category,
        item_type=Item.ItemType.CRATE,
        rarity=Item.Rarity.COMMON,
        crate_loot_table=[{"item_slug": view_item.slug, "weight": 100, "min_qty": 1, "max_qty": 1}],
    )
    key_item = Item.objects.create(
        name="Lucky Key",
        slug="lucky-key",
        category=view_category,
        item_type=Item.ItemType.KEY,
        rarity=Item.Rarity.COMMON,
        opens_crate=crate,
    )
    UserInventory.objects.create(user=view_user, item=crate, quantity=1)
    UserInventory.objects.create(user=view_user, item=key_item, quantity=1)
    resp = client.post(
        f"{BASE}/inventory/open-crate/",
        data=f'{{"crate_item_slug": "{crate.slug}", "key_item_slug": "{key_item.slug}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=view_auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "drops" in data
    assert len(data["drops"]) > 0
    assert not UserInventory.objects.filter(user=view_user, item=crate).exists()
    assert not UserInventory.objects.filter(user=view_user, item=key_item).exists()
    assert ItemDrop.objects.filter(user=view_user, source=ItemDrop.DropSource.CRATE_OPEN).count() > 0


# ---------------------------------------------------------------------------
# InventoryTaskTests — pure helper functions in tasks.py and views.py
# ---------------------------------------------------------------------------


@pytest.fixture
def task_user(db):
    return User.objects.create_user(
        email="tasktest@test.com",
        username="tasktestuser",
        password="testpass123",
    )


@pytest.fixture
def task_category(db):
    return make_category("Task Cat", "task-cat")


@pytest.fixture
def task_item(task_category):
    return make_item(task_category, name="Task Ore", slug="task-ore")


# --- _roll_rarity --------------------------------------------------------


@pytest.mark.django_db
def test_roll_rarity_returns_available_rarity():
    from apps.inventory.tasks import WINNER_RARITY_WEIGHTS, _roll_rarity

    available = ["common", "uncommon"]
    for _ in range(20):
        result = _roll_rarity(WINNER_RARITY_WEIGHTS, available)
        assert result in available


@pytest.mark.django_db
def test_roll_rarity_with_single_option():
    from apps.inventory.tasks import _roll_rarity

    weights = {"common": 100, "rare": 50}
    result = _roll_rarity(weights, ["rare"])
    assert result == "rare"


@pytest.mark.django_db
def test_roll_rarity_empty_filtered_falls_back():
    from apps.inventory.tasks import _roll_rarity

    weights = {"epic": 100}
    result = _roll_rarity(weights, ["common", "rare"])
    assert result in ["common", "rare"]


@pytest.mark.django_db
def test_winner_rarity_weights_sum_to_100():
    from apps.inventory.tasks import WINNER_RARITY_WEIGHTS

    assert sum(WINNER_RARITY_WEIGHTS.values()) == 100


@pytest.mark.django_db
def test_loser_rarity_weights_sum_to_100():
    from apps.inventory.tasks import LOSER_RARITY_WEIGHTS

    assert sum(LOSER_RARITY_WEIGHTS.values()) == 100


# --- _roll_crate_loot ----------------------------------------------------


@pytest.mark.django_db
def test_roll_crate_loot_empty_returns_empty():
    from apps.inventory.views import _roll_crate_loot

    result = _roll_crate_loot([])
    assert result == []


@pytest.mark.django_db
def test_roll_crate_loot_returns_expected_structure():
    from apps.inventory.views import _roll_crate_loot

    loot_table = [{"item_slug": "iron-ore", "weight": 100, "min_qty": 1, "max_qty": 3}]
    results = _roll_crate_loot(loot_table, num_rolls=3)
    assert isinstance(results, list)
    for slug, qty in results:
        assert isinstance(slug, str)
        assert isinstance(qty, int)
        assert qty >= 1


@pytest.mark.django_db
def test_roll_crate_loot_merges_duplicates():
    from apps.inventory.views import _roll_crate_loot

    loot_table = [{"item_slug": "iron-ore", "weight": 100, "min_qty": 1, "max_qty": 1}]
    results = _roll_crate_loot(loot_table, num_rolls=3)
    slugs = [r[0] for r in results]
    assert len(slugs) == len(set(slugs))
    assert results[0][1] == 3


@pytest.mark.django_db
def test_roll_crate_loot_respects_qty_range():
    from apps.inventory.views import _roll_crate_loot

    loot_table = [{"item_slug": "iron-ore", "weight": 100, "min_qty": 5, "max_qty": 10}]
    results = _roll_crate_loot(loot_table, num_rolls=1)
    assert len(results) == 1
    slug, qty = results[0]
    assert 5 <= qty <= 10


# --- add_item_to_inventory / remove_item_from_inventory ------------------


@pytest.mark.django_db
def test_add_stackable_item_creates_inventory_entry(task_user, task_item):
    from apps.inventory.views import add_item_to_inventory

    result = add_item_to_inventory(task_user, task_item, 5)
    assert result.quantity == 5


@pytest.mark.django_db
def test_add_stackable_item_increments_existing(task_user, task_item):
    from apps.inventory.views import add_item_to_inventory

    UserInventory.objects.create(user=task_user, item=task_item, quantity=3)
    add_item_to_inventory(task_user, task_item, 4)
    inv = UserInventory.objects.get(user=task_user, item=task_item)
    assert inv.quantity == 7


@pytest.mark.django_db
def test_add_stackable_item_capped_at_max_stack(task_user, task_item):
    from apps.inventory.views import add_item_to_inventory

    task_item.max_stack = 10
    task_item.save()
    UserInventory.objects.create(user=task_user, item=task_item, quantity=8)
    add_item_to_inventory(task_user, task_item, 5)
    inv = UserInventory.objects.get(user=task_user, item=task_item)
    assert inv.quantity == 10


@pytest.mark.django_db
def test_add_nonstackable_item_creates_instance(task_user, task_category):
    from apps.inventory.views import add_item_to_inventory

    non_stackable = Item.objects.create(
        name="NS Item",
        slug="ns-item-task",
        category=task_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    result = add_item_to_inventory(task_user, non_stackable, 1)
    assert result.owner == task_user
    assert result.item == non_stackable


@pytest.mark.django_db
def test_add_nonstackable_multiple_returns_list(task_user, task_category):
    from apps.inventory.views import add_item_to_inventory

    non_stackable = Item.objects.create(
        name="NS Multi",
        slug="ns-multi",
        category=task_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    result = add_item_to_inventory(task_user, non_stackable, 3)
    assert isinstance(result, list)
    assert len(result) == 3


@pytest.mark.django_db
def test_remove_stackable_item_decrements_quantity(task_user, task_item):
    from apps.inventory.views import remove_item_from_inventory

    UserInventory.objects.create(user=task_user, item=task_item, quantity=5)
    ok = remove_item_from_inventory(task_user, task_item, 3)
    assert ok is True
    inv = UserInventory.objects.get(user=task_user, item=task_item)
    assert inv.quantity == 2


@pytest.mark.django_db
def test_remove_stackable_item_deletes_entry_at_zero(task_user, task_item):
    from apps.inventory.views import remove_item_from_inventory

    UserInventory.objects.create(user=task_user, item=task_item, quantity=3)
    ok = remove_item_from_inventory(task_user, task_item, 3)
    assert ok is True
    assert not UserInventory.objects.filter(user=task_user, item=task_item).exists()


@pytest.mark.django_db
def test_remove_stackable_item_returns_false_when_insufficient(task_user, task_item):
    from apps.inventory.views import remove_item_from_inventory

    UserInventory.objects.create(user=task_user, item=task_item, quantity=2)
    ok = remove_item_from_inventory(task_user, task_item, 5)
    assert ok is False
    inv = UserInventory.objects.get(user=task_user, item=task_item)
    assert inv.quantity == 2


@pytest.mark.django_db
def test_remove_stackable_item_returns_false_when_not_owned(task_user, task_item):
    from apps.inventory.views import remove_item_from_inventory

    ok = remove_item_from_inventory(task_user, task_item, 1)
    assert ok is False


@pytest.mark.django_db
def test_remove_nonstackable_item_deletes_instance(task_user, task_category):
    from apps.inventory.views import remove_item_from_inventory

    non_stackable = Item.objects.create(
        name="NS Del",
        slug="ns-del",
        category=task_category,
        item_type=Item.ItemType.TACTICAL_PACKAGE,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
    )
    ItemInstance.objects.create(item=non_stackable, owner=task_user)
    ok = remove_item_from_inventory(task_user, non_stackable, 1)
    assert ok is True
    assert ItemInstance.objects.filter(owner=task_user, item=non_stackable).count() == 0


# --- create_item_instance ------------------------------------------------


@pytest.mark.django_db
def test_create_item_instance_generates_wear_and_seed(task_item, task_user):
    from apps.inventory.views import create_item_instance

    inst = create_item_instance(task_item, task_user)
    assert 0 <= inst.pattern_seed <= 999
    assert 0.0 <= inst.wear <= 1.0


@pytest.mark.django_db
def test_create_item_instance_respects_rarity_wear_ranges(task_user, task_category):
    from apps.inventory.views import create_item_instance

    legendary = Item.objects.create(
        name="Legendary Item",
        slug="legendary-item-test",
        category=task_category,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.LEGENDARY,
    )
    for _ in range(10):
        inst = create_item_instance(legendary, task_user)
        assert inst.wear <= 0.15


@pytest.mark.django_db
def test_create_item_instance_forced_stattrak(task_item, task_user):
    from apps.inventory.views import create_item_instance

    inst = create_item_instance(task_item, task_user, stattrak=True)
    assert inst.stattrak is True


# --- generate_match_drops ------------------------------------------------


@pytest.mark.django_db
def test_generate_match_drops_skips_when_no_results():
    """generate_match_drops should not raise when no player results exist."""
    from apps.inventory.tasks import generate_match_drops

    generate_match_drops(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# generate_match_drops — full run with player results
# ---------------------------------------------------------------------------


@pytest.fixture
def drops_match_setup(db):
    from apps.game.models import MatchResult, PlayerResult
    from apps.game_config.models import GameSettings
    from apps.matchmaking.models import Match, MatchPlayer

    GameSettings.get()
    winner = User.objects.create_user(email="drops_winner@test.com", username="drops_winner", password="testpass123")
    loser = User.objects.create_user(email="drops_loser@test.com", username="drops_loser", password="testpass123")
    match = Match.objects.create(status=Match.Status.FINISHED, max_players=2)
    MatchPlayer.objects.create(match=match, user=winner, color="#FF0000")
    MatchPlayer.objects.create(match=match, user=loser, color="#0000FF")
    result = MatchResult.objects.create(match=match, total_ticks=100)
    PlayerResult.objects.create(match_result=result, user=winner, placement=1, elo_change=16)
    PlayerResult.objects.create(match_result=result, user=loser, placement=2, elo_change=-16)
    return match, winner, loser


@pytest.mark.django_db
def test_generate_match_drops_awards_gold_to_winner(drops_match_setup):
    from apps.inventory.models import Item, ItemCategory, Wallet
    from apps.inventory.tasks import WINNER_GOLD, generate_match_drops

    match, winner, _ = drops_match_setup
    cat = ItemCategory.objects.get_or_create(name="DropsTest", slug="drops-test")[0]
    Item.objects.create(
        name="Drops Iron",
        slug="drops-iron",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
    )
    generate_match_drops(str(match.id))
    wallet = Wallet.objects.get(user=winner)
    assert wallet.gold == WINNER_GOLD


@pytest.mark.django_db
def test_generate_match_drops_awards_gold_to_loser(drops_match_setup):
    from apps.inventory.models import Item, ItemCategory, Wallet
    from apps.inventory.tasks import LOSER_GOLD, generate_match_drops

    match, _, loser = drops_match_setup
    cat = ItemCategory.objects.get_or_create(name="DropsTest2", slug="drops-test2")[0]
    Item.objects.create(
        name="Drops Steel",
        slug="drops-steel",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
    )
    generate_match_drops(str(match.id))
    wallet = Wallet.objects.get(user=loser)
    assert wallet.gold == LOSER_GOLD


@pytest.mark.django_db
def test_generate_match_drops_creates_item_drop_records(drops_match_setup):
    from apps.inventory.models import Item, ItemCategory, ItemDrop
    from apps.inventory.tasks import generate_match_drops

    match, winner, _ = drops_match_setup
    cat = ItemCategory.objects.get_or_create(name="DropsTest3", slug="drops-test3")[0]
    Item.objects.create(
        name="Drops Copper",
        slug="drops-copper",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
    )
    generate_match_drops(str(match.id))
    assert ItemDrop.objects.filter(user=winner, source=ItemDrop.DropSource.MATCH_REWARD).exists()


@pytest.mark.django_db
def test_generate_match_drops_skips_bot_players(db):
    from apps.game.models import MatchResult, PlayerResult
    from apps.game_config.models import GameSettings
    from apps.inventory.models import Item, ItemCategory, ItemDrop, Wallet
    from apps.inventory.tasks import generate_match_drops
    from apps.matchmaking.models import Match, MatchPlayer

    GameSettings.get()
    cat = ItemCategory.objects.get_or_create(name="DropsBot", slug="drops-bot")[0]
    Item.objects.create(
        name="Bot Ore",
        slug="bot-ore",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
    )
    bot = User.objects.create_user(
        email="bot_drops@test.com", username="bot_drops", password="testpass123", is_bot=True
    )
    match = Match.objects.create(status=Match.Status.FINISHED, max_players=2)
    MatchPlayer.objects.create(match=match, user=bot, color="#FF0000")
    result = MatchResult.objects.create(match=match, total_ticks=50)
    PlayerResult.objects.create(match_result=result, user=bot, placement=1)
    generate_match_drops(str(match.id))
    assert not Wallet.objects.filter(user=bot).exists()
    assert not ItemDrop.objects.filter(user=bot).exists()


@pytest.mark.django_db
def test_generate_match_drops_skips_when_no_droppable_items(drops_match_setup):
    """When no droppable items exist, function should log and return cleanly."""
    from apps.inventory.tasks import generate_match_drops

    match, winner, _ = drops_match_setup
    # No Item objects exist, function should exit gracefully
    generate_match_drops(str(match.id))


# ---------------------------------------------------------------------------
# generate_match_drops_task — Celery wrapper
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_generate_match_drops_task_celery_wrapper():
    from apps.inventory.tasks import generate_match_drops_task

    # Should not raise; no player results exist so it logs and returns
    generate_match_drops_task(str(uuid.uuid4()))


# ---------------------------------------------------------------------------
# InventoryViewTests — cosmetics equip/unequip
# ---------------------------------------------------------------------------


@pytest.fixture
def cosmetic_setup(db):
    cat = ItemCategory.objects.get_or_create(name="Cosmetics", slug="cosmetics-test")[0]
    cosmetic_item = Item.objects.create(
        name="Cool Skin",
        slug="cool-skin",
        category=cat,
        item_type=Item.ItemType.COSMETIC,
        rarity=Item.Rarity.RARE,
        is_stackable=False,
        cosmetic_slot="infantry",
    )
    owner = User.objects.create_user(email="cosm_owner@test.com", username="cosm_owner", password="testpass123")
    auth = _get_auth_header(owner)
    inst = ItemInstance.objects.create(item=cosmetic_item, owner=owner, wear=0.1)
    return owner, cosmetic_item, inst, auth


@pytest.mark.django_db
def test_equip_cosmetic_by_instance_id(client, cosmetic_setup):
    owner, cosmetic_item, inst, auth = cosmetic_setup
    resp = client.post(
        f"{BASE}/inventory/cosmetics/equip/",
        data=f'{{"item_slug": "{cosmetic_item.slug}", "instance_id": "{inst.id}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["slot"] == "infantry"


@pytest.mark.django_db
def test_equip_cosmetic_by_slug(client, cosmetic_setup):
    owner, cosmetic_item, inst, auth = cosmetic_setup
    resp = client.post(
        f"{BASE}/inventory/cosmetics/equip/",
        data=f'{{"item_slug": "{cosmetic_item.slug}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["slot"] == "infantry"


@pytest.mark.django_db
def test_equip_cosmetic_not_in_inventory_returns_404(client, db):
    owner = User.objects.create_user(email="cosm_empty@test.com", username="cosm_empty", password="testpass123")
    auth = _get_auth_header(owner)
    resp = client.post(
        f"{BASE}/inventory/cosmetics/equip/",
        data='{"item_slug": "does-not-exist"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_equip_non_cosmetic_item_returns_400(client, db):
    cat = ItemCategory.objects.get_or_create(name="NonCosm", slug="non-cosm")[0]
    material = Item.objects.create(
        name="Rock",
        slug="rock-equip",
        category=cat,
        item_type=Item.ItemType.MATERIAL,
        rarity=Item.Rarity.COMMON,
    )
    owner = User.objects.create_user(email="cosm_mat@test.com", username="cosm_mat", password="testpass123")
    UserInventory.objects.create(user=owner, item=material, quantity=1)
    auth = _get_auth_header(owner)
    resp = client.post(
        f"{BASE}/inventory/cosmetics/equip/",
        data=f'{{"item_slug": "{material.slug}"}}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_unequip_cosmetic_success(client, cosmetic_setup):
    from apps.inventory.models import EquippedCosmetic

    owner, cosmetic_item, inst, auth = cosmetic_setup
    EquippedCosmetic.objects.create(user=owner, slot="infantry", item=cosmetic_item, instance=inst)
    resp = client.post(
        f"{BASE}/inventory/cosmetics/unequip/",
        data='{"slot": "infantry"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 200
    assert not EquippedCosmetic.objects.filter(user=owner, slot="infantry").exists()


@pytest.mark.django_db
def test_unequip_cosmetic_not_equipped_returns_404(client, db):
    owner = User.objects.create_user(email="unequip_none@test.com", username="unequip_none", password="testpass123")
    auth = _get_auth_header(owner)
    resp = client.post(
        f"{BASE}/inventory/cosmetics/unequip/",
        data='{"slot": "infantry"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_unequip_cosmetic_unauthenticated_returns_401(client):
    resp = client.post(
        f"{BASE}/inventory/cosmetics/unequip/",
        data='{"slot": "infantry"}',
        content_type="application/json",
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# delete_deck — default deck protection
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_default_deck_returns_403(client, db):
    owner = User.objects.create_user(email="del_default@test.com", username="del_default", password="testpass123")
    auth = _get_auth_header(owner)
    default_deck = Deck.objects.create(user=owner, name="Default", is_default=True, is_editable=False)
    resp = client.delete(
        f"{BASE}/inventory/decks/{default_deck.id}/",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# update_deck — non-editable deck protection
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_update_non_editable_deck_returns_403(client, db):
    owner = User.objects.create_user(email="upd_nonedit@test.com", username="upd_nonedit", password="testpass123")
    auth = _get_auth_header(owner)
    locked_deck = Deck.objects.create(user=owner, name="Locked", is_editable=False)
    resp = client.put(
        f"{BASE}/inventory/decks/{locked_deck.id}/",
        data='{"name": "Attempt"}',
        content_type="application/json",
        HTTP_AUTHORIZATION=auth,
    )
    assert resp.status_code == 403
