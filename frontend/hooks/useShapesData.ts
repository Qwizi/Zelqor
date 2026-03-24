import { useEffect, useState } from "react";
import type { ShapesData } from "@/lib/canvasTypes";

const API_BASE = typeof window !== "undefined" ? "/api/v1" : process.env.API_URL || "http://backend:8000/api/v1";

/**
 * Fetch pre-projected province shapes from the backend.
 * Returns pixel-space polygons ready for Pixi.js rendering.
 *
 * @param matchId — optional match ID to scope regions to the match's map config
 * @param canvasSize — pixel dimensions of the projection target (default 4096)
 */
export function useShapesData(matchId?: string, canvasSize = 4096) {
  const [shapesData, setShapesData] = useState<ShapesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      const params = new URLSearchParams({ canvas_size: String(canvasSize) });
      if (matchId) params.set("match_id", matchId);

      try {
        const res = await fetch(`${API_BASE}/geo/regions/shapes/?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to load shapes: ${res.status}`);
        }
        const data: ShapesData = await res.json();
        if (!cancelled) {
          setShapesData(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [matchId, canvasSize]);

  return { shapesData, loading, error };
}
