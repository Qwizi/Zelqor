"""
Tests for apps/game_config — GameSettings singleton, BuildingType, UnitType.
"""

from django.test import TestCase

from apps.game_config.models import BuildingType, GameSettings, MovementType, UnitType

# ---------------------------------------------------------------------------
# GameSettings singleton
# ---------------------------------------------------------------------------


class GameSettingsTests(TestCase):
    """Tests for the GameSettings singleton model."""

    def test_get_creates_instance_on_first_call(self):
        self.assertEqual(GameSettings.objects.count(), 0)
        obj = GameSettings.get()
        self.assertIsNotNone(obj)
        self.assertEqual(GameSettings.objects.count(), 1)

    def test_get_returns_same_instance_on_subsequent_calls(self):
        first = GameSettings.get()
        second = GameSettings.get()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(GameSettings.objects.count(), 1)

    def test_default_elo_k_factor(self):
        obj = GameSettings.get()
        self.assertEqual(obj.elo_k_factor, 32)

    def test_default_max_players(self):
        obj = GameSettings.get()
        self.assertEqual(obj.max_players, 2)

    def test_default_tick_interval_ms(self):
        obj = GameSettings.get()
        self.assertEqual(obj.tick_interval_ms, 1000)

    def test_multiple_raw_saves_allowed(self):
        """GameSettings uses UUID PK — raw save() doesn't enforce singleton.
        The practical enforcement is via GameSettings.get() always returning first()."""
        GameSettings.get()  # create first
        second = GameSettings(elo_k_factor=64)
        second.save()
        self.assertEqual(GameSettings.objects.count(), 2)

    def test_str_representation(self):
        obj = GameSettings.get()
        self.assertEqual(str(obj), "Game Settings")

    def test_update_existing_instance_allowed(self):
        obj = GameSettings.get()
        obj.elo_k_factor = 48
        obj.save()  # should not raise
        obj.refresh_from_db()
        self.assertEqual(obj.elo_k_factor, 48)

    def test_capital_selection_default(self):
        obj = GameSettings.get()
        self.assertEqual(obj.capital_selection_time_seconds, 30)


# ---------------------------------------------------------------------------
# BuildingType model
# ---------------------------------------------------------------------------


class BuildingTypeTests(TestCase):
    """Tests for the BuildingType model."""

    def setUp(self):
        self.building = BuildingType.objects.create(
            name="Barracks",
            slug="barracks",
            cost=50,
            energy_cost=30,
            build_time_ticks=10,
            defense_bonus=0.1,
            max_level=3,
        )

    def test_creation_and_attribute_access(self):
        self.assertEqual(self.building.name, "Barracks")
        self.assertEqual(self.building.slug, "barracks")
        self.assertEqual(self.building.cost, 50)
        self.assertEqual(self.building.defense_bonus, 0.1)

    def test_str_representation(self):
        self.assertEqual(str(self.building), "Barracks")

    def test_level_stats_jsonfield_default_is_empty_dict(self):
        self.assertEqual(self.building.level_stats, {})

    def test_level_stats_can_store_per_level_data(self):
        self.building.level_stats = {
            "1": {"defense_bonus": 0.1},
            "2": {"defense_bonus": 0.2},
            "3": {"defense_bonus": 0.3},
        }
        self.building.save()
        self.building.refresh_from_db()
        self.assertEqual(self.building.level_stats["2"]["defense_bonus"], 0.2)

    def test_is_active_default_true(self):
        self.assertTrue(self.building.is_active)

    def test_requires_coastal_default_false(self):
        self.assertFalse(self.building.requires_coastal)

    def test_unique_slug_constraint(self):
        from django.db import IntegrityError

        with self.assertRaises(IntegrityError):
            BuildingType.objects.create(
                name="Barracks Duplicate",
                slug="barracks",  # same slug
            )

    def test_ordering_by_order_then_name(self):
        BuildingType.objects.all().delete()  # clear any fixtures
        BuildingType.objects.create(name="Alpha", slug="alpha", order=1)
        BuildingType.objects.create(name="Zeta", slug="zeta", order=0)
        buildings = list(BuildingType.objects.all())
        # Zeta has order=0, should come before Alpha (order=1)
        self.assertEqual(buildings[0].slug, "zeta")


# ---------------------------------------------------------------------------
# UnitType model
# ---------------------------------------------------------------------------


class UnitTypeTests(TestCase):
    """Tests for the UnitType model."""

    def setUp(self):
        self.unit = UnitType.objects.create(
            name="Infantry",
            slug="infantry",
            attack=1.0,
            defense=1.0,
            speed=1,
            production_cost=5,
            production_time_ticks=5,
            movement_type=MovementType.LAND,
        )

    def test_creation_and_attributes(self):
        self.assertEqual(self.unit.name, "Infantry")
        self.assertEqual(self.unit.attack, 1.0)
        self.assertEqual(self.unit.defense, 1.0)
        self.assertEqual(self.unit.movement_type, MovementType.LAND)

    def test_str_representation_includes_movement_type(self):
        self.assertIn("Infantry", str(self.unit))
        self.assertIn("Land", str(self.unit))

    def test_level_stats_default_empty_dict(self):
        self.assertEqual(self.unit.level_stats, {})

    def test_level_stats_can_be_set(self):
        self.unit.level_stats = {"1": {"attack": 2.0}, "2": {"attack": 3.0}}
        self.unit.save()
        self.unit.refresh_from_db()
        self.assertEqual(self.unit.level_stats["1"]["attack"], 2.0)

    def test_produced_by_slug_none_when_no_building(self):
        self.assertIsNone(self.unit.produced_by_slug)

    def test_produced_by_slug_when_building_set(self):
        building = BuildingType.objects.create(name="Factory", slug="factory")
        self.unit.produced_by = building
        self.unit.save()
        self.assertEqual(self.unit.produced_by_slug, "factory")

    def test_sea_unit_type(self):
        sea_unit = UnitType.objects.create(
            name="Battleship",
            slug="battleship",
            movement_type=MovementType.SEA,
        )
        self.assertEqual(sea_unit.movement_type, MovementType.SEA)
        self.assertIn("Sea", str(sea_unit))
