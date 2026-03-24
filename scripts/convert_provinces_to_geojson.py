#!/usr/bin/env python3
"""
Convert provinces_nvetbz_1.8.2.json (custom game format) to GeoJSON.

The game uses a custom pixel coordinate system. We convert linearly to WGS84:
  lon = (gx - X_MIN) / (X_MAX - X_MIN) * 360 - 180
  lat = 85 - (gy - Y_MIN) / (Y_MAX - Y_MIN) * 170
"""

import json
from pathlib import Path

INPUT_FILE = Path(__file__).parent.parent / "frontend/public/assets/maps/provinces_nvetbz_1.8.2.json"
OUTPUT_FILE = Path(__file__).parent.parent / "frontend/public/assets/maps/provinces.geojson"

# Canvas bounds (derived from all polygon coordinates)
X_MIN, X_MAX = -2923, 23451
Y_MIN, Y_MAX = 7156, 22465

# Lat/lon output range
LON_MIN, LON_MAX = -180.0, 180.0
LAT_MAX, LAT_MIN = 85.0, -85.0  # Inverted: y increases downward


def game_to_lonlat(gx: float, gy: float) -> tuple:
    lon = (gx - X_MIN) / (X_MAX - X_MIN) * (LON_MAX - LON_MIN) + LON_MIN
    lat = LAT_MAX - (gy - Y_MIN) / (Y_MAX - Y_MIN) * (LAT_MAX - LAT_MIN)
    # Clamp to valid range
    lon = max(-180.0, min(180.0, lon))
    lat = max(-90.0, min(90.0, lat))
    return round(lon, 6), round(lat, 6)


def parse_point(pt: str) -> list:
    x, y = map(float, pt.split(","))
    lon, lat = game_to_lonlat(x, y)
    return [lon, lat]


def polygon_to_coordinates(points: list) -> list:
    coords = [parse_point(pt) for pt in points]
    # Close the ring if not already closed
    if coords and coords[0] != coords[-1]:
        coords.append(coords[0])
    return coords


def province_to_feature(province: dict) -> dict:
    polygons = province.get("polygons", [])

    if not polygons:
        return None

    rings = [polygon_to_coordinates(p["points"]) for p in polygons]

    # Filter out degenerate rings (< 4 points)
    rings = [r for r in rings if len(r) >= 4]
    if not rings:
        return None

    # Build geometry: Polygon (1 ring) or MultiPolygon (multiple rings)
    if len(rings) == 1:
        geometry = {"type": "Polygon", "coordinates": [rings[0]]}
    else:
        geometry = {"type": "MultiPolygon", "coordinates": [[r] for r in rings]}

    # Capital centroid in lon/lat
    capital_lonlat = None
    capital = province.get("capital", {})
    if "position" in capital:
        try:
            cx, cy = map(float, capital["position"].split(","))
            capital_lonlat = list(game_to_lonlat(cx, cy))
        except (ValueError, AttributeError):
            pass

    properties = {
        "id": province["id"],
        "s_id": province["s_id"],
        "name": province["s_id"].replace("_x0020_", " ").replace("_", " "),
        "is_coastal": province.get("coast", False),
        "is_zone": province.get("zone", False),
        "enabled": province.get("enabled", True),
        "neighbors": province.get("neighbors", []),
        "distances": province.get("distances", []),
        "port": province.get("port"),
        "coast_port_tile": province.get("coast_port_tile"),
        "e_points": province.get("e_points", 0),
        "capital_lonlat": capital_lonlat,
    }

    return {
        "type": "Feature",
        "id": province["id"],
        "properties": properties,
        "geometry": geometry,
    }


def main():
    print(f"Reading: {INPUT_FILE}")
    with open(INPUT_FILE) as f:
        data = json.load(f)

    provinces = data["provinces"]
    print(f"Province count: {len(provinces)}")

    features = []
    skipped = 0
    for p in provinces:
        if not p.get("enabled", True):
            print(f"  Skipping disabled: {p['s_id']}")
            skipped += 1
            continue
        feature = province_to_feature(p)
        if feature:
            features.append(feature)
        else:
            print(f"  Warning: no polygons for province {p['id']} ({p['s_id']})")
            skipped += 1

    geojson = {
        "type": "FeatureCollection",
        "features": features,
        "metadata": {
            "source": "provinces_nvetbz_1.8.2.json",
            "coordinate_system": "linear_normalized",
            "canvas_bounds": {
                "x_min": X_MIN,
                "x_max": X_MAX,
                "y_min": Y_MIN,
                "y_max": Y_MAX,
            },
        },
    }

    print(f"Features generated: {len(features)}, skipped: {skipped}")
    print(f"Writing: {OUTPUT_FILE}")
    with open(OUTPUT_FILE, "w") as f:
        json.dump(geojson, f, separators=(",", ":"))

    size_kb = OUTPUT_FILE.stat().st_size / 1024
    print(f"Done. File size: {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
