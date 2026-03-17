"""
Tests for apps/inventory — Item, ItemCategory, UserInventory, Wallet, Deck, DeckItem, ItemInstance.
"""
from django.contrib.auth import get_user_model
from django.test import TestCase

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


def make_category(name='Materials', slug='materials'):
    return ItemCategory.objects.create(name=name, slug=slug)


def make_item(category, name='Iron Ore', slug='iron-ore', item_type=Item.ItemType.MATERIAL):
    return Item.objects.create(
        name=name,
        slug=slug,
        category=category,
        item_type=item_type,
        rarity=Item.Rarity.COMMON,
    )


# ---------------------------------------------------------------------------
# ItemCategory tests
# ---------------------------------------------------------------------------

class ItemCategoryTests(TestCase):

    def test_creation(self):
        cat = make_category('Blueprints', 'blueprints')
        self.assertEqual(cat.name, 'Blueprints')
        self.assertEqual(cat.slug, 'blueprints')

    def test_str_representation(self):
        cat = make_category('Boosts', 'boosts')
        self.assertEqual(str(cat), 'Boosts')

    def test_is_active_default_true(self):
        cat = make_category()
        self.assertTrue(cat.is_active)

    def test_unique_slug(self):
        make_category('Mats', 'unique-slug')
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            make_category('Mats 2', 'unique-slug')


# ---------------------------------------------------------------------------
# Item model tests
# ---------------------------------------------------------------------------

class ItemModelTests(TestCase):

    def setUp(self):
        self.category = make_category()
        self.item = make_item(self.category)

    def test_creation_and_attributes(self):
        self.assertEqual(self.item.name, 'Iron Ore')
        self.assertEqual(self.item.slug, 'iron-ore')
        self.assertEqual(self.item.category, self.category)
        self.assertEqual(self.item.item_type, Item.ItemType.MATERIAL)
        self.assertEqual(self.item.rarity, Item.Rarity.COMMON)

    def test_str_representation(self):
        self.assertIn('Iron Ore', str(self.item))
        self.assertIn('Common', str(self.item))

    def test_is_active_default_true(self):
        self.assertTrue(self.item.is_active)

    def test_is_stackable_default_true(self):
        self.assertTrue(self.item.is_stackable)

    def test_is_tradeable_default_true(self):
        self.assertTrue(self.item.is_tradeable)

    def test_is_consumable_default_false(self):
        self.assertFalse(self.item.is_consumable)

    def test_unique_slug_constraint(self):
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            make_item(self.category, name='Iron Ore 2', slug='iron-ore')

    def test_rarity_choices(self):
        for rarity in [
            Item.Rarity.COMMON, Item.Rarity.UNCOMMON, Item.Rarity.RARE,
            Item.Rarity.EPIC, Item.Rarity.LEGENDARY,
        ]:
            item = Item.objects.create(
                name=f'Item {rarity}', slug=f'item-{rarity}',
                category=self.category, item_type=Item.ItemType.MATERIAL,
                rarity=rarity,
            )
            item.refresh_from_db()
            self.assertEqual(item.rarity, rarity)

    def test_blueprint_item_type(self):
        bp = make_item(
            self.category,
            name='Barracks Blueprint',
            slug='bp-barracks',
            item_type=Item.ItemType.BLUEPRINT_BUILDING,
        )
        self.assertEqual(bp.item_type, Item.ItemType.BLUEPRINT_BUILDING)


# ---------------------------------------------------------------------------
# UserInventory tests
# ---------------------------------------------------------------------------

class UserInventoryTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            email='inventory@test.com', username='inventoryuser', password='testpass123',
        )
        self.category = make_category()
        self.item = make_item(self.category)

    def test_creation_with_quantity(self):
        inv = UserInventory.objects.create(user=self.user, item=self.item, quantity=5)
        self.assertEqual(inv.quantity, 5)

    def test_str_representation(self):
        inv = UserInventory.objects.create(user=self.user, item=self.item, quantity=3)
        self.assertIn('inventoryuser', str(inv))
        self.assertIn('Iron Ore', str(inv))
        self.assertIn('3', str(inv))

    def test_unique_together_user_item(self):
        UserInventory.objects.create(user=self.user, item=self.item, quantity=1)
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            UserInventory.objects.create(user=self.user, item=self.item, quantity=2)

    def test_quantity_tracking(self):
        inv = UserInventory.objects.create(user=self.user, item=self.item, quantity=10)
        inv.quantity -= 3
        inv.save()
        inv.refresh_from_db()
        self.assertEqual(inv.quantity, 7)

    def test_related_name_on_user(self):
        UserInventory.objects.create(user=self.user, item=self.item, quantity=1)
        self.assertEqual(self.user.inventory.count(), 1)


