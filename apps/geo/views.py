import json
from typing import List

from django.contrib.gis.serializers.geojson import Serializer as GeoJSONSerializer
from django.core.cache import cache
from django.db import connection
from django.http import HttpResponse
from ninja_extra import api_controller, route

from apps.geo.models import Country, Region
from apps.geo.schemas import CountryOutSchema, RegionOutSchema


@api_controller('/geo', tags=['Geo'])
class GeoController:

    @route.get('/countries/', response=List[CountryOutSchema], auth=None)
    def list_countries(self):
        return list(Country.objects.all())

    @route.get('/regions/graph/', auth=None)
    def regions_graph(self, match_id: str = None):
        """Lightweight neighbor graph with centroids — no geometry.
        Used by frontend to build neighborMap and animation centroids.
        Pass match_id to filter by that match's map config (country_codes).
        """
        qs = Region.objects.prefetch_related('neighbors').all()
        if match_id:
            country_codes = self._country_codes_for_match(match_id)
            if country_codes:
                qs = qs.filter(country__code__in=country_codes)
        return [
            {
                "id": str(r.id),
                "neighbor_ids": [str(n.id) for n in r.neighbors.all()],
                "centroid": [r.centroid.x, r.centroid.y] if r.centroid else None,
            }
            for r in qs
        ]

    @route.get('/tiles/{z}/{x}/{y}/', auth=None)
    def get_tile(self, z: int, x: int, y: int, match_id: str = None):
        """Serves MVT vector tiles for the regions layer.
        MapLibre requests only tiles visible in the current viewport.
        Pass match_id to filter by that match's map config (country_codes).
        Tiles are cached in Redis — geometry never changes during a match.
        """
        country_codes = self._country_codes_for_match(match_id) if match_id else []

        codes_key = "|".join(sorted(country_codes)) if country_codes else "all"
        cache_key = f"mvt:{z}:{x}:{y}:{codes_key}"
        cached = cache.get(cache_key)
        if cached is not None:
            response = HttpResponse(cached or b'', content_type='application/x-protobuf',
                                    status=200 if cached else 204)
            response['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=3600'
            return response

        if country_codes:
            sql = """
                SELECT ST_AsMVT(q, 'regions', 4096, 'geom')
                FROM (
                    SELECT
                        r.id::text          AS id,
                        r.name,
                        r.is_coastal,
                        c.code              AS country_code,
                        c.name              AS country_name,
                        ST_AsMVTGeom(
                            ST_Transform(r.geometry, 3857),
                            ST_TileEnvelope(%s, %s, %s),
                            4096, 64, true
                        ) AS geom
                    FROM geo_region r
                    JOIN geo_country c ON c.id = r.country_id
                    WHERE r.geometry && ST_Transform(ST_TileEnvelope(%s, %s, %s), 4326)
                      AND c.code = ANY(%s)
                ) q
                WHERE geom IS NOT NULL
            """
            params = [z, x, y, z, x, y, country_codes]
        else:
            sql = """
                SELECT ST_AsMVT(q, 'regions', 4096, 'geom')
                FROM (
                    SELECT
                        r.id::text          AS id,
                        r.name,
                        r.is_coastal,
                        c.code              AS country_code,
                        c.name              AS country_name,
                        ST_AsMVTGeom(
                            ST_Transform(r.geometry, 3857),
                            ST_TileEnvelope(%s, %s, %s),
                            4096, 64, true
                        ) AS geom
                    FROM geo_region r
                    JOIN geo_country c ON c.id = r.country_id
                    WHERE r.geometry && ST_Transform(ST_TileEnvelope(%s, %s, %s), 4326)
                ) q
                WHERE geom IS NOT NULL
            """
            params = [z, x, y, z, x, y]

        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            tile = cursor.fetchone()[0]

        tile_bytes = bytes(tile) if tile else b''
        # Cache for 24h — geometry is immutable
        cache.set(cache_key, tile_bytes, timeout=86400)

        if tile_bytes:
            response = HttpResponse(tile_bytes, content_type='application/x-protobuf')
        else:
            response = HttpResponse(b'', content_type='application/x-protobuf', status=204)

        response['Cache-Control'] = 'public, max-age=86400, stale-while-revalidate=3600'
        return response

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
            match = Match.objects.select_related('map_config').get(id=match_id)
            if match.map_config and match.map_config.country_codes:
                result = match.map_config.country_codes
                cache.set(cache_key, result, timeout=3600)
                return result
        except Exception:
            pass
        cache.set(cache_key, [], timeout=3600)
        return []

    @route.get('/regions/', auth=None)
    def list_regions(self, country_code: str = None):
        """Returns regions as GeoJSON FeatureCollection (kept for tooling/debug)."""
        qs = Region.objects.select_related('country').prefetch_related('neighbors')
        if country_code:
            qs = qs.filter(country__code=country_code)

        serializer = GeoJSONSerializer()
        geojson_str = serializer.serialize(
            qs,
            geometry_field='geometry',
            fields=('name', 'is_coastal', 'population_weight'),
        )
        geojson = json.loads(geojson_str)

        regions_by_pk = {str(r.pk): r for r in qs}
        for feature in geojson['features']:
            pk = feature['properties'].get('pk') or feature.get('id')
            region = regions_by_pk.get(str(pk))
            if region:
                feature['id'] = str(region.id)
                feature['properties']['id'] = str(region.id)
                feature['properties']['country_code'] = region.country.code
                feature['properties']['country_name'] = region.country.name
                feature['properties']['neighbor_ids'] = [
                    str(n.id) for n in region.neighbors.all()
                ]
                if region.centroid:
                    feature['properties']['centroid'] = [region.centroid.x, region.centroid.y]

        return geojson

    @route.get('/regions/{region_id}/', response=RegionOutSchema, auth=None)
    def get_region(self, region_id: str):
        return Region.objects.select_related('country').get(id=region_id)
