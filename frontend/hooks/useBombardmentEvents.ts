// ── Bombardment & combat event listeners ──────────────────────────────────────
// Extracted from GameCanvas.tsx — handles window events for bombs, SAM, damage.

import { useEffect, useRef } from "react";
import type { ProvinceRenderState, ShapesData } from "@/lib/canvasTypes";
import { computeCurvePath } from "@/lib/pixiAnimationPaths";
import type { PixiAnimationManager } from "@/lib/pixiAnimations";

export interface SamIntercept {
  startTime: number;
  meetMs: number;
  artFrom: [number, number];
  samFrom: [number, number];
  meetPoint: [number, number];
  exploded: boolean;
}

/**
 * Registers window event listeners for bombardment, bomb visuals, SAM intercepts,
 * and animation kill signals. Side-effect only hook — no return value.
 */
export function useBombardmentEvents(
  shapesDataRef: React.RefObject<ShapesData | null>,
  animManagerRef: React.RefObject<PixiAnimationManager | null>,
  stateMapRef: React.RefObject<Map<string, ProvinceRenderState>>,
  unitPulsesRef: React.RefObject<Map<string, { startTime: number; delta: number }>>,
  bombardAdjustRef: React.RefObject<Map<string, number>>,
  recentlyBombedRef: React.RefObject<Map<string, number>>,
  samInterceptsRef: React.RefObject<SamIntercept[]>,
) {
  // Pre-built shape lookup map — rebuilt when shapesData changes, O(1) per event
  const shapeMapRef = useRef<Map<string, { centroid: [number, number] }>>(new Map());

  // Rebuild shape map when shapesData changes
  useEffect(() => {
    const map = new Map<string, { centroid: [number, number] }>();
    const sd = shapesDataRef.current;
    if (sd) {
      for (const s of sd.regions) {
        map.set(s.id, { centroid: s.centroid });
      }
    }
    shapeMapRef.current = map;
  }, [shapesDataRef.current]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string; count: number }>).detail;
      recentlyBombedRef.current.set(regionId, Date.now());
    };
    window.addEventListener("bomb-drop", handler);

    const pathHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string }>).detail;
      recentlyBombedRef.current.set(regionId, Date.now());
    };
    window.addEventListener("province-bombed", pathHandler);

    const pathDamageBombHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string; killed: number }>).detail;
      const mgr = animManagerRef.current;
      if (!mgr) return;
      const shape = shapeMapRef.current.get(regionId);
      if (!shape) return;
      const [cx, cy] = shape.centroid;
      if (typeof mgr.spawnBombingSalvoAt === "function") {
        mgr.spawnBombingSalvoAt(cx, cy, false);
      } else {
        mgr.spawnBombAt(cx, cy);
      }
    };
    window.addEventListener("path-damage-bomb", pathDamageBombHandler);

    const bombardDamageHandler = (e: Event) => {
      const { regionId, killed } = (e as CustomEvent<{ regionId: string; killed: number }>).detail;
      if (killed > 0) {
        unitPulsesRef.current.set(regionId, { startTime: Date.now(), delta: -killed });
        const prev = bombardAdjustRef.current.get(regionId) ?? 0;
        bombardAdjustRef.current.set(regionId, prev + killed);
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

    const bombardCompleteHandler = (e: Event) => {
      const { regionId } = (e as CustomEvent<{ regionId: string }>).detail;
      bombardAdjustRef.current.delete(regionId);
      recentlyBombedRef.current.delete(regionId);
    };
    window.addEventListener("bombard-complete", bombardCompleteHandler);

    const samInterceptHandler = (e: Event) => {
      const { sourceId, targetId, samRegionId, flightMs, samFlightMs } = (
        e as CustomEvent<{
          sourceId: string;
          targetId: string;
          samRegionId: string;
          flightMs: number;
          samFlightMs?: number;
        }>
      ).detail;
      const sMap = shapeMapRef.current;
      const artSrc = sMap.get(sourceId)?.centroid;
      const tgt = sMap.get(targetId)?.centroid;
      const samSrc = sMap.get(samRegionId)?.centroid;
      if (!artSrc || !tgt || !samSrc) return;
      const samMs = samFlightMs ?? 600;
      const artProgress = Math.min(samMs / flightMs, 0.9);
      const curvePath = computeCurvePath(artSrc, tgt, 0.55, 20);
      const meetIdx = Math.floor(curvePath.length * artProgress);
      const meetPt = curvePath[Math.min(meetIdx, curvePath.length - 1)] ?? artSrc;
      samInterceptsRef.current.push({
        startTime: Date.now(),
        meetMs: samMs,
        artFrom: artSrc,
        samFrom: samSrc,
        meetPoint: [meetPt[0], meetPt[1]],
        exploded: false,
      });
    };
    window.addEventListener("sam-intercept-visual", samInterceptHandler);

    const killAnimHandler = (e: Event) => {
      const { animId } = (e as CustomEvent<{ animId: string }>).detail;
      animManagerRef.current?.removeAnimation(animId);
    };
    window.addEventListener("kill-animation", killAnimHandler);

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
      window.removeEventListener("sam-intercept-visual", samInterceptHandler);
      window.removeEventListener("kill-animation", killAnimHandler);
      clearInterval(interval);
    };
    // Refs are stable across renders — no deps needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    animManagerRef.current,
    bombardAdjustRef.current.delete,
    bombardAdjustRef.current.get,
    bombardAdjustRef.current.set,
    recentlyBombedRef.current,
    samInterceptsRef.current.push,
    stateMapRef.current.get,
    unitPulsesRef.current.set,
  ]);
}
