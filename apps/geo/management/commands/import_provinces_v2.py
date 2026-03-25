import json
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.geo.models import Country, Region

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_SOURCE_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent.parent / "fixtures" / "provinces_source_v2.json"
)

GAME_COUNTRY_CODE = "GAM"
GAME_COUNTRY_NAME = "Game Map"

# Linear mapping extents (game pixel space -> WGS-84)
GAME_X_MIN = -2923.0
GAME_X_MAX = 23451.0
GAME_Y_MIN = 7156.0
GAME_Y_MAX = 22465.0


# ---------------------------------------------------------------------------
# Coordinate helpers
# ---------------------------------------------------------------------------


def parse_game_point(raw: str) -> tuple[float, float]:
    """Parse a 'x,y' or '(x, y)' string into (gx, gy) floats."""
    cleaned = raw.strip().lstrip("(").rstrip(")")
    parts = cleaned.replace(" ", "").split(",")
    return float(parts[0]), float(parts[1])


def game_to_lonlat(gx: float, gy: float) -> tuple[float, float]:
    """Convert game pixel coordinates to WGS-84 (lon, lat)."""
    lon = (gx - GAME_X_MIN) / (GAME_X_MAX - GAME_X_MIN) * 360.0 - 180.0
    lat = 85.0 - (gy - GAME_Y_MIN) / (GAME_Y_MAX - GAME_Y_MIN) * 170.0
    return lon, lat


def compute_centroid_game(polygons: list[dict]) -> list[float]:
    """Return the average [x, y] of all points across all polygon rings."""
    xs: list[float] = []
    ys: list[float] = []
    for poly in polygons:
        for raw_pt in poly.get("points", []):
            gx, gy = parse_game_point(raw_pt)
            xs.append(gx)
            ys.append(gy)
    if not xs:
        return [0.0, 0.0]
    return [sum(xs) / len(xs), sum(ys) / len(ys)]


def build_geojson_multipolygon(polygons: list[dict]) -> dict:
    """Convert game-pixel polygon rings to a GeoJSON MultiPolygon."""
    geojson_polygons: list[list[list[list[float]]]] = []
    for poly in polygons:
        points = poly.get("points", [])
        if len(points) < 3:
            continue
        coords: list[list[float]] = []
        for raw_pt in points:
            gx, gy = parse_game_point(raw_pt)
            lon, lat = game_to_lonlat(gx, gy)
            coords.append([lon, lat])
        # Close the ring if needed
        if coords[0] != coords[-1]:
            coords.append(coords[0])
        geojson_polygons.append([coords])

    if not geojson_polygons:
        geojson_polygons = [[[[0, 0], [0, 0.001], [0.001, 0.001], [0, 0]]]]

    return {"type": "MultiPolygon", "coordinates": geojson_polygons}


# ---------------------------------------------------------------------------
# Management command
# ---------------------------------------------------------------------------


