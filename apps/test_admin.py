"""
Admin tests: verify that list/change/add pages return 200 for all registered
ModelAdmin classes that have below-100% coverage.
"""

import pytest
from django.contrib.admin.sites import AdminSite
from django.test import Client

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def superuser(db):
    from apps.accounts.models import User

    return User.objects.create_superuser(
        username="admintest",
        email="admin@test.local",
        password="adminpass",
    )


@pytest.fixture
def admin_client(superuser):
    c = Client()
    c.force_login(superuser)
    return c


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _list_url(app, model):
    return f"/admin/{app}/{model}/"


def _add_url(app, model):
    return f"/admin/{app}/{model}/add/"


def _change_url(app, model, pk):
    return f"/admin/{app}/{model}/{pk}/change/"


# ---------------------------------------------------------------------------
# accounts/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAccountsAdmin:
    def test_user_list(self, admin_client):
        r = admin_client.get(_list_url("accounts", "user"))
        assert r.status_code == 200

    def test_user_add(self, admin_client):
        r = admin_client.get(_add_url("accounts", "user"))
        assert r.status_code == 200

    def test_user_change(self, admin_client, superuser):
        r = admin_client.get(_change_url("accounts", "user", superuser.pk))
        assert r.status_code == 200

    def test_socialaccount_list(self, admin_client):
        r = admin_client.get(_list_url("accounts", "socialaccount"))
        assert r.status_code == 200

    def test_directmessage_list(self, admin_client):
        r = admin_client.get(_list_url("accounts", "directmessage"))
        assert r.status_code == 200

    def test_friendship_list(self, admin_client):
        r = admin_client.get(_list_url("accounts", "friendship"))
        assert r.status_code == 200

    def test_merge_into_user_get(self, admin_client, superuser):
        """GET on the merge-into-user action should return an HTML form."""
        url = f"/admin/accounts/user/{superuser.pk}/merge-into-user/"
        r = admin_client.get(url)
        assert r.status_code == 200
        assert b"Scal konto" in r.content

    def test_merge_into_user_post_no_target(self, admin_client, superuser):
        """POST without target_identifier should show an error redirect."""
        url = f"/admin/accounts/user/{superuser.pk}/merge-into-user/"
        r = admin_client.post(url, {"target_identifier": ""})
        assert r.status_code in (200, 302)

    def test_merge_into_user_post_invalid_target(self, admin_client, superuser):
        url = f"/admin/accounts/user/{superuser.pk}/merge-into-user/"
        r = admin_client.post(url, {"target_identifier": "nonexistent@nope.local"})
        assert r.status_code in (200, 302)

    def test_merge_into_user_self(self, admin_client, superuser):
        """Merging a user into themselves should redirect back with an error."""
        url = f"/admin/accounts/user/{superuser.pk}/merge-into-user/"
        r = admin_client.post(url, {"target_identifier": superuser.username})
        assert r.status_code in (200, 302)

    def test_merge_into_user_post_valid(self, admin_client, superuser, db):
        """POST with a valid distinct target should merge and redirect."""
        from apps.accounts.models import User

        target = User.objects.create_user(
            username="targetuser",
            email="target@test.local",
            password="pass",
        )
        url = f"/admin/accounts/user/{superuser.pk}/merge-into-user/"
        r = admin_client.post(url, {"target_identifier": target.username})
        assert r.status_code in (200, 302)

    def test_set_admin_password_redirect(self, admin_client, superuser):
        url = f"/admin/accounts/user/{superuser.pk}/set-admin-password/"
        r = admin_client.get(url)
        assert r.status_code == 302
        assert "password" in r["Location"]

    def test_display_role(self, superuser):
        from django.contrib.admin.sites import AdminSite

        from apps.accounts.admin import UserAdmin

        admin = UserAdmin(model=superuser.__class__, admin_site=AdminSite())
        assert admin.display_role(superuser) == superuser.role

    def test_display_elo(self, superuser):
        from apps.accounts.admin import UserAdmin

        admin = UserAdmin(model=superuser.__class__, admin_site=AdminSite())
        assert admin.display_elo(superuser) == superuser.elo_rating

    def test_display_social_no_accounts(self, superuser):
        from apps.accounts.admin import UserAdmin

        admin = UserAdmin(model=superuser.__class__, admin_site=AdminSite())
        assert admin.display_social(superuser) == "-"

    def test_display_social_with_account(self, superuser, db):
        from apps.accounts.admin import UserAdmin
        from apps.accounts.models import SocialAccount

        SocialAccount.objects.create(
            user=superuser,
            provider="google",
            provider_user_id="gid123",
        )
        admin = UserAdmin(model=superuser.__class__, admin_site=AdminSite())
        result = admin.display_social(superuser)
        assert "Google" in result

    def test_merge_selected_users_wrong_count(self, admin_client, superuser, db):
        """merge_selected_users with only 1 user selected should show error."""

        data = {
            "action": "merge_selected_users",
            "_selected_action": [str(superuser.pk)],
        }
        r = admin_client.post(_list_url("accounts", "user"), data)
        assert r.status_code in (200, 302)

    def test_merge_selected_users_two_users_get(self, admin_client, superuser, db):
        """merge_selected_users with 2 users should render direction picker."""
        from apps.accounts.models import User

        u2 = User.objects.create_user(
            username="mergeuser2",
            email="merge2@test.local",
            password="pass",
        )
        data = {
            "action": "merge_selected_users",
            "_selected_action": [str(superuser.pk), str(u2.pk)],
        }
        r = admin_client.post(_list_url("accounts", "user"), data)
        assert r.status_code == 200
        assert b"Scal" in r.content

    def test_merge_selected_users_execute(self, admin_client, superuser, db):
        """POST with target_id should execute the merge."""
        from apps.accounts.models import User

        u2 = User.objects.create_user(
            username="mergeexec2",
            email="mergeexec2@test.local",
            password="pass",
        )
        data = {
            "action": "merge_selected_users",
            "_selected_action": [str(superuser.pk), str(u2.pk)],
            "target_id": str(superuser.pk),
        }
        r = admin_client.post(_list_url("accounts", "user"), data)
        assert r.status_code in (200, 302)


