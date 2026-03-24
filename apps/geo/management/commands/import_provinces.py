import contextlib
import json
from pathlib import Path

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Point, Polygon
from django.core.management.base import BaseCommand

from apps.geo.models import Country, Region

GEOJSON_PATH = Path(__file__).resolve().parent.parent.parent.parent.parent / "fixtures" / "provinces.geojson"

GAME_COUNTRY_CODE = "GAM"
GAME_COUNTRY_NAME = "Game Map"


def make_multipolygon(geometry_data: dict) -> MultiPolygon:
    geom = GEOSGeometry(json.dumps(geometry_data), srid=4326)
    if isinstance(geom, Polygon):
        geom = MultiPolygon(geom, srid=4326)
    return geom


class Command(BaseCommand):
    help = "Import game provinces from provinces.geojson into Country/Region models"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing game map data before import",
        )
        parser.add_argument(
            "--skip-neighbors",
            action="store_true",
            help="Skip setting neighbor relationships",
        )
        parser.add_argument(
            "--geojson",
            type=str,
            default=None,
            help=f"Path to provinces.geojson (default: {GEOJSON_PATH})",
        )

    def handle(self, *args, **options):
        geojson_path = Path(options["geojson"]) if options["geojson"] else GEOJSON_PATH

        if not geojson_path.exists():
            self.stderr.write(f"GeoJSON not found: {geojson_path}\nRun: python scripts/convert_provinces_to_geojson.py")
            return

        if options["clear"]:
            self.stdout.write("Clearing existing game map data...")
            try:
                country = Country.objects.get(code=GAME_COUNTRY_CODE)
                Region.objects.filter(country=country).delete()
                country.delete()
                self.stdout.write("  Cleared.")
            except Country.DoesNotExist:
                self.stdout.write("  Nothing to clear.")

        self.stdout.write(f"Loading: {geojson_path}")
        with open(geojson_path) as f:
            geojson = json.load(f)

        features = geojson["features"]
        self.stdout.write(f"Features: {len(features)}")

        # Ensure the game country exists
        country, created = Country.objects.get_or_create(
            code=GAME_COUNTRY_CODE,
            defaults={"name": GAME_COUNTRY_NAME},
        )
        if created:
            self.stdout.write(f"Created country: {country}")
        else:
            self.stdout.write(f"Using existing country: {country}")

        # Import regions — track province numeric ID -> Region for neighbor linking
        province_id_to_region: dict[int, Region] = {}
        province_id_to_neighbor_ids: dict[int, list[int]] = {}
        province_id_to_sea_distances: dict[int, list[dict]] = {}
        created_count = 0
        updated_count = 0
        skipped = 0

        for feature in features:
            props = feature["properties"]
            province_id = props["id"]  # numeric 1-144
            s_id = props["s_id"]
            props["name"]
            is_coastal = props.get("is_coastal", False)
            capital_lonlat = props.get("capital_lonlat")
            neighbor_ids = props.get("neighbors", [])
            sea_distances = props.get("distances", [])

            try:
                geometry = make_multipolygon(feature["geometry"])
            except Exception as e:
                self.stderr.write(f"  Error parsing geometry for {s_id}: {e}")
                skipped += 1
                continue

            # Centroid: use capital position if available, else compute from geometry
            centroid = None
            if capital_lonlat:
                with contextlib.suppress(Exception):
                    centroid = Point(capital_lonlat[0], capital_lonlat[1], srid=4326)
            if centroid is None:
                centroid = geometry.centroid

            region, was_created = Region.objects.update_or_create(
                name=s_id,
                country=country,
                defaults={
                    "map_source_id": province_id,
                    "geometry": geometry,
                    "centroid": centroid,
                    "is_coastal": is_coastal,
                },
            )

            province_id_to_region[province_id] = region
            province_id_to_neighbor_ids[province_id] = neighbor_ids
            province_id_to_sea_distances[province_id] = sea_distances

            if was_created:
                created_count += 1
            else:
                updated_count += 1

        self.stdout.write(f"Regions: {created_count} created, {updated_count} updated, {skipped} skipped")

        if not options["skip_neighbors"]:
            self._set_neighbors(province_id_to_region, province_id_to_neighbor_ids)

        self._set_sea_distances(province_id_to_region, province_id_to_sea_distances)

        self.stdout.write(self.style.SUCCESS("Import complete!"))
        self.stdout.write(f"  Countries: {Country.objects.count()}")
        self.stdout.write(f"  Regions:   {Region.objects.count()}")

    def _set_neighbors(
        self,
        id_to_region: dict[int, Region],
        id_to_neighbor_ids: dict[int, list[int]],
    ):
        self.stdout.write("Setting gameplay neighbor relationships from source map...")
        for region in id_to_region.values():
            region.neighbors.clear()

        pair_count = 0

        for province_id, region in id_to_region.items():
            for neighbor_numeric_id in id_to_neighbor_ids.get(province_id, []):
                neighbor = id_to_region.get(neighbor_numeric_id)
                if not neighbor:
                    continue
                region.neighbors.add(neighbor)
                pair_count += 1

        self.stdout.write(f"  Set {pair_count} gameplay neighbor links")

    def _set_sea_distances(
        self,
        id_to_region: dict[int, Region],
        id_to_sea_distances: dict[int, list[dict]],
    ):
        self.stdout.write("Setting sea distance bands...")
        updated = 0

        for province_id, region in id_to_region.items():
            raw_bands = id_to_sea_distances.get(province_id, [])
            normalized_bands = []
            for band in raw_bands:
                provinces = []
                for target_numeric_id in band.get("provinces", []):
                    try:
                        target_region = id_to_region.get(int(target_numeric_id))
                    except (TypeError, ValueError):
                        target_region = None
                    if target_region:
                        provinces.append(str(target_region.id))
                normalized_bands.append(
                    {
                        "r": int(band.get("r", 0)),
                        "provinces": provinces,
                    }
                )

            region.sea_distances = normalized_bands
            region.save(update_fields=["sea_distances"])
            updated += 1

        self.stdout.write(f"  Stored sea distance bands for {updated} regions")
