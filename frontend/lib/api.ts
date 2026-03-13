// SSR: use internal container URL; browser: use relative path (same origin via Caddy)
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined"
    ? "/api/v1"
    : process.env.API_URL || "http://backend:8000/api/v1");

interface FetchOptions extends RequestInit {
  token?: string | null;
}

async function fetchAPI<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { token, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { headers, ...rest });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new APIError(res.status, body.detail || res.statusText, body);
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

export class APIError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown
  ) {
    super(message);
    this.name = "APIError";
  }
}

// --- Auth ---

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: string;
  elo_rating: number;
  date_joined: string;
  tutorial_completed: boolean;
}

export async function login(
  email: string,
  password: string
): Promise<TokenPair> {
  return fetchAPI<TokenPair>("/token/pair", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function refreshToken(refresh: string): Promise<TokenPair> {
  return fetchAPI<TokenPair>("/token/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh }),
  });
}

export async function register(data: {
  username: string;
  email: string;
  password: string;
}): Promise<User> {
  return fetchAPI<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getMe(token: string): Promise<User> {
  return fetchAPI<User>("/auth/me", { token });
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  elo_rating: number;
  matches_played: number;
  wins: number;
  win_rate: number;
  average_placement: number;
}

export async function getLeaderboard(token: string): Promise<LeaderboardEntry[]> {
  return fetchAPI<LeaderboardEntry[]>("/auth/leaderboard", { token });
}

// --- Config ---

export interface BuildingType {
  id: string;
  name: string;
  slug: string;
  asset_key: string;
  description: string;
  icon: string;
  cost: number;
  currency_cost: number;
  build_time_ticks: number;
  max_per_region: number;
  requires_coastal: boolean;
  defense_bonus: number;
  vision_range: number;
  unit_generation_bonus: number;
  currency_generation_bonus: number;
  order: number;
}

export interface UnitType {
  id: string;
  name: string;
  slug: string;
  asset_key: string;
  description: string;
  icon: string;
  attack: number;
  defense: number;
  speed: number;
  attack_range: number;
  sea_range: number;
  sea_hop_distance_km: number;
  movement_type: string;
  produced_by_slug?: string | null;
  production_cost: number;
  production_time_ticks: number;
  manpower_cost: number;
  order: number;
}

export interface GameSettings {
  max_players: number;
  min_players: number;
  tick_interval_ms: number;
  starting_units: number;
  base_unit_generation_rate: number;
  starting_currency: number;
  base_currency_per_tick: number;
  region_currency_per_tick: number;
}

export interface MapConfigItem {
  id: string;
  name: string;
  description: string;
  country_codes: string[];
}

export interface GameModeListItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  max_players: number;
  min_players: number;
  is_default: boolean;
  order: number;
}

export interface GameMode extends GameModeListItem {
  tick_interval_ms: number;
  capital_selection_time_seconds: number;
  match_duration_limit_minutes: number;
  base_unit_generation_rate: number;
  capital_generation_bonus: number;
  starting_currency: number;
  base_currency_per_tick: number;
  region_currency_per_tick: number;
  attacker_advantage: number;
  defender_advantage: number;
  combat_randomness: number;
  starting_units: number;
  starting_regions: number;
  neutral_region_units: number;
  elo_k_factor: number;
  map_config_id: string | null;
  is_active: boolean;
}

export interface AbilityType {
  id: string;
  name: string;
  slug: string;
  asset_key: string;
  description: string;
  icon: string;
  sound_key: string;
  target_type: "enemy" | "own" | "any";
  range: number;
  currency_cost: number;
  cooldown_ticks: number;
  damage: number;
  effect_duration_ticks: number;
  effect_params: Record<string, number>;
  order: number;
}

export interface FullConfig {
  settings: GameSettings;
  buildings: BuildingType[];
  units: UnitType[];
  abilities: AbilityType[];
  maps: MapConfigItem[];
  game_modes: GameModeListItem[];
}

export async function getConfig(): Promise<FullConfig> {
  return fetchAPI<FullConfig>("/config/");
}

export async function getGameModes(): Promise<GameModeListItem[]> {
  return fetchAPI<GameModeListItem[]>("/config/game-modes/");
}

export async function getGameMode(slug: string): Promise<GameMode> {
  return fetchAPI<GameMode>(`/config/game-modes/${slug}/`);
}

// --- Geo ---

export interface GeoJSON {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface GeoFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    country_code: string;
    country_name: string;
    is_coastal: boolean;
    neighbor_ids: string[];
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

export interface RegionGraphEntry {
  id: string;
  neighbor_ids: string[];
  centroid: [number, number] | null;
}

export async function getRegions(): Promise<GeoJSON> {
  return fetchAPI<GeoJSON>("/geo/regions/");
}

/** Lightweight neighbor graph + centroids (no geometry).
 *  Pass matchId to restrict to that match's map config. */
export async function getRegionsGraph(matchId?: string): Promise<RegionGraphEntry[]> {
  const qs = matchId ? `?match_id=${matchId}` : "";
  return fetchAPI<RegionGraphEntry[]>(`/geo/regions/graph/${qs}`);
}

/** URL template for MVT vector tiles (MapLibre vector source).
 *  MapLibre requires absolute URLs — use window.location.origin as base.
 *  Pass matchId to restrict tiles to that match's map config. */
export function getRegionTilesUrl(matchId?: string): string {
  const apiRoot = API_BASE.replace(/\/api\/v1$/, "");
  // MapLibre requires an absolute URL — prepend origin when using relative path
  const origin =
    apiRoot.startsWith("http")
      ? apiRoot
      : typeof window !== "undefined"
        ? window.location.origin + apiRoot
        : apiRoot;
  const base = `${origin}/api/v1/geo/tiles/{z}/{x}/{y}/`;
  return matchId ? `${base}?match_id=${matchId}` : base;
}

// --- Matches ---

export interface MatchPlayer {
  id: string;
  user_id: string;
  username: string;
  color: string;
  is_alive: boolean;
  joined_at: string;
}

export interface Match {
  id: string;
  status: string;
  max_players: number;
  game_mode_id: string | null;
  winner_id: string | null;
  players: MatchPlayer[];
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface PlayerResult {
  user_id: string;
  username: string;
  placement: number;
  regions_conquered: number;
  units_produced: number;
  units_lost: number;
  buildings_built: number;
  elo_change: number;
}

export interface MatchResult {
  id: string;
  match_id: string;
  duration_seconds: number;
  total_ticks: number;
  player_results: PlayerResult[];
}

export async function getMyMatches(token: string): Promise<Match[]> {
  return fetchAPI<Match[]>("/matches/", { token });
}

export async function getMatch(
  token: string,
  matchId: string
): Promise<Match> {
  return fetchAPI<Match>(`/matches/${matchId}/`, { token });
}

export async function getMatchResult(
  token: string,
  matchId: string
): Promise<MatchResult> {
  return fetchAPI<MatchResult>(`/game/results/${matchId}/`, { token });
}

// --- Replay Snapshots ---

export interface SnapshotTick {
  tick: number;
  created_at: string;
}

export interface SnapshotDetail {
  tick: number;
  state_data: Record<string, unknown>;
  created_at: string;
}

export async function getMatchSnapshots(
  token: string,
  matchId: string
): Promise<SnapshotTick[]> {
  return fetchAPI<SnapshotTick[]>(`/game/snapshots/${matchId}/`, { token });
}

export async function getSnapshot(
  token: string,
  matchId: string,
  tick: number
): Promise<SnapshotDetail> {
  return fetchAPI<SnapshotDetail>(`/game/snapshots/${matchId}/${tick}/`, { token });
}

// --- Tutorial ---

export async function startTutorial(token: string): Promise<{ match_id: string }> {
  return fetchAPI<{ match_id: string }>("/matches/tutorial/start/", {
    method: "POST",
    token,
  });
}

export async function completeTutorial(token: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>("/auth/tutorial/complete/", {
    method: "POST",
    token,
  });
}

export async function cleanupTutorial(token: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>("/matches/tutorial/cleanup/", {
    method: "POST",
    token,
  });
}