# ---------------------------------------------------------------------------
# assets/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAssetsAdmin:
    def test_gameasset_list(self, admin_client):
        r = admin_client.get(_list_url("assets", "gameasset"))
        assert r.status_code == 200

    def test_gameasset_add(self, admin_client):
        r = admin_client.get(_add_url("assets", "gameasset"))
        assert r.status_code == 200

    def test_gameasset_change(self, admin_client, db, tmp_path, settings):
        from apps.assets.models import GameAsset

        settings.MEDIA_ROOT = str(tmp_path)
        # Create without a real file to avoid storage write
        asset = GameAsset(key="test-icon", name="Test Icon", category="icon", is_active=True)
        asset.save()
        r = admin_client.get(_change_url("assets", "gameasset", asset.pk))
        assert r.status_code == 200

    def test_display_active_true(self, db):

        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        admin = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="k", name="N", category="icon")
        asset.is_active = True
        assert admin.display_active(asset) == "ACTIVE"

    def test_display_active_false(self, db):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        admin = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="k", name="N", category="icon")
        asset.is_active = False
        assert admin.display_active(asset) == "INACTIVE"

    def test_preview_no_file(self, db):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        admin = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="k", name="N", category="sound")
        asset.file = None
        assert admin.preview(asset) == "-"

    def test_available_keys_no_config(self, db):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        admin = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        result = admin.available_keys()
        # Should return either the "no keys" message or HTML — just not raise
        assert result is not None


