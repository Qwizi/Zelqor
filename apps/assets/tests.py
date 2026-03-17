import uuid
from io import BytesIO

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from apps.assets.models import AssetCategory, GameAsset


def make_fake_file(name='test_asset.png', content=b'fakecontent'):
    return SimpleUploadedFile(name, content, content_type='image/png')


class GameAssetModelTest(TestCase):

    def test_create_game_asset(self):
        asset = GameAsset.objects.create(
            key='building_barracks',
            name='Barracks',
            category=AssetCategory.BUILDING,
            file=make_fake_file('barracks.png'),
        )
        self.assertIsNotNone(asset.id)
        self.assertEqual(asset.key, 'building_barracks')
        self.assertEqual(asset.name, 'Barracks')

    def test_game_asset_str(self):
        asset = GameAsset.objects.create(
            key='unit_soldier',
            name='Soldier',
            category=AssetCategory.UNIT,
            file=make_fake_file('soldier.png'),
        )
        s = str(asset)
        self.assertIn('Soldier', s)
        self.assertIn(AssetCategory.UNIT, s)

    def test_game_asset_uuid_pk(self):
        asset = GameAsset.objects.create(
            key='icon_close',
            name='Close Icon',
            category=AssetCategory.ICON,
            file=make_fake_file('close.png'),
        )
        self.assertIsInstance(asset.id, uuid.UUID)

    def test_game_asset_is_active_default_true(self):
        asset = GameAsset.objects.create(
            key='sfx_click',
            name='Click SFX',
            category=AssetCategory.SOUND,
            file=make_fake_file('click.mp3', b'audiodata'),
        )
        self.assertTrue(asset.is_active)

    def test_game_asset_key_unique(self):
        GameAsset.objects.create(
            key='unique_key',
            name='Asset 1',
            category=AssetCategory.OTHER,
            file=make_fake_file('a1.png'),
        )
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            GameAsset.objects.create(
                key='unique_key',
                name='Asset 2',
                category=AssetCategory.OTHER,
                file=make_fake_file('a2.png'),
            )

    def test_game_asset_description_blank_default(self):
        asset = GameAsset.objects.create(
            key='no_desc_asset',
            name='No Desc',
            category=AssetCategory.OTHER,
            file=make_fake_file('nodesc.png'),
        )
        self.assertEqual(asset.description, '')

    def test_game_asset_category_default_other(self):
        asset = GameAsset.objects.create(
            key='default_cat',
            name='Default Category Asset',
            file=make_fake_file('default.png'),
        )
        self.assertEqual(asset.category, AssetCategory.OTHER)

    def test_game_asset_updated_at_changes_on_save(self):
        asset = GameAsset.objects.create(
            key='update_test',
            name='Update Test',
            category=AssetCategory.OTHER,
            file=make_fake_file('update.png'),
        )
        original_updated_at = asset.updated_at
        asset.name = 'Updated Name'
        asset.save(update_fields=['name'])
        asset.refresh_from_db()
        self.assertGreaterEqual(asset.updated_at, original_updated_at)

    def test_game_asset_created_at_auto(self):
        from django.utils import timezone
        before = timezone.now()
        asset = GameAsset.objects.create(
            key='created_at_test',
            name='Created At Test',
            category=AssetCategory.OTHER,
            file=make_fake_file('cat.png'),
        )
        after = timezone.now()
        self.assertGreaterEqual(asset.created_at, before)
        self.assertLessEqual(asset.created_at, after)

    def test_game_asset_all_categories_valid(self):
        valid_categories = [
            AssetCategory.BUILDING,
            AssetCategory.UNIT,
            AssetCategory.ABILITY,
            AssetCategory.MUSIC,
            AssetCategory.SOUND,
            AssetCategory.ICON,
            AssetCategory.TEXTURE,
            AssetCategory.ANIMATION,
            AssetCategory.OTHER,
        ]
        for i, cat in enumerate(valid_categories):
            asset = GameAsset.objects.create(
                key=f'cat_test_{i}',
                name=f'Category Test {i}',
                category=cat,
                file=make_fake_file(f'cat{i}.png'),
            )
            self.assertEqual(asset.category, cat)

    def test_game_asset_soft_disable(self):
        asset = GameAsset.objects.create(
            key='disable_test',
            name='Disable Test',
            category=AssetCategory.OTHER,
            file=make_fake_file('disable.png'),
        )
        asset.is_active = False
        asset.save(update_fields=['is_active'])
        asset.refresh_from_db()
        self.assertFalse(asset.is_active)

    def test_game_asset_queryset_filter_active(self):
        GameAsset.objects.create(
            key='active_asset', name='Active', category=AssetCategory.OTHER,
            file=make_fake_file('active.png'), is_active=True,
        )
        GameAsset.objects.create(
            key='inactive_asset', name='Inactive', category=AssetCategory.OTHER,
            file=make_fake_file('inactive.png'), is_active=False,
        )
        active_count = GameAsset.objects.filter(is_active=True).count()
        self.assertEqual(active_count, 1)


class AssetAPITest(TestCase):

    def test_get_asset_overrides_public(self):
        """The asset endpoint requires no authentication."""
        resp = self.client.get('/api/v1/assets/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('assets', data)
        self.assertIsInstance(data['assets'], dict)

    def test_get_asset_overrides_contains_active_assets(self):
        asset = GameAsset.objects.create(
            key='test_building_key',
            name='Test Building',
            category=AssetCategory.BUILDING,
            file=make_fake_file('tb.png'),
            is_active=True,
        )
        resp = self.client.get('/api/v1/assets/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # The key should appear in the map
        self.assertIn('test_building_key', data['assets'])

    def test_get_asset_overrides_excludes_inactive(self):
        GameAsset.objects.create(
            key='inactive_building',
            name='Inactive',
            category=AssetCategory.BUILDING,
            file=make_fake_file('ib.png'),
            is_active=False,
        )
        resp = self.client.get('/api/v1/assets/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertNotIn('inactive_building', data['assets'])


class AssetRegistryTest(TestCase):

    def test_well_known_assets_not_empty(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        self.assertGreater(len(WELL_KNOWN_ASSETS), 0)

    def test_well_known_assets_structure(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        for entry in WELL_KNOWN_ASSETS:
            self.assertEqual(len(entry), 3, f"Expected 3-tuple, got {entry}")
            category, key, description = entry
            self.assertIsInstance(category, str)
            self.assertIsInstance(key, str)
            self.assertIsInstance(description, str)

    def test_well_known_assets_no_duplicate_keys(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        keys = [entry[1] for entry in WELL_KNOWN_ASSETS]
        self.assertEqual(len(keys), len(set(keys)), "Duplicate keys found in WELL_KNOWN_ASSETS")

    def test_well_known_assets_contains_expected_buildings(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        building_keys = {key for cat, key, _ in WELL_KNOWN_ASSETS if cat == 'building'}
        self.assertIn('barracks', building_keys)
        self.assertIn('port', building_keys)

    def test_well_known_assets_contains_expected_units(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        unit_keys = {key for cat, key, _ in WELL_KNOWN_ASSETS if cat == 'unit'}
        self.assertIn('ground_unit', unit_keys)

    def test_well_known_assets_valid_categories(self):
        from apps.assets.registry import WELL_KNOWN_ASSETS
        valid_cats = {'building', 'unit', 'ability', 'music', 'sound', 'icon', 'texture', 'animation', 'other'}
        for cat, key, _ in WELL_KNOWN_ASSETS:
            self.assertIn(cat, valid_cats, f"Unknown category '{cat}' for key '{key}'")
