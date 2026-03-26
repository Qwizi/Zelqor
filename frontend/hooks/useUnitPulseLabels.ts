// ── Unit change floating labels ──────────────────────────────────────────────
// Extracted from GameCanvas.tsx — floating +N/-N labels on unit count changes.

import { type Application, type Container, Text, TextStyle } from "pixi.js";
import { useEffect } from "react";
import type { ShapesData } from "@/lib/canvasTypes";
import { UNIT_PULSE_DURATION_MS } from "@/lib/canvasTypes";

// Module-level TextStyle constants — avoids re-creating on every effect run
const PULSE_STYLE_GREEN = new TextStyle({
  fontFamily: "Rajdhani, sans-serif",
  fontSize: 16,
  fontWeight: "bold",
  fill: 0x4ade80,
  align: "center",
  dropShadow: { color: 0x000000, blur: 4, distance: 1, alpha: 0.9, angle: Math.PI / 4 },
});
const PULSE_STYLE_RED = new TextStyle({
  fontFamily: "Rajdhani, sans-serif",
  fontSize: 16,
  fontWeight: "bold",
  fill: 0xf87171,
  align: "center",
  dropShadow: { color: 0x000000, blur: 4, distance: 1, alpha: 0.9, angle: Math.PI / 4 },
});

/**
 * Renders floating +N/-N labels above provinces when unit counts change.
 * Uses a Pixi ticker for smooth animation (drift up + fade out).
 */
export function useUnitPulseLabels(
  _appReady: boolean,
  appRef: React.RefObject<Application | null>,
  shapesData: ShapesData | null,
  unitChangeLayerRef: React.RefObject<Container | null>,
  unitPulsesRef: React.RefObject<Map<string, { startTime: number; delta: number }>>,
  centroidCacheRef: React.RefObject<Map<string, [number, number]>>,
) {
  useEffect(() => {
    const app = appRef.current;
    const unitChangeLayer = unitChangeLayerRef.current;
    if (!app || !unitChangeLayer || !shapesData) return;

    const centroidMap = centroidCacheRef.current;

    const activeTexts = new Map<string, Text>();

    const tickerFn = () => {
      const now = Date.now();
      const pulses = unitPulsesRef.current;

      for (const [rid, pulse] of pulses.entries()) {
        const elapsed = now - pulse.startTime;

        if (elapsed >= UNIT_PULSE_DURATION_MS) {
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
        const opacity = progress < 0.6 ? 1.0 : 1.0 - (progress - 0.6) / 0.4;
        const yOffset = -20 * progress;

        let txt = activeTexts.get(rid);
        if (!txt) {
          const centroid = centroidMap.get(rid);
          if (!centroid) continue;

          const isPositive = pulse.delta > 0;
          const label = isPositive ? `+${pulse.delta}` : String(pulse.delta);

          txt = new Text({ text: label, style: isPositive ? PULSE_STYLE_GREEN : PULSE_STYLE_RED, resolution: 3 });
          txt.anchor.set(0.5, 0.5);
          txt.position.set(centroid[0], centroid[1] - 20);
          txt.eventMode = "none";
          unitChangeLayer.addChild(txt);
          activeTexts.set(rid, txt);
        }

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
      for (const txt of activeTexts.values()) {
        if (!txt.destroyed) {
          unitChangeLayer.removeChild(txt);
          txt.destroy();
        }
      }
      activeTexts.clear();
    };
    // Only re-run when shapesData changes — refs are stable and read inside ticker
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesData, appRef.current, centroidCacheRef.current, unitChangeLayerRef.current, unitPulsesRef.current]);
}
