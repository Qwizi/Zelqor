const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? "/api/v1" : process.env.API_URL || "http://backend:8000/api/v1");

let overrideMap: Record<string, string> = {};
let loaded = false;

export async function loadAssetOverrides(): Promise<void> {
  if (loaded) return;
  try {
    const res = await fetch(`${API_BASE}/assets/`, {
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { assets: Record<string, string> };
      overrideMap = data.assets;
    }
  } catch {
    overrideMap = {};
  }
  loaded = true;
}

export function getOverrideUrl(key: string): string | null {
  return overrideMap[key] ?? null;
}

/**
 * Get asset URL with backend override support.
 * If the backend has an override for this key, use it; otherwise use the fallback.
 */
export function getAssetUrl(key: string, fallback: string): string {
  return overrideMap[key] ?? fallback;
}