# ---------------------------------------------------------------------------
# Wallet tests
# ---------------------------------------------------------------------------

class WalletTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            email='wallet@test.com', username='walletuser', password='testpass123',
        )

    def test_wallet_creation_with_gold(self):
        wallet = Wallet.objects.create(user=self.user, gold=100)
        self.assertEqual(wallet.gold, 100)

    def test_str_representation(self):
        wallet = Wallet.objects.create(user=self.user, gold=250)
        self.assertIn('walletuser', str(wallet))
        self.assertIn('250', str(wallet))

    def test_one_to_one_user_relationship(self):
        wallet = Wallet.objects.create(user=self.user, gold=0)
        self.assertEqual(wallet.user, self.user)

    def test_gold_update(self):
        wallet = Wallet.objects.create(user=self.user, gold=100)
        wallet.gold += 50
        wallet.total_earned += 50
        wallet.save()
        wallet.refresh_from_db()
        self.assertEqual(wallet.gold, 150)
        self.assertEqual(wallet.total_earned, 50)


# ---------------------------------------------------------------------------
# Deck model tests
# ---------------------------------------------------------------------------

class DeckModelTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            email='deck@test.com', username='deckuser', password='testpass123',
        )
        self.category = make_category()
        self.item = make_item(self.category)

    def test_deck_creation(self):
        deck = Deck.objects.create(user=self.user, name='My Deck')
        self.assertEqual(deck.name, 'My Deck')
        self.assertEqual(deck.user, self.user)

    def test_str_representation(self):
        deck = Deck.objects.create(user=self.user, name='Battle Deck')
        self.assertIn('deckuser', str(deck))
        self.assertIn('Battle Deck', str(deck))

    def test_is_default_false_by_default(self):
        deck = Deck.objects.create(user=self.user, name='Not Default')
        self.assertFalse(deck.is_default)

    def test_default_deck_flag(self):
        deck = Deck.objects.create(user=self.user, name='Default', is_default=True)
        self.assertTrue(deck.is_default)

    def test_only_one_default_deck_per_user(self):
        """Setting a new deck as default should unset the previous default."""
        d1 = Deck.objects.create(user=self.user, name='D1', is_default=True)
        d2 = Deck.objects.create(user=self.user, name='D2', is_default=True)
        d1.refresh_from_db()
        self.assertFalse(d1.is_default)
        self.assertTrue(d2.is_default)

    def test_deck_items_relationship(self):
        deck = Deck.objects.create(user=self.user, name='Deck with Items')
        DeckItem.objects.create(deck=deck, item=self.item, quantity=1)
        self.assertEqual(deck.items.count(), 1)

    def test_deck_item_str(self):
        deck = Deck.objects.create(user=self.user, name='Test Deck')
        di = DeckItem.objects.create(deck=deck, item=self.item, quantity=2)
        self.assertIn('Iron Ore', str(di))
        self.assertIn('2', str(di))


# ---------------------------------------------------------------------------
# ItemInstance tests
# ---------------------------------------------------------------------------

class ItemInstanceTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            email='instance@test.com', username='instanceuser', password='testpass123',
        )
        self.category = make_category()
        self.item = make_item(
            self.category,
            name='Tactical Package',
            slug='tactical-pkg',
            item_type=Item.ItemType.TACTICAL_PACKAGE,
        )

    def test_creation(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user)
        self.assertEqual(inst.item, self.item)
        self.assertEqual(inst.owner, self.user)

    def test_wear_condition_factory_new(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user, wear=0.0)
        self.assertEqual(inst.wear_condition, ItemInstance.WearCondition.FACTORY_NEW)

    def test_wear_condition_battle_scarred(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user, wear=0.9)
        self.assertEqual(inst.wear_condition, ItemInstance.WearCondition.BATTLE_SCARRED)

    def test_is_rare_pattern_true_for_low_seed(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user, pattern_seed=5)
        self.assertTrue(inst.is_rare_pattern)

    def test_is_rare_pattern_false_for_high_seed(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user, pattern_seed=100)
        self.assertFalse(inst.is_rare_pattern)

    def test_stattrak_default_false(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user)
        self.assertFalse(inst.stattrak)

    def test_nametag_default_empty(self):
        inst = ItemInstance.objects.create(item=self.item, owner=self.user)
        self.assertEqual(inst.nametag, '')