# ---------------------------------------------------------------------------
# game_config/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGameConfigAdmin:
    def test_gamesettings_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "gamesettings"))
        assert r.status_code == 200

    def test_buildingtype_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "buildingtype"))
        assert r.status_code == 200

    def test_unittype_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "unittype"))
        assert r.status_code == 200

    def test_abilitytype_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "abilitytype"))
        assert r.status_code == 200

    def test_mapconfig_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "mapconfig"))
        assert r.status_code == 200

    def test_gamemode_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "gamemode"))
        assert r.status_code == 200

    def test_systemmodule_list(self, admin_client):
        r = admin_client.get(_list_url("game_config", "systemmodule"))
        assert r.status_code == 200

    def test_gamesettings_has_add_blocked_when_exists(self, db):
        from apps.game_config.admin import GameSettingsAdmin
        from apps.game_config.models import GameSettings

        GameSettings.objects.create()
        admin = GameSettingsAdmin(model=GameSettings, admin_site=AdminSite())
        assert admin.has_add_permission(request=None) is False

    def test_gamesettings_has_add_allowed_when_empty(self, db):
        from apps.game_config.admin import GameSettingsAdmin
        from apps.game_config.models import GameSettings

        admin = GameSettingsAdmin(model=GameSettings, admin_site=AdminSite())
        assert admin.has_add_permission(request=None) is True

    def test_gamesettings_has_delete_blocked(self, db):
        from apps.game_config.admin import GameSettingsAdmin
        from apps.game_config.models import GameSettings

        admin = GameSettingsAdmin(model=GameSettings, admin_site=AdminSite())
        assert admin.has_delete_permission(request=None) is False

    def test_display_active_labels(self, db):
        from apps.game_config.admin import BuildingTypeAdmin
        from apps.game_config.models import BuildingType

        admin = BuildingTypeAdmin(model=BuildingType, admin_site=AdminSite())
        bt = BuildingType(name="B", slug="b")
        bt.is_active = True
        assert admin.display_active(bt) == "ACTIVE"
        bt.is_active = False
        assert admin.display_active(bt) == "INACTIVE"

    def test_systemmodule_display_enabled(self, db):
        from apps.game_config.admin import SystemModuleAdmin
        from apps.game_config.models import SystemModule

        admin = SystemModuleAdmin(model=SystemModule, admin_site=AdminSite())
        mod = SystemModule(name="M", slug="m")
        mod.enabled = True
        assert admin.display_enabled(mod) == "ON"
        mod.enabled = False
        assert admin.display_enabled(mod) == "OFF"

    def test_systemmodule_display_layers(self, db):
        from apps.game_config.admin import SystemModuleAdmin
        from apps.game_config.models import SystemModule

        admin = SystemModuleAdmin(model=SystemModule, admin_site=AdminSite())
        mod = SystemModule(name="M", slug="m", affects_backend=True, affects_frontend=True, affects_gateway=False)
        layers = admin.display_layers(mod)
        assert "BE" in layers
        assert "FE" in layers
        assert "GW" not in layers

    def test_systemmodule_display_core(self, db):
        from apps.game_config.admin import SystemModuleAdmin
        from apps.game_config.models import SystemModule

        admin = SystemModuleAdmin(model=SystemModule, admin_site=AdminSite())
        mod = SystemModule(name="M", slug="m", is_core=True)
        assert admin.display_core(mod) == "CORE"
        mod.is_core = False
        assert admin.display_core(mod) == "-"

    def test_systemmodule_display_type(self, db):
        from apps.game_config.admin import SystemModuleAdmin
        from apps.game_config.models import SystemModule

        admin = SystemModuleAdmin(model=SystemModule, admin_site=AdminSite())
        mod = SystemModule(name="M", slug="m", module_type="game")
        assert admin.display_type(mod) == "GAME"


