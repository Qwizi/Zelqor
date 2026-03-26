import uuid

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError
from django.utils import timezone

from apps.assets.models import AssetCategory, GameAsset


def make_fake_file(name="test_asset.png", content=b"fakecontent"):
    return SimpleUploadedFile(name, content, content_type="image/png")


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")


# --- GameAssetModelTest ---


@pytest.mark.django_db
def test_create_game_asset():
    asset = GameAsset.objects.create(
        key="building_barracks",
        name="Barracks",
        category=AssetCategory.BUILDING,
        file=make_fake_file("barracks.png"),
    )
    assert asset.id is not None
    assert asset.key == "building_barracks"
    assert asset.name == "Barracks"


@pytest.mark.django_db
def test_game_asset_str():
    asset = GameAsset.objects.create(
        key="unit_soldier",
        name="Soldier",
        category=AssetCategory.UNIT,
        file=make_fake_file("soldier.png"),
    )
    s = str(asset)
    assert "Soldier" in s
    assert AssetCategory.UNIT in s


@pytest.mark.django_db
def test_game_asset_uuid_pk():
    asset = GameAsset.objects.create(
        key="icon_close",
        name="Close Icon",
        category=AssetCategory.ICON,
        file=make_fake_file("close.png"),
    )
    assert isinstance(asset.id, uuid.UUID)


@pytest.mark.django_db
def test_game_asset_is_active_default_true():
    asset = GameAsset.objects.create(
        key="sfx_click",
        name="Click SFX",
        category=AssetCategory.SOUND,
        file=make_fake_file("click.mp3", b"audiodata"),
    )
    assert asset.is_active is True


@pytest.mark.django_db
def test_game_asset_key_unique():
    GameAsset.objects.create(
        key="unique_key",
        name="Asset 1",
        category=AssetCategory.OTHER,
        file=make_fake_file("a1.png"),
    )
    with pytest.raises(IntegrityError):
        GameAsset.objects.create(
            key="unique_key",
            name="Asset 2",
            category=AssetCategory.OTHER,
            file=make_fake_file("a2.png"),
        )


@pytest.mark.django_db
def test_game_asset_description_blank_default():
    asset = GameAsset.objects.create(
        key="no_desc_asset",
        name="No Desc",
        category=AssetCategory.OTHER,
        file=make_fake_file("nodesc.png"),
    )
    assert asset.description == ""


@pytest.mark.django_db
def test_game_asset_category_default_other():
    asset = GameAsset.objects.create(
        key="default_cat",
        name="Default Category Asset",
        file=make_fake_file("default.png"),
    )
    assert asset.category == AssetCategory.OTHER


@pytest.mark.django_db
def test_game_asset_updated_at_changes_on_save():
    asset = GameAsset.objects.create(
        key="update_test",
        name="Update Test",
        category=AssetCategory.OTHER,
        file=make_fake_file("update.png"),
    )
    original_updated_at = asset.updated_at
    asset.name = "Updated Name"
    asset.save(update_fields=["name"])
    asset.refresh_from_db()
    assert asset.updated_at >= original_updated_at


@pytest.mark.django_db
def test_game_asset_created_at_auto():
    before = timezone.now()
    asset = GameAsset.objects.create(
        key="created_at_test",
        name="Created At Test",
        category=AssetCategory.OTHER,
        file=make_fake_file("cat.png"),
    )
    after = timezone.now()
    assert asset.created_at >= before
    assert asset.created_at <= after


@pytest.mark.django_db
def test_game_asset_all_categories_valid():
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
            key=f"cat_test_{i}",
            name=f"Category Test {i}",
            category=cat,
            file=make_fake_file(f"cat{i}.png"),
        )
        assert asset.category == cat


@pytest.mark.django_db
def test_game_asset_soft_disable():
    asset = GameAsset.objects.create(
        key="disable_test",
        name="Disable Test",
        category=AssetCategory.OTHER,
        file=make_fake_file("disable.png"),
    )
    asset.is_active = False
    asset.save(update_fields=["is_active"])
    asset.refresh_from_db()
    assert asset.is_active is False


@pytest.mark.django_db
def test_game_asset_queryset_filter_active():
    GameAsset.objects.create(
        key="active_asset",
        name="Active",
        category=AssetCategory.OTHER,
        file=make_fake_file("active.png"),
        is_active=True,
    )
    GameAsset.objects.create(
        key="inactive_asset",
        name="Inactive",
        category=AssetCategory.OTHER,
        file=make_fake_file("inactive.png"),
        is_active=False,
    )
    assert GameAsset.objects.filter(is_active=True).count() == 1


# --- AssetAPITest ---


@pytest.mark.django_db
def test_get_asset_overrides_public(client):
    """The asset endpoint requires no authentication."""
    resp = client.get("/api/v1/assets/")
    assert resp.status_code == 200
    data = resp.json()
    assert "assets" in data
    assert isinstance(data["assets"], dict)


@pytest.mark.django_db
def test_get_asset_overrides_contains_active_assets(client):
    GameAsset.objects.create(
        key="test_building_key",
        name="Test Building",
        category=AssetCategory.BUILDING,
        file=make_fake_file("tb.png"),
        is_active=True,
    )
    resp = client.get("/api/v1/assets/")
    assert resp.status_code == 200
    data = resp.json()
    assert "test_building_key" in data["assets"]


@pytest.mark.django_db
def test_get_asset_overrides_excludes_inactive(client):
    GameAsset.objects.create(
        key="inactive_building",
        name="Inactive",
        category=AssetCategory.BUILDING,
        file=make_fake_file("ib.png"),
        is_active=False,
    )
    resp = client.get("/api/v1/assets/")
    assert resp.status_code == 200
    data = resp.json()
    assert "inactive_building" not in data["assets"]


# --- AssetRegistryTest ---


def test_well_known_assets_not_empty():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    assert len(WELL_KNOWN_ASSETS) > 0


def test_well_known_assets_structure():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    for entry in WELL_KNOWN_ASSETS:
        assert len(entry) == 3, f"Expected 3-tuple, got {entry}"
        category, key, description = entry
        assert isinstance(category, str)
        assert isinstance(key, str)
        assert isinstance(description, str)


def test_well_known_assets_no_duplicate_keys():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    keys = [entry[1] for entry in WELL_KNOWN_ASSETS]
    assert len(keys) == len(set(keys)), "Duplicate keys found in WELL_KNOWN_ASSETS"


def test_well_known_assets_contains_expected_buildings():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    building_keys = {key for cat, key, _ in WELL_KNOWN_ASSETS if cat == "building"}
    assert "barracks" in building_keys
    assert "port" in building_keys


def test_well_known_assets_contains_expected_units():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    unit_keys = {key for cat, key, _ in WELL_KNOWN_ASSETS if cat == "unit"}
    assert "ground_unit" in unit_keys


def test_well_known_assets_valid_categories():
    from apps.assets.registry import WELL_KNOWN_ASSETS

    valid_cats = {"building", "unit", "ability", "music", "sound", "icon", "texture", "animation", "other"}
    for cat, key, _ in WELL_KNOWN_ASSETS:
        assert cat in valid_cats, f"Unknown category '{cat}' for key '{key}'"
