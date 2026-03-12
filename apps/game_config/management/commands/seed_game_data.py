from django.core.management.base import BaseCommand

from apps.game_config.models import BuildingType, GameMode, GameSettings, UnitType


GAME_MODES = [
    {
        "name": "Standard 1v1",
        "slug": "standard-1v1",
        "description": "Klasyczny mecz 1 na 1. Szybki i intensywny.",
        "max_players": 2,
        "min_players": 2,
        "tick_interval_ms": 1000,
        "capital_selection_time_seconds": 30,
        "match_duration_limit_minutes": 30,
        "base_unit_generation_rate": 1.0,
        "capital_generation_bonus": 2.0,
        "starting_currency": 120,
        "base_currency_per_tick": 2.0,
        "region_currency_per_tick": 0.35,
        "attacker_advantage": 0.0,
        "defender_advantage": 0.1,
        "combat_randomness": 0.2,
        "starting_units": 10,
        "starting_regions": 1,
        "neutral_region_units": 3,
        "elo_k_factor": 32,
        "is_active": True,
        "is_default": True,
        "order": 1,
    },
    {
        "name": "Standard 3 Players",
        "slug": "standard-3p",
        "description": "Mecz na 3 graczy. Dyplomacja i sojusze.",
        "max_players": 3,
        "min_players": 3,
        "tick_interval_ms": 1000,
        "capital_selection_time_seconds": 30,
        "match_duration_limit_minutes": 45,
        "base_unit_generation_rate": 1.0,
        "capital_generation_bonus": 2.0,
        "starting_currency": 150,
        "base_currency_per_tick": 2.5,
        "region_currency_per_tick": 0.35,
        "attacker_advantage": 0.0,
        "defender_advantage": 0.1,
        "combat_randomness": 0.2,
        "starting_units": 10,
        "starting_regions": 1,
        "neutral_region_units": 4,
        "elo_k_factor": 28,
        "is_active": True,
        "is_default": False,
        "order": 2,
    },
    {
        "name": "Standard 4 Players",
        "slug": "standard-4p",
        "description": "Mecz na 4 graczy. Wielkie bitwy na duzej mapie.",
        "max_players": 4,
        "min_players": 4,
        "tick_interval_ms": 1000,
        "capital_selection_time_seconds": 45,
        "match_duration_limit_minutes": 60,
        "base_unit_generation_rate": 1.0,
        "capital_generation_bonus": 2.0,
        "starting_currency": 180,
        "base_currency_per_tick": 3.0,
        "region_currency_per_tick": 0.4,
        "attacker_advantage": 0.0,
        "defender_advantage": 0.1,
        "combat_randomness": 0.2,
        "starting_units": 12,
        "starting_regions": 1,
        "neutral_region_units": 5,
        "elo_k_factor": 24,
        "is_active": True,
        "is_default": False,
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
        "starting_regions": 1,
        "neutral_region_units": 2,
        "elo_k_factor": 24,
        "is_active": True,
        "is_default": False,
        "order": 4,
    },
    {
        "name": "Custom",
        "slug": "custom",
        "description": "Tryb niestandardowy. Mozna dostosowac ustawienia w panelu admina.",
        "max_players": 4,
        "min_players": 2,
        "tick_interval_ms": 1000,
        "capital_selection_time_seconds": 30,
        "match_duration_limit_minutes": 60,
        "base_unit_generation_rate": 1.0,
        "capital_generation_bonus": 2.0,
        "starting_currency": 120,
        "base_currency_per_tick": 2.0,
        "region_currency_per_tick": 0.35,
        "attacker_advantage": 0.0,
        "defender_advantage": 0.1,
        "combat_randomness": 0.2,
        "starting_units": 10,
        "starting_regions": 1,
        "neutral_region_units": 3,
        "elo_k_factor": 16,
        "is_active": True,
        "is_default": False,
        "order": 10,
    },
]


BUILDINGS = [
    {
        "name": "Barracks",
        "slug": "barracks",
        "asset_key": "military_base",
        "description": "Accelerates infantry growth in the region.",
        "icon": "🏠",
        "cost": 30,
        "currency_cost": 40,
        "build_time_ticks": 8,
        "max_per_region": 1,
        "requires_coastal": False,
        "defense_bonus": 0.0,
        "vision_range": 0,
        "unit_generation_bonus": 0.9,
        "currency_generation_bonus": 0.0,
        "order": 1,
    },
    {
        "name": "Factory",
        "slug": "factory",
        "asset_key": "ironworks",
        "description": "Industrial complex required to produce tanks.",
        "icon": "🏭",
        "cost": 60,
        "currency_cost": 70,
        "build_time_ticks": 15,
        "max_per_region": 3,
        "requires_coastal": False,
        "defense_bonus": 0.0,
        "vision_range": 0,
        "unit_generation_bonus": 0.0,
        "currency_generation_bonus": 0.0,
        "order": 2,
    },
    {
        "name": "Tower",
        "slug": "tower",
        "asset_key": "ratusz",
        "description": "Defensive structure. Grants defense bonus to the region.",
        "icon": "🗼",
        "cost": 40,
        "currency_cost": 45,
        "build_time_ticks": 10,
        "max_per_region": 3,
        "requires_coastal": False,
        "defense_bonus": 0.22,
        "vision_range": 2,
        "unit_generation_bonus": 0.0,
        "currency_generation_bonus": 0.0,
        "order": 3,
    },
    {
        "name": "Port",
        "slug": "port",
        "asset_key": "navy_port",
        "description": "Coastal naval base required to commission ships.",
        "icon": "⚓",
        "cost": 50,
        "currency_cost": 80,
        "build_time_ticks": 12,
        "max_per_region": 1,
        "requires_coastal": True,
        "defense_bonus": 0.0,
        "vision_range": 1,
        "unit_generation_bonus": 0.0,
        "currency_generation_bonus": 0.0,
        "order": 4,
    },
    {
        "name": "Airport",
        "slug": "carrier",
        "asset_key": "airport",
        "description": "Air base required to deploy fighters.",
        "icon": "🛫",
        "cost": 100,
        "currency_cost": 90,
        "build_time_ticks": 25,
        "max_per_region": 1,
        "requires_coastal": False,
        "defense_bonus": 0.05,
        "vision_range": 3,
        "unit_generation_bonus": 0.0,
        "currency_generation_bonus": 0.0,
        "order": 5,
    },
    {
        "name": "Power Plant",
        "slug": "radar",
        "asset_key": "power_plant",
        "description": "Boosts strategic currency income in the region.",
        "icon": "📡",
        "cost": 35,
        "currency_cost": 55,
        "build_time_ticks": 6,
        "max_per_region": 3,
        "requires_coastal": False,
        "defense_bonus": 0.0,
        "vision_range": 1,
        "unit_generation_bonus": 0.0,
        "currency_generation_bonus": 1.5,
        "order": 6,
    },
]