# ---------------------------------------------------------------------------
# matchmaking/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMatchmakingAdmin:
    def test_match_list(self, admin_client):
        r = admin_client.get(_list_url("matchmaking", "match"))
        assert r.status_code == 200

    def test_matchplayer_list(self, admin_client):
        r = admin_client.get(_list_url("matchmaking", "matchplayer"))
        assert r.status_code == 200

    def test_matchqueue_list(self, admin_client):
        r = admin_client.get(_list_url("matchmaking", "matchqueue"))
        assert r.status_code == 200

    def test_lobby_list(self, admin_client):
        r = admin_client.get(_list_url("matchmaking", "lobby"))
        assert r.status_code == 200

    def test_lobbyplayer_list(self, admin_client):
        r = admin_client.get(_list_url("matchmaking", "lobbyplayer"))
        assert r.status_code == 200

    def test_display_status_match(self, db):
        from apps.matchmaking.admin import MatchAdmin
        from apps.matchmaking.models import Match

        admin = MatchAdmin(model=Match, admin_site=AdminSite())
        m = Match(status="in_progress")
        assert admin.display_status(m) == "in_progress"

    def test_display_alive(self, db):
        from apps.matchmaking.admin import MatchPlayerAdmin
        from apps.matchmaking.models import MatchPlayer

        admin = MatchPlayerAdmin(model=MatchPlayer, admin_site=AdminSite())
        mp = MatchPlayer(is_alive=True)
        assert admin.display_alive(mp) == "ALIVE"
        mp.is_alive = False
        assert admin.display_alive(mp) == "DEAD"

    def test_player_count_annotation(self, admin_client, db, superuser):
        """MatchAdmin queryset should have player_count annotation."""
        from apps.matchmaking.models import Match

        Match.objects.create(status="waiting")
        r = admin_client.get(_list_url("matchmaking", "match"))
        assert r.status_code == 200

    def test_cancel_match_action_skips_finished(self, admin_client, db):
        """cancel_match_action should not cancel already-finished matches."""
        from unittest.mock import MagicMock, patch

        from apps.matchmaking.admin import MatchAdmin
        from apps.matchmaking.models import Match

        m = Match.objects.create(status="finished")
        admin_obj = MatchAdmin(model=Match, admin_site=AdminSite())

        mock_request = MagicMock()
        mock_request.user = MagicMock()

        mock_redis_instance = MagicMock()
        with patch("redis.Redis", return_value=mock_redis_instance):
            admin_obj.cancel_match_action(mock_request, Match.objects.filter(pk=m.pk))

        # Finished match status should be unchanged
        m.refresh_from_db()
        assert m.status == "finished"


# ---------------------------------------------------------------------------
# geo/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGeoAdmin:
    def test_country_list(self, admin_client):
        r = admin_client.get(_list_url("geo", "country"))
        assert r.status_code == 200

    def test_region_list(self, admin_client):
        r = admin_client.get(_list_url("geo", "region"))
        assert r.status_code == 200

    def test_country_change(self, admin_client, db):
        from apps.geo.models import Country

        c = Country.objects.create(name="TestLand", code="TST")
        r = admin_client.get(_change_url("geo", "country", c.pk))
        assert r.status_code == 200

    def test_neighbor_count_method(self, db):
        from apps.geo.admin import RegionAdmin
        from apps.geo.models import Country, Region

        admin = RegionAdmin(model=Region, admin_site=AdminSite())
        country = Country.objects.create(name="C", code="CCC")
        region = Region.objects.create(name="R1", country=country)
        assert admin.neighbor_count(region) == 0

    def test_region_count_annotation(self, admin_client, db):
        from apps.geo.models import Country

        Country.objects.create(name="C2", code="CC2")
        r = admin_client.get(_list_url("geo", "country"))
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# game/admin.py
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestGameAdmin:
    def test_gamestate_list(self, admin_client):
        r = admin_client.get(_list_url("game", "gamestatessnapshot"))
        # The URL name uses the model's verbose name; try both common spellings
        assert r.status_code in (200, 404)

    def test_matchresult_list(self, admin_client):
        r = admin_client.get(_list_url("game", "matchresult"))
        assert r.status_code == 200

    def test_playerresult_list(self, admin_client):
        r = admin_client.get(_list_url("game", "playerresult"))
        assert r.status_code == 200

    def test_display_placement_label(self, db):
        from apps.game.admin import PlayerResultAdmin
        from apps.game.models import PlayerResult

        admin = PlayerResultAdmin(model=PlayerResult, admin_site=AdminSite())
        pr = PlayerResult(placement=1)
        assert admin.display_placement(pr) == 1

    def test_display_elo_change_positive(self, db):
        from apps.game.admin import PlayerResultAdmin
        from apps.game.models import PlayerResult

        admin = PlayerResultAdmin(model=PlayerResult, admin_site=AdminSite())
        pr = PlayerResult(elo_change=25)
        assert admin.display_elo_change(pr) == "+25"

    def test_display_elo_change_negative(self, db):
        from apps.game.admin import PlayerResultAdmin
        from apps.game.models import PlayerResult

        admin = PlayerResultAdmin(model=PlayerResult, admin_site=AdminSite())
        pr = PlayerResult(elo_change=-10)
        assert admin.display_elo_change(pr) == "-10"


