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

        self.stdout.write(self.style.SUCCESS("Game config loaded successfully"))

        self.stdout.write("\nFlushing game state from Redis...")
        call_command("flush_game_redis", stdout=self.stdout, stderr=self.stderr)

        if not options["skip_provinces"]:
            self.stdout.write("\nRunning import_provinces --clear ...")
            call_command("import_provinces", clear=True, stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nSeeding economy data (items, recipes)...")
        call_command("seed_economy_data", stdout=self.stdout, stderr=self.stderr)

        self.stdout.write("\nCreating bot users...")
        call_command("create_bots", stdout=self.stdout, stderr=self.stderr)

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
                "starting_currency": 150,
                "base_currency_per_tick": 2.5,
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
                "starting_currency": 180,
                "base_currency_per_tick": 3.0,
                "region_currency_per_tick": 0.4,
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
                "starting_currency": 250,
                "base_currency_per_tick": 5.0,
                "region_currency_per_tick": 0.7,
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
                "starting_currency": 500,
                "starting_units": 20,
                "neutral_region_units": 2,
                "base_unit_generation_rate": 2.0,
                "capital_generation_bonus": 4.0,
                "base_currency_per_tick": 10.0,
                "region_currency_per_tick": 2.0,
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
            "starting_currency": settings.starting_currency,
            "base_currency_per_tick": settings.base_currency_per_tick,
            "region_currency_per_tick": settings.region_currency_per_tick,
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
