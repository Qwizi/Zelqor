import math

from django.core.cache import cache
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from ninja_extra import api_controller, route

from apps.geo.models import Country, Region
from apps.geo.schemas import CountryOutSchema, RegionOutSchema


def _lng_to_mercator_x(lng: float) -> float:
    return math.radians(lng)


def _lat_to_mercator_y(lat: float) -> float:
    lat = max(-85.051129, min(85.051129, lat))
    lat_rad = math.radians(lat)
    return math.log(math.tan(math.pi / 4 + lat_rad / 2))


@api_controller("/geo", tags=["Geo"])
class GeoController:
    @route.get("/countries/", response=list[CountryOutSchema], auth=None)
    def list_countries(self):
        return list(Country.objects.all())

    @route.get("/regions/graph/", auth=None)
    def regions_graph(self, match_id: str = None):
        """Lightweight neighbor graph with centroids — no geometry.
        Used by frontend to build neighborMap and animation centroids.
        Pass match_id to filter by that match's map config (country_codes).
        Cached for 24h — neighbor graph is immutable after data import.
        """
        country_codes = self._country_codes_for_match(match_id) if match_id else []
        codes_key = "|".join(sorted(country_codes)) if country_codes else "all"
        cache_key = f"regions_graph:{codes_key}"

        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        qs = Region.objects.prefetch_related("neighbors").all()
        if country_codes:
            qs = qs.filter(country__code__in=country_codes)
        result = [
            {
                "id": str(r.id),
                "neighbor_ids": [str(n.id) for n in r.neighbors.all()],
                "centroid": r.centroid if isinstance(r.centroid, list) and len(r.centroid) == 2 else None,
            }
            for r in qs
        ]
        cache.set(cache_key, result, timeout=86400)
        return result

    @route.get("/regions/shapes/", auth=None)
    def region_shapes(self, match_id: str = None, canvas_size: int = 4096):
        """Return region polygons in normalised pixel space for Pixi.js.

        Uses native game coordinates from ``polygons_data`` (loaded via
        import_provinces_v2) and linearly maps them into a canvas of
        ``canvas_size`` pixels with 5 % padding. The texture map09 chunks
        use the same coordinate system so ``world_texture`` gives the
        exact pixel rect for the full texture atlas.
        Cached for 24h.
        """
        country_codes = self._country_codes_for_match(match_id) if match_id else []
        codes_key = "|".join(sorted(country_codes)) if country_codes else "all"
        cache_key = f"region_shapes_v2:{codes_key}:{canvas_size}"

        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        qs = Region.objects.select_related("country").prefetch_related("neighbors")
        if country_codes:
            qs = qs.filter(country__code__in=country_codes)

        regions = list(qs)

        # Texture-aligned game coordinate bounds.
        # 27x16 chunk grid, 276x308 px/chunk = 7452x4928 px.
        # Province terrain baked into chunks (chunks_game/).
        TEX_W, TEX_H = 7452.0, 4928.0
        GX_MIN = -2891.9338
        GX_MAX = 3.622519 * TEX_W + GX_MIN  # 24103.08
        GY_MIN = 7184.4125
        GY_MAX = 3.248962 * TEX_H + GY_MIN  # 23195.30

        # Map game coords to canvas preserving aspect ratio.
        # Use a uniform scale so the map isn't distorted.
        scale = min(canvas_size / (GX_MAX - GX_MIN), canvas_size / (GY_MAX - GY_MIN))
        scale_x = scale
        scale_y = scale

        def project(gx, gy):
            px = round((gx - GX_MIN) * scale_x, 2)
            py = round((gy - GY_MIN) * scale_y, 2)
            return [px, py]

        out_regions = []
        for region in regions:
            poly_data = region.polygons_data
            if not poly_data:
                continue

            pixel_polygons = []
            for poly_obj in poly_data:
                points = poly_obj.get("points", [])
                if len(points) < 3:
                    continue
                ring = []
                for pt_str in points:
                    parts = pt_str.split(",")
                    ring.append(project(float(parts[0]), float(parts[1])))
                pixel_polygons.append([ring])  # [exterior_ring] — no holes in game data

            if not pixel_polygons:
                continue

            centroid_px = None
            cg = region.centroid_game
            if cg and len(cg) == 2:
                centroid_px = project(cg[0], cg[1])

            out_regions.append(
                {
                    "id": str(region.id),
                    "name": region.name,
                    "polygons": pixel_polygons,
                    "centroid": centroid_px,
                    "neighbors": [str(n.id) for n in region.neighbors.all()],
                    "is_coastal": region.is_coastal,
                    "population_weight": region.population_weight,
                    "tile_chunks": region.tile_chunks or [],
                }
            )

        # World texture mapping: the full game coordinate space projected to canvas.
        # map09 chunks cover the same game coords, so this tells the frontend
        # exactly where to place the 27x16 chunk grid.
        wt_tl = project(GX_MIN, GY_MIN)
        wt_br = project(GX_MAX, GY_MAX)

        result = {
            "regions": out_regions,
            "bounds": {
                "min_x": wt_tl[0],
                "min_y": wt_tl[1],
                "max_x": wt_br[0],
                "max_y": wt_br[1],
            },
            "world_texture": {
                "x": wt_tl[0],
                "y": wt_tl[1],
                "w": wt_br[0] - wt_tl[0],
                "h": wt_br[1] - wt_tl[1],
            },
        }
        cache.set(cache_key, result, timeout=86400)
        return result

    @route.get("/tiles/{z}/{x}/{y}/", auth=None)
    def get_tile(self, z: int, x: int, y: int, match_id: str = None):
        """MVT vector tiles endpoint — disabled after PostGIS removal.
        The game uses Pixi.js canvas rendering (region_shapes) instead.
        """
        return HttpResponse(b"", content_type="application/x-protobuf", status=204)

    @staticmethod
    def _country_codes_for_match(match_id: str) -> list:
        """Return country_codes list for the given match's map_config, or [] if unrestricted.
        Cached in Redis for 1h — map_config doesn't change during a match.
        """
        cache_key = f"match_country_codes:{match_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached
        try:
            from apps.matchmaking.models import Match

            match = Match.objects.select_related("map_config").get(id=match_id)
            if match.map_config and match.map_config.country_codes:
                result = match.map_config.country_codes
                cache.set(cache_key, result, timeout=3600)
                return result
        except Exception:
            pass
        cache.set(cache_key, [], timeout=3600)
        return []

    @route.get("/regions/", auth=None)
    def list_regions(self, country_code: str = None):
        """Returns regions as GeoJSON-like FeatureCollection."""
        qs = Region.objects.select_related("country").prefetch_related("neighbors")
        if country_code:
            qs = qs.filter(country__code=country_code)

        features = []
        for region in qs:
            feature = {
                "type": "Feature",
                "id": str(region.id),
                "geometry": region.geometry if isinstance(region.geometry, dict) else {},
                "properties": {
                    "id": str(region.id),
                    "name": region.name,
                    "is_coastal": region.is_coastal,
                    "population_weight": region.population_weight,
                    "country_code": region.country.code,
                    "country_name": region.country.name,
                    "neighbor_ids": [str(n.id) for n in region.neighbors.all()],
                    "centroid": region.centroid if isinstance(region.centroid, list) else None,
                },
            }
            features.append(feature)

        return {"type": "FeatureCollection", "features": features}

    @route.get("/regions/{region_id}/", response=RegionOutSchema, auth=None)
    def get_region(self, region_id: str):
        return get_object_or_404(Region.objects.select_related("country"), id=region_id)
