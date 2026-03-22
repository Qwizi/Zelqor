import json
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.game_config.models import AbilityType, BuildingType, GameMode, GameSettings, MapConfig, UnitType
from apps.matchmaking.models import Match


DEFAULT_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent.parent
    / "fixtures"
    / "game_config.json"
)


class Command(BaseCommand):
    help = "Cleanly reload game config from fixture, then re-import provinces"

    def add_arguments(self, parser):
        parser.add_argument(
            "--fixture",
            type=str,
            default=str(DEFAULT_FIXTURE_PATH),
            help=f"Path to fixture JSON (default: {DEFAULT_FIXTURE_PATH})",
        )
        parser.add_argument(
            "--skip-provinces",
            action="store_true",
            help="Skip running import_provinces after loading config",
        )
        parser.add_argument(
            "--dev",
            action="store_true",
            help="Dev mode: all costs=1, build/prod time=1 tick, cooldowns=2 ticks, high energy",
        )
        parser.add_argument(
            "--merge",
            action="store_true",
            help="Merge mode: upsert by slug, preserve customised values, don't delete extras",
        )

    def handle(self, *args, **options):
        fixture_path = Path(options["fixture"])
        if not fixture_path.exists():
            raise CommandError(f"Fixture not found: {fixture_path}")

        with fixture_path.open() as fixture_file:
            payload = json.load(fixture_file)

        settings_entry = None
        building_entries = []
        unit_entries = []
        map_entries = []
        game_mode_entries = []
        ability_entries = []

        for entry in payload:
            model = entry.get("model")
            if model == "game_config.gamesettings":
                settings_entry = entry
            elif model == "game_config.buildingtype":
                building_entries.append(entry)
            elif model == "game_config.unittype":
                unit_entries.append(entry)
            elif model == "game_config.mapconfig":
                map_entries.append(entry)
            elif model == "game_config.gamemode":
                game_mode_entries.append(entry)
            elif model == "game_config.abilitytype":
                ability_entries.append(entry)

        if not settings_entry:
            raise CommandError("Fixture does not contain game_config.gamesettings")

        merge = options["merge"]

        if merge:
            self.stdout.write("Merge mode: upserting config (preserving custom values)...")
            self._merge_settings(settings_entry)
            building_map = self._merge_buildings(building_entries)
            self._merge_units(unit_entries, building_entries, building_map)
            self._merge_abilities(ability_entries)
            self._merge_maps(map_entries)
            self._merge_game_modes(game_mode_entries)
        else:
            self.stdout.write("Clearing existing game config...")
            Match.objects.update(map_config=None, game_mode=None)
            GameMode.objects.all().delete()
            AbilityType.objects.all().delete()
            UnitType.objects.all().delete()
            BuildingType.objects.all().delete()
            MapConfig.objects.all().delete()
            GameSettings.objects.all().delete()
            self.stdout.write("  Cleared.")

            self._load_settings(settings_entry)
            building_map = self._load_buildings(building_entries)
            self._load_units(unit_entries, building_entries, building_map)
            self._load_abilities(ability_entries)
            self._load_maps(map_entries)
            self._load_game_modes(game_mode_entries)

        if options["dev"]:
            self._apply_dev_overrides()

        self.stdout.write(self.style.SUCCESS("Game config loaded successfully"))

        self.stdout.write("\nFlushing game state from Redis...")
        call_command("flush_game_redis", stdout=self.stdout, stderr=self.stderr)

        if not options["skip_provinces"]:
            self.stdout.write("\nRunning import_provinces --clear ...")
            call_command("import_provinces_v2", clear=True, stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nSeeding economy data (items, recipes)...")
        call_command("seed_economy_data", stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nCreating bot users...")
        call_command("create_bots", stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nSeeding bot marketplace listings...")
        call_command("seed_bot_marketplace", stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nCleaning up duplicate decks...")
        call_command("cleanup_duplicate_decks", stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nProvisioning default items for all players...")
        call_command("provision_player_defaults", stdout=self.stdout, stderr=self.stderr)

    def _load_settings(self, entry: dict):
        fields = dict(entry.get("fields") or {})
        GameSettings.objects.create(**fields)
        self.stdout.write("  GameSettings: created")

    def _load_buildings(self, entries: list[dict]) -> dict[str, BuildingType]:
        building_map: dict[str, BuildingType] = {}

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            instance = BuildingType.objects.create(**fields)
            building_map[str(entry.get("pk"))] = instance

        self.stdout.write(f"  BuildingType: {len(building_map)} created")
        return building_map

    def _load_units(
        self,
        entries: list[dict],
        building_entries: list[dict],
        building_map: dict[str, BuildingType],
    ):
        building_pk_to_slug = {
            str(entry.get("pk")): (entry.get("fields") or {}).get("slug")
            for entry in building_entries
        }
        count = 0

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            produced_by_pk = fields.pop("produced_by", None)
            produced_by_slug = building_pk_to_slug.get(str(produced_by_pk)) if produced_by_pk else None
            fields["produced_by"] = (
                BuildingType.objects.filter(slug=produced_by_slug).first()
                if produced_by_slug
                else None
            )
            UnitType.objects.create(**fields)
            count += 1

        self.stdout.write(f"  UnitType: {count} created")

    def _load_abilities(self, entries: list[dict]):
        count = 0

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            AbilityType.objects.create(**fields)
            count += 1

        self.stdout.write(f"  AbilityType: {count} created")

    def _load_maps(self, entries: list[dict]):
        count = 0

        for entry in entries:
            fields = {k: v for k, v in (entry.get("fields") or {}).items() if k != "created_at"}
            MapConfig.objects.create(**fields)
            count += 1

        self.stdout.write(f"  MapConfig: {count} created")

    def _load_game_modes(self, entries: list[dict]):
        if entries:
            count = 0
            for entry in entries:
                fields = {k: v for k, v in (entry.get("fields") or {}).items() if k != "created_at"}
                map_config_name = fields.pop("map_config", None)
                if map_config_name:
                    fields["map_config"] = MapConfig.objects.filter(name=map_config_name).first()
                GameMode.objects.create(**fields)
                count += 1
            self.stdout.write(f"  GameMode: {count} created")
            return

        # No game modes in fixture — create defaults
        settings = GameSettings.objects.first()
        if not settings:
            return

        map_config = MapConfig.objects.filter(is_active=True).first()
        defaults = [
            {
                "name": "Standard 1v1",
                "slug": "standard-1v1",
                "description": "Klasyczny mecz 1 na 1. Szybki i intensywny.",
                "max_players": 2,
                "min_players": 2,
                "is_default": True,
                "order": 1,
            },
            {
                "name": "Standard 3P",
                "slug": "standard-3p",
                "description": "Mecz na 3 graczy. Dyplomacja i sojusze.",
                "max_players": 3,
                "min_players": 3,
                "starting_energy": 150,
                "base_energy_per_tick": 2.5,
                "neutral_region_units": 4,
                "match_duration_limit_minutes": 45,
                "elo_k_factor": 28,
                "order": 2,
            },
            {
                "name": "Standard 4P",
                "slug": "standard-4p",
                "description": "Mecz na 4 graczy. Wielkie bitwy na duzej mapie.",
                "max_players": 4,
                "min_players": 4,
                "capital_selection_time_seconds": 45,
                "starting_energy": 180,
                "base_energy_per_tick": 3.0,
                "region_energy_per_tick": 0.4,
                "starting_units": 12,
                "neutral_region_units": 5,
                "match_duration_limit_minutes": 60,
                "elo_k_factor": 24,
                "order": 3,
            },
            {
                "name": "Blitz 1v1",
                "slug": "blitz-1v1",
                "description": "Szybki mecz 1v1. Wiecej zasobow, krotszy czas.",
                "max_players": 2,
                "min_players": 2,
                "tick_interval_ms": 800,
                "capital_selection_time_seconds": 20,
                "match_duration_limit_minutes": 15,
                "base_unit_generation_rate": 2.0,
                "capital_generation_bonus": 3.0,
                "starting_energy": 250,
                "base_energy_per_tick": 5.0,
                "region_energy_per_tick": 0.7,
                "attacker_advantage": 0.1,
                "defender_advantage": 0.05,
                "combat_randomness": 0.25,
                "starting_units": 20,
                "neutral_region_units": 2,
                "elo_k_factor": 24,
                "order": 4,
            },
            {
                "name": "Custom",
                "slug": "custom",
                "description": "Tryb niestandardowy do dostosowania w panelu admina.",
                "max_players": 4,
                "min_players": 2,
                "elo_k_factor": 16,
                "order": 10,
            },
            {
                "name": "Samouczek",
                "slug": "tutorial",
                "description": "Samouczek dla nowych graczy. 1v1 ze slabym botem.",
                "max_players": 2,
                "min_players": 2,
                "is_active": False,
                "is_default": False,
                "tick_interval_ms": 1000,
                "capital_selection_time_seconds": 60,
                "match_duration_limit_minutes": 30,
                "starting_energy": 500,
                "starting_units": 20,
                "neutral_region_units": 2,
                "base_unit_generation_rate": 2.0,
                "capital_generation_bonus": 4.0,
                "base_energy_per_tick": 10.0,
                "region_energy_per_tick": 2.0,
                "combat_randomness": 0.1,
                "elo_k_factor": 0,
                "order": 99,
            },
        ]

        # Base values from GameSettings for fields not overridden
        base = {
            "tick_interval_ms": settings.tick_interval_ms,
            "capital_selection_time_seconds": settings.capital_selection_time_seconds,
            "match_duration_limit_minutes": settings.match_duration_limit_minutes,
            "base_unit_generation_rate": settings.base_unit_generation_rate,
            "capital_generation_bonus": settings.capital_generation_bonus,
            "starting_energy": settings.starting_energy,
            "base_energy_per_tick": settings.base_energy_per_tick,
            "region_energy_per_tick": settings.region_energy_per_tick,
            "attacker_advantage": settings.attacker_advantage,
            "defender_advantage": settings.defender_advantage,
            "combat_randomness": settings.combat_randomness,
            "starting_units": settings.starting_units,
            "starting_regions": settings.starting_regions,
            "neutral_region_units": settings.neutral_region_units,
            "elo_k_factor": settings.elo_k_factor,
        }

        count = 0
        for mode_data in defaults:
            fields = {**base, **mode_data, "map_config": map_config}
            GameMode.objects.create(**fields)
            count += 1

        self.stdout.write(f"  GameMode: {count} created (defaults from GameSettings)")

    def _apply_dev_overrides(self):
        """Apply dev-friendly overrides: cheap costs, fast timers, high energy."""
        self.stdout.write("\n  Applying --dev overrides...")

        # GameSettings: high energy, fast generation
        settings = GameSettings.objects.first()
        if settings:
            settings.starting_energy = 9999
            settings.base_energy_per_tick = 50.0
            settings.region_energy_per_tick = 5.0
            settings.base_unit_generation_rate = 1.5
            settings.capital_generation_bonus = 3.0
            settings.capital_selection_time_seconds = 10
            settings.save()
            self.stdout.write("    GameSettings: high energy, normal unit gen")

        # Buildings: patch level_stats — cost=1, energy_cost=1, build_time=1 tick for all levels
        bt_updated = 0
        for bt in BuildingType.objects.filter(is_active=True):
            level_stats = bt.level_stats or {}
            for level_data in level_stats.values():
                level_data['cost'] = 1
                level_data['energy_cost'] = 1
                level_data['build_time_ticks'] = 1
            bt.level_stats = level_stats
            bt.save(update_fields=['level_stats'])
            bt_updated += 1
        self.stdout.write(f"    BuildingType: {bt_updated} updated (level_stats cost=1, energy=1, build=1 tick)")

        # Units: patch level_stats — production_cost=1, production_time=1 for all levels.
        # manpower_cost preserved from fixture (defines unit strength, not just cost).
        ut_updated = 0
        for ut in UnitType.objects.filter(is_active=True):
            level_stats = ut.level_stats or {}
            for level_data in level_stats.values():
                level_data['production_cost'] = 1
                level_data['production_time_ticks'] = 1
                # Don't override manpower_cost — it defines unit strength/force.
            ut.level_stats = level_stats
            ut.save(update_fields=['level_stats'])
            ut_updated += 1
        self.stdout.write(f"    UnitType: {ut_updated} updated (level_stats cost=1, time=1, manpower preserved)")

        # Abilities: patch base fields (energy_cost, cooldown_ticks) AND level_stats
        at_updated = 0
        for at in AbilityType.objects.filter(is_active=True):
            level_stats = at.level_stats or {}
            for level_data in level_stats.values():
                level_data['energy_cost'] = 1
                level_data['cooldown_ticks'] = 2
            at.level_stats = level_stats
            at.energy_cost = 1
            at.cooldown_ticks = 2
            at.save(update_fields=['level_stats', 'energy_cost', 'cooldown_ticks'])
            at_updated += 1
        self.stdout.write(f"    AbilityType: {at_updated} updated (cost=1, cooldown=2)")

        # GameModes: apply same high energy/fast gen
        updated = GameMode.objects.all().update(
            starting_energy=9999,
            base_energy_per_tick=50.0,
            region_energy_per_tick=5.0,
            base_unit_generation_rate=1.5,
            capital_generation_bonus=3.0,
            capital_selection_time_seconds=10,
        )
        self.stdout.write(f"    GameMode: {updated} updated (dev settings)")

        self.stdout.write(self.style.WARNING("  DEV MODE ACTIVE — all costs minimal!"))

    # ── Merge helpers (--merge mode) ──────────────────────────────────────

    def _merge_settings(self, entry: dict):
        """Upsert GameSettings: create if missing, add new fields only."""
        fields = dict(entry.get("fields") or {})
        existing = GameSettings.objects.first()
        if not existing:
            GameSettings.objects.create(**fields)
            self.stdout.write("  GameSettings: created (new)")
            return
        # Only set fields that don't exist on the model yet (new columns with defaults)
        updated = []
        for key, value in fields.items():
            if not hasattr(existing, key):
                continue
            # Check if the field is at its model default — if so, update it
            field_obj = existing._meta.get_field(key)
            model_default = field_obj.default if hasattr(field_obj, 'default') else None
            current_value = getattr(existing, key)
            if current_value == model_default and value != model_default:
                setattr(existing, key, value)
                updated.append(key)
        if updated:
            existing.save(update_fields=updated)
        self.stdout.write(f"  GameSettings: merged ({len(updated)} new defaults applied)")

    def _merge_buildings(self, entries: list[dict]) -> dict[str, "BuildingType"]:
        """Upsert BuildingType by slug: create missing, preserve existing."""
        building_map: dict[str, BuildingType] = {}
        created = updated = 0
        for entry in entries:
            fields = dict(entry.get("fields") or {})
            slug = fields.get("slug")
            if not slug:
                continue
            obj, was_created = BuildingType.objects.get_or_create(slug=slug, defaults=fields)
            building_map[str(entry.get("pk"))] = obj
            if was_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(f"  BuildingType: {created} created, {updated} preserved")
        return building_map

    def _merge_units(self, entries: list[dict], building_entries: list[dict], building_map: dict[str, "BuildingType"]):
        """Upsert UnitType by slug: create missing, preserve existing."""
        building_pk_to_slug = {
            str(entry.get("pk")): (entry.get("fields") or {}).get("slug")
            for entry in building_entries
        }
        created = preserved = 0
        for entry in entries:
            fields = dict(entry.get("fields") or {})
            slug = fields.get("slug")
            if not slug:
                continue
            produced_by_pk = fields.pop("produced_by", None)
            produced_by_slug = building_pk_to_slug.get(str(produced_by_pk)) if produced_by_pk else None
            fields["produced_by"] = (
                BuildingType.objects.filter(slug=produced_by_slug).first()
                if produced_by_slug
                else None
            )
            _, was_created = UnitType.objects.get_or_create(slug=slug, defaults=fields)
            if was_created:
                created += 1
            else:
                preserved += 1
        self.stdout.write(f"  UnitType: {created} created, {preserved} preserved")

    def _merge_abilities(self, entries: list[dict]):
        """Upsert AbilityType by slug: create missing, preserve existing."""
        created = preserved = 0
        for entry in entries:
            fields = dict(entry.get("fields") or {})
            slug = fields.get("slug")
            if not slug:
                continue
            _, was_created = AbilityType.objects.get_or_create(slug=slug, defaults=fields)
            if was_created:
                created += 1
            else:
                preserved += 1
        self.stdout.write(f"  AbilityType: {created} created, {preserved} preserved")

    def _merge_maps(self, entries: list[dict]):
        """Upsert MapConfig by name: create missing, preserve existing."""
        created = preserved = 0
        for entry in entries:
            fields = {k: v for k, v in (entry.get("fields") or {}).items() if k != "created_at"}
            name = fields.get("name")
            if not name:
                continue
            _, was_created = MapConfig.objects.get_or_create(name=name, defaults=fields)
            if was_created:
                created += 1
            else:
                preserved += 1
        self.stdout.write(f"  MapConfig: {created} created, {preserved} preserved")

    def _merge_game_modes(self, entries: list[dict]):
        """Upsert GameMode by slug: create missing, preserve customised existing ones.

        For existing modes: only fill in fields that are at their model default
        (i.e. new columns added by migrations). Custom values are never overwritten.
        Modes not in fixture are kept (custom production modes).
        """
        if entries:
            created = merged = preserved = 0
            for entry in entries:
                fields = {k: v for k, v in (entry.get("fields") or {}).items() if k != "created_at"}
                slug = fields.pop("slug", None)
                if not slug:
                    continue
                map_config_name = fields.pop("map_config", None)
                if map_config_name:
                    fields["map_config"] = MapConfig.objects.filter(name=map_config_name).first()
                existing = GameMode.objects.filter(slug=slug).first()
                if existing:
                    # Only update fields that are still at their model default
                    new_fields = self._get_new_default_fields(existing, fields)
                    if new_fields:
                        for k, v in new_fields.items():
                            setattr(existing, k, v)
                        existing.save(update_fields=list(new_fields.keys()))
                        merged += 1
                    else:
                        preserved += 1
                else:
                    GameMode.objects.create(slug=slug, **fields)
                    created += 1
            self.stdout.write(f"  GameMode: {created} created, {merged} merged, {preserved} preserved")
            return

        # No game modes in fixture — create defaults for any missing slugs
        settings = GameSettings.objects.first()
        if not settings:
            return

        map_config = MapConfig.objects.filter(is_active=True).first()
        defaults = [
            {
                "name": "Standard 1v1",
                "slug": "standard-1v1",
                "description": "Klasyczny mecz 1 na 1. Szybki i intensywny.",
                "max_players": 2,
                "min_players": 2,
                "is_default": True,
                "order": 1,
            },
            {
                "name": "Standard 3P",
                "slug": "standard-3p",
                "description": "Mecz na 3 graczy. Dyplomacja i sojusze.",
                "max_players": 3,
                "min_players": 3,
                "starting_energy": 150,
                "base_energy_per_tick": 2.5,
                "neutral_region_units": 4,
                "match_duration_limit_minutes": 45,
                "elo_k_factor": 28,
                "order": 2,
            },
            {
                "name": "Standard 4P",
                "slug": "standard-4p",
                "description": "Mecz na 4 graczy. Wielkie bitwy na duzej mapie.",
                "max_players": 4,
                "min_players": 4,
                "capital_selection_time_seconds": 45,
                "starting_energy": 180,
                "base_energy_per_tick": 3.0,
                "region_energy_per_tick": 0.4,
                "starting_units": 12,
                "neutral_region_units": 5,
                "match_duration_limit_minutes": 60,
                "elo_k_factor": 24,
                "order": 3,
            },
            {
                "name": "Blitz 1v1",
                "slug": "blitz-1v1",
                "description": "Szybki mecz 1v1. Wiecej zasobow, krotszy czas.",
                "max_players": 2,
                "min_players": 2,
                "tick_interval_ms": 800,
                "capital_selection_time_seconds": 20,
                "match_duration_limit_minutes": 15,
                "base_unit_generation_rate": 2.0,
                "capital_generation_bonus": 3.0,
                "starting_energy": 250,
                "base_energy_per_tick": 5.0,
                "region_energy_per_tick": 0.7,
                "attacker_advantage": 0.1,
                "defender_advantage": 0.05,
                "combat_randomness": 0.25,
                "starting_units": 20,
                "neutral_region_units": 2,
                "elo_k_factor": 24,
                "order": 4,
            },
            {
                "name": "Custom",
                "slug": "custom",
                "description": "Tryb niestandardowy do dostosowania w panelu admina.",
                "max_players": 4,
                "min_players": 2,
                "elo_k_factor": 16,
                "order": 10,
            },
            {
                "name": "Samouczek",
                "slug": "tutorial",
                "description": "Samouczek dla nowych graczy. 1v1 ze slabym botem.",
                "max_players": 2,
                "min_players": 2,
                "is_active": False,
                "is_default": False,
                "tick_interval_ms": 1000,
                "capital_selection_time_seconds": 60,
                "match_duration_limit_minutes": 30,
                "starting_energy": 500,
                "starting_units": 20,
                "neutral_region_units": 2,
                "base_unit_generation_rate": 2.0,
                "capital_generation_bonus": 4.0,
                "base_energy_per_tick": 10.0,
                "region_energy_per_tick": 2.0,
                "combat_randomness": 0.1,
                "elo_k_factor": 0,
                "order": 99,
            },
        ]

        base = {
            "tick_interval_ms": settings.tick_interval_ms,
            "capital_selection_time_seconds": settings.capital_selection_time_seconds,
            "match_duration_limit_minutes": settings.match_duration_limit_minutes,
            "base_unit_generation_rate": settings.base_unit_generation_rate,
            "capital_generation_bonus": settings.capital_generation_bonus,
            "starting_energy": settings.starting_energy,
            "base_energy_per_tick": settings.base_energy_per_tick,
            "region_energy_per_tick": settings.region_energy_per_tick,
            "attacker_advantage": settings.attacker_advantage,
            "defender_advantage": settings.defender_advantage,
            "combat_randomness": settings.combat_randomness,
            "starting_units": settings.starting_units,
            "starting_regions": settings.starting_regions,
            "neutral_region_units": settings.neutral_region_units,
            "elo_k_factor": settings.elo_k_factor,
        }

        created = preserved = 0
        for mode_data in defaults:
            slug = mode_data.get("slug")
            if GameMode.objects.filter(slug=slug).exists():
                preserved += 1
                continue
            fields = {**base, **mode_data, "map_config": map_config}
            GameMode.objects.create(**fields)
            created += 1

        self.stdout.write(f"  GameMode: {created} created, {preserved} preserved (merge defaults)")

    @staticmethod
    def _get_new_default_fields(instance, fixture_fields: dict) -> dict:
        """Return fields from fixture that are still at their model default on the instance.

        This detects new columns added by migrations — their value equals the Django
        field default, so it's safe to fill them with the fixture value.
        """
        result = {}
        for key, fixture_value in fixture_fields.items():
            if not hasattr(instance, key):
                continue
            try:
                field_obj = instance._meta.get_field(key)
            except Exception:
                continue
            model_default = getattr(field_obj, 'default', None)
            if model_default is None:
                continue
            # callable defaults (e.g. dict) — call to compare
            if callable(model_default):
                model_default = model_default()
            current_value = getattr(instance, key)
            # Only update if current == model default AND fixture has a different value
            if current_value == model_default and fixture_value != model_default:
                result[key] = fixture_value
        return result