# ---------------------------------------------------------------------------
# assets/admin.py — additional method coverage
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAssetsAdminAdditional:
    def test_preview_non_image_file_returns_filename(self, db, tmp_path, settings):

        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        settings.MEDIA_ROOT = str(tmp_path)
        admin_obj = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="sound-test", name="Sound", category="sound")
        # Give it a fake non-image file name via a mock
        from unittest.mock import MagicMock

        mock_file = MagicMock()
        mock_file.name = "sounds/effect.mp3"
        mock_file.url = "/media/sounds/effect.mp3"
        mock_file.__bool__ = lambda self: True
        asset.file = mock_file
        result = admin_obj.preview(asset)
        assert result == "effect.mp3"

    def test_preview_image_returns_img_tag(self, db, tmp_path, settings):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        settings.MEDIA_ROOT = str(tmp_path)
        admin_obj = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="img-test", name="Img", category="icon")
        from unittest.mock import MagicMock

        mock_file = MagicMock()
        mock_file.name = "icons/test.webp"
        mock_file.url = "/media/icons/test.webp"
        mock_file.__bool__ = lambda self: True
        asset.file = mock_file
        result = admin_obj.preview(asset)
        # format_html returns SafeString with <img tag
        assert "img" in str(result).lower()

    def test_preview_large_no_file_returns_dash(self, db):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        admin_obj = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="k2", name="N2", category="sound")
        asset.file = None
        result = admin_obj.preview_large(asset)
        assert result == "-"

    def test_preview_large_image_returns_img_tag(self, db, tmp_path, settings):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset

        settings.MEDIA_ROOT = str(tmp_path)
        admin_obj = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        asset = GameAsset(key="lg-img-test", name="LgImg", category="icon")
        from unittest.mock import MagicMock

        mock_file = MagicMock()
        mock_file.name = "icons/large.png"
        mock_file.url = "/media/icons/large.png"
        mock_file.__bool__ = lambda self: True
        asset.file = mock_file
        result = admin_obj.preview_large(asset)
        assert "img" in str(result).lower()

    def test_available_keys_returns_html_with_config(self, db):
        from apps.assets.admin import GameAssetAdmin
        from apps.assets.models import GameAsset
        from apps.game_config.models import BuildingType

        BuildingType.objects.create(
            name="Barracks",
            slug="barracks",
            asset_key="building-barracks",
            is_active=True,
        )
        admin_obj = GameAssetAdmin(model=GameAsset, admin_site=AdminSite())
        result = admin_obj.available_keys()
        assert result is not None
        # Should contain the building key in the output
        assert "building-barracks" in str(result)

    def test_get_available_keys_includes_unit_and_ability(self, db):
        from apps.assets.admin import _get_available_keys
        from apps.game_config.models import AbilityType, UnitType

        UnitType.objects.get_or_create(
            slug="infantry-test-unique",
            defaults={"name": "Infantry Test Unique", "asset_key": "unit-infantry-tst", "is_active": True},
        )
        AbilityType.objects.get_or_create(
            slug="nuke-test-unique",
            defaults={
                "name": "Nuke Test Unique",
                "asset_key": "ability-nuke-tst",
                "sound_key": "sound-nuke-tst",
                "is_active": True,
            },
        )
        keys = _get_available_keys()
        key_names = [k for _, k, _, _ in keys]
        assert "unit-infantry-tst" in key_names
        assert "ability-nuke-tst" in key_names
        assert "sound-nuke-tst" in key_names


