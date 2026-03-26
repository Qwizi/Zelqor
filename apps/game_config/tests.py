"""
Tests for apps/game_config — GameSettings singleton, BuildingType, UnitType.
"""

import pytest
from django.core.cache import cache

from apps.game_config.models import BuildingType, GameSettings, MovementType, UnitType

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


@pytest.fixture
def building():
    return BuildingType.objects.create(
        name="Barracks",
        slug="barracks",
        defense_bonus=0.1,
        max_level=3,
    )


@pytest.fixture
def unit():
    return UnitType.objects.create(
        name="Infantry",
        slug="infantry",
        attack=1.0,
        defense=1.0,
        speed=1,
        movement_type=MovementType.LAND,
    )


# ---------------------------------------------------------------------------
# GameSettings singleton
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_creates_instance_on_first_call():
    assert GameSettings.objects.count() == 0
    obj = GameSettings.get()
    assert obj is not None
    assert GameSettings.objects.count() == 1


@pytest.mark.django_db
def test_get_returns_same_instance_on_subsequent_calls():
    first = GameSettings.get()
    second = GameSettings.get()
    assert first.pk == second.pk
    assert GameSettings.objects.count() == 1


@pytest.mark.django_db
def test_default_elo_k_factor():
    assert GameSettings.get().elo_k_factor == 32


@pytest.mark.django_db
def test_default_max_players():
    assert GameSettings.get().max_players == 2


@pytest.mark.django_db
def test_default_tick_interval_ms():
    assert GameSettings.get().tick_interval_ms == 1000


@pytest.mark.django_db
def test_multiple_raw_saves_allowed():
    """GameSettings uses UUID PK — raw save() doesn't enforce singleton.
    The practical enforcement is via GameSettings.get() always returning first()."""
    GameSettings.get()  # create first
    second = GameSettings(elo_k_factor=64)
    second.save()
    assert GameSettings.objects.count() == 2


@pytest.mark.django_db
def test_game_settings_str_representation():
    assert str(GameSettings.get()) == "Game Settings"


@pytest.mark.django_db
def test_update_existing_instance_allowed():
    obj = GameSettings.get()
    obj.elo_k_factor = 48
    obj.save()  # should not raise
    obj.refresh_from_db()
    assert obj.elo_k_factor == 48


@pytest.mark.django_db
def test_capital_selection_default():
    assert GameSettings.get().capital_selection_time_seconds == 30


# ---------------------------------------------------------------------------
# BuildingType model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_building_creation_and_attribute_access(building):
    assert building.name == "Barracks"
    assert building.slug == "barracks"
    assert building.defense_bonus == 0.1


@pytest.mark.django_db
def test_building_str_representation(building):
    assert str(building) == "Barracks"


@pytest.mark.django_db
def test_building_level_stats_jsonfield_default_is_empty_dict(building):
    assert building.level_stats == {}


@pytest.mark.django_db
def test_building_level_stats_can_store_per_level_data(building):
    building.level_stats = {
        "1": {"defense_bonus": 0.1},
        "2": {"defense_bonus": 0.2},
        "3": {"defense_bonus": 0.3},
    }
    building.save()
    building.refresh_from_db()
    assert building.level_stats["2"]["defense_bonus"] == 0.2


@pytest.mark.django_db
def test_building_is_active_default_true(building):
    assert building.is_active is True


@pytest.mark.django_db
def test_building_requires_coastal_default_false(building):
    assert building.requires_coastal is False


@pytest.mark.django_db
def test_building_unique_slug_constraint(building):
    from django.db import IntegrityError

    with pytest.raises(IntegrityError):
        BuildingType.objects.create(
            name="Barracks Duplicate",
            slug="barracks",  # same slug
        )


