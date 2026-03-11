"use client";

import { useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GameRegion } from "@/hooks/useGameSocket";

// ── Types ────────────────────────────────────────────────────

export interface TroopAnimation {
  id: string;
  sourceId: string;
  targetId: string;
  color: string;
  units: number;
  type: "attack" | "move";
  startTime: number;
}

interface InternalAnim {
  id: string;
  path: [number, number][];
  color: string;
  units: number;
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

// ── Geometry helpers ─────────────────────────────────────────

function computeArc(
  from: [number, number],
  to: [number, number],
  n = 40
): [number, number][] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return [from, to];

  const mx = (from[0] + to[0]) / 2;
  const my = (from[1] + to[1]) / 2;
  const offset = dist * 0.15;
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
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#0f172a" },
          },
        ],
      },
      center: [15, 51],
      zoom: 4,
      maxZoom: 7,   // cap zoom — too many tiles at high zoom
      minZoom: 4,   // prevent zooming out to a point where tiny tile count is wasteful
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
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

    const setup = () => {
      if (map.getSource("regions")) return;

      // Vector tile source — MapLibre requests only tiles in the current viewport
      map.addSource("regions", {
        type: "vector",
        tiles: [tilesUrl],
        minzoom: 0,
        maxzoom: 10,          // don't request higher-resolution tiles than zoom 10
        promoteId: { regions: "id" },
      });

      // Label source: small point GeoJSON (centroid + text) updated via setData().
      // Needed because feature-state is NOT supported in layout properties like text-field.
      map.addSource("region-labels", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });

      map.addSource("anim-lines", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      map.addSource("anim-dots", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });
      map.addSource("defend-pulses", {
        type: "geojson",
        data: EMPTY_FC as unknown as GeoJSON.FeatureCollection,
      });

      // 1. Region fill — color driven by feature-state (set per-tick via setFeatureState)
      map.addLayer({
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

      // 2. Dim overlay — darkens regions that are invalid during capital selection
      map.addLayer({
        id: "regions-dim",
        type: "fill",
        source: "regions",
        "source-layer": "regions",
        paint: { "fill-color": "#000000", "fill-opacity": 0.45 },
        filter: ["==", ["get", "id"], ""],
      });

      // 3. Region border
      map.addLayer({
        id: "regions-border",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": "#1e293b", "line-width": 0.8 },
      });

      // 3. Neighbor highlight (valid targets) — controlled via setFilter
      map.addLayer({
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

      // 4. Selected source border
      map.addLayer({
        id: "regions-selected",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": SELECTED_COLOR, "line-width": 3 },
        filter: ["==", ["get", "id"], ""],
      });

      // 5b. Selected targets outline (multi-target)
      map.addLayer({
        id: "regions-targets",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": "#f97316", "line-width": 2.5 },
        filter: ["==", ["get", "id"], ""],
      });

      // 5. Capital outline
      map.addLayer({
        id: "regions-capital",
        type: "line",
        source: "regions",
        "source-layer": "regions",
        paint: { "line-color": CAPITAL_OUTLINE, "line-width": 3 },
        filter: ["==", ["get", "id"], ""],
      });

      // 6. Animation lines
      map.addLayer({
        id: "anim-lines",
        type: "line",
        source: "anim-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": ["get", "opacity"],
          "line-dasharray": [4, 3],
        },
      });

      // 7. Animation dots
      map.addLayer({
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

      // 8. Defender pulse rings — pulsing concentric circles at attacked region centroid
      map.addLayer({
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

      // 9. Animation labels
      map.addLayer({
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

      // 9. Region unit labels — from region-labels GeoJSON source (["get", "units_text"])
      //    Only included in the source for owned regions or the current attack target.
      map.addLayer({
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

      // 10. Building icons — from same region-labels GeoJSON source
      map.addLayer({
        id: "regions-building-icons",
        type: "symbol",
        source: "region-labels",
        layout: {
          "text-field": ["get", "building_icon"],
          "text-size": 20,
          "text-offset": [0, 1.2],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 2,
        },
      });

      // 11. Capital star icon — shown above the unit/name label
      map.addLayer({
        id: "regions-capital-icon",
        type: "symbol",
        source: "region-labels",
        filter: ["!=", ["get", "capital_icon"], ""],
        layout: {
          "text-field": ["get", "capital_icon"],
          "text-size": 18,
          "text-offset": [0, -1.4],
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-halo-color": "rgba(0,0,0,0.8)",
          "text-halo-width": 2,
        },
      });

      // Click / hover events
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

      // Re-apply feature states whenever new tiles are loaded into memory
      map.on("sourcedata", (e) => {
        if (e.sourceId === "regions" && e.isSourceLoaded) {
          applyFeatureStatesRef.current?.();
        }
      });

      setLayersReady(true);
      onMapReadyRef.current?.();
    };

    if (map.loaded()) setup();
    else map.on("load", setup);
  }, [tilesUrl]);

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

    // ① Color: feature-state on vector tile source (paint property — supported)
    const applyColors = () => {
      for (const [rid] of Object.entries(regions)) {
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
      const buildingIcon = r.building_type ? (buildingIcons[r.building_type] ?? "") : "";
      const capitalIcon = r.is_capital ? "⭐" : "";
      if (!labelText && !buildingIcon && !capitalIcon) continue;
      const centroid = centroids[rid];
      if (!centroid) continue;
      labelFeatures.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: centroid },
        properties: {
          units_text: labelText,
          building_icon: buildingIcon,
          capital_icon: capitalIcon,
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
  }, [regions, players, myUserId, animations, getRegionColor, buildingIcons, centroids, layersReady]);

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
      newAnims.push({
        id: a.id,
        path: computeArc(from, to),
        color: a.color,
        units: a.units,
        startTime: a.startTime,
        duration: ANIMATION_DURATION_MS,
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
      if (!map.getSource("anim-lines") || !map.getSource("anim-dots")) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = Date.now();
      animsRef.current = animsRef.current.filter(
        (a) => now - a.startTime < a.duration + 400
      );

      const lineFeats: unknown[] = [];
      const dotFeats: unknown[] = [];
      const pulseFeats: unknown[] = [];

      for (const a of animsRef.current) {
        const progress = Math.min((now - a.startTime) / a.duration, 1);
        const fadeOut = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1;

        lineFeats.push({
          type: "Feature",
          geometry: { type: "LineString", coordinates: a.path },
          properties: { color: a.color, opacity: 0.4 * fadeOut },
        });

        for (let i = 0; i < NUM_TRAIL_DOTS; i++) {
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
              color: a.color,
              units: i === 0 ? a.units : 0,
              opacity: (1 - (i / NUM_TRAIL_DOTS) * 0.7) * fadeOut,
              size: i === 0 ? 8 : 5 - i * 0.3,
            },
          });
        }

        // Defender pulse rings — 3 concentric expanding rings at the target centroid
        // Each ring is offset by 1/3 of the cycle so they stagger continuously
        for (let ring = 0; ring < 3; ring++) {
          const phase = (progress * 2 + ring / 3) % 1; // cycle twice over animation duration
          pulseFeats.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: a.targetCentroid },
            properties: {
              radius: 8 + phase * 44,           // grows from 8px to 52px
              color: "#ef4444",
              opacity: (1 - phase) * 0.75 * fadeOut,
            },
          });
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
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return <div ref={containerRef} className="h-full w-full" />;
}