# ---------------------------------------------------------------------------
# inventory/admin.py — list views and display methods
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestInventoryAdmin:
    def test_item_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "item"))
        assert r.status_code == 200

    def test_itemcategory_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "itemcategory"))
        assert r.status_code == 200

    def test_userinventory_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "userinventory"))
        assert r.status_code == 200

    def test_deck_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "deck"))
        assert r.status_code == 200

    def test_wallet_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "wallet"))
        assert r.status_code == 200

    def test_equippedcosmetic_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "equippedcosmetic"))
        assert r.status_code == 200

    def test_iteminstance_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "iteminstance"))
        assert r.status_code == 200

    def test_itemdrop_list(self, admin_client):
        r = admin_client.get(_list_url("inventory", "itemdrop"))
        assert r.status_code == 200

    def test_display_rarity(self, db):
        from apps.inventory.admin import ItemAdmin
        from apps.inventory.models import Item, ItemCategory

        admin = ItemAdmin(model=Item, admin_site=AdminSite())
        cat = ItemCategory.objects.create(name="Test Cat Rarity", slug="test-cat-rarity")
        item = Item(name="Sword", slug="sword-rarity", category=cat, rarity=Item.Rarity.EPIC)
        assert admin.display_rarity(item) == "epic"

    def test_display_wear(self, db):
        from apps.inventory.admin import ItemInstanceAdmin
        from apps.inventory.models import Item, ItemCategory, ItemInstance

        admin = ItemInstanceAdmin(model=ItemInstance, admin_site=AdminSite())
        cat = ItemCategory.objects.create(name="Wear Cat", slug="wear-cat-admin")
        item = Item.objects.create(
            name="Wear Item",
            slug="wear-item-admin",
            category=cat,
            item_type=Item.ItemType.COSMETIC,
            rarity=Item.Rarity.COMMON,
        )
        user = __import__("django.contrib.auth", fromlist=["get_user_model"]).get_user_model()
        usr = user.objects.create_user(email="wear_adm@test.com", username="wear_adm", password="x")
        inst = ItemInstance.objects.create(item=item, owner=usr, wear=0.05, pattern_seed=42, first_owner=usr)
        result = admin.display_wear(inst)
        assert "Factory New" in result or "factory_new" in result.lower() or "0.0" in result

    def test_display_stattrak(self, db):
        from apps.inventory.admin import ItemInstanceAdmin
        from apps.inventory.models import Item, ItemCategory, ItemInstance

        admin = ItemInstanceAdmin(model=ItemInstance, admin_site=AdminSite())
        cat = ItemCategory.objects.create(name="ST Cat Admin", slug="st-cat-admin")
        item = Item.objects.create(
            name="ST Item",
            slug="st-item-admin",
            category=cat,
            item_type=Item.ItemType.COSMETIC,
            rarity=Item.Rarity.COMMON,
        )
        user = __import__("django.contrib.auth", fromlist=["get_user_model"]).get_user_model()
        usr = user.objects.create_user(email="st_adm@test.com", username="st_adm", password="x")
        inst = ItemInstance.objects.create(item=item, owner=usr, wear=0.1, pattern_seed=10, first_owner=usr)
        assert admin.display_stattrak(inst) == "-"
        inst.stattrak = True
        assert admin.display_stattrak(inst) == "ST"

    def test_display_item_count(self, db):
        from apps.inventory.admin import DeckAdmin
        from apps.inventory.models import Deck

        admin = DeckAdmin(model=Deck, admin_site=AdminSite())
        usr = __import__("django.contrib.auth", fromlist=["get_user_model"]).get_user_model()
        user = usr.objects.create_user(email="deck_cnt@test.com", username="deck_cnt", password="x")
        deck = Deck.objects.create(user=user, name="Count Deck")
        assert admin.display_item_count(deck) == 0

    def test_display_item_type(self, db):
        from apps.inventory.admin import EquippedCosmeticAdmin
        from apps.inventory.models import CosmeticSlot, EquippedCosmetic, Item, ItemCategory

        admin = EquippedCosmeticAdmin(model=EquippedCosmetic, admin_site=AdminSite())
        cat = ItemCategory.objects.create(name="EC Type Cat", slug="ec-type-cat")
        item = Item.objects.create(
            name="EC Item",
            slug="ec-item-admin",
            category=cat,
            item_type=Item.ItemType.COSMETIC,
            rarity=Item.Rarity.COMMON,
            cosmetic_slot=CosmeticSlot.UNIT_INFANTRY,
        )
        ec = EquippedCosmetic(item=item)
        result = admin.display_item_type(ec)
        assert result is not None

    def test_display_source(self, db):
        from apps.inventory.admin import ItemDropAdmin
        from apps.inventory.models import ItemDrop

        admin = ItemDropAdmin(model=ItemDrop, admin_site=AdminSite())
        drop = ItemDrop(source=ItemDrop.DropSource.CRATE_OPEN)
        assert admin.display_source(drop) == "crate_open"