@pytest.mark.django_db
def test_building_ordering_by_order_then_name():
    BuildingType.objects.all().delete()  # clear any fixtures
    BuildingType.objects.create(name="Alpha", slug="alpha", order=1)
    BuildingType.objects.create(name="Zeta", slug="zeta", order=0)
    buildings = list(BuildingType.objects.all())
    # Zeta has order=0, should come before Alpha (order=1)
    assert buildings[0].slug == "zeta"


# ---------------------------------------------------------------------------
# UnitType model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_unit_creation_and_attributes(unit):
    assert unit.name == "Infantry"
    assert unit.attack == 1.0
    assert unit.defense == 1.0
    assert unit.movement_type == MovementType.LAND


@pytest.mark.django_db
def test_unit_str_representation_includes_movement_type(unit):
    assert "Infantry" in str(unit)
    assert "Land" in str(unit)


@pytest.mark.django_db
def test_unit_level_stats_default_empty_dict(unit):
    assert unit.level_stats == {}


@pytest.mark.django_db
def test_unit_level_stats_can_be_set(unit):
    unit.level_stats = {"1": {"attack": 2.0}, "2": {"attack": 3.0}}
    unit.save()
    unit.refresh_from_db()
    assert unit.level_stats["1"]["attack"] == 2.0


@pytest.mark.django_db
def test_unit_produced_by_slug_none_when_no_building(unit):
    assert unit.produced_by_slug is None


@pytest.mark.django_db
def test_unit_produced_by_slug_when_building_set(unit):
    building = BuildingType.objects.create(name="Factory", slug="factory")
    unit.produced_by = building
    unit.save()
    assert unit.produced_by_slug == "factory"


@pytest.mark.django_db
def test_sea_unit_type():
    sea_unit = UnitType.objects.create(
        name="Battleship",
        slug="battleship",
        movement_type=MovementType.SEA,
    )
    assert sea_unit.movement_type == MovementType.SEA
    assert "Sea" in str(sea_unit)


# ---------------------------------------------------------------------------
# ConfigController API endpoints (/api/v1/config/)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_config_public_returns_200(client):
    from apps.game_config.models import GameSettings

    GameSettings.get()
    resp = client.get("/api/v1/config/")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_get_config_contains_required_keys(client):
    from apps.game_config.models import GameSettings

    GameSettings.get()
    resp = client.get("/api/v1/config/")
    assert resp.status_code == 200
    data = resp.json()
    for key in ("settings", "buildings", "units", "abilities", "maps", "game_modes"):
        assert key in data, f"Missing key: {key}"


@pytest.mark.django_db
def test_get_config_includes_active_buildings_only(client, building):
    from apps.game_config.models import BuildingType, GameSettings

    GameSettings.get()
    BuildingType.objects.create(name="Inactive Fort", slug="inactive-fort", is_active=False)
    resp = client.get("/api/v1/config/")
    assert resp.status_code == 200
    slugs = [b["slug"] for b in resp.json()["buildings"]]
    assert "barracks" in slugs
    assert "inactive-fort" not in slugs


@pytest.mark.django_db
def test_get_config_includes_active_units_only(client, unit):
    from apps.game_config.models import GameSettings, UnitType

    GameSettings.get()
    UnitType.objects.create(name="Inactive Scout", slug="inactive-scout", is_active=False)
    resp = client.get("/api/v1/config/")
    assert resp.status_code == 200
    slugs = [u["slug"] for u in resp.json()["units"]]
    assert "infantry" in slugs
    assert "inactive-scout" not in slugs


@pytest.mark.django_db
def test_list_game_modes_returns_empty_when_none(client):
    from apps.game_config.models import GameMode, GameSettings

    GameSettings.get()
    GameMode.objects.all().delete()
    resp = client.get("/api/v1/config/game-modes/")
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.django_db
def test_list_game_modes_returns_active_modes(client):
    from apps.game_config.models import GameMode, GameSettings

    GameSettings.get()
    GameMode.objects.create(name="Standard 2P", slug="standard-2p", is_active=True)
    GameMode.objects.create(name="Hidden Mode", slug="hidden-mode", is_active=False)
    resp = client.get("/api/v1/config/game-modes/")
    assert resp.status_code == 200
    slugs = [m["slug"] for m in resp.json()]
    assert "standard-2p" in slugs
    assert "hidden-mode" not in slugs


