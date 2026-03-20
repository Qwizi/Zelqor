"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Graphics, Text, Container, TextStyle, Assets, Sprite, Texture } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { GameRegion, ActiveEffect, WeatherState, AirTransitItem } from "@/hooks/useGameSocket";
import type { TroopAnimation } from "@/lib/gameTypes";
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
const DEFAULT_STROKE = 0x1a2a3d;
const SELECTED_STROKE = 0xffffff;
const TARGET_STROKE = 0xef4444;
const NEIGHBOR_TINT = 0x2a4060;
const CAPITAL_FILL = 0xfbbf24;
const DIMMED_ALPHA = 0.25;
const NORMAL_ALPHA = 0.90; // semi-transparent so terrain texture shows through
const UNCLAIMED_FILL_ALPHA = 0.0; // unclaimed provinces: no fill, terrain shows through
const STROKE_WIDTH_DEFAULT = 1.5;
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
  const animManagerRef = useRef<PixiAnimationManager | null>(null);
  const airTransitLayerRef = useRef<Container | null>(null);

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

  // Stable ref wrappers for props used inside Pixi event callbacks so we
  // don't have to tear down / rebuild interactivity on every render.
  const onRegionClickRef = useRef(onRegionClick);
  onRegionClickRef.current = onRegionClick;

  const onDoubleTapRef = useRef(onDoubleTap);
  onDoubleTapRef.current = onDoubleTap;

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

  // Dirty-region rendering: track previous region snapshot + structural generation.
  const prevRegionSnapshotRef = useRef<Record<string, GameRegion>>({});
  const structuralGenRef = useRef(0);
  const prevStructuralGenRef = useRef(-1);
  // Bump structural gen when non-region deps change (selection, highlights, etc.)
  useEffect(() => {
    structuralGenRef.current++;
  }, [selectedRegion, targetRegions, highlightedNeighbors, dimmedRegions, airTransitQueue]);

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
    // Cleanup stale entries every 5s
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [rid, ts] of recentlyBombedRef.current) {
        if (now - ts > 8000) recentlyBombedRef.current.delete(rid);
      }
    }, 5000);
    return () => {
      window.removeEventListener("bomb-drop", handler);
      window.removeEventListener("province-bombed", pathHandler);
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
      const ownerId = region?.owner_id ?? null;
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
          // Calculate air units separately (fighter, bomber)
          const airSlugs = ["fighter", "bomber"];
          const units = region.units ?? {};
          let airCount = 0;
          let airManpower = 0;
          for (const slug of airSlugs) {
            const count = units[slug] ?? 0;
            if (count > 0) {
              airCount += count;
              airManpower += count * (unitManpowerMapRef.current?.[slug] ?? 1);
            }
          }
          const groundCount = region.unit_count - airManpower;
          if (groundCount > 0 && airCount > 0) {
            label.text = `${groundCount}  ${airCount}✈(${airManpower})`;
          } else if (airCount > 0) {
            label.text = `${airCount}✈(${airManpower})`;
          } else {
            label.text = region.unit_count > 0 ? String(region.unit_count) : "";
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

      // Draw dark rounded rect behind unit count label for readability
      const bg = state.labelBg;
      bg.clear();
      if (label.text && label.text.length > 0) {
        const textW = Math.max(label.text.length * 9, 20);
        const textH = 18;
        const [lx, ly] = shape.centroid;
        bg.roundRect(lx - textW / 2 - 4, ly - textH / 2 - 1, textW + 8, textH + 2, 4)
          .fill({ color: 0x000000, alpha: 0.55 });
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
      fontSize: 15,
      fill: 0xffffff,
      fontWeight: "bold",
      dropShadow: {
        color: 0x000000,
        blur: 4,
        distance: 1,
        alpha: 0.9,
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

    for (const [rid, region] of Object.entries(regions)) {
      if (isSeeded && region.owner_id === myUserId) {
        const prevOwner = prevOwners.get(rid);
        const prevCount = prevCounts.get(rid);
        // Only pulse for POSITIVE changes (unit generation, +1/+2 per tick).
        // Negative changes (sending troops, enemy damage) are noise — player
        // sees the unit count updating directly. Also skip newly captured provinces.
        if (prevOwner === myUserId && prevCount !== undefined) {
          const delta = region.unit_count - prevCount;
          if (delta > 0) {
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
        if (p && p.unit_count === curr.unit_count && p.owner_id === curr.owner_id &&
            p.is_capital === curr.is_capital && p.building_type === curr.building_type) {
          continue; // unchanged — skip redraw
        }
        const state = stateMapRef.current.get(rid);
        if (state) drawProvince(rid, shape, state, false);
      }
    }
    prevRegionSnapshotRef.current = regions;
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

    for (const flight of airTransitQueue) {
      if (registeredFlightsRef.current.has(flight.id)) continue;
      registeredFlightsRef.current.add(flight.id);

      const color = players[flight.player_id]?.color ?? "#888888";

      // Calculate manpower.
      const mainManpower = flight.units * (unitManpowerMap?.[flight.unit_type] ?? 1);
      const escortManpower = flight.escort_fighters * (unitManpowerMap?.["fighter"] ?? 1);
      const totalManpower = mainManpower + escortManpower;

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
        units: totalManpower,
        unitCount: totalManpower,
        unitType: flight.unit_type,
        type: "attack" as const,
        startTime: Date.now() - (flight.progress / flight.speed_per_tick) * tickMs,
        durationMs: (1.0 / flight.speed_per_tick) * tickMs,
        playerId: flight.player_id,
        bombingWaypoints,
        totalHops,
      });
    }

    // Update unit count labels on already-registered bomber flights
    // (bomber loses units during path bombing — engine updates air_transit_queue).
    const manager = animManagerRef.current;
    if (manager) {
      for (const flight of airTransitQueue) {
        if (!registeredFlightsRef.current.has(flight.id)) continue;
        const mainManpower = flight.units * (unitManpowerMap?.[flight.unit_type] ?? 1);
        const escortManpower = flight.escort_fighters * (unitManpowerMap?.["fighter"] ?? 1);
        manager.updateAnimationLabel(flight.id, mainManpower + escortManpower);
      }
    }

    // Clean up finished flights.
    const activeIds = new Set(airTransitQueue.map((f) => f.id));
    for (const id of registeredFlightsRef.current) {
      if (!activeIds.has(id)) registeredFlightsRef.current.delete(id);
    }
    if (registeredFlightsRef.current.size > 200) registeredFlightsRef.current.clear();

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

      const weatherOverlay = new Graphics();
      weatherOverlay.eventMode = "none";
      weatherOverlayRef.current = weatherOverlay;

      viewport.addChild(provinceLayer);
      viewport.addChild(capitalLayer);
      viewport.addChild(weatherOverlay);
      viewport.addChild(effectLayer);
      viewport.addChild(nukeLayer);
      viewport.addChild(animManager.container);

      // Air transit flight icons layer — between animations and labels
      const airTransitLayer = new Container();
      airTransitLayer.eventMode = "none";
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