UNITS = [
    {
        "name": "Infantry",
        "slug": "infantry",
        "asset_key": "ground_unit",
        "description": "Basic land unit. Cheap and fast to produce.",
        "icon": "🪖",
        "attack": 1.0,
        "defense": 1.0,
        "speed": 1,
        "attack_range": 1,
        "sea_range": 0,
        "sea_hop_distance_km": 0,
        "produced_by_slug": None,
        "production_cost": 0,
        "production_time_ticks": 0,
        "manpower_cost": 1,
        "movement_type": "land",
        "order": 1,
    },
    {
        "name": "Tank",
        "slug": "tank",
        "asset_key": "ground_unit_sphere",
        "description": "Heavy armored vehicle. Slow but powerful.",
        "icon": "🛡️",
        "attack": 3.0,
        "defense": 2.5,
        "speed": 1,
        "attack_range": 1,
        "sea_range": 0,
        "sea_hop_distance_km": 0,
        "produced_by_slug": "factory",
        "production_cost": 15,
        "production_time_ticks": 8,
        "manpower_cost": 3,
        "movement_type": "land",
        "order": 2,
    },
    {
        "name": "Ship",
        "slug": "ship",
        "asset_key": "ship_1",
        "description": "Naval unit. Can attack coastal regions.",
        "icon": "🚢",
        "attack": 2.0,
        "defense": 2.0,
        "speed": 4,
        "attack_range": 4,
        "sea_range": 80,
        "sea_hop_distance_km": 2800,
        "produced_by_slug": "port",
        "production_cost": 20,
        "production_time_ticks": 10,
        "manpower_cost": 10,
        "movement_type": "sea",
        "order": 3,
    },
    {
        "name": "Fighter",
        "slug": "fighter",
        "asset_key": "bomber",
        "description": "Air unit with long range. Launched from carriers.",
        "icon": "✈️",
        "attack": 2.5,
        "defense": 1.0,
        "speed": 3,
        "attack_range": 3,
        "sea_range": 0,
        "sea_hop_distance_km": 0,
        "produced_by_slug": "carrier",
        "production_cost": 25,
        "production_time_ticks": 12,
        "manpower_cost": 10,
        "movement_type": "air",
        "order": 4,
    },
]


class Command(BaseCommand):
    help = "Seed default GameSettings, BuildingTypes, and UnitTypes"

    def handle(self, *args, **options):
        # GameSettings singleton
        if not GameSettings.objects.exists():
            GameSettings.objects.create(
                starting_currency=120,
                base_currency_per_tick=2.0,
                region_currency_per_tick=0.35,
            )
            self.stdout.write(self.style.SUCCESS("Created default GameSettings"))
        else:
            GameSettings.objects.update(
                starting_currency=120,
                base_currency_per_tick=2.0,
                region_currency_per_tick=0.35,
            )
            self.stdout.write("GameSettings already exists — updated economy fields")

        # Buildings
        building_map = {}
        for data in BUILDINGS:
            obj, created = BuildingType.objects.update_or_create(
                slug=data["slug"],
                defaults={k: v for k, v in data.items() if k != "slug"},
            )
            building_map[data["slug"]] = obj
            status = "created" if created else "updated"
            self.stdout.write(f"  BuildingType {obj.name}: {status}")

        BuildingType.objects.exclude(slug__in=[b["slug"] for b in BUILDINGS]).update(is_active=False)

        # Units
        for data in UNITS:
            produced_by_slug = data.pop("produced_by_slug")
            produced_by = building_map.get(produced_by_slug) if produced_by_slug else None
            obj, created = UnitType.objects.update_or_create(
                slug=data["slug"],
                defaults={**{k: v for k, v in data.items() if k != "slug"}, "produced_by": produced_by},
            )
            status = "created" if created else "updated"
            self.stdout.write(f"  UnitType {obj.name}: {status}")

        UnitType.objects.exclude(slug__in=[u["slug"] for u in UNITS]).update(is_active=False)

        # Game Modes
        for data in GAME_MODES:
            obj, created = GameMode.objects.update_or_create(
                slug=data["slug"],
                defaults={k: v for k, v in data.items() if k != "slug"},
            )
            status = "created" if created else "updated"
            self.stdout.write(f"  GameMode {obj.name}: {status}")

        self.stdout.write(self.style.SUCCESS("Seed complete!"))
