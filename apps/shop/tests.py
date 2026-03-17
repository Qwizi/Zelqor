import uuid

from django.test import TestCase

from apps.shop.models import ShopCategory, ShopItem


class ShopCategoryModelTest(TestCase):

    def test_create_category(self):
        cat = ShopCategory.objects.create(name='Cosmetics', slug='cosmetics')
        self.assertIsNotNone(cat.id)
        self.assertEqual(cat.name, 'Cosmetics')

    def test_category_str(self):
        cat = ShopCategory.objects.create(name='Boosts', slug='boosts')
        self.assertEqual(str(cat), 'Boosts')

    def test_category_is_active_default(self):
        cat = ShopCategory.objects.create(name='Active Cat', slug='active-cat')
        self.assertTrue(cat.is_active)

    def test_category_order_default(self):
        cat = ShopCategory.objects.create(name='Order Cat', slug='order-cat')
        self.assertEqual(cat.order, 0)

    def test_category_ordering(self):
        ShopCategory.objects.create(name='Z Category', slug='z-cat', order=10)
        ShopCategory.objects.create(name='A Category', slug='a-cat', order=1)
        cats = list(ShopCategory.objects.all())
        self.assertEqual(cats[0].name, 'A Category')

    def test_category_slug_unique(self):
        ShopCategory.objects.create(name='Cat1', slug='shared-slug')
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            ShopCategory.objects.create(name='Cat2', slug='shared-slug')


class ShopItemModelTest(TestCase):

    def setUp(self):
        self.category = ShopCategory.objects.create(name='Test Cat', slug='test-cat')

    def test_create_shop_item(self):
        item = ShopItem.objects.create(
            name='Fancy Hat',
            category=self.category,
            price=500,
        )
        self.assertIsNotNone(item.id)
        self.assertEqual(item.name, 'Fancy Hat')
        self.assertEqual(item.price, 500)

    def test_shop_item_str(self):
        item = ShopItem.objects.create(
            name='Cool Skin',
            category=self.category,
        )
        self.assertEqual(str(item), 'Cool Skin')

    def test_shop_item_is_active_default(self):
        item = ShopItem.objects.create(name='Active Item', category=self.category)
        self.assertTrue(item.is_active)

    def test_shop_item_price_default_zero(self):
        item = ShopItem.objects.create(name='Free Item', category=self.category)
        self.assertEqual(item.price, 0)

    def test_shop_item_type_default_cosmetic(self):
        item = ShopItem.objects.create(name='Default Item', category=self.category)
        self.assertEqual(item.item_type, ShopItem.ItemType.COSMETIC)

    def test_shop_item_boost_type(self):
        item = ShopItem.objects.create(
            name='XP Boost',
            category=self.category,
            item_type=ShopItem.ItemType.BOOST,
        )
        self.assertEqual(item.item_type, ShopItem.ItemType.BOOST)

    def test_shop_item_currency_type(self):
        item = ShopItem.objects.create(
            name='Gold Pack',
            category=self.category,
            item_type=ShopItem.ItemType.CURRENCY,
        )
        self.assertEqual(item.item_type, ShopItem.ItemType.CURRENCY)

    def test_shop_item_description_blank(self):
        item = ShopItem.objects.create(name='No Desc', category=self.category)
        self.assertEqual(item.description, '')

    def test_shop_item_icon_default(self):
        item = ShopItem.objects.create(name='Icon Item', category=self.category)
        self.assertEqual(item.icon, '🎁')

    def test_shop_item_cascade_on_category_delete(self):
        cat = ShopCategory.objects.create(name='Temp Cat', slug='temp-cat')
        item = ShopItem.objects.create(name='Temp Item', category=cat)
        item_id = item.id
        cat.delete()
        self.assertFalse(ShopItem.objects.filter(id=item_id).exists())

    def test_shop_item_uuid_pk(self):
        item = ShopItem.objects.create(name='UUID Item', category=self.category)
        self.assertIsInstance(item.id, uuid.UUID)

    def test_multiple_items_in_category(self):
        ShopItem.objects.create(name='Item A', category=self.category)
        ShopItem.objects.create(name='Item B', category=self.category)
        self.assertEqual(self.category.items.count(), 2)
