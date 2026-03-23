"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Application, Graphics, Text, Container, TextStyle, Assets, Sprite, Texture } from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { GameRegion, ActiveEffect, AirTransitItem } from "@/hooks/useGameSocket";
import type { TroopAnimation, PlannedMove, DiplomacyState } from "@/lib/gameTypes";
import { PixiAnimationManager, computeCurvePath } from "@/lib/pixiAnimations";
import type { CosmeticValue } from "@/lib/animationConfig";
import { getBuildingAsset, getUnitAsset } from "@/lib/gameAssets";
import { useBombardmentEvents, type SamIntercept } from "@/hooks/useBombardmentEvents";
import { useEffectOverlays } from "@/hooks/useEffectOverlays";
import { useUnitPulseLabels } from "@/hooks/useUnitPulseLabels";
import {
  type ProvinceShape,
  type ShapesData,
  type GameCanvasProps,
  type ProvinceRenderState,
  EFFECT_CONFIG,
  BG_COLOR,
  DEFAULT_FILL,
  DEFAULT_STROKE,
  SELECTED_STROKE,
  TARGET_STROKE,
  NEIGHBOR_TINT,
  CAPITAL_FILL,
  DIMMED_ALPHA,
  NORMAL_ALPHA,
  UNCLAIMED_FILL_ALPHA,
  STROKE_WIDTH_DEFAULT,
  STROKE_WIDTH_SELECTED,
  STROKE_WIDTH_TARGET,
  PM_STYLE_ATTACK,
  PM_STYLE_MOVE,
  UNIT_PULSE_DURATION_MS,
  hexStringToNumber,
  lighten,
  drawPolygon,
  drawCapitalMarker,
} from "@/lib/canvasTypes";
// Re-export shape types for backwards compatibility
export type { ProvinceShape, ShapesBounds, ShapesData, WorldTextureMapping, GameCanvasProps } from "@/lib/canvasTypes";

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
  airTransitQueue,
  onFlightClick,
  unitManpowerMap,
  plannedMoves,
  diplomacy,
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
  const gridLayerRef = useRef<Graphics | null>(null);
  const animManagerRef = useRef<PixiAnimationManager | null>(null);
  const airTransitLayerRef = useRef<Container | null>(null);
  const capitalRadarRef = useRef<Graphics | null>(null);
  const plannedMovesLayerRef = useRef<Container | null>(null);
  const plannedMovesRef = useRef(plannedMoves);
  plannedMovesRef.current = plannedMoves;

  /** Cached centroid lookup — rebuilt when shapesData changes, not per frame */
  const centroidCacheRef = useRef<Map<string, [number, number]>>(new Map());

  /** Object pools for ticker — avoid per-frame Graphics allocation */
  const airHitPoolRef = useRef<Graphics[]>([]);
  const airHitPoolIdxRef = useRef(0);
  const interceptorPoolRef = useRef<Graphics[]>([]);
  const interceptorPoolIdxRef = useRef(0);
  const samGfxPoolRef = useRef<Graphics[]>([]);
  const samGfxPoolIdxRef = useRef(0);
  const pmGfxPoolRef = useRef<Graphics[]>([]);
  const pmTextPoolRef = useRef<Text[]>([]);
  const pmPoolIdxRef = useRef(0);

  /** Per-province render state — Graphics, Text, cached owner/fill */
  const stateMapRef = useRef<Map<string, ProvinceRenderState>>(new Map());
  /** Track which animation IDs have been registered with the manager */
  const registeredAnimsRef = useRef<Set<string>>(new Set());

  /** Pre-built Sets for O(1) lookup inside drawProvince (avoids .some() per province) */
  const animTargetSetRef = useRef<Set<string>>(new Set());
  const bombedRegionSetRef = useRef<Set<string>>(new Set());

  /** Pre-computed diplomacy relation map — rebuilt before each render loop (O(1) lookup per province) */
  const diplomacyRelMapRef = useRef<Map<string, "war" | "nap" | "ally">>(new Map());

  /** Persistent capital layer sprite map — keyed by region ID, values are the Container/Sprite added to capitalLayer */
  const capitalSpriteMapRef = useRef<Map<string, Array<Container | Sprite | Graphics>>>(new Map());
  /** Per-region capital snapshot strings used for incremental diff */
  const capitalRegionSnapshotRef = useRef<Map<string, string>>(new Map());

  // Unit change pulse tracking
  const prevUnitCountsRef = useRef<Map<string, number>>(new Map());
  const prevUnitOwnersRef = useRef<Map<string, string | null>>(new Map());
  const unitPulsesRef = useRef<Map<string, { startTime: number; delta: number }>>(new Map());

  /** Snapshot of the previous regions state — used to diff tick updates. */
  const prevRegionsRef = useRef<Record<string, GameRegion>>({});


  /** Temporary visual adjustments from bombardment — subtracted from displayed unit_count
   *  until the next tick confirms the actual state. Keyed by region ID. */
  const bombardAdjustRef = useRef<Map<string, number>>(new Map());

  /** Active SAM intercept animations drawn in the ticker. */
  const samInterceptsRef = useRef<SamIntercept[]>([]);

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

  const diplomacyRef = useRef(diplomacy);
  diplomacyRef.current = diplomacy;

  const myUserIdRef = useRef(myUserId);
  myUserIdRef.current = myUserId;

  const airTransitQueueRef = useRef(airTransitQueue);
  airTransitQueueRef.current = airTransitQueue;

  const unitManpowerMapRef = useRef(unitManpowerMap);
  unitManpowerMapRef.current = unitManpowerMap;

  const shapesDataRef = useRef(shapesData);
  shapesDataRef.current = shapesData;


  // Dirty-region rendering: track previous region snapshot + structural generation.
  const prevRegionSnapshotRef = useRef<Record<string, GameRegion>>({});
  const structuralGenRef = useRef(0);
  const prevStructuralGenRef = useRef(-1);
  // Bump structural gen when non-region deps change (selection, highlights, etc.)
  useEffect(() => {
    structuralGenRef.current++;
  }, [selectedRegion, targetRegions, highlightedNeighbors, dimmedRegions, airTransitQueue, unitManpowerMap]);

  // Rebuild centroid cache when shapesData changes (used by ticker without per-frame allocation)
  useEffect(() => {
    const cache = new Map<string, [number, number]>();
    if (shapesData) {
      for (const s of shapesData.regions) cache.set(s.id, s.centroid);
    }
    centroidCacheRef.current = cache;
  }, [shapesData]);

  // Track recently bombed provinces — keep showing unit count for 5s after bombing.
  const recentlyBombedRef = useRef<Map<string, number>>(new Map());

  // Bombardment & combat event listeners (extracted to hook)
  useBombardmentEvents(
    shapesDataRef, animManagerRef, stateMapRef,
    unitPulsesRef, bombardAdjustRef, recentlyBombedRef, samInterceptsRef,
  );

  // ── Province drawing helper ──────────────────────────────────

  const drawProvince = useCallback(
    (
      id: string,
      shape: ProvinceShape,
      state: ProvinceRenderState,
      isHovered: boolean,
      diplomacyRelMap?: Map<string, "war" | "nap" | "ally">
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

      // Determine diplomacy-based style for other players' provinces
      const myId = myUserIdRef.current;
      let relationStroke = DEFAULT_STROKE;
      let showHatch = true;
      let hatchAlpha = 0.12;
      let fillAlphaOverride: number | null = null;

      if (ownerId && ownerId !== myId) {
        // Use pre-computed relation map when available (O(1)); fall back to
        // linear scan only for hover events that arrive outside the render loop.
        const relMap = diplomacyRelMap ?? diplomacyRelMapRef.current;
        const relation = relMap.get(ownerId);
        if (relation === "war") {
          relationStroke = 0x8b2020; // dark red — war
          hatchAlpha = 0.18;        // more visible danger hatch
        } else if (relation === "nap") {
          relationStroke = 0x1a5c2d; // dark green — allied NAP
          showHatch = false;          // no hostile hatch for allies
          fillAlphaOverride = 0.45;  // slightly more transparent, friendly
        } else if (!relMap.size) {
          // Fallback: relMap not populated yet — scan raw diplomacy state
          const diplo = diplomacyRef.current;
          if (diplo) {
            const isAtWar = diplo.wars.some(
              (w) =>
                (w.player_a === myId && w.player_b === ownerId) ||
                (w.player_b === myId && w.player_a === ownerId)
            );
            const hasNap = diplo.pacts.some(
              (p) =>
                ((p.player_a === myId && p.player_b === ownerId) ||
                  (p.player_b === myId && p.player_a === ownerId)) &&
                p.pact_type === "nap"
            );
            if (isAtWar) {
              relationStroke = 0x8b2020;
              hatchAlpha = 0.18;
            } else if (hasNap) {
              relationStroke = 0x1a5c2d;
              showHatch = false;
              fillAlphaOverride = 0.45;
            }
          }
        }
      }

      // Determine stroke
      const isCapital = region?.is_capital ?? false;
      let strokeColor = relationStroke;
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

      const baseAlpha = isDimmed
        ? DIMMED_ALPHA
        : ownerId
          ? (fillAlphaOverride !== null ? fillAlphaOverride : NORMAL_ALPHA)
          : UNCLAIMED_FILL_ALPHA;
      const alpha = baseAlpha;

      // Redraw
      const gfx = state.graphics;
      gfx.clear();

      // Draw all sub-polygons (MultiPolygon regions have multiple, e.g. islands)
      for (let si = 0; si < shape.polygons.length; si++) {
        const outerRing = shape.polygons[si][0];
        if (outerRing && outerRing.length >= 3) {
          drawPolygon(gfx, outerRing, baseFill, strokeColor, strokeWidth, alpha);
          // Selected province: double stroke — player color at 3px, then white at 1.5px on top
          if (isSelected) {
            const playerColor = player ? hexStringToNumber(player.color) : SELECTED_STROKE;
            const flatPoints = state.flatPolys[si];
            gfx.poly(flatPoints, true).stroke({ color: playerColor, width: 3, alpha: 1.0 });
            gfx.poly(flatPoints, true).stroke({ color: 0xffffff, width: 1.5, alpha: 1.0 });
          }
        }
      }

      // Hatch pattern on non-ally enemy provinces (diagonal lines — military map style).
      // Drawn as a separate pass so the fill polygon acts as visual context.
      if (ownerId && ownerId !== myId && !isDimmed && showHatch) {
        for (const subPoly of shape.polygons) {
          const outerRing = subPoly[0];
          if (!outerRing || outerRing.length < 3) continue;
          // Iterative min/max — avoids .map() allocation + Math.min(...) spread
          let minX = outerRing[0][0], maxX = minX, minY = outerRing[0][1], maxY = minY;
          for (let pi = 1; pi < outerRing.length; pi++) {
            const px = outerRing[pi][0], py = outerRing[pi][1];
            if (px < minX) minX = px; else if (px > maxX) maxX = px;
            if (py < minY) minY = py; else if (py > maxY) maxY = py;
          }
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
          gfx.stroke({ color: 0x000000, width: 0.8, alpha: hatchAlpha });
        }
      }

      // War pulse — red border throb for provinces owned by a player we're at war with.
      // Only applies to the default (non-selected, non-target, non-neighbor) stroke case.
      if (
        ownerId &&
        ownerId !== myId &&
        !isSelected &&
        !isTarget &&
        !isNeighbor &&
        !isDimmed &&
        relationStroke === 0x8b2020
      ) {
        const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 500);
        for (let si = 0; si < state.flatPolys.length; si++) {
          const flatPoints = state.flatPolys[si];
          if (flatPoints.length < 6) continue;
          gfx
            .poly(flatPoints, true)
            .stroke({ color: 0x8b2020, width: STROKE_WIDTH_DEFAULT + 1, alpha: pulse });
        }
      }

      state.fillColor = baseFill;
      state.ownerId = ownerId;

      // Update label — show unit count for own + attacked + sub-revealed regions;
      // show short username for other owned regions.
      const label = state.label;
      if (region) {
        const isOwner = ownerId === myId;

        // Reveal unit count only when actively being attacked (animation in flight),
        // NOT when merely selected as a target — player shouldn't know before attacking
        const isAnimTarget = animTargetSetRef.current.has(id);

        // Check whether this region is revealed by submarine effect
        const isSubRevealed = activeEffectsRef.current?.some(
          (e) => e.effect_type === "ab_pr_submarine" && e.affected_region_ids.includes(id)
        ) ?? false;

        // Show unit count on enemy provinces being bombed (in active bomber flight paths)
        // OR recently bombed (keep visible for a few seconds after flight ends).
        const isBombed = bombedRegionSetRef.current.has(id);
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
        const isEnemy = ownerId !== null && ownerId !== myId;
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
    // Reset incremental capital layer tracking so the next regions effect
    // rebuilds all sprites from scratch for the new shapesData.
    capitalSpriteMapRef.current.clear();
    capitalRegionSnapshotRef.current.clear();

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

      // Pre-compute flat point arrays for each sub-polygon (reused in selection + war pulse)
      const flatPolys: number[][] = [];
      for (const subPoly of shape.polygons) {
        const outerRing = subPoly[0];
        if (outerRing && outerRing.length >= 3) {
          const flat: number[] = [];
          for (const pt of outerRing) flat.push(pt[0], pt[1]);
          flatPolys.push(flat);
        } else {
          flatPolys.push([]);
        }
      }

      const renderState: ProvinceRenderState = {
        graphics: gfx,
        label,
        labelBg,
        buildingLabel,
        fillColor: DEFAULT_FILL,
        ownerId: null,
        flatPolys,
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

    // Re-draw capitals and building sprites — incremental per-region diff.
    // Instead of rebuilding ALL sprites on any change, we compare a per-region
    // fingerprint and only destroy/recreate sprites for regions that changed.
    const capitalLayer = capitalLayerRef.current;
    if (capitalLayer) {
      const spriteMap = capitalSpriteMapRef.current;
      const regionSnap = capitalRegionSnapshotRef.current;

      // Helper: compute the fingerprint for a single region
      const regionCapFingerprint = (rid: string, region: GameRegion): string => {
        const parts: string[] = [];
        if (region.is_capital) parts.push("C");
        if (region.building_instances?.length) {
          parts.push(`B${region.building_instances.length}`);
        } else if (region.buildings) {
          const bkeys = Object.entries(region.buildings)
            .filter(([, c]) => c > 0)
            .map(([s, c]) => `${s}${c}`)
            .join(",");
          if (bkeys) parts.push(bkeys);
        }
        return parts.length ? `${rid}:${parts.join(",")}` : "";
      };

      // Helper: destroy and remove all sprites for a region
      const destroyRegionSprites = (rid: string) => {
        const sprites = spriteMap.get(rid);
        if (sprites) {
          for (const s of sprites) {
            capitalLayer.removeChild(s);
            s.destroy({ children: true });
          }
          spriteMap.delete(rid);
        }
        regionSnap.delete(rid);
      };

      // Helper: build sprites for a single region and add to capitalLayer
      const buildRegionSprites = (rid: string, region: GameRegion, shape: ProvinceShape) => {
        const [cx, cy] = shape.centroid;
        const created: Array<Container | Sprite | Graphics> = [];

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
            // Track it so we can remove it on next change
            const existing = capitalSpriteMapRef.current.get(rid) ?? [];
            existing.push(sprite);
            capitalSpriteMapRef.current.set(rid, existing);
          }).catch(() => {
            if (!capitalLayerRef.current) return;
            const cap = new Graphics();
            cap.eventMode = "none";
            drawCapitalMarker(cap, cx, cy - 18, 7);
            capitalLayerRef.current.addChild(cap);
            const existing = capitalSpriteMapRef.current.get(rid) ?? [];
            existing.push(cap);
            capitalSpriteMapRef.current.set(rid, existing);
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

        if (buildingEntries.length > 0) {
          const bldgContainer = new Container();
          bldgContainer.eventMode = "none";
          bldgContainer.position.set(cx, cy);
          created.push(bldgContainer);

          const ICON_SIZE = 16;
          const RADIUS = 22;
          const startAngle = -Math.PI / 2;
          const totalItems = buildingEntries.length;
          let itemIndex = 0;

          for (const entry of buildingEntries) {
            const angle = startAngle + (itemIndex / totalItems) * Math.PI * 2;
            const ix = Math.cos(angle) * RADIUS;
            const iy = Math.sin(angle) * RADIUS;
            const capturedIx = ix;
            const capturedIy = iy;
            const capturedCount = entry.count;
            itemIndex++;

            Assets.load(entry.url).then((texture: Texture) => {
              if (!capitalLayerRef.current) return;

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

        // Register synchronously-created items (async sprite load handles itself above)
        if (created.length) {
          const existing = spriteMap.get(rid) ?? [];
          for (const c of created) existing.push(c);
          spriteMap.set(rid, existing);
        }
      };

      // Build shape lookup once
      const shapeMap = new Map<string, ProvinceShape>();
      for (const s of shapesData.regions) shapeMap.set(s.id, s);

      // Remove stale entries for regions no longer in the game state.
      // Collect keys first to avoid mutating the map during iteration.
      const staleRids: string[] = [];
      for (const rid of spriteMap.keys()) {
        if (!regions[rid]) staleRids.push(rid);
      }
      for (const rid of staleRids) destroyRegionSprites(rid);

      // Incremental per-region diff
      for (const [rid, region] of Object.entries(regions)) {
        const fingerprint = regionCapFingerprint(rid, region);
        const prevFingerprint = regionSnap.get(rid) ?? "";

        if (fingerprint === prevFingerprint) continue; // no change — skip

        // Destroy old sprites for this region then rebuild
        destroyRegionSprites(rid);

        if (fingerprint) {
          // Only build if region has capital or buildings
          const shape = shapeMap.get(rid);
          if (shape) {
            // Pre-register the rid with an empty array so async loads can append
            spriteMap.set(rid, []);
            buildRegionSprites(rid, region, shape);
          }
        }

        regionSnap.set(rid, fingerprint);
      }
    }

    // Pre-build lookup Sets for O(1) checks inside drawProvince
    const ats = animTargetSetRef.current;
    ats.clear();
    for (const a of animations) {
      if (a.type === "attack") ats.add(a.targetId);
    }
    const brs = bombedRegionSetRef.current;
    brs.clear();
    if (airTransitQueue) {
      for (const f of airTransitQueue) {
        if (f.mission_type === "bomb_run" && f.flight_path) {
          for (const rid of f.flight_path) brs.add(rid);
        }
      }
    }

    // Pre-compute diplomacy relation map — O(wars + pacts) once per frame instead
    // of O(wars × provinces + pacts × provinces) inside drawProvince.
    const relMap = diplomacyRelMapRef.current;
    relMap.clear();
    if (diplomacy && myUserId) {
      for (const w of diplomacy.wars) {
        if (w.player_a === myUserId) relMap.set(w.player_b, "war");
        else if (w.player_b === myUserId) relMap.set(w.player_a, "war");
      }
      for (const p of diplomacy.pacts) {
        if (p.pact_type !== "nap") continue;
        const other = p.player_a === myUserId ? p.player_b : p.player_b === myUserId ? p.player_a : null;
        if (other && !relMap.has(other)) relMap.set(other, "nap");
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
        if (state) drawProvince(shape.id, shape, state, false, relMap);
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
        if (state) drawProvince(rid, shape, state, false, relMap);
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
    diplomacy,
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

  // Unit change floating labels (extracted to hook)
  useUnitPulseLabels(appReady, appRef, shapesData, unitChangeLayerRef, unitPulsesRef, centroidCacheRef);

  // Effect overlays + nuke blackout (extracted to hook)
  useEffectOverlays(appReady, shapesData, activeEffects, nukeBlackout, effectLayerRef, nukeLayerRef, appRef);

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
        preference: "webgpu",
        // Falls back to WebGL automatically if WebGPU unavailable
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


      // Tactical grid overlay — drawn behind provinces, updated when shapesData loads
      const gridLayer = new Graphics();
      gridLayer.eventMode = "none";
      gridLayer.alpha = 0.04;
      gridLayerRef.current = gridLayer;

      viewport.addChild(gridLayer);
      viewport.addChild(provinceLayer);
      viewport.addChild(capitalLayer);
      viewport.addChild(capitalRadar);
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
          // Hide all pooled graphics from last frame
          const hitPool = airHitPoolRef.current;
          for (let pi = 0; pi < airHitPoolIdxRef.current; pi++) {
            hitPool[pi].visible = false;
          }
          airHitPoolIdxRef.current = 0;
          const intPool = interceptorPoolRef.current;
          for (let pi = 0; pi < interceptorPoolIdxRef.current; pi++) {
            intPool[pi].visible = false;
          }
          interceptorPoolIdxRef.current = 0;

          const atq = airTransitQueueRef.current;
          if (atq) {
            const centroidLookup = centroidCacheRef.current;

            for (const flight of atq) {
              if (flight.player_id === myUserId) continue;
              const src = centroidLookup.get(flight.source_region_id);
              const tgt = centroidLookup.get(flight.target_region_id);
              if (!src || !tgt) continue;
              const progress = flight.progress;
              const x = src[0] + (tgt[0] - src[0]) * progress;
              const y = src[1] + (tgt[1] - src[1]) * progress;

              // Get or create pooled Graphics
              let hitArea: Graphics;
              const poolIdx = airHitPoolIdxRef.current;
              if (poolIdx < hitPool.length) {
                hitArea = hitPool[poolIdx];
                hitArea.clear();
                hitArea.visible = true;
              } else {
                hitArea = new Graphics();
                hitArea.eventMode = "static";
                hitArea.cursor = "crosshair";
                airLayer.addChild(hitArea);
                hitPool.push(hitArea);
              }
              airHitPoolIdxRef.current++;

              hitArea.circle(x, y, 20).fill({ color: 0xff0000, alpha: 0.001 });
              (hitArea as Graphics & { _flightId?: string })._flightId = flight.id;
              hitArea.removeAllListeners();
              hitArea.on("pointerdown", () => {
                onFlightClickRef.current?.((hitArea as Graphics & { _flightId?: string })._flightId!);
              });
            }

            // Render interceptor groups chasing bombers
            for (const flight of atq) {
              if (!flight.interceptors || flight.interceptors.length === 0) continue;
              const src = centroidLookup.get(flight.source_region_id);
              const tgt = centroidLookup.get(flight.target_region_id);
              if (!src || !tgt) continue;
              const bomberX = src[0] + (tgt[0] - src[0]) * flight.progress;
              const bomberY = src[1] + (tgt[1] - src[1]) * flight.progress;

              for (const interceptor of flight.interceptors) {
                const intSrc = centroidLookup.get(interceptor.source_region_id);
                if (!intSrc) continue;
                const intX = intSrc[0] + (bomberX - intSrc[0]) * interceptor.progress;
                const intY = intSrc[1] + (bomberY - intSrc[1]) * interceptor.progress;
                const intPlayer = playersRef.current[interceptor.player_id];
                const intColor = intPlayer ? hexStringToNumber(intPlayer.color) : 0xef4444;

                let g: Graphics;
                const iPoolIdx = interceptorPoolIdxRef.current;
                if (iPoolIdx < intPool.length) {
                  g = intPool[iPoolIdx];
                  g.clear();
                  g.visible = true;
                } else {
                  g = new Graphics();
                  g.eventMode = "none";
                  airLayer.addChild(g);
                  intPool.push(g);
                }
                interceptorPoolIdxRef.current++;

                g.moveTo(intSrc[0], intSrc[1]).lineTo(intX, intY)
                  .stroke({ color: intColor, width: 1.5, alpha: 0.4 });
                g.circle(intX, intY, 8)
                  .fill({ color: intColor, alpha: 0.7 })
                  .stroke({ color: 0xffffff, width: 1.5, alpha: 0.8 });
                g.circle(intX, intY, 3).fill({ color: 0xffffff, alpha: 0.9 });
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

        // SAM intercept animations — SAM rocket flies to meet point + explosion
        const samAnims = samInterceptsRef.current;
        if (airLayer) {
        // Reset SAM pool visibility
        const samPool = samGfxPoolRef.current;
        for (let pi = 0; pi < samGfxPoolIdxRef.current; pi++) {
          samPool[pi].visible = false;
        }
        samGfxPoolIdxRef.current = 0;

        for (let si = samAnims.length - 1; si >= 0; si--) {
          const sa = samAnims[si];
          const elapsed = now - sa.startTime;
          const progress = Math.min(elapsed / sa.meetMs, 1);

          if (progress < 1) {
            const samX = sa.samFrom[0] + (sa.meetPoint[0] - sa.samFrom[0]) * progress;
            const samY = sa.samFrom[1] + (sa.meetPoint[1] - sa.samFrom[1]) * progress;

            let samGfx: Graphics;
            const samPoolIdx = samGfxPoolIdxRef.current;
            if (samPoolIdx < samPool.length) {
              samGfx = samPool[samPoolIdx];
              samGfx.clear();
              samGfx.visible = true;
            } else {
              samGfx = new Graphics();
              samGfx.eventMode = "none";
              airLayer.addChild(samGfx);
              samPool.push(samGfx);
            }
            samGfxPoolIdxRef.current++;

            samGfx.circle(samX, samY, 3).fill({ color: 0x22d3ee, alpha: 0.95 });
            samGfx.circle(samX, samY, 7).fill({ color: 0x22d3ee, alpha: 0.2 });
            const tailP = Math.max(0, progress - 0.2);
            const tailX = sa.samFrom[0] + (sa.meetPoint[0] - sa.samFrom[0]) * tailP;
            const tailY = sa.samFrom[1] + (sa.meetPoint[1] - sa.samFrom[1]) * tailP;
            samGfx.moveTo(tailX, tailY).lineTo(samX, samY)
              .stroke({ color: 0x22d3ee, width: 2.5, alpha: 0.6 });
            samGfx.moveTo(tailX, tailY).lineTo(samX, samY)
              .stroke({ color: 0x22d3ee, width: 5, alpha: 0.15 });
          } else if (!sa.exploded) {
            sa.exploded = true;
            const mgr = animManagerRef.current;
            if (mgr) {
              mgr.spawnParticleEffect("explosion", sa.meetPoint[0], sa.meetPoint[1]);
              mgr.spawnParticleEffect("sparks", sa.meetPoint[0], sa.meetPoint[1]);
            }
          }

          if (elapsed > sa.meetMs + 1500) {
            samAnims.splice(si, 1);
          }
        }
        } // end airLayer guard

        // Render planned move arrows (pooled)
        const pmLayer = plannedMovesLayerRef.current;
        if (pmLayer) {
          const pmGfxPool = pmGfxPoolRef.current;
          const pmTxtPool = pmTextPoolRef.current;
          for (let pi = 0; pi < pmPoolIdxRef.current; pi++) {
            if (pi < pmGfxPool.length) pmGfxPool[pi].visible = false;
            if (pi < pmTxtPool.length) pmTxtPool[pi].visible = false;
          }
          pmPoolIdxRef.current = 0;

          const pMoves = plannedMovesRef.current;
          if (pMoves && pMoves.length > 0) {
            const cMap = centroidCacheRef.current;

            for (const pm of pMoves) {
              const src = cMap.get(pm.sourceId);
              const tgt = cMap.get(pm.targetId);
              if (!src || !tgt) continue;

              const idx = pmPoolIdxRef.current;

              let g: Graphics;
              if (idx < pmGfxPool.length) {
                g = pmGfxPool[idx];
                g.clear();
                g.visible = true;
              } else {
                g = new Graphics();
                g.eventMode = "none";
                pmLayer.addChild(g);
                pmGfxPool.push(g);
              }

              const isAttack = pm.actionType === "attack" || pm.actionType === "bombard";
              const color = isAttack ? 0xff4444 : 0x22d3ee;

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
              const pulse = 0.5 + Math.sin(now * 0.004) * 0.3;
              g.stroke({ color, width: 2.5, alpha: pulse });

              const aSize = 8;
              const angle = Math.atan2(dy, dx);
              const ax = tgt[0] - ux * 5;
              const ay = tgt[1] - uy * 5;
              g.moveTo(ax, ay)
                .lineTo(ax - Math.cos(angle - 0.4) * aSize, ay - Math.sin(angle - 0.4) * aSize)
                .lineTo(ax - Math.cos(angle + 0.4) * aSize, ay - Math.sin(angle + 0.4) * aSize)
                .closePath()
                .fill({ color, alpha: pulse });

              let label: Text;
              if (idx < pmTxtPool.length) {
                label = pmTxtPool[idx];
                label.visible = true;
              } else {
                label = new Text({ text: "", style: PM_STYLE_MOVE, resolution: 3 });
                label.anchor.set(0.5, 0.5);
                label.eventMode = "none";
                pmLayer.addChild(label);
                pmTxtPool.push(label);
              }

              label.text = String(pm.unitCount);
              label.style = isAttack ? PM_STYLE_ATTACK : PM_STYLE_MOVE;
              const mx = (src[0] + tgt[0]) / 2;
              const my = (src[1] + tgt[1]) / 2;
              label.position.set(mx, my - 6);

              pmPoolIdxRef.current++;
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
