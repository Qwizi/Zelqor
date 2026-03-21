"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Graphics, Text, Container, TextStyle, Assets, Sprite, Texture } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { GameRegion, ActiveEffect, WeatherState, AirTransitItem } from "@/hooks/useGameSocket";
import type { TroopAnimation, PlannedMove } from "@/lib/gameTypes";
import { PixiAnimationManager } from "@/lib/pixiAnimations";
import type { CosmeticValue } from "@/lib/animationConfig";
import { getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";

// ── Shape data types ──────────────────────────────────────────

export interface ProvinceShape {
  id: string;
  name: string;
  /** Sub-polygons for MultiPolygon regions (e.g. islands).
   *  Each sub-polygon: [exterior_ring, hole1?, hole2?, ...]
   *  Each ring: [[x, y], [x, y], ...] in pixel space */
  polygons: number[][][][];
  /** [x, y] in pixel space (pre-projected) */
  centroid: [number, number];
  neighbors: string[];
  is_coastal: boolean;
  population_weight: number;
  /** Texture chunk coords this province covers: ["cx,cy", ...] */
  tile_chunks?: string[];
}

export interface ShapesBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

export interface WorldTextureMapping {
  x: number; // pixel X of game coord origin in canvas space
  y: number; // pixel Y of game coord origin in canvas space
  w: number; // pixel width of full game world in canvas space
  h: number; // pixel height of full game world in canvas space
}

export interface ShapesData {
  regions: ProvinceShape[];
  bounds: ShapesBounds;
  world_texture?: WorldTextureMapping;
}

// ── Component props ───────────────────────────────────────────

export interface GameCanvasProps {
  shapesData: ShapesData | null;
  regions: Record<string, GameRegion>;
  players: Record<string, { color: string; username: string; cosmetics?: Record<string, unknown> }>;
  selectedRegion: string | null;
  targetRegions: string[];
  highlightedNeighbors: string[];
  dimmedRegions: string[];
  onRegionClick: (regionId: string) => void;
  onDoubleTap?: (regionId: string) => void;
  myUserId: string;
  animations: TroopAnimation[];
  buildingIcons: Record<string, string>;
  activeEffects?: ActiveEffect[];
  nukeBlackout?: Array<{ rid: string; startTime: number }>;
  onMapReady?: () => void;
  initialZoom?: number;
  weather?: WeatherState;
  airTransitQueue?: AirTransitItem[];
  onFlightClick?: (flightId: string) => void;
  /** slug → manpower_cost for air unit display. */
  unitManpowerMap?: Record<string, number>;
  plannedMoves?: PlannedMove[];
}

// ── Internal render state ─────────────────────────────────────

interface ProvinceRenderState {
  graphics: Graphics;
  label: Text;
  labelBg: Graphics;
  buildingLabel: Text;
  /** Hex color number of the current fill — used to detect owner change */
  fillColor: number;
  ownerId: string | null;
}

// ── Effect config ─────────────────────────────────────────────

const EFFECT_CONFIG: Record<string, { color: string; borderColor: string; icon: string; symbol: string }> = {
  ab_virus:              { color: "#22c55e", borderColor: "#16a34a", icon: "/assets/abilities/ab_virus.webp",              symbol: "☣" },
  ab_shield:             { color: "#3b82f6", borderColor: "#60a5fa", icon: "/assets/abilities/ab_shield.webp",             symbol: "🛡" },
  ab_pr_submarine:       { color: "#a855f7", borderColor: "#c084fc", icon: "/assets/abilities/ab_pr_submarine.webp",       symbol: "⚓" },
  ab_province_nuke:      { color: "#ef4444", borderColor: "#f87171", icon: "/assets/abilities/ab_province_nuke.webp",      symbol: "☢" },
  ab_conscription_point: { color: "#f59e0b", borderColor: "#fbbf24", icon: "/assets/abilities/ab_conscription_point.webp", symbol: "⚔" },
  ab_flash:              { color: "#fbbf24", borderColor: "#f59e0b", icon: "⚡", symbol: "💡" },
};

// ── Color constants ───────────────────────────────────────────

const BG_COLOR = 0x08111d;
const DEFAULT_FILL = 0x1a2332;
const DEFAULT_STROKE = 0x1a3a2d;
const SELECTED_STROKE = 0xffffff;
const TARGET_STROKE = 0xef4444;
const NEIGHBOR_TINT = 0x2a4060;
const CAPITAL_FILL = 0xfbbf24;
const DIMMED_ALPHA = 0.25;
const NORMAL_ALPHA = 0.60; // semi-transparent so terrain texture shows through
const UNCLAIMED_FILL_ALPHA = 0.0; // unclaimed provinces: no fill, terrain shows through
const STROKE_WIDTH_DEFAULT = 2;
const STROKE_WIDTH_SELECTED = 3;
const STROKE_WIDTH_TARGET = 2;

// ── Unit pulse config ─────────────────────────────────────────

const UNIT_PULSE_DURATION_MS = 1200;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Parse a CSS hex color string like "#a1b2c3" or "#abc" into a Pixi color
 * number (0xRRGGBB). Falls back to DEFAULT_FILL on invalid input.
 */
function hexStringToNumber(hex: string): number {
  if (!hex) return DEFAULT_FILL;
  const clean = hex.replace("#", "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return (r << 16) | (g << 8) | b;
  }
  if (clean.length === 6) {
    return parseInt(clean, 16);
  }
  return DEFAULT_FILL;
}

/** Lighten a packed hex color number by a given factor (0–1). */
function lighten(color: number, factor: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + Math.round(factor * 255));
  const g = Math.min(255, ((color >> 8) & 0xff) + Math.round(factor * 80));
  const b = Math.min(255, (color & 0xff) + Math.round(factor * 80));
  return (r << 16) | (g << 8) | b;
}

/**
 * Draw the outer ring of a polygon onto a Graphics object, then fill and
 * stroke it. Holes (additional rings) are excluded — full hole support
 * would require a custom mask or earcut, which adds complexity for minimal
 * visual gain at game-map zoom levels.
 */
function drawPolygon(
  gfx: Graphics,
  outerRing: number[][],
  fillColor: number,
  strokeColor: number,
  strokeWidth: number,
  fillAlpha = 1.0
): void {
  if (outerRing.length < 3) return;

  const flatPoints: number[] = [];
  for (const pt of outerRing) {
    flatPoints.push(pt[0], pt[1]);
  }

  gfx.poly(flatPoints, true).fill({ color: fillColor, alpha: fillAlpha }).stroke({
    color: strokeColor,
    width: strokeWidth,
    alpha: 1.0,
  });
}

/** Build a star/diamond capital marker centred at (cx, cy) with given half-size. */
function drawCapitalMarker(gfx: Graphics, cx: number, cy: number, size: number): void {
  // Outer glow ring
  gfx.circle(cx, cy, size + 3).stroke({ color: CAPITAL_FILL, width: 1.5, alpha: 0.4 });
  // Diamond shape
  gfx
    .poly([cx, cy - size, cx + size, cy, cx, cy + size, cx - size, cy], true)
    .fill({ color: CAPITAL_FILL, alpha: 1 })
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.9 });
}

// ── Main component ────────────────────────────────────────────