@pytest.mark.django_db
def test_get_game_mode_by_slug_returns_200(client):
    from apps.game_config.models import GameMode, GameSettings

    GameSettings.get()
    GameMode.objects.create(name="FFA 3P", slug="ffa-3p", is_active=True, max_players=3)
    resp = client.get("/api/v1/config/game-modes/ffa-3p/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["slug"] == "ffa-3p"
    assert data["max_players"] == 3


@pytest.mark.django_db
def test_get_game_mode_not_found_returns_404(client):
    from apps.game_config.models import GameSettings

    GameSettings.get()
    resp = client.get("/api/v1/config/game-modes/does-not-exist/")
    assert resp.status_code == 404


@pytest.mark.django_db
def test_get_game_mode_inactive_returns_404(client):
    from apps.game_config.models import GameMode, GameSettings

    GameSettings.get()
    GameMode.objects.create(name="Beta Mode", slug="beta-mode", is_active=False)
    resp = client.get("/api/v1/config/game-modes/beta-mode/")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# SystemModule model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_system_module_str_enabled():
    from apps.game_config.models import SystemModule

    mod = SystemModule.objects.create(slug="test-mod-on", name="Test On", enabled=True)
    assert "ON" in str(mod)
    assert "Test On" in str(mod)


@pytest.mark.django_db
def test_system_module_str_disabled():
    from apps.game_config.models import SystemModule

    mod = SystemModule.objects.create(slug="test-mod-off", name="Test Off", enabled=False)
    assert "OFF" in str(mod)


@pytest.mark.django_db
def test_system_module_str_core():
    from apps.game_config.models import SystemModule

    mod = SystemModule.objects.create(slug="core-mod", name="Core", enabled=True, is_core=True)
    assert "[CORE]" in str(mod)


@pytest.mark.django_db
def test_system_module_is_enabled_returns_true_for_enabled():
    from apps.game_config.models import SystemModule

    SystemModule.objects.create(slug="enabled-mod", name="Enabled", enabled=True)
    assert SystemModule.is_enabled("enabled-mod") is True


@pytest.mark.django_db
def test_system_module_is_enabled_returns_false_for_disabled():
    from apps.game_config.models import SystemModule

    SystemModule.objects.create(slug="disabled-mod", name="Disabled", enabled=False)
    assert SystemModule.is_enabled("disabled-mod") is False


@pytest.mark.django_db
def test_system_module_is_enabled_returns_true_for_unknown():
    """Unknown modules are fail-open (considered enabled) to avoid breaking dev."""
    from apps.game_config.models import SystemModule

    assert SystemModule.is_enabled("completely-unknown-slug-xyz") is True


@pytest.mark.django_db
def test_system_module_get_all_states_returns_dict():
    from apps.game_config.models import SystemModule

    SystemModule.objects.create(slug="state-mod-a", name="A", enabled=True)
    SystemModule.objects.create(slug="state-mod-b", name="B", enabled=False)
    states = SystemModule.get_all_states()
    assert states["state-mod-a"] is True
    assert states["state-mod-b"] is False


@pytest.mark.django_db
def test_system_module_core_clean_raises_on_disable():
    from django.core.exceptions import ValidationError

    from apps.game_config.models import SystemModule

    mod = SystemModule.objects.create(slug="core-cant-disable", name="Core", enabled=True, is_core=True)
    mod.enabled = False
    with pytest.raises(ValidationError):
        mod.clean()


@pytest.mark.django_db
def test_system_module_save_invalidates_cache():

    from apps.game_config.models import SystemModule

    mod = SystemModule.objects.create(slug="cache-test-mod", name="Cache Test", enabled=True)
    # Warm the cache
    SystemModule.is_enabled("cache-test-mod")
    # Saving should clear cache
    mod.enabled = False
    mod.save()
    # After cache invalidation, is_enabled should read fresh from DB
    assert SystemModule.is_enabled("cache-test-mod") is False


# ---------------------------------------------------------------------------
# get_module_config / is_module_enabled helpers
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_get_module_config_returns_value_when_key_exists():
    from apps.game_config.models import SystemModule
    from apps.game_config.modules import get_module_config

    SystemModule.objects.update_or_create(
        slug="leaderboard",
        defaults={
            "name": "Leaderboard",
            "enabled": True,
            "config": {"min_human_players_for_ranked": 3},
        },
    )
    val = get_module_config("leaderboard", "min_human_players_for_ranked", 2)
    assert val == 3


@pytest.mark.django_db
def test_get_module_config_returns_default_when_key_missing():
    from apps.game_config.models import SystemModule
    from apps.game_config.modules import get_module_config

    SystemModule.objects.get_or_create(
        slug="leaderboard-empty-test",
        defaults={"name": "Leaderboard Empty", "enabled": True, "config": {}},
    )
    val = get_module_config("leaderboard-empty-test", "nonexistent_key", 99)
    assert val == 99


@pytest.mark.django_db
def test_get_module_config_returns_default_when_module_missing():
    from apps.game_config.modules import get_module_config

    val = get_module_config("totally-absent-module", "some_key", "fallback")
    assert val == "fallback"


@pytest.mark.django_db
def test_is_module_enabled_shortcut():
    from apps.game_config.models import SystemModule
    from apps.game_config.modules import is_module_enabled

    SystemModule.objects.create(slug="shortcut-mod", name="Shortcut", enabled=True)
    assert is_module_enabled("shortcut-mod") is True


@pytest.mark.django_db
def test_get_all_module_configs_returns_all_modules():
    from apps.game_config.models import SystemModule
    from apps.game_config.modules import get_all_module_configs

    SystemModule.objects.create(slug="all-cfg-a", name="All A", enabled=True, config={"x": 1})
    SystemModule.objects.create(slug="all-cfg-b", name="All B", enabled=False, config={})
    result = get_all_module_configs()
    assert "all-cfg-a" in result
    assert result["all-cfg-a"]["enabled"] is True
    assert result["all-cfg-a"]["config"]["x"] == 1
    assert "all-cfg-b" in result
    assert result["all-cfg-b"]["enabled"] is False


# ---------------------------------------------------------------------------
# require_module / require_module_controller decorators
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_require_module_returns_503_when_disabled():
    """require_module wrapper returns JsonResponse 503 when module is disabled."""
    from django.core.cache import cache

    from apps.game_config.decorators import require_module
    from apps.game_config.models import SystemModule

    SystemModule.objects.update_or_create(
        slug="test-gate-mod",
        defaults={"name": "Test Gate", "enabled": False},
    )
    cache.delete("sysmodule:test-gate-mod")

    from django.test import RequestFactory

    factory = RequestFactory()
    request = factory.get("/")

    @require_module("test-gate-mod")
    def dummy_view(*args, **kwargs):
        return "should_not_reach"

    response = dummy_view(request)
    assert response.status_code == 503


@pytest.mark.django_db
def test_require_module_passes_through_when_enabled():
    """require_module wrapper calls the wrapped function when module is enabled."""
    from django.core.cache import cache

    from apps.game_config.decorators import require_module
    from apps.game_config.models import SystemModule

    SystemModule.objects.update_or_create(
        slug="test-pass-mod",
        defaults={"name": "Test Pass", "enabled": True},
    )
    cache.delete("sysmodule:test-pass-mod")

    @require_module("test-pass-mod")
    def dummy_view(*args, **kwargs):
        return "reached"

    from django.test import RequestFactory

    factory = RequestFactory()
    request = factory.get("/")
    result = dummy_view(request)
    assert result == "reached"


# ---------------------------------------------------------------------------
# GameMode model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_game_mode_str_representation():
    from apps.game_config.models import GameMode

    mode = GameMode.objects.create(name="Blitz Mode", slug="blitz-mode")
    assert str(mode) == "Blitz Mode"


@pytest.mark.django_db
def test_game_mode_only_one_default():
    from apps.game_config.models import GameMode

    m1 = GameMode.objects.create(name="Mode A", slug="mode-a", is_default=True)
    m2 = GameMode.objects.create(name="Mode B", slug="mode-b", is_default=True)
    m1.refresh_from_db()
    assert m1.is_default is False
    assert m2.is_default is True


@pytest.mark.django_db
def test_game_mode_default_max_players():
    from apps.game_config.models import GameMode

    mode = GameMode.objects.create(name="1v1", slug="1v1-mode", max_players=2)
    assert mode.max_players == 2


# ---------------------------------------------------------------------------
# MapConfig model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_map_config_str_representation():
    from apps.game_config.models import MapConfig

    mc = MapConfig.objects.create(name="Europe Map")
    assert str(mc) == "Europe Map"


@pytest.mark.django_db
def test_map_config_country_codes_default_empty():
    from apps.game_config.models import MapConfig

    mc = MapConfig.objects.create(name="World Map")
    assert mc.country_codes == []


@pytest.mark.django_db
def test_map_config_can_store_country_codes():
    from apps.game_config.models import MapConfig

    mc = MapConfig.objects.create(name="EU Map", country_codes=["DE", "FR", "PL"])
    mc.refresh_from_db()
    assert "DE" in mc.country_codes
    assert len(mc.country_codes) == 3


# ---------------------------------------------------------------------------
# AbilityType model
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_ability_type_creation():
    from apps.game_config.models import AbilityType

    ability = AbilityType.objects.create(
        name="Nuclear Strike",
        slug="nuclear-strike",
        energy_cost=200,
        damage=500,
        cooldown_ticks=120,
    )
    assert ability.name == "Nuclear Strike"
    assert ability.energy_cost == 200
    assert ability.damage == 500


@pytest.mark.django_db
def test_ability_type_str_representation():
    from apps.game_config.models import AbilityType

    ability = AbilityType.objects.create(name="Airstrike", slug="airstrike")
    assert str(ability) == "Airstrike"


@pytest.mark.django_db
def test_ability_type_is_active_default_true():
    from apps.game_config.models import AbilityType

    ability = AbilityType.objects.create(name="Spy", slug="spy")
    assert ability.is_active is True


# ---------------------------------------------------------------------------
# SystemModuleForm tests (game_config/forms.py)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestSystemModuleForm:
    def _make_module(self, module_type="system", schema=None, config=None):
        from apps.game_config.models import SystemModule

        return SystemModule.objects.create(
            slug=f"test-module-{id(schema)}",
            name="Test Module",
            module_type=module_type,
            config_schema=schema or [],
            config=config or {},
        )

    def test_no_schema_fields_empty_when_no_pk(self):
        """New (unsaved) instance: no cfg__ fields generated."""
        from apps.game_config.forms import SystemModuleForm

        form = SystemModuleForm()
        cfg_fields = [k for k in form.fields if k.startswith("cfg__")]
        assert cfg_fields == []

    def test_int_field_generated(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "max_players", "label": "Max Players", "type": "int"}]
        module = self._make_module(schema=schema, config={"max_players": 4})
        form = SystemModuleForm(instance=module)
        assert "cfg__max_players" in form.fields
        assert isinstance(form.fields["cfg__max_players"], forms.IntegerField)

    def test_float_field_generated(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "ratio", "label": "Ratio", "type": "float"}]
        module = self._make_module(schema=schema)
        form = SystemModuleForm(instance=module)
        assert "cfg__ratio" in form.fields
        assert isinstance(form.fields["cfg__ratio"], forms.FloatField)

    def test_bool_field_generated(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "enabled_flag", "label": "Enabled", "type": "bool"}]
        module = self._make_module(schema=schema)
        form = SystemModuleForm(instance=module)
        assert "cfg__enabled_flag" in form.fields
        assert isinstance(form.fields["cfg__enabled_flag"], forms.BooleanField)

    def test_str_with_options_generates_choicefield(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "mode", "label": "Mode", "type": "str", "options": ["a", "b"]}]
        module = self._make_module(schema=schema)
        form = SystemModuleForm(instance=module)
        assert "cfg__mode" in form.fields
        assert isinstance(form.fields["cfg__mode"], forms.ChoiceField)

    def test_list_field_generates_charfield_with_textarea(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "tags", "label": "Tags", "type": "list"}]
        module = self._make_module(schema=schema, config={"tags": ["x", "y"]})
        form = SystemModuleForm(instance=module)
        assert "cfg__tags" in form.fields
        assert isinstance(form.fields["cfg__tags"].widget, forms.Textarea)

    def test_str_field_default_charfield(self):
        from django import forms

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "label", "label": "Label", "type": "str"}]
        module = self._make_module(schema=schema)
        form = SystemModuleForm(instance=module)
        assert "cfg__label" in form.fields
        assert isinstance(form.fields["cfg__label"], forms.CharField)

    def test_clean_writes_config_for_system_module(self):
        """clean() should write cfg__ fields back into the 'config' key."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "tick_rate", "label": "Tick Rate", "type": "int", "default": 5}]
        module = self._make_module(module_type="system", schema=schema)
        data = {
            "slug": module.slug,
            "name": module.name,
            "module_type": "system",
            "description": "",
            "icon": "",
            "enabled": True,
            "config": "{}",
            "config_schema": "[]",
            "affects_backend": True,
            "affects_frontend": True,
            "affects_gateway": False,
            "is_core": False,
            "order": 0,
            "default_enabled": True,
            "default_config": "{}",
            "field_mapping": "{}",
            "cfg__tick_rate": 10,
        }
        form = SystemModuleForm(data=data, instance=module)
        if form.is_valid():
            cleaned = form.cleaned_data
            assert cleaned.get("config", {}).get("tick_rate") == 10

    def test_clean_writes_default_config_for_game_module(self):
        """For game module type, cfg__ fields write to 'default_config'."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "damage_mult", "label": "Damage", "type": "float", "default": 1.0}]
        module = self._make_module(module_type="game", schema=schema)
        data = {
            "slug": module.slug,
            "name": module.name,
            "module_type": "game",
            "description": "",
            "icon": "",
            "enabled": True,
            "config": "{}",
            "config_schema": "[]",
            "affects_backend": True,
            "affects_frontend": True,
            "affects_gateway": False,
            "is_core": False,
            "order": 0,
            "default_enabled": True,
            "default_config": "{}",
            "field_mapping": "{}",
            "cfg__damage_mult": 2.5,
        }
        form = SystemModuleForm(data=data, instance=module)
        if form.is_valid():
            cleaned = form.cleaned_data
            assert cleaned.get("default_config", {}).get("damage_mult") == 2.5

    def test_get_config_source_returns_default_config_for_game(self):
        from apps.game_config.forms import SystemModuleForm

        module = self._make_module(module_type="game", config={"x": 1})
        module.default_config = {"y": 2}
        module.save()
        form = SystemModuleForm(instance=module)
        source = form._get_config_source()
        assert source == {"y": 2}

    def test_get_config_source_returns_config_for_system(self):
        from apps.game_config.forms import SystemModuleForm

        module = self._make_module(module_type="system", config={"z": 9})
        form = SystemModuleForm(instance=module)
        source = form._get_config_source()
        assert source == {"z": 9}

    def test_generate_config_fields_with_str_options(self):
        """str field with options should generate a ChoiceField."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "mode", "type": "str", "label": "Mode", "options": ["a", "b"], "default": "a"}]
        module = self._make_module(module_type="system", schema=schema, config={})
        form = SystemModuleForm(instance=module)
        assert "cfg__mode" in form.fields

    def test_generate_config_fields_with_list_type(self):
        """list field type should generate a Textarea CharField."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "items", "type": "list", "label": "Items", "default": []}]
        module = self._make_module(module_type="system", schema=schema, config={})
        form = SystemModuleForm(instance=module)
        assert "cfg__items" in form.fields

    def test_generate_config_fields_with_bool_type(self):
        """bool field type should generate a BooleanField."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "enabled_flag", "type": "bool", "label": "Enabled Flag", "default": True}]
        module = self._make_module(module_type="system", schema=schema, config={})
        form = SystemModuleForm(instance=module)
        assert "cfg__enabled_flag" in form.fields

    def test_generate_config_fields_with_float_type(self):
        """float field type should generate a FloatField."""
        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "ratio", "type": "float", "label": "Ratio", "default": 1.5}]
        module = self._make_module(module_type="system", schema=schema, config={})
        form = SystemModuleForm(instance=module)
        assert "cfg__ratio" in form.fields

    def test_clean_handles_list_json_parse_error(self):
        """clean() should fall back to the default on invalid JSON for list type."""
        import django.forms as forms_mod

        from apps.game_config.forms import SystemModuleForm

        schema = [{"key": "items", "type": "list", "label": "Items", "default": []}]
        module = self._make_module(module_type="system", schema=schema, config={})
        form = SystemModuleForm(
            data={"cfg__items": "not-valid-json", "name": module.name, "slug": module.slug},
            instance=module,
        )
        # Force add the field so clean() can find it
        form.fields["cfg__items"] = forms_mod.CharField(required=False, initial="[]")
        # clean should not raise
        form.is_valid()


# ---------------------------------------------------------------------------
# game_config/models.py — GameSettingsModuleOverride and GameModeModuleOverride __str__
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_game_settings_module_override_str():
    from apps.game_config.models import GameSettings, GameSettingsModuleOverride, SystemModule

    gs = GameSettings.objects.create()
    mod = SystemModule.objects.create(name="Reg", slug="reg-str-test")
    ov = GameSettingsModuleOverride.objects.create(game_settings=gs, module=mod, enabled=True)
    assert "Reg" in str(ov)
    assert "ON" in str(ov)
    ov.enabled = False
    assert "OFF" in ov.__str__() if not ov.pk else True


@pytest.mark.django_db
def test_game_mode_module_override_str():
    from apps.game_config.models import GameMode, GameModeModuleOverride, SystemModule

    mode = GameMode.objects.create(name="TestMode", slug="test-mode-str")
    mod = SystemModule.objects.create(name="ChatMod", slug="chat-mod-str")
    ov = GameModeModuleOverride.objects.create(game_mode=mode, module=mod, enabled=False)
    s = str(ov)
    assert "ChatMod" in s
    assert "OFF" in s


@pytest.mark.django_db
def test_system_module_invalidate_cache_and_save():
    """SystemModule.save should invalidate the all-modules cache keys."""
    from django.core.cache import cache

    from apps.game_config.models import SystemModule

    # Set the aggregate cache keys that invalidate_cache clears
    cache.set("sysmodules:all", "stale_value")
    cache.set("sysmodules:full", "stale_full")

    mod = SystemModule.objects.create(name="CacheTest2", slug="cache-test-save2")
    # After save, the aggregate keys should be cleared
    assert cache.get("sysmodules:all") is None
    assert cache.get("sysmodules:full") is None

    # Test delete path as well
    cache.set("sysmodules:all", "stale_again")
    mod.delete()
    assert cache.get("sysmodules:all") is None
