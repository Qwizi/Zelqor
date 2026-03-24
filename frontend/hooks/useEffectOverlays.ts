// ── Ability effect overlays + Nuke blackout ──────────────────────────────────
// Extracted from GameCanvas.tsx — renders dashed effect borders and nuke fades.

import { type Application, type Container, Graphics, Text, TextStyle } from "pixi.js";
import { useEffect } from "react";
import type { ActiveEffect } from "@/hooks/useGameSocket";
import type { ProvinceShape, ShapesData } from "@/lib/canvasTypes";
import { EFFECT_CONFIG, hexStringToNumber } from "@/lib/canvasTypes";

/**
 * Renders ability effect overlays (dashed borders + symbol badges) and
 * nuke blackout fading overlays onto dedicated Pixi layers.
 */
export function useEffectOverlays(
  _appReady: boolean,
  shapesData: ShapesData | null,
  activeEffects: ActiveEffect[] | undefined,
  nukeBlackout: Array<{ rid: string; startTime: number }> | undefined,
  effectLayerRef: React.RefObject<Container | null>,
  nukeLayerRef: React.RefObject<Container | null>,
  appRef: React.RefObject<Application | null>,
) {
  // ── Ability effect overlays ─────────────────────────────────
  useEffect(() => {
    const effectLayer = effectLayerRef.current;
    if (!effectLayer || !shapesData) return;

    effectLayer.removeChildren().forEach((child) => child.destroy());

    if (!activeEffects || activeEffects.length === 0) return;

    const shapeMap = new Map<string, ProvinceShape>();
    for (const s of shapesData.regions) {
      shapeMap.set(s.id, s);
    }

    function drawDashedBorder(
      gfx: Graphics,
      ring: number[][],
      color: number,
      width: number,
      dashLen = 8,
      gapLen = 5,
    ): void {
      if (ring.length < 2) return;
      const pts =
        ring[ring.length - 1][0] !== ring[0][0] || ring[ring.length - 1][1] !== ring[0][1] ? [...ring, ring[0]] : ring;

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

      const regionIds = new Set<string>([effect.target_region_id, ...effect.affected_region_ids]);

      const fillColor = hexStringToNumber(cfg.color);
      const borderColor = hexStringToNumber(cfg.borderColor);

      for (const rid of regionIds) {
        const shape = shapeMap.get(rid);
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
          gfx.poly(flatPoints, true).fill({ color: fillColor, alpha: 0.25 });
          drawDashedBorder(gfx, outerRing, borderColor, 2.5);
        }
        if (!hasDrawn) continue;
        effectLayer.addChild(gfx);

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
  }, [activeEffects, shapesData, effectLayerRef.current]);

  // ── Nuke blackout overlays ─────────────────────────────────
  useEffect(() => {
    const nukeLayer = nukeLayerRef.current;
    const app = appRef.current;
    if (!nukeLayer || !shapesData || !app) return;

    nukeLayer.removeChildren().forEach((child) => child.destroy());

    if (!nukeBlackout || nukeBlackout.length === 0) return;

    const shapeMap = new Map<string, ProvinceShape>();
    for (const s of shapesData.regions) {
      shapeMap.set(s.id, s);
    }

    const FADE_DURATION_MS = 5000;

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
  }, [nukeBlackout, shapesData, appRef.current, nukeLayerRef.current]);
}