# ---------------------------------------------------------------------------
# Helper: obtain a JWT Bearer token for a user without touching the network
# ---------------------------------------------------------------------------

def _get_auth_header(user):
    """Return an Authorization header value with a fresh access token."""
    from ninja_jwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(user)
    return f'Bearer {str(refresh.access_token)}'


# ---------------------------------------------------------------------------
# InventoryViewTests — API endpoint tests
# ---------------------------------------------------------------------------

class InventoryViewTests(TestCase):
    """HTTP-level tests for InventoryController and DeckController endpoints."""

    BASE = '/api/v1'

    def setUp(self):
        self.user = User.objects.create_user(
            email='viewtest@test.com', username='viewtestuser', password='testpass123',
        )
        self.other_user = User.objects.create_user(
            email='other@test.com', username='othertestuser', password='testpass123',
        )
        self.auth = _get_auth_header(self.user)
        self.category = make_category('Materials', 'materials-view')
        self.item = make_item(
            self.category,
            name='Copper Ore',
            slug='copper-ore',
        )

    # --- /inventory/items/ (public) ------------------------------------------

    def test_list_items_public_returns_200(self):
        resp = self.client.get(f'{self.BASE}/inventory/items/')
        self.assertEqual(resp.status_code, 200)

    def test_list_items_returns_active_categories_only(self):
        inactive_cat = ItemCategory.objects.create(
            name='Inactive Cat', slug='inactive-cat', is_active=False,
        )
        resp = self.client.get(f'{self.BASE}/inventory/items/')
        data = resp.json()
        slugs = [c['slug'] for c in data]
        self.assertNotIn('inactive-cat', slugs)

    # --- /inventory/my/ (auth required) --------------------------------------

    def test_my_inventory_unauthenticated_returns_401(self):
        resp = self.client.get(f'{self.BASE}/inventory/my/')
        self.assertEqual(resp.status_code, 401)

    def test_my_inventory_empty_for_new_user(self):
        resp = self.client.get(
            f'{self.BASE}/inventory/my/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('items', data)
        self.assertIn('count', data)
        self.assertEqual(data['count'], 0)

    def test_my_inventory_shows_stackable_item(self):
        UserInventory.objects.create(user=self.user, item=self.item, quantity=7)
        resp = self.client.get(
            f'{self.BASE}/inventory/my/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 1)
        entry = data['items'][0]
        self.assertEqual(entry['quantity'], 7)
        self.assertFalse(entry['is_instance'])

    def test_my_inventory_item_type_filter(self):
        # Add a blueprint item as well so we can filter it out
        bp_item = Item.objects.create(
            name='Barracks BP', slug='bp-barracks-view',
            category=self.category,
            item_type=Item.ItemType.BLUEPRINT_BUILDING,
            rarity=Item.Rarity.UNCOMMON,
        )
        UserInventory.objects.create(user=self.user, item=self.item, quantity=3)
        UserInventory.objects.create(user=self.user, item=bp_item, quantity=1)

        resp = self.client.get(
            f'{self.BASE}/inventory/my/?item_type=material',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['items'][0]['item']['item_type'], 'material')

    def test_my_inventory_shows_instance_items(self):
        non_stackable = Item.objects.create(
            name='Tactical Pkg', slug='tactical-pkg-view',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        ItemInstance.objects.create(item=non_stackable, owner=self.user)
        resp = self.client.get(
            f'{self.BASE}/inventory/my/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 1)
        entry = data['items'][0]
        self.assertTrue(entry['is_instance'])
        self.assertIsNotNone(entry['instance'])

    def test_my_inventory_pagination(self):
        for i in range(5):
            item = Item.objects.create(
                name=f'Ore {i}', slug=f'ore-pag-{i}',
                category=self.category,
                item_type=Item.ItemType.MATERIAL,
                rarity=Item.Rarity.COMMON,
            )
            UserInventory.objects.create(user=self.user, item=item, quantity=1)

        resp = self.client.get(
            f'{self.BASE}/inventory/my/?limit=2&offset=0',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 5)
        self.assertEqual(len(data['items']), 2)

    # --- /inventory/wallet/ --------------------------------------------------

    def test_wallet_unauthenticated_returns_401(self):
        resp = self.client.get(f'{self.BASE}/inventory/wallet/')
        self.assertEqual(resp.status_code, 401)

    def test_wallet_returns_zero_for_new_user(self):
        resp = self.client.get(
            f'{self.BASE}/inventory/wallet/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['gold'], 0)
        self.assertEqual(data['total_earned'], 0)
        self.assertEqual(data['total_spent'], 0)

    def test_wallet_reflects_existing_gold(self):
        Wallet.objects.create(user=self.user, gold=500, total_earned=600)
        resp = self.client.get(
            f'{self.BASE}/inventory/wallet/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['gold'], 500)
        self.assertEqual(data['total_earned'], 600)

    # --- /inventory/drops/ ---------------------------------------------------

    def test_drops_unauthenticated_returns_401(self):
        resp = self.client.get(f'{self.BASE}/inventory/drops/')
        self.assertEqual(resp.status_code, 401)

    def test_drops_empty_for_new_user(self):
        resp = self.client.get(
            f'{self.BASE}/inventory/drops/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 0)

    def test_drops_shows_existing_drop_records(self):
        ItemDrop.objects.create(
            user=self.user, item=self.item, quantity=3,
            source=ItemDrop.DropSource.MATCH_REWARD,
        )
        resp = self.client.get(
            f'{self.BASE}/inventory/drops/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['items'][0]['quantity'], 3)

    # --- /inventory/instances/{id}/ ------------------------------------------

    def test_get_instance_unauthenticated_returns_401(self):
        import uuid
        resp = self.client.get(f'{self.BASE}/inventory/instances/{uuid.uuid4()}/')
        self.assertEqual(resp.status_code, 401)

    def test_get_instance_returns_404_for_missing(self):
        import uuid
        resp = self.client.get(
            f'{self.BASE}/inventory/instances/{uuid.uuid4()}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_instance_returns_details(self):
        non_stackable = Item.objects.create(
            name='Special Pkg', slug='special-pkg-inst',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.EPIC,
            is_stackable=False,
        )
        inst = ItemInstance.objects.create(
            item=non_stackable, owner=self.user,
            wear=0.05, pattern_seed=3, stattrak=True, nametag='My Special',
        )
        resp = self.client.get(
            f'{self.BASE}/inventory/instances/{inst.id}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['nametag'], 'My Special')
        self.assertTrue(data['stattrak'])
        self.assertTrue(data['is_rare_pattern'])

    # --- /inventory/instances/{id}/rename/ -----------------------------------

    def test_rename_instance_success(self):
        non_stackable = Item.objects.create(
            name='Rename Pkg', slug='rename-pkg',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        inst = ItemInstance.objects.create(item=non_stackable, owner=self.user)
        resp = self.client.post(
            f'{self.BASE}/inventory/instances/{inst.id}/rename/',
            data='{"nametag": "Dragon Slayer"}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['nametag'], 'Dragon Slayer')
        inst.refresh_from_db()
        self.assertEqual(inst.nametag, 'Dragon Slayer')

    def test_rename_instance_too_long_returns_400(self):
        non_stackable = Item.objects.create(
            name='Long Nametag Pkg', slug='long-nametag-pkg',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        inst = ItemInstance.objects.create(item=non_stackable, owner=self.user)
        resp = self.client.post(
            f'{self.BASE}/inventory/instances/{inst.id}/rename/',
            data='{"nametag": "' + 'x' * 51 + '"}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_rename_instance_not_owned_returns_404(self):
        non_stackable = Item.objects.create(
            name='Not Mine Pkg', slug='not-mine-pkg',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        # Instance owned by other_user
        inst = ItemInstance.objects.create(item=non_stackable, owner=self.other_user)
        resp = self.client.post(
            f'{self.BASE}/inventory/instances/{inst.id}/rename/',
            data='{"nametag": "Stolen"}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 404)

    # --- /inventory/decks/ ---------------------------------------------------

    def test_list_decks_unauthenticated_returns_401(self):
        resp = self.client.get(f'{self.BASE}/inventory/decks/')
        self.assertEqual(resp.status_code, 401)

    def test_list_decks_empty_for_new_user(self):
        resp = self.client.get(
            f'{self.BASE}/inventory/decks/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['count'], 0)

    def test_create_deck_success(self):
        resp = self.client.post(
            f'{self.BASE}/inventory/decks/',
            data='{"name": "My Attack Deck"}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], 'My Attack Deck')
        self.assertFalse(data['is_default'])
        self.assertIn('id', data)

    def test_create_deck_unauthenticated_returns_401(self):
        resp = self.client.post(
            f'{self.BASE}/inventory/decks/',
            data='{"name": "Fail Deck"}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_get_deck_returns_404_for_wrong_user(self):
        other_deck = Deck.objects.create(user=self.other_user, name='Secret Deck')
        resp = self.client.get(
            f'{self.BASE}/inventory/decks/{other_deck.id}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_get_deck_returns_own_deck(self):
        deck = Deck.objects.create(user=self.user, name='My Deck')
        resp = self.client.get(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], 'My Deck')

    def test_delete_deck_success(self):
        deck = Deck.objects.create(user=self.user, name='Temp Deck')
        resp = self.client.delete(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Deck.objects.filter(id=deck.id).exists())

    def test_delete_deck_wrong_user_returns_404(self):
        other_deck = Deck.objects.create(user=self.other_user, name='Not Yours')
        resp = self.client.delete(
            f'{self.BASE}/inventory/decks/{other_deck.id}/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 404)

    def test_set_default_deck(self):
        d1 = Deck.objects.create(user=self.user, name='D1', is_default=True)
        d2 = Deck.objects.create(user=self.user, name='D2')
        resp = self.client.post(
            f'{self.BASE}/inventory/decks/{d2.id}/set-default/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertTrue(data['is_default'])
        d1.refresh_from_db()
        self.assertFalse(d1.is_default)

    def test_update_deck_name(self):
        deck = Deck.objects.create(user=self.user, name='Old Name')
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data='{"name": "New Name"}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['name'], 'New Name')

    def test_update_deck_with_blueprint_item(self):
        bp_item = Item.objects.create(
            name='Barracks Blueprint', slug='bp-barracks-deck',
            category=self.category,
            item_type=Item.ItemType.BLUEPRINT_BUILDING,
            rarity=Item.Rarity.UNCOMMON,
            is_stackable=True,
            blueprint_ref='barracks',
        )
        UserInventory.objects.create(user=self.user, item=bp_item, quantity=1)
        deck = Deck.objects.create(user=self.user, name='Blueprint Deck')
        payload = '{"items": [{"item_slug": "bp-barracks-deck", "quantity": 1}]}'
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data=payload,
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(data['items'][0]['item']['slug'], 'bp-barracks-deck')

    def test_update_deck_with_nonexistent_item_returns_400(self):
        deck = Deck.objects.create(user=self.user, name='Bad Deck')
        payload = '{"items": [{"item_slug": "does-not-exist", "quantity": 1}]}'
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data=payload,
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_update_deck_with_disallowed_item_type_returns_400(self):
        # Material items are not allowed in decks
        UserInventory.objects.create(user=self.user, item=self.item, quantity=5)
        deck = Deck.objects.create(user=self.user, name='Material Deck')
        payload = f'{{"items": [{{"item_slug": "{self.item.slug}", "quantity": 1}}]}}'
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data=payload,
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_update_deck_insufficient_inventory_returns_400(self):
        consumable = Item.objects.create(
            name='Speed Boost', slug='boost-speed-deck',
            category=self.category,
            item_type=Item.ItemType.BOOST,
            rarity=Item.Rarity.COMMON,
            is_stackable=True,
            is_consumable=True,
        )
        # User has 1, deck requests 3
        UserInventory.objects.create(user=self.user, item=consumable, quantity=1)
        deck = Deck.objects.create(user=self.user, name='Greedy Deck')
        payload = '{"items": [{"item_slug": "boost-speed-deck", "quantity": 3}]}'
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data=payload,
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_duplicate_blueprint_ref_in_deck_returns_400(self):
        bp1 = Item.objects.create(
            name='Barracks Lvl 1', slug='bp-barracks-lvl1',
            category=self.category,
            item_type=Item.ItemType.BLUEPRINT_BUILDING,
            rarity=Item.Rarity.UNCOMMON,
            blueprint_ref='barracks',
            level=1,
        )
        bp2 = Item.objects.create(
            name='Barracks Lvl 2', slug='bp-barracks-lvl2',
            category=self.category,
            item_type=Item.ItemType.BLUEPRINT_BUILDING,
            rarity=Item.Rarity.RARE,
            blueprint_ref='barracks',
            level=2,
        )
        UserInventory.objects.create(user=self.user, item=bp1, quantity=1)
        UserInventory.objects.create(user=self.user, item=bp2, quantity=1)
        deck = Deck.objects.create(user=self.user, name='Double Barracks')
        payload = ('{"items": ['
                   '{"item_slug": "bp-barracks-lvl1", "quantity": 1},'
                   '{"item_slug": "bp-barracks-lvl2", "quantity": 1}'
                   ']}')
        resp = self.client.put(
            f'{self.BASE}/inventory/decks/{deck.id}/',
            data=payload,
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    # --- /inventory/cosmetics/equipped/ --------------------------------------

    def test_equipped_cosmetics_unauthenticated_returns_401(self):
        resp = self.client.get(f'{self.BASE}/inventory/cosmetics/equipped/')
        self.assertEqual(resp.status_code, 401)

    def test_equipped_cosmetics_empty_by_default(self):
        resp = self.client.get(
            f'{self.BASE}/inventory/cosmetics/equipped/',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data, [])

    # --- open-crate ----------------------------------------------------------

    def test_open_crate_unauthenticated_returns_401(self):
        resp = self.client.post(
            f'{self.BASE}/inventory/open-crate/',
            data='{"crate_item_slug": "test-crate", "key_item_slug": "test-key"}',
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 401)

    def test_open_crate_returns_400_when_key_doesnt_match(self):
        # Create two crates; the key is linked to crate2, not crate1
        crate1 = Item.objects.create(
            name='Crate A', slug='crate-a',
            category=self.category,
            item_type=Item.ItemType.CRATE,
            rarity=Item.Rarity.COMMON,
            crate_loot_table=[
                {'item_slug': self.item.slug, 'weight': 10, 'min_qty': 1, 'max_qty': 1}
            ],
        )
        crate2 = Item.objects.create(
            name='Crate B', slug='crate-b',
            category=self.category,
            item_type=Item.ItemType.CRATE,
            rarity=Item.Rarity.COMMON,
        )
        key_item = Item.objects.create(
            name='Key A', slug='key-a',
            category=self.category,
            item_type=Item.ItemType.KEY,
            rarity=Item.Rarity.COMMON,
            opens_crate=crate2,   # opens crate2, not crate1
        )
        UserInventory.objects.create(user=self.user, item=crate1, quantity=1)
        UserInventory.objects.create(user=self.user, item=key_item, quantity=1)
        resp = self.client.post(
            f'{self.BASE}/inventory/open-crate/',
            data=f'{{"crate_item_slug": "{crate1.slug}", "key_item_slug": "{key_item.slug}"}}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_open_crate_returns_400_when_no_crate_in_inventory(self):
        crate = Item.objects.create(
            name='Empty Crate', slug='empty-crate',
            category=self.category,
            item_type=Item.ItemType.CRATE,
            rarity=Item.Rarity.COMMON,
            crate_loot_table=[
                {'item_slug': self.item.slug, 'weight': 10, 'min_qty': 1, 'max_qty': 1}
            ],
        )
        key_item = Item.objects.create(
            name='Empty Key', slug='empty-key',
            category=self.category,
            item_type=Item.ItemType.KEY,
            rarity=Item.Rarity.COMMON,
            opens_crate=crate,
        )
        # Do NOT add crate to inventory; add key only
        UserInventory.objects.create(user=self.user, item=key_item, quantity=1)
        resp = self.client.post(
            f'{self.BASE}/inventory/open-crate/',
            data=f'{{"crate_item_slug": "{crate.slug}", "key_item_slug": "{key_item.slug}"}}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 400)

    def test_open_crate_success_drops_items_and_reduces_inventory(self):
        crate = Item.objects.create(
            name='Lucky Crate', slug='lucky-crate',
            category=self.category,
            item_type=Item.ItemType.CRATE,
            rarity=Item.Rarity.COMMON,
            crate_loot_table=[
                {'item_slug': self.item.slug, 'weight': 100, 'min_qty': 1, 'max_qty': 1}
            ],
        )
        key_item = Item.objects.create(
            name='Lucky Key', slug='lucky-key',
            category=self.category,
            item_type=Item.ItemType.KEY,
            rarity=Item.Rarity.COMMON,
            opens_crate=crate,
        )
        UserInventory.objects.create(user=self.user, item=crate, quantity=1)
        UserInventory.objects.create(user=self.user, item=key_item, quantity=1)
        resp = self.client.post(
            f'{self.BASE}/inventory/open-crate/',
            data=f'{{"crate_item_slug": "{crate.slug}", "key_item_slug": "{key_item.slug}"}}',
            content_type='application/json',
            HTTP_AUTHORIZATION=self.auth,
        )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('drops', data)
        self.assertGreater(len(data['drops']), 0)
        # Crate and key should be consumed
        self.assertFalse(UserInventory.objects.filter(user=self.user, item=crate).exists())
        self.assertFalse(UserInventory.objects.filter(user=self.user, item=key_item).exists())
        # Drop records should be created
        self.assertGreater(
            ItemDrop.objects.filter(user=self.user, source=ItemDrop.DropSource.CRATE_OPEN).count(),
            0,
        )


# ---------------------------------------------------------------------------
# InventoryTaskTests — pure helper functions in tasks.py and views.py
# ---------------------------------------------------------------------------

class InventoryTaskTests(TestCase):
    """Tests for helper functions in inventory tasks and views."""

    def setUp(self):
        self.user = User.objects.create_user(
            email='tasktest@test.com', username='tasktestuser', password='testpass123',
        )
        self.category = make_category('Task Cat', 'task-cat')
        self.item = make_item(self.category, name='Task Ore', slug='task-ore')

    # --- _roll_rarity --------------------------------------------------------

    def test_roll_rarity_returns_available_rarity(self):
        from apps.inventory.tasks import _roll_rarity, WINNER_RARITY_WEIGHTS
        available = ['common', 'uncommon']
        for _ in range(20):
            result = _roll_rarity(WINNER_RARITY_WEIGHTS, available)
            self.assertIn(result, available)

    def test_roll_rarity_with_single_option(self):
        from apps.inventory.tasks import _roll_rarity
        weights = {'common': 100, 'rare': 50}
        result = _roll_rarity(weights, ['rare'])
        self.assertEqual(result, 'rare')

    def test_roll_rarity_empty_filtered_falls_back(self):
        from apps.inventory.tasks import _roll_rarity
        # weights has no overlap with available rarities
        weights = {'epic': 100}
        result = _roll_rarity(weights, ['common', 'rare'])
        self.assertIn(result, ['common', 'rare'])

    def test_winner_rarity_weights_sum_to_100(self):
        from apps.inventory.tasks import WINNER_RARITY_WEIGHTS
        self.assertEqual(sum(WINNER_RARITY_WEIGHTS.values()), 100)

    def test_loser_rarity_weights_sum_to_100(self):
        from apps.inventory.tasks import LOSER_RARITY_WEIGHTS
        self.assertEqual(sum(LOSER_RARITY_WEIGHTS.values()), 100)

    # --- _roll_crate_loot ----------------------------------------------------

    def test_roll_crate_loot_empty_returns_empty(self):
        from apps.inventory.views import _roll_crate_loot
        result = _roll_crate_loot([])
        self.assertEqual(result, [])

    def test_roll_crate_loot_returns_expected_structure(self):
        from apps.inventory.views import _roll_crate_loot
        loot_table = [
            {'item_slug': 'iron-ore', 'weight': 100, 'min_qty': 1, 'max_qty': 3},
        ]
        results = _roll_crate_loot(loot_table, num_rolls=3)
        self.assertIsInstance(results, list)
        # All results should be tuples of (str, int)
        for slug, qty in results:
            self.assertIsInstance(slug, str)
            self.assertIsInstance(qty, int)
            self.assertGreaterEqual(qty, 1)

    def test_roll_crate_loot_merges_duplicates(self):
        from apps.inventory.views import _roll_crate_loot
        loot_table = [
            {'item_slug': 'iron-ore', 'weight': 100, 'min_qty': 1, 'max_qty': 1},
        ]
        # All 3 rolls will pick the same item; they should be merged
        results = _roll_crate_loot(loot_table, num_rolls=3)
        slugs = [r[0] for r in results]
        # No duplicates after merge
        self.assertEqual(len(slugs), len(set(slugs)))
        # The merged quantity should be 3
        self.assertEqual(results[0][1], 3)

    def test_roll_crate_loot_respects_qty_range(self):
        from apps.inventory.views import _roll_crate_loot
        loot_table = [
            {'item_slug': 'iron-ore', 'weight': 100, 'min_qty': 5, 'max_qty': 10},
        ]
        results = _roll_crate_loot(loot_table, num_rolls=1)
        self.assertEqual(len(results), 1)
        slug, qty = results[0]
        self.assertGreaterEqual(qty, 5)
        self.assertLessEqual(qty, 10)

    # --- add_item_to_inventory / remove_item_from_inventory ------------------

    def test_add_stackable_item_creates_inventory_entry(self):
        from apps.inventory.views import add_item_to_inventory
        result = add_item_to_inventory(self.user, self.item, 5)
        self.assertEqual(result.quantity, 5)

    def test_add_stackable_item_increments_existing(self):
        from apps.inventory.views import add_item_to_inventory
        UserInventory.objects.create(user=self.user, item=self.item, quantity=3)
        add_item_to_inventory(self.user, self.item, 4)
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 7)

    def test_add_stackable_item_capped_at_max_stack(self):
        from apps.inventory.views import add_item_to_inventory
        self.item.max_stack = 10
        self.item.save()
        UserInventory.objects.create(user=self.user, item=self.item, quantity=8)
        add_item_to_inventory(self.user, self.item, 5)
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 10)

    def test_add_nonstackable_item_creates_instance(self):
        from apps.inventory.views import add_item_to_inventory
        non_stackable = Item.objects.create(
            name='NS Item', slug='ns-item-task',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        result = add_item_to_inventory(self.user, non_stackable, 1)
        self.assertEqual(result.owner, self.user)
        self.assertEqual(result.item, non_stackable)

    def test_add_nonstackable_multiple_returns_list(self):
        from apps.inventory.views import add_item_to_inventory
        non_stackable = Item.objects.create(
            name='NS Multi', slug='ns-multi',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        result = add_item_to_inventory(self.user, non_stackable, 3)
        self.assertIsInstance(result, list)
        self.assertEqual(len(result), 3)

    def test_remove_stackable_item_decrements_quantity(self):
        from apps.inventory.views import remove_item_from_inventory
        UserInventory.objects.create(user=self.user, item=self.item, quantity=5)
        ok = remove_item_from_inventory(self.user, self.item, 3)
        self.assertTrue(ok)
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 2)

    def test_remove_stackable_item_deletes_entry_at_zero(self):
        from apps.inventory.views import remove_item_from_inventory
        UserInventory.objects.create(user=self.user, item=self.item, quantity=3)
        ok = remove_item_from_inventory(self.user, self.item, 3)
        self.assertTrue(ok)
        self.assertFalse(UserInventory.objects.filter(user=self.user, item=self.item).exists())

    def test_remove_stackable_item_returns_false_when_insufficient(self):
        from apps.inventory.views import remove_item_from_inventory
        UserInventory.objects.create(user=self.user, item=self.item, quantity=2)
        ok = remove_item_from_inventory(self.user, self.item, 5)
        self.assertFalse(ok)
        # Quantity should be unchanged
        inv = UserInventory.objects.get(user=self.user, item=self.item)
        self.assertEqual(inv.quantity, 2)

    def test_remove_stackable_item_returns_false_when_not_owned(self):
        from apps.inventory.views import remove_item_from_inventory
        ok = remove_item_from_inventory(self.user, self.item, 1)
        self.assertFalse(ok)

    def test_remove_nonstackable_item_deletes_instance(self):
        from apps.inventory.views import remove_item_from_inventory
        non_stackable = Item.objects.create(
            name='NS Del', slug='ns-del',
            category=self.category,
            item_type=Item.ItemType.TACTICAL_PACKAGE,
            rarity=Item.Rarity.RARE,
            is_stackable=False,
        )
        ItemInstance.objects.create(item=non_stackable, owner=self.user)
        ok = remove_item_from_inventory(self.user, non_stackable, 1)
        self.assertTrue(ok)
        self.assertEqual(ItemInstance.objects.filter(owner=self.user, item=non_stackable).count(), 0)

    # --- create_item_instance ------------------------------------------------

    def test_create_item_instance_generates_wear_and_seed(self):
        from apps.inventory.views import create_item_instance
        inst = create_item_instance(self.item, self.user)
        self.assertGreaterEqual(inst.pattern_seed, 0)
        self.assertLessEqual(inst.pattern_seed, 999)
        self.assertGreaterEqual(inst.wear, 0.0)
        self.assertLessEqual(inst.wear, 1.0)

    def test_create_item_instance_respects_rarity_wear_ranges(self):
        from apps.inventory.views import create_item_instance
        legendary = Item.objects.create(
            name='Legendary Item', slug='legendary-item-test',
            category=self.category,
            item_type=Item.ItemType.MATERIAL,
            rarity=Item.Rarity.LEGENDARY,
        )
        for _ in range(10):
            inst = create_item_instance(legendary, self.user)
            self.assertLessEqual(inst.wear, 0.15)

    def test_create_item_instance_forced_stattrak(self):
        from apps.inventory.views import create_item_instance
        inst = create_item_instance(self.item, self.user, stattrak=True)
        self.assertTrue(inst.stattrak)

    # --- generate_match_drops ------------------------------------------------

    def test_generate_match_drops_skips_when_no_results(self):
        """generate_match_drops should not raise when no player results exist."""
        import uuid
        from apps.inventory.tasks import generate_match_drops
        # Use a random match UUID that has no results — should log warning and return
        generate_match_drops(str(uuid.uuid4()))
