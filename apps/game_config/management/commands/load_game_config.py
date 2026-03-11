import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.game_config.models import BuildingType, GameSettings, MapConfig, UnitType


DEFAULT_FIXTURE_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent.parent
    / "fixtures"
    / "game_config.json"
)


class Command(BaseCommand):
    help = "Load game config fixture with upserts (safe for GameSettings singleton)"

    def add_arguments(self, parser):
        parser.add_argument(
            "--fixture",
            type=str,
            default=str(DEFAULT_FIXTURE_PATH),
            help=f"Path to fixture JSON (default: {DEFAULT_FIXTURE_PATH})",
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

        if not settings_entry:
            raise CommandError("Fixture does not contain game_config.gamesettings")

        self._upsert_settings(settings_entry)
        building_map = self._upsert_buildings(building_entries)
        self._upsert_units(unit_entries, building_entries, building_map)
        self._upsert_maps(map_entries)

        self.stdout.write(self.style.SUCCESS("Game config loaded successfully"))

    def _upsert_settings(self, entry: dict):
        fields = dict(entry.get("fields") or {})
        instance = GameSettings.objects.first()
        if instance is None:
            instance = GameSettings(id=entry.get("pk"))

        for field_name, value in fields.items():
            setattr(instance, field_name, value)
        instance.save()

        if GameSettings.objects.exclude(pk=instance.pk).exists():
            GameSettings.objects.exclude(pk=instance.pk).delete()

        self.stdout.write("  GameSettings: upserted")

    def _upsert_buildings(self, entries: list[dict]) -> dict[str, BuildingType]:
        building_map: dict[str, BuildingType] = {}
        seen_slugs: list[str] = []

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            slug = fields["slug"]
            seen_slugs.append(slug)
            defaults = {key: value for key, value in fields.items() if key != "slug"}
            instance, _ = BuildingType.objects.update_or_create(slug=slug, defaults=defaults)
            building_map[str(entry.get("pk"))] = instance

        if seen_slugs:
            BuildingType.objects.exclude(slug__in=seen_slugs).update(is_active=False)

        self.stdout.write(f"  BuildingType: {len(seen_slugs)} upserted")
        return building_map

    def _upsert_units(
        self,
        entries: list[dict],
        building_entries: list[dict],
        building_map: dict[str, BuildingType],
    ):
        building_pk_to_slug = {
            str(entry.get("pk")): (entry.get("fields") or {}).get("slug")
            for entry in building_entries
        }
        seen_slugs: list[str] = []

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            slug = fields["slug"]
            seen_slugs.append(slug)
            produced_by_pk = fields.pop("produced_by", None)
            produced_by_slug = building_pk_to_slug.get(str(produced_by_pk)) if produced_by_pk else None
            produced_by = None
            if produced_by_slug:
                produced_by = BuildingType.objects.filter(slug=produced_by_slug).first()

            defaults = {key: value for key, value in fields.items() if key != "slug"}
            defaults["produced_by"] = produced_by
            UnitType.objects.update_or_create(slug=slug, defaults=defaults)

        if seen_slugs:
            UnitType.objects.exclude(slug__in=seen_slugs).update(is_active=False)

        self.stdout.write(f"  UnitType: {len(seen_slugs)} upserted")

    def _upsert_maps(self, entries: list[dict]):
        seen_names: list[str] = []

        for entry in entries:
            fields = dict(entry.get("fields") or {})
            name = fields["name"]
            seen_names.append(name)
            defaults = {
                key: value
                for key, value in fields.items()
                if key not in {"name", "created_at"}
            }
            MapConfig.objects.update_or_create(name=name, defaults=defaults)

        if seen_names:
            MapConfig.objects.exclude(name__in=seen_names).update(is_active=False)

        self.stdout.write(f"  MapConfig: {len(seen_names)} upserted")