class Command(BaseCommand):
    help = "Import game provinces from provinces_source_v2.json into Country/Region models"

    def add_arguments(self, parser):
        parser.add_argument(
            "--clear",
            action="store_true",
            help="Clear existing game map data before import",
        )
        parser.add_argument(
            "--file",
            type=str,
            default=None,
            dest="file",
            help=f"Path to source JSON (default: {DEFAULT_SOURCE_PATH})",
        )

    def handle(self, *args, **options):
        source_path = Path(options["file"]) if options["file"] else DEFAULT_SOURCE_PATH

        if not source_path.exists():
            self.stderr.write(self.style.ERROR(f"Source file not found: {source_path}"))
            return

        if options["clear"]:
            self._clear_existing()

        self.stdout.write(f"Loading: {source_path}")
        with open(source_path) as f:
            data = json.load(f)

        provinces = data.get("provinces", [])
        self.stdout.write(f"Provinces in source: {len(provinces)}")

        # Ensure the game country exists
        country, created = Country.objects.get_or_create(
            code=GAME_COUNTRY_CODE,
            defaults={"name": GAME_COUNTRY_NAME},
        )
        action = "Created" if created else "Using existing"
        self.stdout.write(f"{action} country: {country}")

        # First pass: create/update all Region records
        province_id_to_region: dict[int, Region] = {}
        province_id_to_neighbor_ids: dict[int, list[int]] = {}
        province_id_to_sea_distances: dict[int, list[dict]] = {}
        created_count = 0
        updated_count = 0
        skipped_count = 0

        for province in provinces:
            try:
                region, was_created = self._import_province(province, country)
            except Exception as exc:
                s_id = province.get("s_id", province.get("id", "?"))
                self.stderr.write(self.style.WARNING(f"  Skipped province {s_id}: {exc}"))
                skipped_count += 1
                continue

            province_id = province["id"]
            province_id_to_region[province_id] = region
            province_id_to_neighbor_ids[province_id] = province.get("neighbors", [])
            province_id_to_sea_distances[province_id] = province.get("distances", [])

            if was_created:
                created_count += 1
            else:
                updated_count += 1

        self.stdout.write(f"Regions: {created_count} created, {updated_count} updated, {skipped_count} skipped")

        self._set_neighbors(province_id_to_region, province_id_to_neighbor_ids)
        self._set_sea_distances(province_id_to_region, province_id_to_sea_distances)

        self.stdout.write(self.style.SUCCESS("Import complete!"))
        self.stdout.write(f"  Countries: {Country.objects.count()}")
        self.stdout.write(f"  Regions:   {Region.objects.count()}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _clear_existing(self):
        self.stdout.write("Clearing existing game map data...")
        try:
            country = Country.objects.get(code=GAME_COUNTRY_CODE)
            deleted_count, _ = Region.objects.filter(country=country).delete()
            country.delete()
            self.stdout.write(f"  Deleted {deleted_count} regions and the country.")
        except Country.DoesNotExist:
            self.stdout.write("  Nothing to clear.")

    def _import_province(self, province: dict, country: Country) -> tuple[Region, bool]:
        """Create or update a single Region from a province dict."""
        province_id: int = province["id"]
        s_id: str = province["s_id"]
        polygons: list[dict] = province.get("polygons", [])
        capital: dict = province.get("capital", {})
        buildings: dict = province.get("buildings", {})

        # GeoJSON geometry
        geometry = build_geojson_multipolygon(polygons)

        # Centroid [lon, lat]: use capital.position if available
        centroid: list[float] = []
        capital_position_raw: str = capital.get("position", "")
        if capital_position_raw:
            try:
                gx, gy = parse_game_point(capital_position_raw)
                lon, lat = game_to_lonlat(gx, gy)
                centroid = [lon, lat]
            except Exception:
                centroid = []
        if not centroid:
            # Compute from polygon average
            cg = compute_centroid_game(polygons)
            if cg and cg != [0.0, 0.0]:
                lon, lat = game_to_lonlat(cg[0], cg[1])
                centroid = [lon, lat]

        # Native game-coord centroid
        centroid_game = compute_centroid_game(polygons)

        # capital_data: store the full dict, but also parse position into [x, y]
        capital_data = dict(capital)
        if capital_position_raw:
            try:
                gx, gy = parse_game_point(capital_position_raw)
                capital_data["position_xy"] = [gx, gy]
            except Exception:
                pass

        e_points: int = int(province.get("e_points", 0))

        region, was_created = Region.objects.update_or_create(
            name=s_id,
            country=country,
            defaults={
                "map_source_id": province_id,
                "geometry": geometry,
                "centroid": centroid,
                "is_coastal": bool(province.get("coast", False)),
                "is_zone": bool(province.get("zone", False)),
                "is_enabled": bool(province.get("enabled", True)),
                "e_points": e_points,
                "coast_port_tile": province.get("coast_port_tile", "") or "",
                "polygons_data": polygons,
                "centroid_game": centroid_game,
                "tiles": province.get("tiles", []),
                "tile_chunks": province.get("tile_chunks", []),
                "border_tiles": province.get("border_tiles", []),
                "buildings_data": buildings,
                "capital_data": capital_data,
                "population_weight": max(1.0, float(e_points)),
            },
        )
        return region, was_created

    def _set_neighbors(
        self,
        id_to_region: dict[int, Region],
        id_to_neighbor_ids: dict[int, list[int]],
    ):
        self.stdout.write("Setting neighbor relationships...")
        for region in id_to_region.values():
            region.neighbors.clear()

        pair_count = 0
        for province_id, region in id_to_region.items():
            for neighbor_id in id_to_neighbor_ids.get(province_id, []):
                neighbor = id_to_region.get(int(neighbor_id))
                if neighbor is None:
                    continue
                region.neighbors.add(neighbor)
                pair_count += 1

        self.stdout.write(f"  Set {pair_count} neighbor links")

    def _set_sea_distances(
        self,
        id_to_region: dict[int, Region],
        id_to_sea_distances: dict[int, list[dict]],
    ):
        self.stdout.write("Setting sea distance bands...")
        updated = 0

        for province_id, region in id_to_region.items():
            raw_bands = id_to_sea_distances.get(province_id, [])
            normalized_bands: list[dict] = []
            for band in raw_bands:
                province_uuids: list[str] = []
                for raw_id in band.get("provinces", []):
                    try:
                        target = id_to_region.get(int(raw_id))
                    except (TypeError, ValueError):
                        target = None
                    if target is not None:
                        province_uuids.append(str(target.id))
                normalized_bands.append({"r": int(band.get("r", 0)), "provinces": province_uuids})
            region.sea_distances = normalized_bands
            region.save(update_fields=["sea_distances"])
            updated += 1

        self.stdout.write(f"  Stored sea distance bands for {updated} regions")
