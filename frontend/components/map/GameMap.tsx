"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GameRegion } from "@/hooks/useGameSocket";
import { getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";

// ── Types ────────────────────────────────────────────────────

export interface TroopAnimation {
  id: string;
  sourceId: string;
  targetId: string;
  color: string;
  units: number;
  unitType?: string | null;
  type: "attack" | "move";
  startTime: number;
  durationMs?: number;
}

interface InternalAnim {
  id: string;
  path: [number, number][];
  color: string;
  units: number;
  unitType?: string | null;
  actionType: "attack" | "move";
  animKind: "fighter" | "ship" | "tank" | "infantry";
  startTime: number;
  duration: number;
  targetCentroid: [number, number];
}

interface GameMapProps {
  tilesUrl: string;
  centroids: Record<string, [number, number]>;
  regions: Record<string, GameRegion>;
  players: Record<string, { color: string; username: string }>;
  selectedRegion: string | null;
  targetRegions: string[];
  highlightedNeighbors: string[];
  dimmedRegions: string[];
  onRegionClick: (regionId: string) => void;
  myUserId: string;
  animations: TroopAnimation[];
  buildingIcons: Record<string, string>;
  onMapReady?: () => void;
}

// ── Constants ────────────────────────────────────────────────

const DEFAULT_COLOR = "#374151";
const CAPITAL_OUTLINE = "#fbbf24";
const SELECTED_COLOR = "#3b82f6";
const TARGET_ENEMY = "#ef4444";
const TARGET_FRIENDLY = "#60a5fa";
export const ANIMATION_DURATION_MS = 2200;
const NUM_TRAIL_DOTS = 8;
const DOT_SPACING = 0.055;
const AIR_ASSET = "/assets/units/planes/bomber_h300.webp";
const SHIP_ASSET = "/assets/units/ships/ship1.png";
const TANK_ASSET = "/assets/units/ground_unit_sphere_h300.png";

function regionMarkerOffset(kind: "capital" | "buildings", buildingCount = 0): [number, number] {
  if (kind === "capital") {
    return [-28, -30];
  }
  const width = Math.min(84, 28 + buildingCount * 22);
  return [Math.round(width / 2), -24];
}

function getAnimationIconId(unitType?: string | null) {
  const normalized = (unitType || "default")
    .replace(/[^a-z0-9_-]/gi, "-")
    .toLowerCase();
  return `anim-unit-${normalized}`;
}

function resolveAnimationKind(unitType?: string | null) {
  const asset = getUnitAsset(unitType ?? "default");
  if (asset === AIR_ASSET) return "fighter";
  if (asset === SHIP_ASSET) return "ship";
  if (asset === TANK_ASSET) return "tank";
  return "infantry";
}

function loadMapImage(
  map: maplibregl.Map,
  id: string,
  url: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (map.hasImage(id)) {
      resolve();
      return;
    }

    map.loadImage(url).then(({ data: image }) => {
      if (!image) {
        reject(new Error(`Failed to load image: ${url}`));
        return;
      }

      if (!map.hasImage(id)) {
        map.addImage(id, image);
      }
      resolve();
    }).catch((error) => {
      reject(error);
    });
  });
}

// ── Geometry helpers ─────────────────────────────────────────

function computeCurvePath(
  from: [number, number],
  to: [number, number],
  offsetFactor: number,
  n: number
): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const offset = dist * offsetFactor;
  const nx = -dy / dist;
  const ny = dx / dist;
  const cpx = mx + nx * offset;
  const cpy = my + ny * offset;

  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([
      u * u * from[0] + 2 * u * t * cpx + t * t * to[0],
      u * u * from[1] + 2 * u * t * cpy + t * t * to[1],
    ]);
  }
  return pts;
}

function computeMarchPath(
  from: [number, number],
  to: [number, number],
  n = 28
): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const nx = -dy / dist;
  const ny = dx / dist;
  const wobble = Math.min(dist * 0.035, 1.4);
  const pts: [number, number][] = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wave = Math.sin(t * Math.PI * 3) * wobble * (1 - Math.abs(0.5 - t) * 1.15);
    pts.push([
      from[0] + dx * t + nx * wave,
      from[1] + dy * t + ny * wave,
    ]);
  }

  return pts;
}

