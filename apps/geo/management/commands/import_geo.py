import json
import urllib.request

from django.contrib.gis.geos import GEOSGeometry, MultiPolygon, Polygon
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


def make_multipolygon(geometry_data):
    """Convert GeoJSON geometry to MultiPolygon."""
    geom = GEOSGeometry(json.dumps(geometry_data), srid=4326)
    if isinstance(geom, Polygon):
        geom = MultiPolygon(geom, srid=4326)
    return geom


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
            help="Skip neighbor calculation (faster import)",
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
            self.calculate_neighbors()

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

            try:
                geometry = make_multipolygon(feature["geometry"])
            except Exception as e:
                self.stderr.write(f"Error parsing geometry for {name}: {e}")
                skipped += 1
                continue

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
            props.get("iso_a2", "")
            # Try to find country by various fields
            adm0_a3 = props.get("adm0_a3", props.get("ADM0_A3", ""))
            props.get("iso_3166_2", "")

            country = countries_by_code.get(adm0_a3)
            if not country:
                # Try other codes
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

            try:
                geometry = make_multipolygon(feature["geometry"])
            except Exception as e:
                self.stderr.write(f"Error parsing geometry for {name}: {e}")
                skipped += 1
                continue

            # Detect coastal regions (simplified: touches the boundary of the world)
            is_coastal = False
            try:
                # A very simplified check — real coastal detection would use ocean polygons
                bbox = geometry.extent  # (xmin, ymin, xmax, ymax)
                is_coastal = bbox[0] < -170 or bbox[2] > 170 or bbox[1] < -80 or bbox[3] > 80
            except Exception:
                pass

            region, was_created = Region.objects.update_or_create(
                name=name,
                country=country,
                defaults={
                    "geometry": geometry,
                    "centroid": geometry.centroid,
                    "is_coastal": is_coastal,
                },
            )
            if was_created:
                created += 1

        self.stdout.write(f"Regions: {created} created, {skipped} skipped, {no_country} without country")

    def calculate_neighbors(self):
        self.stdout.write("Calculating region neighbors (ST_Touches)...")
        regions = list(Region.objects.all())
        total = len(regions)
        neighbor_count = 0

        # Clear existing neighbors
        for region in regions:
            region.neighbors.clear()

        # Use raw SQL for efficiency with PostGIS
        from django.db import connection

        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT r1.id, r2.id
                FROM geo_region r1, geo_region r2
                WHERE r1.id < r2.id
                AND ST_Touches(r1.geometry, r2.geometry)
            """)
            pairs = cursor.fetchall()

        regions_by_id = {str(r.id): r for r in regions}
        for id1, id2 in pairs:
            r1 = regions_by_id.get(str(id1))
            r2 = regions_by_id.get(str(id2))
            if r1 and r2:
                r1.neighbors.add(r2)
                neighbor_count += 1

        self.stdout.write(f"Calculated {neighbor_count} neighbor pairs for {total} regions")