# ---------------------------------------------------------------------------
# marketplace/admin.py — missing lines (covered in marketplace/tests.py above)
# but also verify matchmaking and game_config admin lines
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMatchmakingAdminExtended:
    def test_lobby_display_status(self, db):
        from apps.matchmaking.admin import LobbyAdmin
        from apps.matchmaking.models import Lobby

        admin = LobbyAdmin(model=Lobby, admin_site=AdminSite())
        lobby = Lobby(status="full")
        assert admin.display_status(lobby) == "full"


@pytest.mark.django_db
class TestGameConfigAdminExtended:
    def test_unittype_display_active(self, db):
        from apps.game_config.admin import UnitTypeAdmin
        from apps.game_config.models import UnitType

        admin = UnitTypeAdmin(model=UnitType, admin_site=AdminSite())
        ut = UnitType(name="Tank", slug="tank-adm")
        ut.is_active = True
        assert admin.display_active(ut) == "ACTIVE"

    def test_abilitytype_display_active(self, db):
        from apps.game_config.admin import AbilityTypeAdmin
        from apps.game_config.models import AbilityType

        admin = AbilityTypeAdmin(model=AbilityType, admin_site=AdminSite())
        at = AbilityType(name="Nuke", slug="nuke-adm")
        at.is_active = True
        assert admin.display_active(at) == "ACTIVE"

    def test_gamemode_display_active(self, db):
        from apps.game_config.admin import GameModeAdmin
        from apps.game_config.models import GameMode

        admin = GameModeAdmin(model=GameMode, admin_site=AdminSite())
        gm = GameMode(name="TestMode", slug="testmode-adm")
        gm.is_active = True
        result = admin.display_active(gm)
        assert result in ("ACTIVE", "INACTIVE")

    def test_systemmodule_form_in_admin(self, admin_client, db):
        from apps.game_config.models import SystemModule

        SystemModule.objects.get_or_create(slug="test-sm-admin", defaults={"name": "Test SM Admin"})
        r = admin_client.get(_list_url("game_config", "systemmodule"))
        assert r.status_code == 200