function buildAnimationPath(
  kind: "fighter" | "ship" | "tank" | "infantry",
  from: [number, number],
  to: [number, number]
): [number, number][] {
  if (kind === "fighter") {
    return computeCurvePath(from, to, 0.24, 52);
  }
  if (kind === "ship") {
    return computeCurvePath(from, to, 0.04, 34);
  }
  if (kind === "tank") {
    return computeCurvePath(from, to, 0.08, 26);
  }
  return computeMarchPath(from, to, 26);
}

function easeAnimationProgress(
  kind: "fighter" | "ship" | "tank" | "infantry",
  linearProgress: number
): number {
  const t = Math.max(0, Math.min(1, linearProgress));
  if (kind === "fighter") {
    return 1 - Math.pow(1 - t, 2.2);
  }
  if (kind === "ship") {
    return t * t * (3 - 2 * t);
  }
  if (kind === "tank") {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }
  return t * t * (3 - 2 * t);
}

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] as unknown[] };

// ── Component ────────────────────────────────────────────────

export default function GameMap({
  tilesUrl,
  centroids,
  regions,
  players,
  selectedRegion,
  targetRegions,
  highlightedNeighbors,
  dimmedRegions,
  onRegionClick,
  myUserId,
  animations,
  buildingIcons,
  onMapReady,
}: GameMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoveredRef = useRef<string | null>(null);
  const onRegionClickRef = useRef(onRegionClick);
  const onMapReadyRef = useRef(onMapReady);
  // Holds the latest feature-state apply fn so the sourcedata listener can call it
  const applyFeatureStatesRef = useRef<(() => void) | null>(null);
  const animsRef = useRef<InternalAnim[]>([]);
  const rafRef = useRef(0);
  const capitalMarkersRef = useRef(new Map<string, maplibregl.Marker>());
  const buildingMarkersRef = useRef(new Map<string, maplibregl.Marker>());
  const prevRegionsRef = useRef<Record<string, GameRegion>>({});
  const prevPlayersRef = useRef<Record<string, { color: string; username: string }>>({});
  const prevMarkerRegionsRef = useRef<Record<string, GameRegion>>({});
  const [layersReady, setLayersReady] = useState(false);

  useLayoutEffect(() => { onRegionClickRef.current = onRegionClick; });
  useLayoutEffect(() => { onMapReadyRef.current = onMapReady; });

  const getRegionColor = useCallback(
    (regionId: string): string => {
      const r = regions[regionId];
      if (!r?.owner_id) return DEFAULT_COLOR;
      return players[r.owner_id]?.color || DEFAULT_COLOR;
    },
    [regions, players]
  );

  // ── Init map (once) ──────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const capitalMarkers = capitalMarkersRef.current;
    const buildingMarkers = buildingMarkersRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#08111d" },
          },
        ],
      },
      center: [15, 51],
      zoom: 4,
      maxZoom: 7,
      minZoom: 1.5,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
      capitalMarkers.forEach((marker) => marker.remove());
      capitalMarkers.clear();
      buildingMarkers.forEach((marker) => marker.remove());
      buildingMarkers.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Add sources & layers ─────────────────────────────────
  //
  // Performance: layers use feature-state expressions so paint properties
  // are set ONCE here and never rebuilt. Dynamic data is pushed via
  // setFeatureState() in the effects below — O(changed features) per tick
  // instead of O(all features) for match-expression rebuilds.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tilesUrl) return;

    const addSourceIfMissing = (id: string, spec: maplibregl.SourceSpecification) => {
      if (map.getSource(id)) return;
      try {
        map.addSource(id, spec);
      } catch (error) {
        console.error(`GameMap source failed: ${id}`, error);
      }
    };

    const addLayerIfMissing = (layer: maplibregl.LayerSpecification) => {
      if (map.getLayer(layer.id)) return;
      try {
        map.addLayer(layer);
      } catch (error) {
        console.error(`GameMap layer failed: ${layer.id}`, error);
      }
    };

    const setup = () => {
      addSourceIfMissing("regions", {
        type: "vector",
        tiles: [tilesUrl],
        minzoom: 0,
        maxzoom: 10,
        promoteId: { regions: "id" },
      });
      addSourceIfMissing("region-labels", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("anim-lines", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("anim-dots", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("anim-icons", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("defend-pulses", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("selected-marker", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      addSourceIfMissing("target-markers", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });

      addLayerIfMissing({
        id: "regions-fill",
        type: "fill",
        source: "regions",
        "source-layer": "regions",
        paint: {
          "fill-color": ["coalesce", ["feature-state", "color"], DEFAULT_COLOR],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false], 0.9,
            0.7,
          ],
        },
      });
      addLayerIfMissing({
        id: "regions-dim",
        type: "fill",
        source: "regions",
        "source-layer": "regions",
        paint: { "fill-color": "#000000", "fill-opacity": 0.45 },
        filter: ["==", ["get", "id"], ""],
      });
      addLayerIfMissing({
        id: "regions-border",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": "#1e293b", "line-width": 0.8 },
      });
      addLayerIfMissing({
        id: "regions-neighbor-glow",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: {
          "line-color": TARGET_ENEMY,
          "line-width": 2.5,
          "line-dasharray": [4, 3],
        },
        filter: ["==", ["get", "id"], ""],
      });
      addLayerIfMissing({
        id: "regions-selected",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": SELECTED_COLOR, "line-width": 3 },
        filter: ["==", ["get", "id"], ""],
      });
      addLayerIfMissing({
        id: "regions-targets",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": "#f97316", "line-width": 2.5 },
        filter: ["==", ["get", "id"], ""],
      });
      addLayerIfMissing({
        id: "regions-capital",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": CAPITAL_OUTLINE, "line-width": 3 },
        filter: ["==", ["get", "id"], ""],
      });
      addLayerIfMissing({
        id: "anim-lines",
        type: "line",
        source: "anim-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["get", "width"],
          "line-opacity": ["get", "opacity"],
          "line-blur": ["get", "blur"],
        },
      });
      addLayerIfMissing({
        id: "anim-dots",
        type: "circle",
        source: "anim-dots",
        paint: {
          "circle-radius": ["get", "size"],
          "circle-color": ["get", "color"],
          "circle-opacity": ["get", "opacity"],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#000",
          "circle-stroke-opacity": ["get", "opacity"],
        },
      });
      addLayerIfMissing({
        id: "anim-icons",
        type: "symbol",
        source: "anim-icons",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-size": ["get", "icon_size"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "map",
          "icon-rotate": ["get", "rotation"],
        },
        paint: {
          "icon-opacity": ["get", "opacity"],
        },
      });
      addLayerIfMissing({
        id: "defend-pulse",
        type: "circle",
        source: "defend-pulses",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": "rgba(0,0,0,0)",
          "circle-opacity": 0,
          "circle-stroke-width": 2.5,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-opacity": ["get", "opacity"],
        },
      });
      addLayerIfMissing({
        id: "anim-labels",
        type: "symbol",
        source: "anim-dots",
        filter: [">", ["get", "units"], 0],
        layout: {
          "text-field": ["concat", ["to-string", ["get", "units"]], " 🪖"],
          "text-size": 12,
          "text-offset": [0, -1.5],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1,
        },
      });
      addLayerIfMissing({
        id: "regions-labels",
        type: "symbol",
        source: "region-labels",
        layout: {
          "text-field": ["get", "units_text"],
          "text-size": 14,
          "text-font": ["Open Sans Bold"],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#000000",
          "text-halo-width": 1.5,
        },
      });
        if (!(map as typeof map & { __maplord_handlers_bound?: boolean }).__maplord_handlers_bound) {
          map.on("click", "regions-fill", (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) onRegionClickRef.current(id as string);
          });
          map.on("mouseenter", "regions-fill", () => {
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", "regions-fill", () => {
            map.getCanvas().style.cursor = "";
          });
          map.on("mousemove", "regions-fill", (e) => {
            if (e.features?.[0]) {
              const id = e.features[0].properties?.id as string;
              if (hoveredRef.current && hoveredRef.current !== id) {
                map.setFeatureState(
                  { source: "regions", sourceLayer: "regions", id: hoveredRef.current },
                  { hover: false }
                );
              }
              hoveredRef.current = id;
              map.setFeatureState(
                { source: "regions", sourceLayer: "regions", id },
                { hover: true }
              );
            }
          });
          map.on("sourcedata", (e) => {
            if (e.sourceId === "regions" && e.isSourceLoaded) {
              applyFeatureStatesRef.current?.();
            }
          });
          (map as typeof map & { __maplord_handlers_bound?: boolean }).__maplord_handlers_bound = true;
        }

        const baseLayersReady =
          !!map.getSource("regions") &&
          !!map.getLayer("regions-fill") &&
          !!map.getLayer("regions-border");
        if (baseLayersReady) {
          setLayersReady(true);
          onMapReadyRef.current?.();
        } else {
          console.error("GameMap setup incomplete: base layers missing");
          onMapReadyRef.current?.();
        }
    };

    const onLoad = () => setup();
    if (map.loaded()) setup();
    else map.on("load", onLoad);

    return () => {
      map.off("load", onLoad);
    };
  }, [tilesUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    let cancelled = false;

    const ensureMarkerLayers = async () => {
      try {
        await Promise.all([
          loadMapImage(map, "selected-region-marker", "/assets/units/cursor.webp"),
          loadMapImage(map, "target-region-marker", "/assets/units/moving_border.webp"),
        ]);
      } catch {
        return;
      }

      if (cancelled) return;

      try {
        if (!map.getLayer("target-markers")) {
          map.addLayer({
            id: "target-markers",
            type: "symbol",
            source: "target-markers",
            layout: {
              "icon-image": "target-region-marker",
              "icon-size": 0.34,
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: {
              "icon-opacity": 0.92,
            },
          });
        }

        if (!map.getLayer("selected-marker")) {
          map.addLayer({
            id: "selected-marker",
            type: "symbol",
            source: "selected-marker",
            layout: {
              "icon-image": "selected-region-marker",
              "icon-size": 0.52,
              "icon-offset": [0, -140],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            },
            paint: {
              "icon-opacity": 0.98,
            },
          });
        }

      } catch {
        // Marker layers are decorative. Base map should continue to work without them.
      }
    };

    void ensureMarkerLayers();

    return () => {
      cancelled = true;
    };
  }, [buildingIcons, layersReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    let cancelled = false;

    const ensureAnimationIcons = async () => {
      const distinctUnitTypes = Array.from(
        new Set(
          animations.map((animation) => animation.unitType || "default")
        )
      );

      try {
        await Promise.all(
          distinctUnitTypes.map((unitType) =>
            loadMapImage(map, getAnimationIconId(unitType), getUnitAsset(unitType))
          )
        );
      } catch (error) {
        if (!cancelled) {
          console.error("GameMap animation icon load failed", error);
        }
      }
    };

    void ensureAnimationIcons();

    return () => {
      cancelled = true;
    };
  }, [animations, layersReady]);

  // ── Effect A: per-region updates (color via feature-state, labels via setData) ──
  //
  // Runs every tick (when regions/players change).
  //
  // Colors: setFeatureState() on the vector tile source — O(n) GPU-side updates,
  //   no expression recompilation. Supported in paint properties.
  //
  // Labels/icons: setData() on a small GeoJSON point source (centroids + text).
  //   feature-state is NOT supported in layout properties (text-field), so we
  //   maintain a separate in-memory GeoJSON with only the features that need labels.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    const prevRegions = prevRegionsRef.current;
    const prevPlayers = prevPlayersRef.current;
    const changedRegionIds = new Set<string>();
    for (const [rid, region] of Object.entries(regions)) {
      if (prevRegions[rid] !== region || prevPlayers !== players) {
        changedRegionIds.add(rid);
      }
    }
    for (const rid of Object.keys(prevRegions)) {
      if (!(rid in regions)) {
        changedRegionIds.add(rid);
      }
    }

    // ① Color: feature-state on vector tile source (paint property — supported)
    const applyColors = () => {
      const regionIds = changedRegionIds.size > 0 ? Array.from(changedRegionIds) : Object.keys(regions);
      for (const rid of regionIds) {
        if (!(rid in regions)) continue;
        try {
          map.setFeatureState(
            { source: "regions", sourceLayer: "regions", id: rid },
            { color: getRegionColor(rid) }
          );
        } catch {
          // tile not yet in memory — re-applied via sourcedata listener
        }
      }
    };
    applyFeatureStatesRef.current = applyColors;
    applyColors();

    // ② Labels + building icons: small GeoJSON point source (layout property workaround)
    //    Own regions: always show unit count.
    //    Enemy/neutral: show only while an animation is flying toward that region.
    const animatedTargets = new Set(animations.map((a) => a.targetId));
    const labelFeatures: unknown[] = [];
    for (const [rid, r] of Object.entries(regions)) {
      let labelText = "";
      if (r.owner_id === myUserId || animatedTargets.has(rid)) {
        labelText = r.unit_count > 0 ? String(r.unit_count) : "";
      } else if (r.owner_id) {
        labelText = players[r.owner_id]?.username ?? "";
      }
      if (!labelText) {
        const hasBuildingAsset = r.building_type ? Boolean(buildingIcons[r.building_type]) : false;
        if (!hasBuildingAsset) continue;
      }
      const centroid = centroids[rid];
      if (!centroid) continue;
      labelFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: centroid },
        properties: {
          units_text: labelText,
        },
      });
    }
    try {
      (map.getSource("region-labels") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: labelFeatures,
      } as unknown as GeoJSON.FeatureCollection);
    } catch {
      // source not ready yet
    }

    const selectedMarker =
      selectedRegion && centroids[selectedRegion]
        ? [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: centroids[selectedRegion],
              },
              properties: {},
            },
          ]
        : [];
    const targetMarkerFeatures = targetRegions
      .map((rid) =>
        centroids[rid]
          ? {
              type: "Feature",
              geometry: { type: "Point", coordinates: centroids[rid] },
              properties: {},
            }
          : null
      )
      .filter(Boolean);
    try {
      (map.getSource("selected-marker") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: selectedMarker,
      } as unknown as GeoJSON.FeatureCollection);
      (map.getSource("target-markers") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features: targetMarkerFeatures,
      } as unknown as GeoJSON.FeatureCollection);
    } catch {
      // sources not ready yet
    }

    prevRegionsRef.current = regions;
    prevPlayersRef.current = players;

  }, [
    regions,
    players,
    myUserId,
    animations,
    getRegionColor,
    buildingIcons,
    centroids,
    layersReady,
    selectedRegion,
    targetRegions,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    const capitalMarkers = capitalMarkersRef.current;
    const buildingMarkers = buildingMarkersRef.current;
    const prevMarkerRegions = prevMarkerRegionsRef.current;

    const desiredCapitalIds = new Set<string>();
    const desiredBuildingIds = new Set<string>();
    const changedRegionIds = new Set<string>();

    for (const [regionId, region] of Object.entries(regions)) {
      if (prevMarkerRegions[regionId] !== region) {
        changedRegionIds.add(regionId);
      }
    }
    for (const regionId of Object.keys(prevMarkerRegions)) {
      if (!(regionId in regions)) {
        changedRegionIds.add(regionId);
      }
    }

    for (const [regionId, region] of Object.entries(regions)) {
      const centroid = centroids[regionId];
      if (!centroid) continue;

      if (region.is_capital) {
        desiredCapitalIds.add(regionId);
      }

      const buildingEntries = Object.entries(region.buildings ?? {})
        .filter(([, count]) => count > 0)
        .map(([slug, count]) => {
          const assetKey = buildingIcons[slug] || slug;
          const assetUrl = getBuildingAsset(assetKey);
          return assetUrl ? { slug, count, assetUrl } : null;
        })
        .filter((entry): entry is { slug: string; count: number; assetUrl: string } => !!entry);
      if (buildingEntries.length > 0) {
        desiredBuildingIds.add(regionId);
      }

      if (!changedRegionIds.has(regionId)) {
        continue;
      }

      if (region.is_capital) {
        const existing = capitalMarkers.get(regionId);
        if (existing) {
          existing.setLngLat(centroid);
        } else {
          const element = document.createElement("div");
          element.className = "pointer-events-none select-none";
          element.innerHTML =
            '<img src="/assets/units/capital_star.png" alt="" draggable="false" style="width:26px;height:26px;display:block;filter:drop-shadow(0 0 10px rgba(251,191,36,0.55));" />';
          capitalMarkers.set(
            regionId,
            new maplibregl.Marker({
              element,
              anchor: "center",
              offset: regionMarkerOffset("capital"),
            })
              .setLngLat(centroid)
              .addTo(map)
          );
        }
      } else {
        const existing = capitalMarkers.get(regionId);
        if (existing) {
          existing.remove();
          capitalMarkers.delete(regionId);
        }
      }

      const existing = buildingMarkers.get(regionId);
      if (buildingEntries.length === 0) {
        if (existing) {
          existing.remove();
          buildingMarkers.delete(regionId);
        }
        continue;
      }
      const buildingOffset = regionMarkerOffset("buildings", buildingEntries.length);
      const markerHtml = `
        <div style="display:flex;align-items:center;gap:4px;padding:4px 7px;border:1px solid rgba(255,255,255,0.1);border-radius:999px;background:rgba(8,17,29,0.88);backdrop-filter:blur(10px);box-shadow:0 6px 16px rgba(8,17,29,0.45);">
          ${buildingEntries
            .map(
              ({ slug, count, assetUrl }) => `
                <div title="${slug}" style="position:relative;width:22px;height:22px;flex:0 0 auto;">
                  <img src="${assetUrl}" alt="" draggable="false" style="width:22px;height:22px;display:block;filter:drop-shadow(0 0 6px rgba(8,17,29,0.7));" />
                  ${
                    count > 1
                      ? `<span style="position:absolute;right:-5px;bottom:-5px;min-width:14px;height:14px;padding:0 3px;border-radius:999px;background:rgba(2,6,23,0.95);border:1px solid rgba(255,255,255,0.1);font-size:9px;line-height:12px;color:#fff;text-align:center;">${count}</span>`
                      : ""
                  }
                </div>
              `
            )
            .join("")}
        </div>
      `;
      if (existing) {
        existing.setLngLat(centroid);
        existing.setOffset(buildingOffset);
        const element = existing.getElement();
        if (element.innerHTML !== markerHtml) {
          element.innerHTML = markerHtml;
        }
      } else {
        const element = document.createElement("div");
        element.className = "pointer-events-none select-none";
        element.innerHTML = markerHtml;
        buildingMarkers.set(
          regionId,
          new maplibregl.Marker({
            element,
            anchor: "center",
            offset: buildingOffset,
          })
            .setLngLat(centroid)
            .addTo(map)
        );
      }
    }

    capitalMarkers.forEach((marker, regionId) => {
      if (!desiredCapitalIds.has(regionId)) {
        marker.remove();
        capitalMarkers.delete(regionId);
      }
    });

    buildingMarkers.forEach((marker, regionId) => {
      if (!desiredBuildingIds.has(regionId)) {
        marker.remove();
        buildingMarkers.delete(regionId);
      }
    });

    prevMarkerRegionsRef.current = regions;

    return () => {
      if (!mapRef.current) {
        capitalMarkers.forEach((marker) => marker.remove());
        capitalMarkers.clear();
        buildingMarkers.forEach((marker) => marker.remove());
        buildingMarkers.clear();
      }
    };
  }, [regions, centroids, buildingIcons, layersReady]);

  // ── Effect B: selection & highlight filters/opacity ───────────────────
  //
  // Only runs when selection / neighbors change — not on every game tick.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !layersReady) return;

    try {
      // Opacity: hover handled in paint expression; selected / target via case
      const opacityExpr: unknown[] = [
        "case",
        ["boolean", ["feature-state", "hover"], false], 0.9,
      ];
      if (selectedRegion) opacityExpr.push(["==", ["get", "id"], selectedRegion], 0.95);
      if (targetRegions.length > 0)
        opacityExpr.push(["in", ["get", "id"], ["literal", targetRegions]], 0.92);
      opacityExpr.push(0.7);
      map.setPaintProperty("regions-fill", "fill-opacity", opacityExpr);

      // Capital outlines
      const capitalIds = Object.entries(regions)
        .filter(([, r]) => r.is_capital)
        .map(([id]) => id);
      map.setFilter(
        "regions-capital",
        capitalIds.length > 0
          ? ["in", ["get", "id"], ["literal", capitalIds]]
          : ["==", ["get", "id"], ""]
      );

      // Selected outline
      map.setFilter(
        "regions-selected",
        selectedRegion
          ? ["==", ["get", "id"], selectedRegion]
          : ["==", ["get", "id"], ""]
      );

      // Selected targets outline (multi-target)
      map.setFilter(
        "regions-targets",
        targetRegions.length > 0
          ? ["in", ["get", "id"], ["literal", targetRegions]]
          : ["==", ["get", "id"], ""]
      );

      // Dim overlay — invalid regions during capital selection
      map.setFilter(
        "regions-dim",
        dimmedRegions.length > 0
          ? ["in", ["get", "id"], ["literal", dimmedRegions]]
          : ["==", ["get", "id"], ""]
      );

      // Neighbor highlights
      if (highlightedNeighbors.length > 0) {
        map.setFilter("regions-neighbor-glow", [
          "in", ["get", "id"], ["literal", highlightedNeighbors],
        ]);
        // Max 2 colors → simple match is fine here (small, infrequent)
        const nColorExpr: unknown[] = ["match", ["get", "id"]];
        for (const nid of highlightedNeighbors) {
          nColorExpr.push(
            nid,
            regions[nid]?.owner_id === myUserId ? TARGET_FRIENDLY : TARGET_ENEMY
          );
        }
        nColorExpr.push(TARGET_ENEMY);
        map.setPaintProperty("regions-neighbor-glow", "line-color", nColorExpr);
      } else {
        map.setFilter("regions-neighbor-glow", ["==", ["get", "id"], ""]);
      }
    } catch {
      // map not ready
    }
  }, [selectedRegion, targetRegions, highlightedNeighbors, dimmedRegions, myUserId, regions, layersReady]);

  // ── Sync animation props → internal ref ──────────────────

  useEffect(() => {
    const newAnims: InternalAnim[] = [];
    for (const a of animations) {
      if (animsRef.current.some((x) => x.id === a.id)) continue;
      const from = centroids[a.sourceId];
      const to = centroids[a.targetId];
      if (!from || !to) continue;
      const animKind = resolveAnimationKind(a.unitType);
      newAnims.push({
        id: a.id,
        path: buildAnimationPath(animKind, from, to),
        color: a.color,
        units: a.units,
        unitType: a.unitType,
        actionType: a.type,
        animKind,
        startTime: a.startTime,
        duration:
          a.durationMs ??
          (animKind === "fighter"
            ? 1100
            : animKind === "ship"
              ? 3200
              : animKind === "tank"
                ? 2400
                : 1900),
        targetCentroid: to,
      });
    }
    if (newAnims.length > 0) {
      animsRef.current = [...animsRef.current, ...newAnims];
    }
  }, [animations, centroids]);

  // ── rAF animation loop ───────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const tick = () => {
      if (!map.getSource("anim-lines") || !map.getSource("anim-dots") || !map.getSource("anim-icons")) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = Date.now();
      animsRef.current = animsRef.current.filter(
        (a) => now - a.startTime < a.duration + 400
      );

      const lineFeats: unknown[] = [];
      const dotFeats: unknown[] = [];
      const iconFeats: unknown[] = [];
      const pulseFeats: unknown[] = [];
      for (const a of animsRef.current) {
        const progress = easeAnimationProgress(a.animKind, Math.min((now - a.startTime) / a.duration, 1));
        const fadeOut = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1;
        const animKind = a.animKind;
        const animColor =
          animKind === "fighter"
            ? "#f59e0b"
            : animKind === "ship"
              ? "#38bdf8"
              : a.color;
        const iconName = getAnimationIconId(a.unitType);
        const pulseColor =
          animKind === "fighter"
            ? "#fbbf24"
            : animKind === "ship"
              ? "#38bdf8"
              : "#ef4444";
        const lineWidth =
          animKind === "fighter"
            ? 4.5
            : animKind === "ship"
              ? 3.2
              : animKind === "tank"
                ? 3.4
                : 2.4;
        const lineBlur =
          animKind === "fighter"
            ? 1.2
            : animKind === "ship"
              ? 0.2
              : 0.15;
        const trailDots =
          animKind === "fighter"
            ? 4
            : animKind === "ship"
              ? 5
              : animKind === "tank"
                ? 6
                : NUM_TRAIL_DOTS + 2;

        lineFeats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: a.path },
          properties: {
            color: animColor,
            opacity:
              animKind === "fighter"
                ? 0.85 * fadeOut
                : animKind === "ship"
                  ? 0.5 * fadeOut
                  : animKind === "tank"
                    ? 0.48 * fadeOut
                    : 0.35 * fadeOut,
            width: lineWidth,
            blur: lineBlur,
          },
        });

        for (let i = 0; i < trailDots; i++) {
          const dp = progress - i * DOT_SPACING;
          if (dp < 0 || dp > 1) continue;
          const idx = Math.min(
            Math.floor(dp * (a.path.length - 1)),
            a.path.length - 1
          );
          dotFeats.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: a.path[idx] },
            properties: {
              color: animColor,
              units: i === 0 ? a.units : 0,
              opacity: (1 - (i / trailDots) * 0.7) * fadeOut,
              size:
                i === 0
                  ? animKind === "fighter"
                    ? 6
                    : animKind === "ship"
                      ? 5.5
                      : animKind === "tank"
                        ? 7
                        : 5.5
                  : Math.max(2.2, animKind === "infantry" ? 3.8 - i * 0.22 : 4.5 - i * 0.35),
            },
          });
        }

        const headIndex = Math.min(
          Math.floor(progress * (a.path.length - 1)),
          a.path.length - 1
        );
        const nextIndex = Math.min(headIndex + 1, a.path.length - 1);
        const currentPoint = a.path[headIndex];
        const nextPoint = a.path[nextIndex];
        const rotation =
          currentPoint && nextPoint
            ? Math.atan2(nextPoint[0] - currentPoint[0], nextPoint[1] - currentPoint[1]) * (180 / Math.PI)
            : 0;
        iconFeats.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: currentPoint },
          properties: {
            icon: iconName,
            icon_size:
              animKind === "fighter"
                ? 0.42
                : animKind === "ship"
                  ? 0.28
                  : animKind === "tank"
                    ? 0.28
                    : 0.2,
            rotation,
            opacity: fadeOut,
          },
        });

        // Defender pulse rings — 3 concentric expanding rings at the target centroid
        // Each ring is offset by 1/3 of the cycle so they stagger continuously
        if (a.actionType === "attack" && progress > 0.58) {
          for (let ring = 0; ring < 3; ring++) {
            const phase = ((progress - 0.58) * 4 + ring / 3) % 1;
            pulseFeats.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: a.targetCentroid },
              properties: {
                radius: 8 + phase * 44,
                color: pulseColor,
                opacity: (1 - phase) * 0.75 * fadeOut,
              },
            });
          }
        }
      }

      try {
        (map.getSource("anim-lines") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: lineFeats,
        } as unknown as GeoJSON.FeatureCollection);
        (map.getSource("anim-dots") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: dotFeats,
        } as unknown as GeoJSON.FeatureCollection);
        (map.getSource("anim-icons") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: iconFeats,
        } as unknown as GeoJSON.FeatureCollection);
        (map.getSource("defend-pulses") as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: pulseFeats,
        } as unknown as GeoJSON.FeatureCollection);
      } catch {
        // source not ready
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      className="h-full w-full bg-[#08111d]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(5,10,18,0.72), rgba(5,10,18,0.72)), url('/assets/map_textures/mapka_coast.webp'), url('/assets/ui/hex_bg_tile.webp')",
        backgroundSize: "cover, cover, 220px",
        backgroundPosition: "center, center, center",
      }}
    >
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
