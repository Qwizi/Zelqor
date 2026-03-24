// ── Canvas types, constants, and helpers ──────────────────────────────────────
// Extracted from GameCanvas.tsx for reuse across hooks and components.

import type { Text } from "pixi.js";
import { type Graphics, TextStyle } from "pixi.js";
import type { ActiveEffect, AirTransitItem, GameRegion } from "@/hooks/useGameSocket";
import type { DiplomacyState, PlannedMove, TroopAnimation } from "@/lib/gameTypes";

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
  x: number;
  y: number;
  w: number;
  h: number;
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
  airTransitQueue?: AirTransitItem[];
  onFlightClick?: (flightId: string) => void;
  /** slug → manpower_cost for air unit display. */
  unitManpowerMap?: Record<string, number>;
  plannedMoves?: PlannedMove[];
  diplomacy?: DiplomacyState;
}

// ── Internal render state ─────────────────────────────────────

export interface ProvinceRenderState {
  graphics: Graphics;
  label: Text;
  labelBg: Graphics;
  buildingLabel: Text;
  /** Hex color number of the current fill — used to detect owner change */
  fillColor: number;
  ownerId: string | null;
  /** Pre-computed flat point arrays per sub-polygon — avoids per-redraw allocation */
  flatPolys: number[][];
}

// ── Effect config ─────────────────────────────────────────────

export const EFFECT_CONFIG: Record<string, { color: string; borderColor: string; icon: string; symbol: string }> = {
  ab_virus: { color: "#22c55e", borderColor: "#16a34a", icon: "/assets/abilities/ab_virus.webp", symbol: "☣" },
  ab_shield: { color: "#3b82f6", borderColor: "#60a5fa", icon: "/assets/abilities/ab_shield.webp", symbol: "🛡" },
  ab_pr_submarine: {
    color: "#a855f7",
    borderColor: "#c084fc",
    icon: "/assets/abilities/ab_pr_submarine.webp",
    symbol: "⚓",
  },
  ab_province_nuke: {
    color: "#ef4444",
    borderColor: "#f87171",
    icon: "/assets/abilities/ab_province_nuke.webp",
    symbol: "☢",
  },
  ab_conscription_point: {
    color: "#f59e0b",
    borderColor: "#fbbf24",
    icon: "/assets/abilities/ab_conscription_point.webp",
    symbol: "⚔",
  },
  ab_flash: { color: "#fbbf24", borderColor: "#f59e0b", icon: "⚡", symbol: "💡" },
};

// ── Color constants ───────────────────────────────────────────

export const BG_COLOR = 0x08111d;
export const DEFAULT_FILL = 0x1a2332;
export const DEFAULT_STROKE = 0x1a3a2d;
export const SELECTED_STROKE = 0xffffff;
export const TARGET_STROKE = 0xef4444;
export const NEIGHBOR_TINT = 0x2a4060;
export const CAPITAL_FILL = 0xfbbf24;
export const DIMMED_ALPHA = 0.25;
export const NORMAL_ALPHA = 0.6;
export const UNCLAIMED_FILL_ALPHA = 0.0;
export const STROKE_WIDTH_DEFAULT = 2;
export const STROKE_WIDTH_SELECTED = 3;
export const STROKE_WIDTH_TARGET = 2;

// ── Cached TextStyles for planned move labels ─────────────────

export const PM_STYLE_ATTACK = new TextStyle({
  fontFamily: "Rajdhani, sans-serif",
  fontSize: 10,
  fontWeight: "bold",
  fill: 0xff4444,
  dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.9, angle: Math.PI / 4 },
});
export const PM_STYLE_MOVE = new TextStyle({
  fontFamily: "Rajdhani, sans-serif",
  fontSize: 10,
  fontWeight: "bold",
  fill: 0x22d3ee,
  dropShadow: { color: 0x000000, blur: 3, distance: 1, alpha: 0.9, angle: Math.PI / 4 },
});

// ── Unit pulse config ─────────────────────────────────────────

export const UNIT_PULSE_DURATION_MS = 1200;

// ── Helpers ───────────────────────────────────────────────────

/**
 * Parse a CSS hex color string like "#a1b2c3" or "#abc" into a Pixi color
 * number (0xRRGGBB). Falls back to DEFAULT_FILL on invalid input.
 */
export function hexStringToNumber(hex: string): number {
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
export function lighten(color: number, factor: number): number {
  const r = Math.min(255, ((color >> 16) & 0xff) + Math.round(factor * 255));
  const g = Math.min(255, ((color >> 8) & 0xff) + Math.round(factor * 80));
  const b = Math.min(255, (color & 0xff) + Math.round(factor * 80));
  return (r << 16) | (g << 8) | b;
}

/**
 * Draw the outer ring of a polygon onto a Graphics object, then fill and stroke it.
 */
export function drawPolygon(
  gfx: Graphics,
  outerRing: number[][],
  fillColor: number,
  strokeColor: number,
  strokeWidth: number,
  fillAlpha = 1.0,
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
export function drawCapitalMarker(gfx: Graphics, cx: number, cy: number, size: number): void {
  gfx.circle(cx, cy, size + 3).stroke({ color: CAPITAL_FILL, width: 1.5, alpha: 0.4 });
  gfx
    .poly([cx, cy - size, cx + size, cy, cx, cy + size, cx - size, cy], true)
    .fill({ color: CAPITAL_FILL, alpha: 1 })
    .stroke({ color: 0xffffff, width: 1.5, alpha: 0.9 });
}
