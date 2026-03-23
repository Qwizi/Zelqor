/**
 * Steam integration via Tauri IPC.
 * These functions are no-ops when running in browser (non-Tauri) mode.
 */

export interface SteamUser {
  steam_id: string;
  name: string;
}

export interface SteamAchievement {
  id: string;
  achieved: boolean;
}

/** Check if we're running inside Tauri desktop app */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri()) return null;
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function isSteamRunning(): Promise<boolean> {
  const result = await invoke<boolean>("is_steam_running");
  return result ?? false;
}

export async function getSteamUser(): Promise<SteamUser | null> {
  return invoke<SteamUser>("get_steam_user");
}

export async function getSteamAuthTicket(): Promise<string | null> {
  return invoke<string>("get_steam_auth_ticket");
}

export async function activateSteamOverlay(): Promise<void> {
  await invoke("activate_steam_overlay");
}

export async function setSteamAchievement(achievementId: string): Promise<void> {
  await invoke("set_steam_achievement", { achievementId });
}

export async function getSteamAchievements(): Promise<SteamAchievement[]> {
  const result = await invoke<SteamAchievement[]>("get_steam_achievements");
  return result ?? [];
}

export async function setSteamRichPresence(key: string, value: string): Promise<void> {
  await invoke("set_steam_rich_presence", { key, value });
}
