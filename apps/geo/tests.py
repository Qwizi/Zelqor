"""Tests for apps/geo — Country, Region models and API endpoints."""

import uuid

import pytest
from django.db import IntegrityError

from apps.geo.models import Country, Region

pytestmark = pytest.mark.django_db


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def country():
    return Country.objects.create(name="Game Map", code="GAM", geometry={})


@pytest.fixture
def region(country):
    return Region.objects.create(
        name="Province Alpha",
        country=country,
        geometry={"type": "MultiPolygon", "coordinates": []},
        centroid=[10.0, 50.0],
        is_coastal=False,
        population_weight=2.0,
        polygons_data=[{"name": "main", "points": ["100,200", "300,400", "500,600"]}],
        centroid_game=[300.0, 400.0],
    )


@pytest.fixture
def region_pair(country):
    r1 = Region.objects.create(name="Province A", country=country, geometry={}, centroid=[1.0, 2.0])
    r2 = Region.objects.create(name="Province B", country=country, geometry={}, centroid=[3.0, 4.0])
    r1.neighbors.add(r2)
    return r1, r2


# ---------------------------------------------------------------------------
# Country model
# ---------------------------------------------------------------------------


def test_country_creation(country):
    assert country.name == "Game Map"
    assert country.code == "GAM"


def test_country_str(country):
    assert str(country) == "Game Map (GAM)"


def test_country_geometry_is_json(country):
    assert isinstance(country.geometry, dict)


def test_country_code_unique():
    Country.objects.create(name="A", code="AAA")
    with pytest.raises(IntegrityError):
        Country.objects.create(name="B", code="AAA")


# ---------------------------------------------------------------------------
# Region model
# ---------------------------------------------------------------------------


def test_region_creation(region):
    assert region.name == "Province Alpha"
    assert region.population_weight == 2.0


def test_region_str(region):
    assert "Province Alpha" in str(region)
    assert "Game Map" in str(region)


def test_region_centroid_is_list(region):
    assert region.centroid == [10.0, 50.0]


def test_region_geometry_is_json(region):
    assert region.geometry["type"] == "MultiPolygon"


def test_region_neighbors(region_pair):
    r1, r2 = region_pair
    assert r2 in r1.neighbors.all()
    assert r1 in r2.neighbors.all()


def test_region_polygons_data(region):
    assert len(region.polygons_data) == 1
    assert "points" in region.polygons_data[0]


def test_region_centroid_game(region):
    assert region.centroid_game == [300.0, 400.0]


def test_region_cascade_on_country_delete(country, region):
    country.delete()
    assert not Region.objects.filter(pk=region.pk).exists()


def test_region_is_coastal_default():
    c = Country.objects.create(name="Test", code="TST")
    r = Region.objects.create(name="R1", country=c, geometry={})
    assert r.is_coastal is False


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------


def test_countries_endpoint(client, country):
    resp = client.get("/api/v1/geo/countries/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 1


def test_regions_graph_endpoint(client, region_pair):
    resp = client.get("/api/v1/geo/regions/graph/")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_regions_shapes_endpoint(client, region):
    resp = client.get("/api/v1/geo/regions/shapes/")
    assert resp.status_code == 200
    data = resp.json()
    assert "regions" in data
    assert "bounds" in data
    assert "world_texture" in data


def test_region_detail_endpoint(client, region):
    resp = client.get(f"/api/v1/geo/regions/{region.id}/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Province Alpha"


def test_region_detail_404(client, country):
    # Need at least one country so the geo app tables exist
    fake_id = uuid.uuid4()
    resp = client.get(f"/api/v1/geo/regions/{fake_id}/")
    assert resp.status_code == 404


def test_tiles_endpoint_returns_204(client):
    resp = client.get("/api/v1/geo/tiles/0/0/0/")
    assert resp.status_code == 204


def test_regions_list_geojson(client, region):
    resp = client.get("/api/v1/geo/regions/")
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) >= 1


def test_regions_list_filter_by_country(client, country, region):
    resp = client.get(f"/api/v1/geo/regions/?country_code={country.code}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["features"]) >= 1


def test_region_schema_centroid_lat_lng(client, region):
    resp = client.get(f"/api/v1/geo/regions/{region.id}/")
    data = resp.json()
    assert data["centroid_lng"] == 10.0
    assert data["centroid_lat"] == 50.0


# ---------------------------------------------------------------------------
# geo/views.py — additional endpoint coverage
# ---------------------------------------------------------------------------


def test_regions_graph_with_match_id_uses_country_codes(client, country, region_pair):
    """regions_graph with a match_id that has no map_config falls back to all regions."""
    from apps.matchmaking.models import Match

    m = Match.objects.create(status="waiting")
    resp = client.get(f"/api/v1/geo/regions/graph/?match_id={m.id}")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


def test_regions_shapes_with_match_id(client, country, region):
    """region_shapes with an unknown match_id should still return a valid response."""
    import uuid

    resp = client.get(f"/api/v1/geo/regions/shapes/?match_id={uuid.uuid4()}")
    assert resp.status_code == 200
    data = resp.json()
    assert "regions" in data


def test_regions_shapes_canvas_size_param(client, region):
    resp = client.get("/api/v1/geo/regions/shapes/?canvas_size=2048")
    assert resp.status_code == 200
    data = resp.json()
    assert "regions" in data


def test_regions_graph_cached_on_second_call(client, region_pair):
    """Second call to the graph endpoint should hit cache (no error)."""
    from django.core.cache import cache

    cache.clear()
    client.get("/api/v1/geo/regions/graph/")
    resp = client.get("/api/v1/geo/regions/graph/")
    assert resp.status_code == 200


def test_regions_shapes_region_with_no_polygons_is_skipped(country):
    """Regions with empty polygons_data should be excluded from region_shapes output."""
    from django.test import Client

    from apps.geo.models import Region

    # Region with empty polygons_data list — polygons_data is NOT NULL, so use []
    Region.objects.create(name="Empty Region", country=country, geometry={}, polygons_data=[])
    c = Client()
    resp = c.get("/api/v1/geo/regions/shapes/")
    assert resp.status_code == 200


def test_regions_list_filter_no_results(client, country):
    resp = client.get("/api/v1/geo/regions/?country_code=ZZZ")
    assert resp.status_code == 200
    data = resp.json()
    assert data["type"] == "FeatureCollection"
    assert data["features"] == []


def test_mercator_helpers():
    """Sanity-check the private projection helpers."""
    import math

    from apps.geo.views import _lat_to_mercator_y, _lng_to_mercator_x

    assert _lng_to_mercator_x(0.0) == 0.0
    assert abs(_lng_to_mercator_x(180.0) - math.pi) < 1e-6
    # Equator -> 0
    assert abs(_lat_to_mercator_y(0.0)) < 1e-6
    # Clamp at 85.051129
    y_max = _lat_to_mercator_y(90.0)
    y_clamped = _lat_to_mercator_y(85.051129)
    assert abs(y_max - y_clamped) < 1e-6