export default function GameCanvas({
  shapesData,
  regions,
  players,
  selectedRegion,
  targetRegions,
  highlightedNeighbors,
  dimmedRegions,
  onRegionClick,
  onDoubleTap,
  myUserId,
  animations,
  buildingIcons: _buildingIcons,
  activeEffects,
  nukeBlackout,
  onMapReady,
  initialZoom = 1,
  weather,
  airTransitQueue,
  onFlightClick,
  unitManpowerMap,
  plannedMoves,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const [appReady, setAppReady] = useState(false);
  const provinceLayerRef = useRef<Container | null>(null);
  const labelLayerRef = useRef<Container | null>(null);
  const capitalLayerRef = useRef<Container | null>(null);
  const effectLayerRef = useRef<Container | null>(null);
  const nukeLayerRef = useRef<Container | null>(null);
  const unitChangeLayerRef = useRef<Container | null>(null);
  const weatherOverlayRef = useRef<Graphics | null>(null);
  const gridLayerRef = useRef<Graphics | null>(null);
  const animManagerRef = useRef<PixiAnimationManager | null>(null);
  const airTransitLayerRef = useRef<Container | null>(null);
  const capitalRadarRef = useRef<Graphics | null>(null);
  const weatherParticlesRef = useRef<Graphics | null>(null);
  const plannedMovesLayerRef = useRef<Container | null>(null);
  const plannedMovesRef = useRef(plannedMoves);
  plannedMovesRef.current = plannedMoves;

  /** Per-province render state — Graphics, Text, cached owner/fill */
  const stateMapRef = useRef<Map<string, ProvinceRenderState>>(new Map());
  /** Track which animation IDs have been registered with the manager */
  const registeredAnimsRef = useRef<Set<string>>(new Set());

  // Unit change pulse tracking
  const prevUnitCountsRef = useRef<Map<string, number>>(new Map());
  const prevUnitOwnersRef = useRef<Map<string, string | null>>(new Map());
  const unitPulsesRef = useRef<Map<string, { startTime: number; delta: number }>>(new Map());

  /** Snapshot of the previous regions state — used to diff tick updates. */
  const prevRegionsRef = useRef<Record<string, GameRegion>>({});

  /** Temporary visual adjustments from bombardment — subtracted from displayed unit_count
   *  until the next tick confirms the actual state. Keyed by region ID. */
  const bombardAdjustRef = useRef<Map<string, number>>(new Map());

  // Stable ref wrappers for props used inside Pixi event callbacks so we
  // don't have to tear down / rebuild interactivity on every render.
  const onRegionClickRef = useRef(onRegionClick);
  onRegionClickRef.current = onRegionClick;

  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;

  const onFlightClickRef = useRef(onFlightClick);
  onFlightClickRef.current = onFlightClick;

  const lastTapRef = useRef<{ regionId: string; time: number } | null>(null);

  const regionsRef = useRef(regions);
  regionsRef.current = regions;

  const playersRef = useRef(players);
  playersRef.current = players;

  const selectedRegionRef = useRef(selectedRegion);
  selectedRegionRef.current = selectedRegion;

  const targetRegionsRef = useRef(targetRegions);
  targetRegionsRef.current = targetRegions;

  const highlightedNeighborsRef = useRef(highlightedNeighbors);
  highlightedNeighborsRef.current = highlightedNeighbors;

  const dimmedRegionsRef = useRef(dimmedRegions);
  dimmedRegionsRef.current = dimmedRegions;


  // Stable refs for animations and activeEffects — used inside drawProvince
  // without causing the callback to rebuild on every render.
  const animationsRef = useRef(animations);
  animationsRef.current = animations;

  const activeEffectsRef = useRef(activeEffects);
  activeEffectsRef.current = activeEffects;

  const airTransitQueueRef = useRef(airTransitQueue);
  airTransitQueueRef.current = airTransitQueue;

  const unitManpowerMapRef = useRef(unitManpowerMap);
  unitManpowerMapRef.current = unitManpowerMap;

  const shapesDataRef = useRef(shapesData);
  shapesDataRef.current = shapesData;

  const weatherRef = useRef(weather);
  weatherRef.current = weather;

  // Dirty-region rendering: track previous region snapshot + structural generation.
  const prevRegionSnapshotRef = useRef<Record<string, GameRegion>>({});
  const structuralGenRef = useRef(0);
  const prevStructuralGenRef = useRef(-1);
  // Bump structural gen when non-region deps change (selection, highlights, etc.)
  useEffect(() => {
    structuralGenRef.current++;
  }, [selectedRegion, targetRegions, highlightedNeighbors, dimmedRegions, airTransitQueue, unitManpowerMap]);

  // Track recently bombed provinces — keep showing unit count for 5s after bombing.
  const recentlyBombedRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const handler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string; count: number }>).detail;
      recentlyBombedRef.current.set(regionId, Date.now());
    };
    window.addEventListener("bomb-drop", handler);
    // Also listen for path_damage via a dedicated event
    const pathHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string }>).detail;
      recentlyBombedRef.current.set(regionId, Date.now());
    };
    window.addEventListener("province-bombed", pathHandler);
    // Listen for path_damage events to spawn bomb visuals at damaged provinces
    const pathDamageBombHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string; killed: number }>).detail;
      const sd = shapesDataRef.current;
      const mgr = animManagerRef.current;
      if (!sd || !mgr) return;
      const shape = sd.regions.find((s) => s.id === regionId);
      if (!shape) return;
      const [cx, cy] = shape.centroid;
      // spawnBombingSalvoAt spreads 2 bombs around the centroid
      if (typeof mgr.spawnBombingSalvoAt === "function") {
        mgr.spawnBombingSalvoAt(cx, cy, false);
      } else {
        // Fallback for HMR — use the older single-bomb method
        mgr.spawnBombAt(cx, cy);
      }
    };
    window.addEventListener("path-damage-bomb", pathDamageBombHandler);
    // Listen for artillery bombardment damage — show floating "-N" label on target
    // AND immediately update the Pixi label in-place (no React re-render needed).
    const bombardDamageHandler = (e: Event) => {
      const { regionId, killed } = (e as CustomEvent<{ regionId: string; killed: number }>).detail;
      if (killed > 0) {
        unitPulsesRef.current.set(regionId, { startTime: Date.now(), delta: -killed });
        // Accumulate visual adjustment
        const prev = bombardAdjustRef.current.get(regionId) ?? 0;
        bombardAdjustRef.current.set(regionId, prev + killed);
        // Directly update the Pixi Text label — parse current number and subtract
        const state = stateMapRef.current.get(regionId);
        if (state) {
          const match = state.label.text.match(/(\d+)/);
          if (match) {
            const current = parseInt(match[1], 10);
            const newCount = Math.max(0, current - killed);
            state.label.text = newCount > 0 ? `▸ ${newCount}` : "";
          }
        }
      }
      recentlyBombedRef.current.set(regionId, Date.now());
    };
    window.addEventListener("bombard-damage", bombardDamageHandler);
    // Clear bombardAdjust when all rockets have landed — province shows real state
    const bombardCompleteHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string }>).detail;
      bombardAdjustRef.current.delete(regionId);
      recentlyBombedRef.current.delete(regionId);
    };
    window.addEventListener("bombard-complete", bombardCompleteHandler);
    // Cleanup stale entries every 5s
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [rid, ts] of recentlyBombedRef.current) {
        if (now - ts > 3000) recentlyBombedRef.current.delete(rid);
      }
    }, 5000);
    return () => {
      window.removeEventListener("bomb-drop", handler);
      window.removeEventListener("province-bombed", pathHandler);
      window.removeEventListener("path-damage-bomb", pathDamageBombHandler);
      window.removeEventListener("bombard-damage", bombardDamageHandler);
      window.removeEventListener("bombard-complete", bombardCompleteHandler);
      clearInterval(interval);
    };
  }, []);

  // ── Province drawing helper ──────────────────────────────────

  const drawProvince = useCallback(
    (
      id: string,
      shape: ProvinceShape,
      state: ProvinceRenderState,
      isHovered: boolean
    ) => {
      const region = regionsRef.current[id];
      // If rockets are still in flight (bombardAdjust active), keep showing the
      // previous owner so the province doesn't visually neutralize before impact.
      const hasPendingBombard = (bombardAdjustRef.current.get(id) ?? 0) > 0;
      const prevOwner = prevUnitOwnersRef.current.get(id) ?? null;
      const ownerId = (hasPendingBombard && !region?.owner_id && prevOwner)
        ? prevOwner
        : (region?.owner_id ?? null);
      const player = ownerId ? playersRef.current[ownerId] : null;

      const isSelected = selectedRegionRef.current === id;
      const isTarget = targetRegionsRef.current.includes(id);
      const isNeighbor = highlightedNeighborsRef.current.includes(id);
      const isDimmed = dimmedRegionsRef.current.includes(id);

      // Determine fill color
      let baseFill: number = DEFAULT_FILL;
      if (player) {
        baseFill = hexStringToNumber(player.color);
      }
      // TODO: If playerCosmetics.flag is set, render flag texture as province background.
      // The flag slot value is a URL (or { url }) pointing to a texture image. When present,
      // the province polygon should be filled with the flag texture (tiled or stretched) at
      // low opacity instead of / beneath the solid player color. Implement by loading the
      // texture via Assets.load() and using a textured Graphics fill once Pixi.js supports it,
      // or by compositing a Sprite masked to the province polygon outline.
      // Resolve: const flagUrl = player.cosmetics?.flag (string | { url: string } | undefined)
      if (isNeighbor) {
        if (!player) {
          baseFill = NEIGHBOR_TINT;
        } else {
          // Slightly lighten enemy/owned territories to indicate reachability
          baseFill = lighten(baseFill, 0.08);
        }
      }
      if (isHovered) {
        baseFill = lighten(baseFill, 0.15);
      }

      // Determine stroke
      const isCapital = region?.is_capital ?? false;
      let strokeColor = DEFAULT_STROKE;
      let strokeWidth = STROKE_WIDTH_DEFAULT;
      if (isSelected) {
        strokeColor = SELECTED_STROKE;
        strokeWidth = STROKE_WIDTH_SELECTED;
      } else if (isTarget) {
        strokeColor = TARGET_STROKE;
        strokeWidth = STROKE_WIDTH_TARGET;
      } else if (isNeighbor) {
        strokeColor = 0x22d3ee; // cyan highlight for reachable regions
        strokeWidth = 2;
      } else if (isCapital) {
        strokeColor = CAPITAL_FILL; // golden outline
        strokeWidth = 2;
      }

      const alpha = isDimmed
        ? DIMMED_ALPHA
        : ownerId
          ? NORMAL_ALPHA
          : UNCLAIMED_FILL_ALPHA;

      // Redraw
      const gfx = state.graphics;
      gfx.clear();

      // Draw all sub-polygons (MultiPolygon regions have multiple, e.g. islands)
      for (const subPoly of shape.polygons) {
        const outerRing = subPoly[0];
        if (outerRing && outerRing.length >= 3) {
          drawPolygon(gfx, outerRing, baseFill, strokeColor, strokeWidth, alpha);
          // Selected province: double stroke — player color at 3px, then white at 1.5px on top
          if (isSelected) {
            const playerColor = player ? hexStringToNumber(player.color) : SELECTED_STROKE;
            const flatPoints: number[] = [];
            for (const pt of outerRing) {
              flatPoints.push(pt[0], pt[1]);
            }
            gfx.poly(flatPoints, true).stroke({ color: playerColor, width: 3, alpha: 1.0 });
            gfx.poly(flatPoints, true).stroke({ color: 0xffffff, width: 1.5, alpha: 1.0 });
          }
        }
      }

      // Hatch pattern on enemy provinces (diagonal lines — military map style).
      // Drawn as a separate pass so the fill polygon acts as visual context.
      if (ownerId && ownerId !== myUserId && !isDimmed) {
        for (const subPoly of shape.polygons) {
          const outerRing = subPoly[0];
          if (!outerRing || outerRing.length < 3) continue;
          const xs = outerRing.map((p) => p[0]);
          const ys = outerRing.map((p) => p[1]);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const spacing = 12;
          // Clip diagonal lines to the polygon bounding box.
          // Lines follow y = d - x (45° diagonal, d = x + y = constant).
          for (let d = minX + minY; d < maxX + maxY; d += spacing) {
            const x1 = Math.max(minX, d - maxY);
            const y1 = d - x1;
            const x2 = Math.min(maxX, d - minY);
            const y2 = d - x2;
            if (y1 >= minY && y1 <= maxY && y2 >= minY && y2 <= maxY) {
              gfx.moveTo(x1, y1).lineTo(x2, y2);
            }
          }
          gfx.stroke({ color: 0x000000, width: 0.8, alpha: 0.12 });
        }
      }

      state.fillColor = baseFill;
      state.ownerId = ownerId;

      // Update label — show unit count for own + attacked + sub-revealed regions;
      // show short username for other owned regions.
      const label = state.label;
      if (region) {
        const isOwner = ownerId === myUserId;

        // Reveal unit count only when actively being attacked (animation in flight),
        // NOT when merely selected as a target — player shouldn't know before attacking
        const isAnimTarget = animationsRef.current.some(
          (a) => a.targetId === id && a.type === "attack"
        );

        // Check whether this region is revealed by submarine effect
        const isSubRevealed = activeEffectsRef.current?.some(
          (e) => e.effect_type === "ab_pr_submarine" && e.affected_region_ids.includes(id)
        ) ?? false;

        // Show unit count on enemy provinces being bombed (in active bomber flight paths)
        // OR recently bombed (keep visible for a few seconds after flight ends).
        const isBombed = airTransitQueueRef.current?.some(
          (f) => f.mission_type === "bomb_run" && f.flight_path?.includes(id)
        ) ?? false;
        const wasRecentlyBombed = recentlyBombedRef.current.has(id);
        const showUnitCount = isOwner || isAnimTarget || isSubRevealed || isBombed || wasRecentlyBombed;

        if (showUnitCount) {
          const units = region.units ?? {};
          const mpMap = unitManpowerMapRef.current ?? {};
          const bombAdj = bombardAdjustRef.current.get(id) ?? 0;

          // Infantry = raw count minus manpower reserved by special units
          const infantryRaw = units["infantry"] ?? 0;
          let reserved = 0;
          for (const [slug, count] of Object.entries(units)) {
            if (slug !== "infantry" && count > 0) {
              reserved += count * (mpMap[slug] ?? 1);
            }
          }
          const infantryAvailable = Math.max(0, infantryRaw - reserved);
          const infantryDisplay = Math.max(0, infantryAvailable - bombAdj);

          // Collect non-infantry unit counts for breakdown
          const UNIT_SYMBOLS: Record<string, string> = {
            tank: "T",
            artillery: "A",
            ship: "S",
            submarine: "U",
            fighter: "F",
            bomber: "B",
            commando: "C",
            sam: "M",
            nuke_rocket: "N",
          };
          const parts: string[] = [];
          for (const [slug, symbol] of Object.entries(UNIT_SYMBOLS)) {
            const count = units[slug] ?? 0;
            if (count > 0) {
              const mp = count * (mpMap[slug] ?? 1);
              parts.push(`${symbol}${count}(${mp})`);
            }
          }

          // Full breakdown on selected/hovered province, compact on others
          const isDetailed = isSelected || isHovered;
          let specialCount = 0;
          let specialMp = 0;
          for (const [slug] of Object.entries(UNIT_SYMBOLS)) {
            const count = units[slug] ?? 0;
            if (count > 0) {
              specialCount += count;
              specialMp += count * (mpMap[slug] ?? 1);
            }
          }

          if (isDetailed) {
            // Full: ▸ 319 | A1(25) F1(100) B1(100)
            const extras = parts.length > 0 ? ` | ${parts.join(" ")}` : "";
            if (infantryDisplay > 0 || parts.length > 0) {
              label.text = infantryDisplay > 0
                ? `▸ ${infantryDisplay}${extras}`
                : `▸${extras}`;
            } else {
              label.text = "";
            }
          } else {
            // Compact: ▸ 319  or  ▸ 319+3  (infantry + number of special units)
            if (infantryDisplay > 0 && specialCount > 0) {
              label.text = `▸ ${infantryDisplay}+${specialCount}`;
            } else if (infantryDisplay > 0) {
              label.text = `▸ ${infantryDisplay}`;
            } else if (specialCount > 0) {
              label.text = `▸ +${specialCount}`;
            } else {
              label.text = "";
            }
          }
        } else if (ownerId && player) {
          // Show short username for enemies
          label.text = player.username.slice(0, 8);
        } else {
          label.text = "";
        }
      } else {
        label.text = "";
      }

      label.alpha = isDimmed ? 0.5 : 1.0;

      // Draw sharp-cornered military stencil rect behind label for readability
      const bg = state.labelBg;
      bg.clear();
      if (label.text && label.text.length > 0) {
        const textW = Math.max(label.text.length * 9, 20);
        const textH = 18;
        const [lx, ly] = shape.centroid;
        const isEnemy = ownerId !== null && ownerId !== myUserId;
        const bgColor = isEnemy ? 0x1a0a0a : 0x0a1a0a;
        const borderColor = isEnemy ? 0x4a2a2a : 0x2a4a2a;
        bg.rect(lx - textW / 2 - 4, ly - textH / 2 - 1, textW + 8, textH + 2)
          .fill({ color: bgColor, alpha: 0.72 })
          .stroke({ color: borderColor, width: 1, alpha: 0.6 });
        bg.alpha = isDimmed ? 0.3 : 1.0;
      }

      // Building badge is now rendered as sprites in the capital layer
      state.buildingLabel.text = "";
      state.buildingLabel.alpha = isDimmed ? 0.4 : 0.85;
    },
    []
  );

  // ── Build province graphics when shapesData arrives ──────────

  useEffect(() => {
    if (!shapesData || !appReady || !appRef.current || !viewportRef.current) return;

    const viewport = viewportRef.current;
    const provinceLayer = provinceLayerRef.current!;
    const labelLayer = labelLayerRef.current!;
    const capitalLayer = capitalLayerRef.current!;

    // Tear down any previously built province graphics
    for (const s of stateMapRef.current.values()) {
      s.graphics.destroy();
      s.label.destroy();
      s.labelBg.destroy();
      s.buildingLabel.destroy();
    }
    stateMapRef.current.clear();
    provinceLayer.removeChildren();
    labelLayer.removeChildren();
    capitalLayer.removeChildren();

    const GAME_FONT = "Rajdhani, sans-serif";
    const TEXT_RESOLUTION = 3; // render text at 3x for crisp zoom

    const labelStyle = new TextStyle({
      fontFamily: GAME_FONT,
      fontSize: 11,
      fill: 0xffffff,
      fontWeight: "bold",
      dropShadow: {
        color: 0x000000,
        blur: 3,
        distance: 1,
        alpha: 0.85,
        angle: Math.PI / 4,
      },
      align: "center",
    });

    const buildingLabelStyle = new TextStyle({
      fontFamily: GAME_FONT,
      fontSize: 11,
      fill: 0xffd700,
      fontWeight: "600",
      dropShadow: {
        color: 0x000000,
        blur: 2,
        distance: 1,
        alpha: 0.7,
        angle: Math.PI / 4,
      },
      align: "center",
    });

    for (const shape of shapesData.regions) {
      const gfx = new Graphics();
      gfx.eventMode = "static";
      gfx.cursor = "pointer";

      const label = new Text({ text: "", style: labelStyle, resolution: TEXT_RESOLUTION });
      label.anchor.set(0.5, 0.5);
      label.position.set(shape.centroid[0], shape.centroid[1]);
      label.eventMode = "none";

      // Dark background behind label for readability
      const labelBg = new Graphics();
      labelBg.eventMode = "none";

      // Building badge sits just below the centroid label
      const buildingLabel = new Text({ text: "", style: buildingLabelStyle, resolution: TEXT_RESOLUTION });
      buildingLabel.anchor.set(0.5, 0.5);
      buildingLabel.position.set(shape.centroid[0], shape.centroid[1] + 13);
      buildingLabel.eventMode = "none";

      const renderState: ProvinceRenderState = {
        graphics: gfx,
        label,
        labelBg,
        buildingLabel,
        fillColor: DEFAULT_FILL,
        ownerId: null,
      };

      stateMapRef.current.set(shape.id, renderState);

      // Initial draw
      drawProvince(shape.id, shape, renderState, false);

      // Interaction
      gfx.on("pointerdown", () => {
        const now = Date.now();
        const last = lastTapRef.current;

        if (last && last.regionId === shape.id && now - last.time < 350) {
          // Double-tap detected
          onDoubleTapRef.current?.(shape.id);
          lastTapRef.current = null;
        } else {
          lastTapRef.current = { regionId: shape.id, time: now };
          onRegionClickRef.current(shape.id);
        }
      });

      gfx.on("pointerover", () => {
        drawProvince(shape.id, shape, renderState, true);
      });

      gfx.on("pointerout", () => {
        drawProvince(shape.id, shape, renderState, false);
      });

      provinceLayer.addChild(gfx);
      labelLayer.addChild(labelBg); // bg behind text
      labelLayer.addChild(label);
      labelLayer.addChild(buildingLabel);
    }

    // Terrain texture — 27×16 chunks (276×308 px each = 7452×4928 total).
    // Province terrain is baked into chunks (chunks_game/).
    {
      const CHUNKS_X = 27;
      const CHUNKS_Y = 16;
      const CHUNK_W = 276;
      const CHUNK_H = 308;
      const MAP_W = CHUNKS_X * CHUNK_W; // 7452
      const MAP_H = CHUNKS_Y * CHUNK_H; // 4928

      const terrainContainer = new Container();
      terrainContainer.eventMode = "none";
      terrainContainer.cullable = true;

      const wt = shapesData.world_texture;
      if (wt) {
        terrainContainer.position.set(wt.x, wt.y);
        terrainContainer.scale.set(wt.w / MAP_W, wt.h / MAP_H);
      } else {
        const { min_x, min_y, max_x, max_y } = shapesData.bounds;
        terrainContainer.position.set(min_x, min_y);
        terrainContainer.scale.set((max_x - min_x) / MAP_W, (max_y - min_y) / MAP_H);
      }

      for (let cx = 0; cx < CHUNKS_X; cx++) {
        for (let cy = 0; cy < CHUNKS_Y; cy++) {
          const url = `/assets/map_textures/map09/chunks_game/${cx}x${cy}.webp`;
          const slotX = cx * CHUNK_W;
          const slotY = cy * CHUNK_H;
          Assets.load(url).then((texture: Texture) => {
            if (!viewportRef.current) return;
            const sprite = new Sprite(texture);
            sprite.position.set(slotX, slotY);
            sprite.width = CHUNK_W;
            sprite.height = CHUNK_H;
            terrainContainer.addChild(sprite);
          }).catch(() => {});
        }
      }

      viewport.addChildAt(terrainContainer, 0);
    }

    // Tactical grid overlay — draw after world bounds are known
    {
      const gridLayer = gridLayerRef.current;
      if (gridLayer) {
        gridLayer.clear();
        const wt = shapesData.world_texture;
        const gridSpacing = 200;
        const minX = wt ? wt.x : shapesData.bounds.min_x;
        const minY = wt ? wt.y : shapesData.bounds.min_y;
        const maxX = wt ? wt.x + wt.w : shapesData.bounds.max_x;
        const maxY = wt ? wt.y + wt.h : shapesData.bounds.max_y;
        for (let x = minX; x <= maxX; x += gridSpacing) {
          gridLayer.moveTo(x, minY).lineTo(x, maxY);
        }
        for (let y = minY; y <= maxY; y += gridSpacing) {
          gridLayer.moveTo(minX, y).lineTo(maxX, y);
        }
        gridLayer.stroke({ color: 0x4a6a4a, width: 0.5 });
      }
    }

    // Fit viewport to world on first load
    const { min_x, min_y, max_x, max_y } = shapesData.bounds;
    const worldW = max_x - min_x;
    const worldH = max_y - min_y;
    viewport.resize(
      viewport.screenWidth,
      viewport.screenHeight,
      worldW,
      worldH
    );
    viewport.fit(true, worldW, worldH);
    // Ensure minimum zoom so map isn't too zoomed out
    const currentScale = viewport.scale.x;
    if (currentScale < 0.7) {
      viewport.setZoom(0.7, true);
    }
    if (initialZoom !== 1) {
      viewport.setZoom(initialZoom, true);
    }
    // Lock camera so the user cannot pan outside the map bounds
    viewport.clamp({
      left: min_x,
      right: max_x,
      top: min_y,
      bottom: max_y,
      direction: "all",
      underflow: "center",
    });

    onMapReady?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesData, appReady]);

  // ── Re-draw all provinces when game state changes ─────────────

  useEffect(() => {
    if (!shapesData) return;

    // Detect unit count changes for own regions and register pulses.
    // Only show delta if I owned the region on BOTH previous and current tick,
    // to avoid showing huge "+N" when capturing a neutral/enemy province.
    const now = Date.now();
    const prevCounts = prevUnitCountsRef.current;
    const prevOwners = prevUnitOwnersRef.current;
    const isSeeded = prevCounts.size > 0;

    // Clear stale bombardAdjust entries — keep only those with active rockets.
    // Entries are removed by bombard-complete event; this is a safety net for
    // entries older than 5s that somehow missed cleanup.
    for (const [rid, adj] of bombardAdjustRef.current) {
      const bombedAt = recentlyBombedRef.current.get(rid) ?? 0;
      if (adj > 0 && now - bombedAt > 5000) {
        bombardAdjustRef.current.delete(rid);
      }
    }

    for (const [rid, region] of Object.entries(regions)) {
      if (isSeeded && region.owner_id === myUserId) {
        const prevOwner = prevOwners.get(rid);
        const prevCount = prevCounts.get(rid);
        // Only show +N for unit generation on provinces I already owned.
        // Skip: newly captured, sending troops away (negative), bombardment targets.
        const hasBombAdj = (bombardAdjustRef.current.get(rid) ?? 0) > 0;
        if (prevOwner === myUserId && prevCount !== undefined && !hasBombAdj) {
          const delta = region.unit_count - prevCount;
          // Only small positive deltas (unit gen is 1-3 per tick, not 50+)
          if (delta > 0 && delta <= 10) {
            unitPulsesRef.current.set(rid, { startTime: now, delta });
          }
        }
      }
      prevCounts.set(rid, region.unit_count);
      prevOwners.set(rid, region.owner_id);
    }

    // Re-draw capitals and building sprites
    const capitalLayer = capitalLayerRef.current;
    if (capitalLayer) {
      capitalLayer.removeChildren().forEach((child) => child.destroy());
      const shapeMap = new Map<string, ProvinceShape>();
      for (const s of shapesData.regions) {
        shapeMap.set(s.id, s);
      }
      for (const [rid, region] of Object.entries(regions)) {
        const shape = shapeMap.get(rid);
        if (!shape) continue;
        const [cx, cy] = shape.centroid;

        // Capital star sprite
        if (region.is_capital) {
          Assets.load("/assets/units/capital_star.png").then((texture: Texture) => {
            if (!capitalLayerRef.current) return;
            const sprite = new Sprite(texture);
            sprite.anchor.set(0.5, 0.5);
            sprite.width = 26;
            sprite.height = 26;
            sprite.position.set(cx - 28, cy - 30);
            sprite.eventMode = "none";
            capitalLayerRef.current.addChild(sprite);
          }).catch(() => {
            // Fallback to diamond if sprite fails
            if (!capitalLayerRef.current) return;
            const cap = new Graphics();
            cap.eventMode = "none";
            drawCapitalMarker(cap, cx, cy - 18, 7);
            capitalLayerRef.current.addChild(cap);
          });
        }

        // Building sprites
        const buildingEntries: Array<{ slug: string; count: number; url: string }> = [];
        if (region.building_instances && region.building_instances.length > 0) {
          const counts: Record<string, number> = {};
          for (const bi of region.building_instances) {
            counts[bi.building_type] = (counts[bi.building_type] || 0) + 1;
          }
          for (const [slug, count] of Object.entries(counts)) {
            const url = getBuildingAsset(slug);
            if (url) buildingEntries.push({ slug, count, url });
          }
        } else if (region.buildings) {
          for (const [slug, count] of Object.entries(region.buildings)) {
            if (count <= 0) continue;
            const url = getBuildingAsset(slug);
            if (url) buildingEntries.push({ slug, count, url });
          }
        }

        // Place building icons in a circle around the centroid
        if (buildingEntries.length > 0) {
          const bldgContainer = new Container();
          bldgContainer.eventMode = "none";
          bldgContainer.position.set(cx, cy);

          const ICON_SIZE = 16;
          const RADIUS = 22; // distance from centroid
          const startAngle = -Math.PI / 2; // top
          const totalItems = buildingEntries.length;

          let itemIndex = 0;
          for (const entry of buildingEntries) {
            // Spread evenly around the circle
            const angle = startAngle + (itemIndex / totalItems) * Math.PI * 2;
            const ix = Math.cos(angle) * RADIUS;
            const iy = Math.sin(angle) * RADIUS;
            const capturedIx = ix;
            const capturedIy = iy;
            const capturedCount = entry.count;
            itemIndex++;

            Assets.load(entry.url).then((texture: Texture) => {
              if (!capitalLayerRef.current) return;

              // Small dark circle behind the icon
              const bg = new Graphics();
              bg.circle(capturedIx, capturedIy, ICON_SIZE / 2 + 3)
                .fill({ color: 0x0a1628, alpha: 0.85 })
                .stroke({ color: 0x2a3a50, width: 1, alpha: 0.6 });
              bldgContainer.addChild(bg);

              const sprite = new Sprite(texture);
              sprite.anchor.set(0.5, 0.5);
              sprite.width = ICON_SIZE;
              sprite.height = ICON_SIZE;
              sprite.position.set(capturedIx, capturedIy);
              bldgContainer.addChild(sprite);

              if (capturedCount > 1) {
                const countText = new Text({
                  text: String(capturedCount),
                  style: new TextStyle({
                    fontFamily: "Rajdhani, sans-serif",
                    fontSize: 9,
                    fill: 0xffffff,
                    fontWeight: "bold",
                    dropShadow: { color: 0x000000, blur: 2, distance: 0, alpha: 1, angle: 0 },
                  }),
                  resolution: 3,
                });
                countText.anchor.set(0.5, 0.5);
                countText.position.set(capturedIx + ICON_SIZE / 2 + 2, capturedIy + ICON_SIZE / 2);
                bldgContainer.addChild(countText);
              }
            }).catch(() => {});
          }
          capitalLayer.addChild(bldgContainer);
        }
      }
    }

    // Dirty-region rendering: only redraw provinces that actually changed.
    // Full redraw triggered by structural deps (selectedRegion, neighbors, etc.)
    // tracked via a generation counter. Tick-driven region updates are incremental.
    const structuralGen = structuralGenRef.current;
    const prevStructGen = prevStructuralGenRef.current;
    const needsFullRedraw = structuralGen !== prevStructGen;
    prevStructuralGenRef.current = structuralGen;

    if (needsFullRedraw) {
      // Full redraw — structural change (selection, highlights, etc.)
      for (const shape of shapesData.regions) {
        const state = stateMapRef.current.get(shape.id);
        if (state) drawProvince(shape.id, shape, state, false);
      }
    } else {
      // Incremental — only redraw regions whose data changed this tick.
      const prev = prevRegionSnapshotRef.current;
      for (const shape of shapesData.regions) {
        const rid = shape.id;
        const curr = regions[rid];
        const p = prev[rid];
        if (!curr) continue;
        // Always redraw if bombardment adjustment is pending
        const hasBombAdj = (bombardAdjustRef.current.get(rid) ?? 0) > 0;
        if (!hasBombAdj && p && p.unit_count === curr.unit_count && p.owner_id === curr.owner_id &&
            p.is_capital === curr.is_capital && p.building_type === curr.building_type) {
          continue; // unchanged — skip redraw
        }
        const state = stateMapRef.current.get(rid);
        if (state) drawProvince(rid, shape, state, false);
      }
    }
    // Shallow snapshot of unit_count + owner for next diff (avoid ref aliasing)
    const snapshot: Record<string, GameRegion> = {};
    for (const [rid, r] of Object.entries(regions)) {
      snapshot[rid] = r;
    }
    prevRegionSnapshotRef.current = snapshot;
  }, [
    shapesData,
    regions,
    players,
    selectedRegion,
    targetRegions,
    highlightedNeighbors,
    dimmedRegions,
    myUserId,
    drawProvince,
    airTransitQueue,
  ]);

  // ── Sync animations with the manager ──────────────────────────

  useEffect(() => {
    const manager = animManagerRef.current;
    if (!manager || !shapesData) return;

    // Build centroid lookup from shapesData
    const centroidMap = new Map<string, [number, number]>();
    for (const s of shapesData.regions) {
      centroidMap.set(s.id, s.centroid);
    }

    for (const anim of animations) {
      if (registeredAnimsRef.current.has(anim.id)) continue;

      const src = centroidMap.get(anim.sourceId);
      const tgt = centroidMap.get(anim.targetId);
      if (!src || !tgt) continue;

      const playerCosmetics = anim.playerId
        ? (players[anim.playerId]?.cosmetics as Record<string, CosmeticValue> | undefined)
        : undefined;

      manager.addAnimation(anim, src, tgt, playerCosmetics);
      registeredAnimsRef.current.add(anim.id);
    }

    // Bound the set to prevent unbounded growth
    if (registeredAnimsRef.current.size > 1000) {
      registeredAnimsRef.current.clear();
    }
  }, [animations, shapesData, players]);

  // ── Air transit: create TroopAnimations from air_transit_queue state ──
  // Track which flight IDs have been registered as animations.
  const registeredFlightsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!airTransitQueue || airTransitQueue.length === 0 || !shapesData) return;

    // Build centroid lookup for waypoint computation.
    const centroids = new Map<string, [number, number]>();
    for (const s of shapesData.regions) centroids.set(s.id, s.centroid);

    const tickMs = 1000;
    const newAnims: TroopAnimation[] = [];

    // Build the full set of IDs currently active (flights + escorts + interceptors)
    // so we can clean up stale registered entries correctly.
    const activeIds = new Set<string>();

    for (const flight of airTransitQueue) {
      activeIds.add(flight.id);
      if (flight.escort_fighters > 0 && flight.unit_type === "bomber") {
        const numEscorts = Math.min(flight.escort_fighters, 4);
        for (let ei = 0; ei < numEscorts; ei++) {
          activeIds.add(`${flight.id}_escort_${ei}`);
        }
      }
      // Interceptor IDs not tracked here — rendered in ticker instead.
    }

    for (const flight of airTransitQueue) {
      if (!registeredFlightsRef.current.has(flight.id)) {
        registeredFlightsRef.current.add(flight.id);

        const color = players[flight.player_id]?.color ?? "#888888";

        // Calculate manpower — bomber animation shows bomber-only count.
        const mainManpower = flight.units * (unitManpowerMap?.[flight.unit_type] ?? 1);

        // Build bombing waypoints from flight_path province IDs → centroids.
        // The bomber animation will fly through these centroids and drop bombs
        // at each hop, synchronized with the engine's tick-by-tick path_damage.
        let bombingWaypoints: [number, number][] | undefined;
        let totalHops: number | undefined;
        if (flight.unit_type === "bomber" && flight.flight_path && flight.flight_path.length >= 2) {
          bombingWaypoints = flight.flight_path
            .map((rid) => centroids.get(rid))
            .filter((c): c is [number, number] => !!c);
          totalHops = flight.flight_path.length;
        }

        newAnims.push({
          id: flight.id,
          sourceId: flight.source_region_id,
          targetId: flight.target_region_id,
          color,
          units: mainManpower,
          unitCount: flight.units,
          unitType: flight.unit_type,
          type: "attack" as const,
          startTime: Date.now() - (flight.progress / flight.speed_per_tick) * tickMs,
          durationMs: (1.0 / flight.speed_per_tick) * tickMs,
          playerId: flight.player_id,
          bombingWaypoints,
          totalHops,
        });

        // Separate escort fighter animation following the SAME path as bomber.
        // Render each escort fighter as a separate animation beside the bomber.
        // Each gets a perpendicular offset so they fly in formation.
        if (flight.escort_fighters > 0 && flight.unit_type === "bomber") {
          const fighterMc = unitManpowerMap?.["fighter"] ?? 1;
          const numEscorts = Math.min(flight.escort_fighters, 4); // max 4 visible escorts
          const offsets = [-18, 18, -32, 32]; // px offsets from bomber path
          for (let ei = 0; ei < numEscorts; ei++) {
            const escortId = `${flight.id}_escort_${ei}`;
            activeIds.add(escortId);
            if (registeredFlightsRef.current.has(escortId)) continue;
            registeredFlightsRef.current.add(escortId);
            newAnims.push({
              id: escortId,
              sourceId: flight.source_region_id,
              targetId: flight.target_region_id,
              color,
              units: fighterMc,
              unitCount: 1,
              unitType: "fighter",
              type: "move" as const,
              startTime: Date.now() - (flight.progress / flight.speed_per_tick) * tickMs,
              durationMs: (1.0 / flight.speed_per_tick) * tickMs,
              playerId: flight.player_id,
              bombingWaypoints,
              totalHops,
              pathOffset: offsets[ei],
            });
          }
        }
      }

      // Interceptors are rendered in the ticker (not as TroopAnimations)
      // because they chase the bomber's moving position, not a fixed province.
    }

    // Update unit count labels on already-registered flights.
    // Bomber loses units during path bombing — engine updates air_transit_queue.
    const manager = animManagerRef.current;
    if (manager) {
      for (const flight of airTransitQueue) {
        if (registeredFlightsRef.current.has(flight.id)) {
          const mainManpower = flight.units * (unitManpowerMap?.[flight.unit_type] ?? 1);
          manager.updateAnimationLabel(flight.id, mainManpower);
        }

        // Escort labels: each escort is 1 fighter, label stays at 1 (no update needed).

        // Interceptor visuals handled in ticker (chase bomber position).
      }
    }

    // Clean up finished flights and their escort/interceptor animations.
    for (const id of registeredFlightsRef.current) {
      if (!activeIds.has(id)) registeredFlightsRef.current.delete(id);
    }
    if (registeredFlightsRef.current.size > 300) registeredFlightsRef.current.clear();

    if (newAnims.length > 0 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("air-transit-anims", { detail: newAnims }));
    }
  }, [airTransitQueue, players, shapesData, unitManpowerMap]);

  // ── Unit change floating labels ────────────────────────────────

  useEffect(() => {
    const app = appRef.current;
    const unitChangeLayer = unitChangeLayerRef.current;
    const shapesSnapshot = shapesData;
    if (!app || !unitChangeLayer || !shapesSnapshot) return;

    // Build centroid lookup once
    const centroidMap = new Map<string, [number, number]>();
    for (const s of shapesSnapshot.regions) {
      centroidMap.set(s.id, s.centroid);
    }

    // Track Text objects for active pulses so we can destroy them
    const activeTexts = new Map<string, Text>();

    const makePulseStyle = (color: number) => new TextStyle({
      fontFamily: "Rajdhani, sans-serif",
      fontSize: 16,
      fontWeight: "bold",
      fill: color,
      align: "center",
      dropShadow: {
        color: 0x000000,
        blur: 4,
        distance: 1,
        alpha: 0.9,
        angle: Math.PI / 4,
      },
    });

    const tickerFn = () => {
      const now = Date.now();
      const pulses = unitPulsesRef.current;

      for (const [rid, pulse] of pulses.entries()) {
        const elapsed = now - pulse.startTime;

        if (elapsed >= UNIT_PULSE_DURATION_MS) {
          // Pulse expired — clean up
          const existing = activeTexts.get(rid);
          if (existing) {
            unitChangeLayer.removeChild(existing);
            existing.destroy();
            activeTexts.delete(rid);
          }
          pulses.delete(rid);
          continue;
        }

        const progress = elapsed / UNIT_PULSE_DURATION_MS;
        // Ease-out opacity: full for first 60%, then fade
        const opacity = progress < 0.6 ? 1.0 : 1.0 - (progress - 0.6) / 0.4;
        // Drift upward: max 20px upward over duration
        const yOffset = -20 * progress;

        let txt = activeTexts.get(rid);
        if (!txt) {
          // Create new Text for this pulse
          const centroid = centroidMap.get(rid);
          if (!centroid) continue;

          const isPositive = pulse.delta > 0;
          const color = isPositive ? 0x4ade80 : 0xf87171;
          const label = isPositive ? `+${pulse.delta}` : String(pulse.delta);

          txt = new Text({ text: label, style: makePulseStyle(color), resolution: 3 });
          txt.anchor.set(0.5, 0.5);
          txt.position.set(centroid[0], centroid[1] - 20); // start above centroid
          txt.eventMode = "none";
          unitChangeLayer.addChild(txt);
          activeTexts.set(rid, txt);
        }

        // Update position and opacity
        const centroid = centroidMap.get(rid);
        if (centroid) {
          txt.position.set(centroid[0], centroid[1] - 20 + yOffset);
        }
        txt.alpha = opacity;
      }
    };

    app.ticker.add(tickerFn);

    return () => {
      app.ticker.remove(tickerFn);
      // Destroy any remaining label texts
      for (const txt of activeTexts.values()) {
        if (!txt.destroyed) {
          unitChangeLayer.removeChild(txt);
          txt.destroy();
        }
      }
      activeTexts.clear();
    };
  // Re-register ticker when app or shapesData changes; pulse data lives in the ref
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appReady, shapesData]);

  // ── Draw ability effect overlays ───────────────────────────────

  useEffect(() => {
    const effectLayer = effectLayerRef.current;
    if (!effectLayer || !shapesData) return;

    // Clear all previous effect graphics
    effectLayer.removeChildren().forEach((child) => child.destroy());

    if (!activeEffects || activeEffects.length === 0) return;

    // Build a lookup from region id → shape for O(1) access
    const shapeMap = new Map<string, ProvinceShape>();
    for (const s of shapesData.regions) {
      shapeMap.set(s.id, s);
    }

    /**
     * Draw a dashed polygon border onto `gfx` by breaking each edge into
     * alternating on/off segments. dashLen and gapLen are in world-pixel units.
     */
    function drawDashedBorder(
      gfx: Graphics,
      ring: number[][],
      color: number,
      width: number,
      dashLen = 8,
      gapLen = 5
    ): void {
      if (ring.length < 2) return;
      // Close the ring explicitly so the last edge is drawn
      const pts = ring[ring.length - 1][0] !== ring[0][0] || ring[ring.length - 1][1] !== ring[0][1]
        ? [...ring, ring[0]]
        : ring;

      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const dx = x1 - x0;
        const dy = y1 - y0;
        const edgeLen = Math.sqrt(dx * dx + dy * dy);
        if (edgeLen === 0) continue;
        const ux = dx / edgeLen;
        const uy = dy / edgeLen;

        let t = 0;
        let drawing = true;
        while (t < edgeLen) {
          const segLen = drawing ? dashLen : gapLen;
          const tEnd = Math.min(t + segLen, edgeLen);
          if (drawing) {
            gfx
              .moveTo(x0 + ux * t, y0 + uy * t)
              .lineTo(x0 + ux * tEnd, y0 + uy * tEnd)
              .stroke({ color, width, alpha: 1.0, cap: "round" });
          }
          t = tEnd;
          drawing = !drawing;
        }
      }
    }

    for (const effect of activeEffects) {
      const cfg = EFFECT_CONFIG[effect.effect_type];
      if (!cfg) continue;

      // Collect all region ids this effect covers
      const regionIds = new Set<string>([
        effect.target_region_id,
        ...effect.affected_region_ids,
      ]);

      const fillColor = hexStringToNumber(cfg.color);
      const borderColor = hexStringToNumber(cfg.borderColor);

      for (const rid of regionIds) {
        const shape = shapeMap.get(rid);
        if (!shape) continue;

        // Draw effect overlay on all sub-polygons
        const gfx = new Graphics();
        let hasDrawn = false;
        for (const subPoly of shape.polygons) {
          const outerRing = subPoly[0];
          if (!outerRing || outerRing.length < 3) continue;
          hasDrawn = true;
          const flatPoints: number[] = [];
          for (const pt of outerRing) {
            flatPoints.push(pt[0], pt[1]);
          }
          gfx.poly(flatPoints, true).fill({ color: fillColor, alpha: 0.25 });
          drawDashedBorder(gfx, outerRing, borderColor, 2.5);
        }
        if (!hasDrawn) continue;
        effectLayer.addChild(gfx);

        // Symbol badge at centroid
        const [cx, cy] = shape.centroid;

        const circle = new Graphics();
        circle
          .circle(cx, cy, 9)
          .fill({ color: borderColor, alpha: 0.9 })
          .stroke({ color: 0xffffff, width: 1, alpha: 0.7 });
        effectLayer.addChild(circle);

        const badge = new Text({
          text: cfg.symbol,
          style: new TextStyle({
            fontSize: 10,
            fill: 0xffffff,
            align: "center",
          }),
        });
        badge.anchor.set(0.5, 0.5);
        badge.position.set(cx, cy);
        badge.eventMode = "none";
        effectLayer.addChild(badge);
      }
    }
  }, [activeEffects, shapesData]);

  // ── Nuke blackout overlays ─────────────────────────────────────

  useEffect(() => {
    const nukeLayer = nukeLayerRef.current;
    const app = appRef.current;
    if (!nukeLayer || !shapesData || !app) return;

    // Clear previous overlays
    nukeLayer.removeChildren().forEach((child) => child.destroy());

    if (!nukeBlackout || nukeBlackout.length === 0) return;

    const shapeMap = new Map<string, ProvinceShape>();
    for (const s of shapesData.regions) {
      shapeMap.set(s.id, s);
    }

    const FADE_DURATION_MS = 5000;

    // Build graphics for each blacked-out region
    const overlays: Array<{ gfx: Graphics; startTime: number }> = [];

    for (const entry of nukeBlackout) {
      const shape = shapeMap.get(entry.rid);
      if (!shape) continue;
      const gfx = new Graphics();
      let hasDrawn = false;
      for (const subPoly of shape.polygons) {
        const outerRing = subPoly[0];
        if (!outerRing || outerRing.length < 3) continue;
        hasDrawn = true;
        const flatPoints: number[] = [];
        for (const pt of outerRing) {
          flatPoints.push(pt[0], pt[1]);
        }
        gfx.poly(flatPoints, true).fill({ color: 0x000000, alpha: 0.5 });
      }
      if (!hasDrawn) continue;
      nukeLayer.addChild(gfx);
      overlays.push({ gfx, startTime: entry.startTime });
    }

    if (overlays.length === 0) return;

    // Animate alpha fade over FADE_DURATION_MS using the Pixi ticker
    const tickerFn = () => {
      const now = Date.now();
      let allDone = true;
      for (const { gfx, startTime } of overlays) {
        const elapsed = now - startTime;
        if (elapsed >= FADE_DURATION_MS) {
          gfx.alpha = 0;
        } else {
          gfx.alpha = 0.5 * (1 - elapsed / FADE_DURATION_MS);
          allDone = false;
        }
      }
      if (allDone) {
        app.ticker.remove(tickerFn);
        nukeLayer.removeChildren().forEach((child) => child.destroy());
      }
    };
    app.ticker.add(tickerFn);

    return () => {
      app.ticker.remove(tickerFn);
    };
  }, [nukeBlackout, shapesData]);

  // ── Weather overlay ────────────────────────────────────────────

  useEffect(() => {
    const overlay = weatherOverlayRef.current;
    if (!overlay || !shapesData) return;

    overlay.clear();

    if (!weather) return;

    const { min_x, min_y, max_x, max_y } = shapesData.bounds;

    let color = 0x000000;
    let alpha = 0;

    const phase = weather.phase;
    const condition = weather.condition;

    if (phase === "night") {
      color = 0x0a0a2e;
      alpha = 0.25 + (1 - weather.visibility) * 0.15;
    } else if (phase === "dawn") {
      color = 0xff8c42;
      alpha = 0.06;
    } else if (phase === "dusk") {
      color = 0xff6b35;
      alpha = 0.08;
    }

    if (condition === "fog") {
      color = 0xc0c0c0;
      alpha = Math.max(alpha, 0.12);
    } else if (condition === "storm") {
      color = 0x2d3748;
      alpha = Math.max(alpha, 0.15);
    } else if (condition === "rain") {
      color = 0x4a5568;
      alpha = Math.max(alpha, 0.06);
    }

    if (alpha > 0) {
      overlay.rect(min_x, min_y, max_x - min_x, max_y - min_y);
      overlay.fill({ color, alpha });
    }
  }, [weather, shapesData]);

  // ── Pixi Application lifecycle ────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    let app: Application | null = null;

    async function init() {
      app = new Application();

      await app.init({
        backgroundAlpha: 1,
        background: BG_COLOR,
        resizeTo: container!,
        antialias: true,
        autoDensity: true,
        resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
        preference: "webgl",
      });

      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }

      container!.appendChild(app.canvas);
      appRef.current = app;

      // Build layer containers
      const provinceLayer = new Container();
      provinceLayer.cullable = true;
      const labelLayer = new Container();
      const capitalLayer = new Container();
      const effectLayer = new Container();
      const nukeLayer = new Container();
      const unitChangeLayer = new Container();
      provinceLayerRef.current = provinceLayer;
      labelLayerRef.current = labelLayer;
      capitalLayerRef.current = capitalLayer;
      effectLayerRef.current = effectLayer;
      nukeLayerRef.current = nukeLayer;
      unitChangeLayerRef.current = unitChangeLayer;

      // Viewport — defaults to screen size; world size updated when shapesData loads
      const viewport = new Viewport({
        screenWidth: container!.clientWidth,
        screenHeight: container!.clientHeight,
        worldWidth: container!.clientWidth,
        worldHeight: container!.clientHeight,
        events: app.renderer.events,
      });

      viewport
        .drag({ mouseButtons: "left" })
        .pinch()
        .wheel({ smooth: 5 })
        .decelerate({ friction: 0.94 })
        .clampZoom({ minScale: 0.8, maxScale: 2 });
      // Camera bounds are applied after shapesData loads (world size is unknown here)

      viewportRef.current = viewport;

      // ── Drag-to-attack/move: viewport-level pointer handlers ──────────────

      // Long-press anywhere on the map → find nearest own province with units → start drag
      // Animation manager — its container lives above provinces, below labels
      const animManager = new PixiAnimationManager();
      animManagerRef.current = animManager;

      const capitalRadar = new Graphics();
      capitalRadar.eventMode = "none";
      capitalRadarRef.current = capitalRadar;

      const weatherOverlay = new Graphics();
      weatherOverlay.eventMode = "none";
      weatherOverlayRef.current = weatherOverlay;

      const weatherParticles = new Graphics();
      weatherParticles.eventMode = "none";
      weatherParticlesRef.current = weatherParticles;

      // Tactical grid overlay — drawn behind provinces, updated when shapesData loads
      const gridLayer = new Graphics();
      gridLayer.eventMode = "none";
      gridLayer.alpha = 0.04;
      gridLayerRef.current = gridLayer;

      viewport.addChild(gridLayer);
      viewport.addChild(provinceLayer);
      viewport.addChild(capitalLayer);
      viewport.addChild(capitalRadar);
      viewport.addChild(weatherOverlay);
      viewport.addChild(weatherParticles);
      viewport.addChild(effectLayer);
      viewport.addChild(nukeLayer);
      viewport.addChild(animManager.container);

      const plannedMovesLayer = new Container();
      plannedMovesLayer.eventMode = "none";
      plannedMovesLayerRef.current = plannedMovesLayer;
      viewport.addChild(plannedMovesLayer);

      // Air transit flight icons layer — between animations and labels.
      // eventMode "static" allows clickable hit areas for enemy flights.
      const airTransitLayer = new Container();
      airTransitLayer.eventMode = "static";
      airTransitLayerRef.current = airTransitLayer;
      viewport.addChild(airTransitLayer);

      viewport.addChild(labelLayer);
      // Unit change labels sit topmost so they are never occluded
      viewport.addChild(unitChangeLayer);
      app.stage.addChild(viewport);
      setAppReady(true);

      // Ticker drives the animation loop
      app.ticker.add(() => {
        animManager.update(Date.now());

        const now = Date.now();

        // Enemy flight click targets — rebuild each frame so positions track flight progress.
        // The centroid map is built once per shapesData change (outside the ticker in a ref)
        // then reused here for O(1) lookups rather than a per-frame linear scan.
        const airLayer = airTransitLayerRef.current;
        if (airLayer && onFlightClickRef.current) {
          airLayer.removeChildren();
          const atq = airTransitQueueRef.current;
          const sd = shapesDataRef.current;
          if (atq && sd) {
            // Build a quick centroid lookup from the stable shapesData ref.
            // This runs at ticker frequency but the loop is small (hundreds of regions max)
            // and the shapes array is stable between ticks — acceptable for 60fps.
            const centroidLookup = new Map<string, [number, number]>();
            for (const s of sd.regions) centroidLookup.set(s.id, s.centroid);

            for (const flight of atq) {
              // Only enemy flights are shown as clickable targets
              if (flight.player_id === myUserId) continue;
              const src = centroidLookup.get(flight.source_region_id);
              const tgt = centroidLookup.get(flight.target_region_id);
              if (!src || !tgt) continue;
              const progress = flight.progress;
              const x = src[0] + (tgt[0] - src[0]) * progress;
              const y = src[1] + (tgt[1] - src[1]) * progress;

              const hitArea = new Graphics();
              hitArea.circle(x, y, 20).fill({ color: 0xff0000, alpha: 0.001 });
              hitArea.eventMode = "static";
              hitArea.cursor = "crosshair";
              const capturedFlightId = flight.id;
              hitArea.on("pointerdown", () => {
                onFlightClickRef.current?.(capturedFlightId);
              });
              airLayer.addChild(hitArea);
            }

            // Render interceptor groups chasing bombers — drawn each frame to track moving targets.
            for (const flight of atq) {
              if (!flight.interceptors || flight.interceptors.length === 0) continue;
              // Bomber's current position (interpolated from progress)
              const src = centroidLookup.get(flight.source_region_id);
              const tgt = centroidLookup.get(flight.target_region_id);
              if (!src || !tgt) continue;
              const bomberX = src[0] + (tgt[0] - src[0]) * flight.progress;
              const bomberY = src[1] + (tgt[1] - src[1]) * flight.progress;

              for (const interceptor of flight.interceptors) {
                const intSrc = centroidLookup.get(interceptor.source_region_id);
                if (!intSrc) continue;
                // Interceptor position: lerp from source toward bomber's current position
                const intX = intSrc[0] + (bomberX - intSrc[0]) * interceptor.progress;
                const intY = intSrc[1] + (bomberY - intSrc[1]) * interceptor.progress;
                const intPlayer = playersRef.current[interceptor.player_id];
                const intColor = intPlayer ? hexStringToNumber(intPlayer.color) : 0xef4444;

                // Draw interceptor icon (small fighter circle)
                const g = new Graphics();
                g.eventMode = "none";
                // Trail line from source to current position
                g.moveTo(intSrc[0], intSrc[1]).lineTo(intX, intY)
                  .stroke({ color: intColor, width: 1.5, alpha: 0.4 });
                // Fighter icon circle
                g.circle(intX, intY, 8)
                  .fill({ color: intColor, alpha: 0.7 })
                  .stroke({ color: 0xffffff, width: 1.5, alpha: 0.8 });
                // Fighter count label
                g.circle(intX, intY, 3).fill({ color: 0xffffff, alpha: 0.9 });
                airLayer.addChild(g);
              }
            }
          }
        }

        // Capital radar ping — expanding concentric rings around owned capital provinces
        const radar = capitalRadarRef.current;
        if (radar) {
          radar.clear();
          const regionEntries = Object.entries(regionsRef.current);
          for (const [rid, region] of regionEntries) {
            if (!region.is_capital || !region.owner_id) continue;
            const player = playersRef.current[region.owner_id];
            if (!player) continue;
            const shape = shapesDataRef.current?.regions.find((s) => s.id === rid);
            if (!shape) continue;
            const [cx, cy] = shape.centroid;
            const playerColor = hexStringToNumber(player.color);
            // 2 concentric expanding rings, cycle every 3 seconds
            for (let ring = 0; ring < 2; ring++) {
              const phase = ((now / 3000) + ring * 0.5) % 1.0;
              const radius = 15 + phase * 40;
              const alpha = (1 - phase) * (1 - phase) * 0.35;
              radar.circle(cx, cy, radius).stroke({ color: playerColor, width: 1.5, alpha });
            }
          }
        }

        // Weather particles — rain / storm diagonal streaks
        const wp = weatherParticlesRef.current;
        if (wp) {
          wp.clear();
          const currentWeather = weatherRef.current;
          if (
            currentWeather &&
            (currentWeather.condition === "rain" || currentWeather.condition === "storm")
          ) {
            const vp = viewportRef.current;
            if (vp) {
              const particleCount = currentWeather.condition === "storm" ? 40 : 20;
              const vx = vp.left ?? 0;
              const vy = vp.top ?? 0;
              const vw = vp.screenWidth / vp.scale.x;
              const vh = vp.screenHeight / vp.scale.y;

              for (let i = 0; i < particleCount; i++) {
                // Each particle has a unique phase based on index
                const seed = i * 7919; // prime for spread
                const phase = ((now * 0.001 + seed) % 2.0) / 2.0; // 0..1 cycling every 2s
                const x = vx + (((seed * 13) % 1000) / 1000) * vw;
                const y = vy + phase * vh;
                const length = currentWeather.condition === "storm" ? 12 : 8;
                // Diagonal rain line (wind from left)
                wp.moveTo(x, y).lineTo(x + 3, y + length);
              }
              wp.stroke({ color: 0xa0b0c0, width: 1, alpha: 0.2 });

              // Storm: lightning flash every ~8 seconds
              if (currentWeather.condition === "storm") {
                const flashPhase = (now % 8000) / 8000;
                if (flashPhase < 0.015) {
                  // ~120ms flash
                  wp.rect(vx, vy, vw, vh).fill({ color: 0xffffff, alpha: 0.08 });
                }
              }
            }
          }
        }

        // Render planned move arrows
        const pmLayer = plannedMovesLayerRef.current;
        if (pmLayer) {
          pmLayer.removeChildren();
          const pMoves = plannedMovesRef.current;
          const sd = shapesDataRef.current;
          if (pMoves && pMoves.length > 0 && sd) {
            const cMap = new Map<string, [number, number]>();
            for (const shape of sd.regions) cMap.set(shape.id, shape.centroid);

            for (const pm of pMoves) {
              const src = cMap.get(pm.sourceId);
              const tgt = cMap.get(pm.targetId);
              if (!src || !tgt) continue;

              const g = new Graphics();
              const isAttack = pm.actionType === "attack" || pm.actionType === "bombard";
              const color = isAttack ? 0xff4444 : 0x22d3ee;

              // Dashed line
              const dx = tgt[0] - src[0];
              const dy = tgt[1] - src[1];
              const dist = Math.sqrt(dx * dx + dy * dy);
              const dashLen = 8;
              const gapLen = 5;
              const steps = Math.floor(dist / (dashLen + gapLen));
              const ux = dx / dist;
              const uy = dy / dist;

              for (let si = 0; si < steps; si++) {
                const startD = si * (dashLen + gapLen);
                const endD = startD + dashLen;
                g.moveTo(src[0] + ux * startD, src[1] + uy * startD)
                  .lineTo(src[0] + ux * Math.min(endD, dist), src[1] + uy * Math.min(endD, dist));
              }
              // Animate: pulse alpha
              const pulse = 0.5 + Math.sin(now * 0.004) * 0.3;
              g.stroke({ color, width: 2.5, alpha: pulse });

              // Arrowhead
              const aSize = 8;
              const angle = Math.atan2(dy, dx);
              const ax = tgt[0] - ux * 5;
              const ay = tgt[1] - uy * 5;
              g.moveTo(ax, ay)
                .lineTo(ax - Math.cos(angle - 0.4) * aSize, ay - Math.sin(angle - 0.4) * aSize)
                .lineTo(ax - Math.cos(angle + 0.4) * aSize, ay - Math.sin(angle + 0.4) * aSize)
                .closePath()
                .fill({ color, alpha: pulse });

              pmLayer.addChild(g);

              // Unit count label at midpoint
              const mx = (src[0] + tgt[0]) / 2;
              const my = (src[1] + tgt[1]) / 2;
              const label = new Text({
                text: String(pm.unitCount),
                style: new TextStyle({
                  fontFamily: "Rajdhani, sans-serif",
                  fontSize: 10,
                  fontWeight: "bold",
                  fill: color,
                  dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.9, angle: Math.PI / 4 },
                }),
                resolution: 3,
              });
              label.anchor.set(0.5, 0.5);
              label.position.set(mx, my - 6);
              pmLayer.addChild(label);
            }
          }
        }
      });

      // Handle canvas resize
      const resizeObserver = new ResizeObserver(() => {
        if (!appRef.current || !viewportRef.current) return;
        viewport.resize(container!.clientWidth, container!.clientHeight);
      });
      resizeObserver.observe(container!);

      // Store cleanup reference
      (app as Application & { _resizeObserver?: ResizeObserver })._resizeObserver =
        resizeObserver;
    }

    init().catch(console.error);

    return () => {
      destroyed = true;

      if (appRef.current) {
        const a = appRef.current as Application & { _resizeObserver?: ResizeObserver };
        a._resizeObserver?.disconnect();

        // Destroy animation manager
        if (animManagerRef.current) {
          animManagerRef.current.destroy();
          animManagerRef.current = null;
        }
        registeredAnimsRef.current.clear();

        for (const s of stateMapRef.current.values()) {
          s.graphics.destroy();
          s.label.destroy();
      s.labelBg.destroy();
          s.buildingLabel.destroy();
        }
        stateMapRef.current.clear();

        // Remove canvas from DOM before destroy to prevent flash
        if (a.canvas && a.canvas.parentNode) {
          a.canvas.parentNode.removeChild(a.canvas);
        }

        a.destroy(true, { children: true });
        appRef.current = null;
        viewportRef.current = null;
        provinceLayerRef.current = null;
        labelLayerRef.current = null;
        capitalLayerRef.current = null;
        effectLayerRef.current = null;
        nukeLayerRef.current = null;
        unitChangeLayerRef.current = null;
        weatherOverlayRef.current = null;
        weatherParticlesRef.current = null;
        gridLayerRef.current = null;
        capitalRadarRef.current = null;
        plannedMovesLayerRef.current = null;
      }
    };
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ background: `#${BG_COLOR.toString(16).padStart(6, "0")}` }}
    />
  );
}
