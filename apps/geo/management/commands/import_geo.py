import json
import urllib.request

from django.core.management.base import BaseCommand

from apps.geo.models import Country, Region

COUNTRIES_URL = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
)
REGIONS_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson"


def download_geojson(url):
    """Download and parse GeoJSON from URL."""
    print(f"Downloading {url}...")
    req = urllib.request.Request(url, headers={"User-Agent": "MapLord/1.0"})
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalize_to_multipolygon(geometry_data: dict) -> dict:
    """Normalize GeoJSON geometry to MultiPolygon format."""
    if geometry_data.get("type") == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geometry_data["coordinates"]]}
    return geometry_data


class Command(BaseCommand):
    help = "Import Natural Earth countries and regions (admin level 1) into the database"

    def add_arguments(self, parser):
        parser.add_argument(
            "--countries-only",
            action="store_true",
            help="Only import countries (skip regions)",
        )
        parser.add_argument(
            "--skip-neighbors",
            action="store_true",
            help="Skip neighbor calculation",
        )
        parser.add_argument(
            "--country-codes",
            nargs="+",
            type=str,
            help="Only import specific country codes (e.g. POL DEU FRA)",
        )
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing data before import",
        )

    def handle(self, *args, **options):
        if options["clear"]:
            self.stdout.write("Clearing existing data...")
            Region.objects.all().delete()
            Country.objects.all().delete()

        self.import_countries(options.get("country_codes"))

        if not options["countries_only"]:
            self.import_regions(options.get("country_codes"))

        if not options["skip_neighbors"]:
            self.stdout.write(
                self.style.WARNING(
                    "Neighbor calculation requires PostGIS (ST_Touches). "
                    "Use import_provinces_v2 with pre-computed neighbors instead."
                )
            )

        self.stdout.write(self.style.SUCCESS("Import complete!"))
        self.stdout.write(f"Countries: {Country.objects.count()}")
        self.stdout.write(f"Regions: {Region.objects.count()}")

    def import_countries(self, filter_codes=None):
        data = download_geojson(COUNTRIES_URL)
        created = 0
        skipped = 0

        for feature in data["features"]:
            props = feature["properties"]
            code = props.get("ISO_A3", props.get("ADM0_A3", ""))
            name = props.get("NAME", props.get("ADMIN", ""))

            if not code or code == "-99":
                skipped += 1
                continue

            if filter_codes and code not in filter_codes:
                continue

            geometry = normalize_to_multipolygon(feature["geometry"])

            _, was_created = Country.objects.update_or_create(
                code=code,
                defaults={"name": name, "geometry": geometry},
            )
            if was_created:
                created += 1

        self.stdout.write(f"Countries: {created} created, {skipped} skipped")

    def import_regions(self, filter_codes=None):
        data = download_geojson(REGIONS_URL)
        created = 0
        skipped = 0
        no_country = 0

        countries_by_code = {c.code: c for c in Country.objects.all()}

        for feature in data["features"]:
            props = feature["properties"]
            name = props.get("name", props.get("NAME", ""))
            adm0_a3 = props.get("adm0_a3", props.get("ADM0_A3", ""))

            country = countries_by_code.get(adm0_a3)
            if not country:
                for _code, c in countries_by_code.items():
                    if c.name == props.get("admin", ""):
                        country = c
                        break

            if not country:
                no_country += 1
                continue

            if filter_codes and country.code not in filter_codes:
                continue

            if not name:
                skipped += 1
                continue

            geometry = normalize_to_multipolygon(feature["geometry"])

            # Detect coastal regions (simplified)
            is_coastal = False
            try:
                coords = geometry.get("coordinates", [])
                if coords:
                    all_points = [p for poly in coords for ring in poly for p in ring]
                    lons = [p[0] for p in all_points]
                    lats = [p[1] for p in all_points]
                    is_coastal = min(lons) < -170 or max(lons) > 170 or min(lats) < -80 or max(lats) > 80
            except Exception:
                pass

            # Compute centroid as average of all coordinates
            centroid = []
            try:
                coords = geometry.get("coordinates", [])
                all_points = [p for poly in coords for ring in poly for p in ring]
                if all_points:
                    avg_lon = sum(p[0] for p in all_points) / len(all_points)
                    avg_lat = sum(p[1] for p in all_points) / len(all_points)
                    centroid = [avg_lon, avg_lat]
            except Exception:
                pass

            _, was_created = Region.objects.update_or_create(
                name=name,
                country=country,
                defaults={
                    "geometry": geometry,
                    "centroid": centroid,
                    "is_coastal": is_coastal,
                },
            )
            if was_created:
                created += 1

        self.stdout.write(f"Regions: {created} created, {skipped} skipped, {no_country} without country")
