import uuid

from ninja import Schema


class CountryOutSchema(Schema):
    id: uuid.UUID
    name: str
    code: str

    class Config:
        from_attributes = True


class RegionOutSchema(Schema):
    id: uuid.UUID
    name: str
    country_id: uuid.UUID
    is_coastal: bool
    population_weight: float
    centroid_lat: float | None = None
    centroid_lng: float | None = None

    class Config:
        from_attributes = True

    @staticmethod
    def resolve_centroid_lat(obj):
        if isinstance(obj.centroid, list) and len(obj.centroid) == 2:
            return obj.centroid[1]
        return None

    @staticmethod
    def resolve_centroid_lng(obj):
        if isinstance(obj.centroid, list) and len(obj.centroid) == 2:
            return obj.centroid[0]
        return None


class RegionGeoJsonFeature(Schema):
    type: str = "Feature"
    id: str
    properties: dict
    geometry: dict


class RegionGeoJsonCollection(Schema):
    type: str = "FeatureCollection"
    features: list[RegionGeoJsonFeature]


class RegionPixelShape(Schema):
    id: str
    name: str
    # Each sub-polygon: [exterior_ring, hole1, hole2, ...]
    # MultiPolygon regions have multiple sub-polygons (e.g. islands)
    polygons: list[list[list[list[float]]]]
    centroid: list[float] | None = None
    neighbors: list[str]
    is_coastal: bool
    population_weight: float


class PixelBounds(Schema):
    min_x: float
    min_y: float
    max_x: float
    max_y: float


class RegionShapesOutSchema(Schema):
    regions: list[RegionPixelShape]
    bounds: PixelBounds
