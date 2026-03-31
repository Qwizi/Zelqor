// SSR: use internal container URL; browser: use relative path (same origin via Caddy)
const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" ? "/api/v1" : process.env.API_URL || "http://backend:8000/api/v1");

interface FetchOptions extends RequestInit {
  /** @deprecated Tokens are now httpOnly cookies. Pass only when using a legacy explicit token. */
  token?: string | null;
}

// Prevent concurrent refresh attempts — share a single in-flight promise
let _refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  if (_refreshPromise) return _refreshPromise;
  _refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/token/refresh/`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const { setAuthenticated } = await import("@/lib/auth");
        setAuthenticated(false);
        return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      _refreshPromise = null;
    }
  })();
  return _refreshPromise;
}

async function fetchAPI<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { token, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((customHeaders as Record<string, string>) || {}),
  };

  // Explicit token provided — keep backward-compat Authorization header.
  // Normal cookie-based auth does not need this; the browser sends the cookie automatically.
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers,
    credentials: "include",
  });

  // Auto-refresh on 401 for authenticated requests
  if (res.status === 401 && typeof window !== "undefined") {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      const retryRes = await fetch(`${API_BASE}${path}`, {
        ...rest,
        headers,
        credentials: "include",
      });
      if (!retryRes.ok) {
        const body = await retryRes.json().catch(() => ({}));
        throw new APIError(retryRes.status, body.detail || retryRes.statusText, body);
      }
      if (retryRes.status === 204) return {} as T;
      return retryRes.json();
    }
  }

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
    public body?: unknown,
  ) {
    super(message);
    this.name = "APIError";
  }
}

export interface PaginatedResponse<T> {
  items: T[];
  count: number;
}

async function fetchPaginated<T>(
  path: string,
  options: FetchOptions & { limit?: number; offset?: number } = {},
): Promise<PaginatedResponse<T>> {
  const { limit, offset, ...rest } = options;
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  const separator = path.includes("?") ? "&" : "?";
  const url = qs ? `${path}${separator}${qs}` : path;
  return fetchAPI<PaginatedResponse<T>>(url, rest);
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
  is_banned: boolean;
  matches_played: number;
  wins: number;
  win_rate: number;
  average_placement: number;
  has_password: boolean;
  avatar_url: string | null;
  clan_tag: string | null;
  level: number;
  experience: number;
}

export class BannedError extends Error {
  constructor() {
    super("Account banned");
    this.name = "BannedError";
  }
}

export interface LoginResponse {
  user: User;
}

/** Login via cookie-based auth. Sets httpOnly cookies on the browser. */
export async function login(email: string, password: string): Promise<LoginResponse> {
  return fetchAPI<LoginResponse>("/auth/login/", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

/** Logout — clears httpOnly cookies on the server. */
export async function logoutAPI(): Promise<void> {
  await fetchAPI("/auth/logout/", { method: "POST" });
}

/**
 * @deprecated Cookie-based refresh is automatic inside fetchAPI.
 * Kept for backward compatibility only.
 */
export async function refreshToken(_refresh: string): Promise<TokenPair> {
  // Cookie refresh is handled internally by tryRefreshToken / the httpOnly cookie.
  // Return a dummy pair so callers that ignore the value still compile.
  await tryRefreshToken();
  return { access: "", refresh: "" };
}

export interface OnlineStats {
  online: number;
  in_queue: number;
  in_game: number;
}

export async function getOnlineStats(): Promise<OnlineStats> {
  return fetchAPI<OnlineStats>("/auth/online-stats");
}

export async function register(data: { username: string; email: string; password: string }): Promise<User> {
  return fetchAPI<User>("/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Fetch the current user. Auth is via httpOnly cookie; the token param is ignored but kept for backward compat. */
export async function getMe(_token?: string | null): Promise<User> {
  return fetchAPI<User>("/auth/me");
}

export async function setPassword(token: string, newPassword: string): Promise<{ ok: boolean }> {
  return fetchAPI("/auth/set-password/", {
    method: "POST",
    token,
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export async function changePassword(
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean }> {
  return fetchAPI("/auth/change-password/", {
    method: "POST",
    token,
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  });
}

export async function changeUsername(token: string, username: string): Promise<{ ok: boolean; username: string }> {
  return fetchAPI("/auth/change-username/", {
    method: "POST",
    token,
    body: JSON.stringify({ username }),
  });
}

// --- Social Auth ---

export interface SocialAuthURL {
  url: string;
}

export interface SocialAuthTokens {
  access: string;
  refresh: string;
  is_new_user: boolean;
}

export async function getSocialAuthURL(provider: "google" | "discord", redirectUri: string): Promise<SocialAuthURL> {
  return fetchAPI<SocialAuthURL>(`/auth/social/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
}

export async function socialAuthCallback(
  provider: "google" | "discord",
  code: string,
  redirectUri: string,
  state?: string | null,
): Promise<SocialAuthTokens> {
  return fetchAPI<SocialAuthTokens>(`/auth/social/${provider}/callback`, {
    method: "POST",
    body: JSON.stringify({ code, redirect_uri: redirectUri, state }),
  });
}

export interface SocialAccountOut {
  id: string;
  provider: string;
  display_name: string;
  email: string;
  avatar_url: string;
  created_at: string;
}

export async function getLinkedSocialAccounts(token: string): Promise<SocialAccountOut[]> {
  return fetchAPI<SocialAccountOut[]>("/auth/social/accounts", { token });
}

export async function linkSocialAccount(
  provider: "google" | "discord",
  code: string,
  redirectUri: string,
  state?: string | null,
): Promise<SocialAccountOut> {
  return fetchAPI<SocialAccountOut>(`/auth/social/${provider}/link`, {
    method: "POST",
    body: JSON.stringify({ code, redirect_uri: redirectUri, state }),
  });
}

export async function unlinkSocialAccount(token: string, accountId: string): Promise<void> {
  await fetchAPI(`/auth/social/${accountId}/unlink`, {
    method: "DELETE",
    token,
  });
}

// --- Push Notifications ---

export async function getVapidKey(): Promise<string> {
  const res = await fetchAPI<{ vapid_public_key: string }>("/auth/push/vapid-key/");
  return res.vapid_public_key;
}

export async function subscribePush(subscription: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
  await fetchAPI("/auth/push/subscribe/", {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(endpoint: string): Promise<void> {
  await fetchAPI("/auth/push/unsubscribe/", {
    method: "POST",
    body: JSON.stringify({ endpoint, p256dh: "", auth: "" }),
  });
}

export interface WsTicketResponse {
  ticket: string;
  challenge: string;
  difficulty: number;
}

/** Get a short-lived WebSocket ticket. Auth is via httpOnly cookie. */
export async function getWsTicket(_token?: string | null): Promise<WsTicketResponse> {
  return fetchAPI<WsTicketResponse>("/auth/ws-ticket/", {
    method: "POST",
  });
}

export interface LeaderboardEntry {
  id: string;
  username: string;
  elo_rating: number;
  matches_played: number;
  wins: number;
  win_rate: number;
  average_placement: number;
  is_banned: boolean;
  avatar_url: string | null;
  clan_tag: string | null;
  level: number;
  experience: number;
}

export async function getLeaderboard(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<LeaderboardEntry>> {
  return fetchPaginated<LeaderboardEntry>("/auth/leaderboard", { token, limit, offset });
}

// --- Config ---

export interface BuildingType {
  id: string;
  name: string;
  slug: string;
  asset_key: string;
  asset_url: string | null;
  description: string;
  icon: string;
  cost: number;
  energy_cost: number;
  build_time_ticks: number;
  max_per_region: number;
  requires_coastal: boolean;
  defense_bonus: number;
  vision_range: number;
  unit_generation_bonus: number;
  energy_generation_bonus: number;
  order: number;
  max_level: number;
  level_stats: Record<string, Record<string, number>>;
}

export interface UnitType {
  id: string;
  name: string;
  slug: string;
  asset_key: string;
  asset_url: string | null;
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
  max_level: number;
  level_stats: Record<string, Record<string, number>>;
  is_stealth: boolean;
  path_damage: number;
  aoe_damage: number;
  blockade_port: boolean;
  intercept_air: boolean;
  can_station_anywhere: boolean;
  lifetime_ticks: number;
  combat_target: string;
  ticks_per_hop: number;
  air_speed_ticks_per_hop: number;
}

export interface GameSettings {
  max_players: number;
  min_players: number;
  tick_interval_ms: number;
  starting_units: number;
  base_unit_generation_rate: number;
  starting_energy: number;
  base_energy_per_tick: number;
  region_energy_per_tick: number;
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
  starting_energy: number;
  base_energy_per_tick: number;
  region_energy_per_tick: number;
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
  asset_url: string | null;
  description: string;
  icon: string;
  sound_key: string;
  sound_url: string | null;
  target_type: "enemy" | "own" | "any";
  range: number;
  energy_cost: number;
  cooldown_ticks: number;
  damage: number;
  effect_duration_ticks: number;
  effect_params: Record<string, number>;
  order: number;
  max_level: number;
  level_stats: Record<string, Record<string, number>>;
}

export interface GameModuleItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  default_enabled: boolean;
  default_config: Record<string, unknown>;
  config_schema: Array<{
    key: string;
    label: string;
    type: string;
    default: unknown;
    min?: number;
    max?: number;
  }>;
  order: number;
}

export interface SystemModule {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  module_type: "system" | "game";
  enabled: boolean;
  config: Record<string, unknown>;
  config_schema: Array<{
    key: string;
    label: string;
    type: string;
    default: unknown;
    min?: number;
    max?: number;
  }>;
  affects_backend: boolean;
  affects_frontend: boolean;
  affects_gateway: boolean;
  is_core: boolean;
  order: number;
  default_enabled: boolean;
  default_config: Record<string, unknown>;
  field_mapping: Record<string, unknown>;
}

export interface FullConfig {
  settings: GameSettings;
  buildings: BuildingType[];
  units: UnitType[];
  abilities: AbilityType[];
  maps: MapConfigItem[];
  game_modes: GameModeListItem[];
  modules: GameModuleItem[];
  system_modules: SystemModule[];
}

export async function getConfig(): Promise<FullConfig> {
  return fetchAPI<FullConfig>("/config/");
}

/** Returns the numeric stat for a given level from level_stats, falling back to a base value. */
export function getLevelStat(
  levelStats: Record<string, Record<string, number>> | undefined,
  level: number,
  key: string,
  fallback: number,
): number {
  return levelStats?.[String(level)]?.[key] ?? fallback;
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
  const origin = apiRoot.startsWith("http")
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
  is_banned: boolean;
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
  is_banned: boolean;
}

export interface MatchResult {
  id: string;
  match_id: string;
  duration_seconds: number;
  total_ticks: number;
  player_results: PlayerResult[];
}

// --- Matchmaking ---

export interface MatchmakingStatus {
  state: "idle" | "in_queue" | "in_lobby" | "in_match";
  match_id?: string;
  lobby_id?: string;
  game_mode_slug?: string;
  joined_at?: string;
  players?: Array<{ user_id: string; username: string; is_ready: boolean; is_bot: boolean }>;
  max_players?: number;
}

export async function getMatchmakingStatus(_token?: string | null): Promise<MatchmakingStatus> {
  return fetchAPI<MatchmakingStatus>("/matchmaking/status/");
}

export async function getMyMatches(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<Match>> {
  return fetchPaginated<Match>("/matches/", { token, limit, offset });
}

export async function getPlayerMatches(
  token: string,
  userId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<Match>> {
  return fetchPaginated<Match>(`/matches/player/${userId}/`, { token, limit, offset });
}

export async function getMatch(token: string, matchId: string): Promise<Match> {
  return fetchAPI<Match>(`/matches/${matchId}/`, { token });
}

export async function getMatchResult(token: string, matchId: string): Promise<MatchResult> {
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

export async function getMatchSnapshots(token: string, matchId: string): Promise<SnapshotTick[]> {
  return fetchAPI<SnapshotTick[]>(`/game/snapshots/${matchId}/`, { token });
}

export async function getSnapshot(token: string, matchId: string, tick: number): Promise<SnapshotDetail> {
  return fetchAPI<SnapshotDetail>(`/game/snapshots/${matchId}/${tick}/`, { token });
}

// --- Tutorial ---

export async function startTutorial(_token?: string | null): Promise<{ match_id: string }> {
  return fetchAPI<{ match_id: string }>("/matches/tutorial/start/", {
    method: "POST",
  });
}

export async function completeTutorial(_token?: string | null): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>("/auth/tutorial/complete/", {
    method: "POST",
  });
}

export async function cleanupTutorial(_token?: string | null): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>("/matches/tutorial/cleanup/", {
    method: "POST",
  });
}

// --- Share ---

export interface ShareLink {
  token: string;
  resource_type: string;
  resource_id: string;
}

export interface SharedMatchData {
  resource_type: "match_result";
  match: Match;
  result: MatchResult | null;
  snapshot_ticks: number[];
}

export async function createShareLink(resourceType: string, resourceId: string): Promise<ShareLink> {
  return fetchAPI<ShareLink>("/share/create/", {
    method: "POST",
    body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
  });
}

export async function getSharedResource(shareToken: string): Promise<SharedMatchData> {
  return fetchAPI<SharedMatchData>(`/share/${shareToken}/`);
}

export async function getSharedSnapshot(shareToken: string, tick: number): Promise<SnapshotDetail> {
  return fetchAPI<SnapshotDetail>(`/share/${shareToken}/snapshots/${tick}/`);
}

// --- Developer Platform ---

export interface DeveloperApp {
  id: string;
  name: string;
  description: string;
  client_id: string;
  is_active: boolean;
  created_at: string;
}

export interface DeveloperAppCreated extends DeveloperApp {
  client_secret: string;
}

export interface APIKeyOut {
  id: string;
  prefix: string;
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  last_used: string | null;
  created_at: string;
}

export interface APIKeyCreated extends APIKeyOut {
  key: string;
}

export interface WebhookOut {
  id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  created_at: string;
}

export interface WebhookDelivery {
  id: string;
  event: string;
  payload: Record<string, unknown>;
  response_status: number | null;
  success: boolean;
  created_at: string;
}

export interface WebhookTestResult {
  success: boolean;
  status_code: number | null;
  message: string;
}

export interface UsageStats {
  app_id: string;
  total_api_calls: number;
  active_keys: number;
  total_webhooks: number;
  active_webhooks: number;
  total_deliveries: number;
  successful_deliveries: number;
  failed_deliveries: number;
}

export interface AvailableScopes {
  scopes: string[];
}

export interface AvailableEvents {
  events: string[];
}

// Apps

export async function createDeveloperApp(
  token: string,
  data: { name: string; description?: string },
): Promise<DeveloperAppCreated> {
  return fetchAPI<DeveloperAppCreated>("/developers/apps/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function getDeveloperApps(token: string): Promise<PaginatedResponse<DeveloperApp>> {
  return fetchPaginated<DeveloperApp>("/developers/apps/", { token });
}

export async function getDeveloperApp(token: string, appId: string): Promise<DeveloperApp> {
  return fetchAPI<DeveloperApp>(`/developers/apps/${appId}/`, { token });
}

export async function updateDeveloperApp(
  token: string,
  appId: string,
  data: { name?: string; description?: string },
): Promise<DeveloperApp> {
  return fetchAPI<DeveloperApp>(`/developers/apps/${appId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteDeveloperApp(token: string, appId: string): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/`, { method: "DELETE", token });
}

// API Keys

export async function createAPIKey(
  token: string,
  appId: string,
  data: { scopes: string[]; rate_limit?: number },
): Promise<APIKeyCreated> {
  return fetchAPI<APIKeyCreated>(`/developers/apps/${appId}/keys/`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function getAPIKeys(
  token: string,
  appId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<APIKeyOut>> {
  return fetchPaginated<APIKeyOut>(`/developers/apps/${appId}/keys/`, { token, limit, offset });
}

export async function deleteAPIKey(token: string, appId: string, keyId: string): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/keys/${keyId}/`, {
    method: "DELETE",
    token,
  });
}

// Webhooks

export async function createWebhook(
  token: string,
  appId: string,
  data: { url: string; events: string[] },
): Promise<WebhookOut> {
  return fetchAPI<WebhookOut>(`/developers/apps/${appId}/webhooks/`, {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}

export async function getWebhooks(
  token: string,
  appId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<WebhookOut>> {
  return fetchPaginated<WebhookOut>(`/developers/apps/${appId}/webhooks/`, {
    token,
    limit,
    offset,
  });
}

export async function updateWebhook(
  token: string,
  appId: string,
  webhookId: string,
  data: { url?: string; events?: string[]; is_active?: boolean },
): Promise<WebhookOut> {
  return fetchAPI<WebhookOut>(`/developers/apps/${appId}/webhooks/${webhookId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteWebhook(token: string, appId: string, webhookId: string): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/webhooks/${webhookId}/`, {
    method: "DELETE",
    token,
  });
}

export async function testWebhook(token: string, appId: string, webhookId: string): Promise<WebhookTestResult> {
  return fetchAPI<WebhookTestResult>(`/developers/apps/${appId}/webhooks/${webhookId}/test/`, {
    method: "POST",
    token,
  });
}

export async function getWebhookDeliveries(
  token: string,
  appId: string,
  webhookId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<WebhookDelivery>> {
  return fetchPaginated<WebhookDelivery>(`/developers/apps/${appId}/webhooks/${webhookId}/deliveries/`, {
    token,
    limit,
    offset,
  });
}

// Usage & Meta

export async function getAppUsage(token: string, appId: string): Promise<UsageStats> {
  return fetchAPI<UsageStats>(`/developers/apps/${appId}/usage/`, { token });
}

export async function getAvailableScopes(token: string): Promise<AvailableScopes> {
  return fetchAPI<AvailableScopes>("/developers/scopes/", { token });
}

export async function getAvailableEvents(token: string): Promise<AvailableEvents> {
  return fetchAPI<AvailableEvents>("/developers/events/", { token });
}

// --- Community Servers ---

export interface CommunityServer {
  id: string;
  name: string;
  description: string;
  region: string;
  max_players: number;
  is_public: boolean;
  status: "online" | "offline" | "maintenance";
  last_heartbeat: string | null;
  server_version: string;
  is_verified: boolean;
  created_at: string;
  max_concurrent_matches: number;
  current_match_count: number;
  current_player_count: number;
  motd: string;
  tags: string[];
  auto_start_match: boolean;
  min_players_to_start: number;
  match_start_countdown_seconds: number;
  allow_spectators: boolean;
  max_spectators: number;
  allow_custom_game_modes: boolean;
  has_password: boolean;
  installed_plugins: string[];
  game_modes: string[];
}

export async function getPublicServers(region?: string): Promise<CommunityServer[]> {
  const params = region ? `?region=${region}` : "";
  const res = await fetchAPI<{ items: CommunityServer[]; count: number }>(`/servers/${params}`);
  return res.items;
}

export async function getServer(id: string): Promise<CommunityServer> {
  return fetchAPI<CommunityServer>(`/servers/${id}/`);
}

export async function getDeveloperServers(token: string, appId: string): Promise<PaginatedResponse<CommunityServer>> {
  return fetchPaginated<CommunityServer>(`/developers/apps/${appId}/servers/`, { token });
}

export async function deleteDeveloperServer(token: string, appId: string, serverId: string): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/servers/${serverId}/`, { method: "DELETE", token });
}

// --- Plugin Marketplace ---

export interface PluginListItem {
  id: string;
  name: string;
  slug: string;
  version: string;
  description: string;
  category: string;
  hooks: string[];
  tags: string[];
  is_approved: boolean;
  is_featured: boolean;
  download_count: number;
  install_count: number;
  average_rating: number;
  rating_count: number;
  author_name: string;
}

export interface PluginDetail extends PluginListItem {
  long_description: string;
  is_published: boolean;
  homepage_url: string;
  source_url: string;
  license: string;
  is_deprecated: boolean;
  deprecation_message: string;
  config_schema: Record<string, unknown>;
  default_config: Record<string, unknown>;
  min_engine_version: string;
  required_permissions: string[];
  created_at: string;
}

export interface PluginReview {
  id: string;
  username: string;
  rating: number;
  title: string;
  body: string;
  created_at: string;
}

export interface PluginCategory {
  value: string;
  label: string;
  count: number;
}

export interface CustomGameMode {
  id: string;
  server_id: string;
  creator_username: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  base_game_mode: string | null;
  config_overrides: Record<string, unknown>;
  required_plugins: string[];
  is_public: boolean;
  is_active: boolean;
  play_count: number;
  created_at: string;
}

export interface ServerPlugin {
  id: string;
  plugin_slug: string;
  plugin_name: string;
  plugin_version: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  priority: number;
  installed_at: string;
}

export async function getPublicPlugins(params?: {
  category?: string;
  tag?: string;
  search?: string;
  sort?: string;
  featured?: boolean;
}): Promise<PluginListItem[]> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.set("category", params.category);
  if (params?.tag) searchParams.set("tag", params.tag);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.featured !== undefined) searchParams.set("featured", String(params.featured));
  const query = searchParams.toString();
  const res = await fetchAPI<{ items: PluginListItem[] }>(`/plugins/${query ? `?${query}` : ""}`);
  return res.items;
}

export async function getPlugin(slug: string): Promise<PluginDetail> {
  return fetchAPI<PluginDetail>(`/plugins/${slug}/`);
}

export async function getPluginCategories(): Promise<PluginCategory[]> {
  return fetchAPI<PluginCategory[]>("/plugins/categories/");
}

export async function getFeaturedPlugins(): Promise<PluginListItem[]> {
  const res = await fetchAPI<{ items: PluginListItem[] }>("/plugins/featured/");
  return res.items;
}

export async function getPluginReviews(slug: string): Promise<PluginReview[]> {
  const res = await fetchAPI<{ items: PluginReview[] }>(`/plugins/${slug}/reviews/`);
  return res.items;
}

export async function getServerPlugins(serverId: string): Promise<ServerPlugin[]> {
  const res = await fetchAPI<{ items: ServerPlugin[] }>(`/servers/${serverId}/plugins/`);
  return res.items;
}

export async function getServerGameModes(serverId: string): Promise<CustomGameMode[]> {
  const res = await fetchAPI<{ items: CustomGameMode[] }>(`/servers/${serverId}/game-modes/`);
  return res.items;
}

// --- Inventory ---

export interface ItemOut {
  id: string;
  name: string;
  slug: string;
  description: string;
  item_type: string;
  rarity: string;
  icon: string;
  cosmetic_slot: string;
  is_stackable: boolean;
  is_tradeable: boolean;
  is_consumable: boolean;
  base_value: number;
  level: number;
  blueprint_ref: string;
  boost_params?: Record<string, unknown> | null;
  cosmetic_params?: Record<string, unknown> | null;
  crate_loot_table?: Array<unknown> | null;
}

export interface ItemInstanceOut {
  id: string;
  item: ItemOut;
  pattern_seed: number;
  wear: number;
  wear_condition: string;
  stattrak: boolean;
  stattrak_matches: number;
  stattrak_kills: number;
  stattrak_units_produced: number;
  nametag: string;
  is_rare_pattern: boolean;
  first_owner_username: string | null;
  crafted_by_username: string | null;
  created_at: string;
}

export interface ItemCategoryOut {
  id: string;
  name: string;
  slug: string;
  items: ItemOut[];
}

export interface InventoryItemOut {
  id: string;
  item: ItemOut;
  quantity: number;
  is_instance: boolean;
  instance: ItemInstanceOut | null;
}

export interface WalletOut {
  gold: number;
  total_earned: number;
  total_spent: number;
}

export interface ItemDropOut {
  id: string;
  item: ItemOut;
  quantity: number;
  source: string;
  match_id: string | null;
  instance: ItemInstanceOut | null;
  created_at: string;
}

export async function getItemCategories(): Promise<ItemCategoryOut[]> {
  return fetchAPI<ItemCategoryOut[]>("/inventory/items/");
}

export async function getMyInventory(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<InventoryItemOut>> {
  return fetchPaginated<InventoryItemOut>("/inventory/my/", { token, limit, offset });
}

export async function getMyWallet(token: string): Promise<WalletOut> {
  return fetchAPI<WalletOut>("/inventory/wallet/", { token });
}

export async function getMyDrops(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ItemDropOut>> {
  return fetchPaginated<ItemDropOut>("/inventory/drops/", { token, limit, offset });
}

export async function openCrate(
  token: string,
  crateSlug: string,
  keySlug: string,
): Promise<{ drops: { item_name: string; item_slug: string; rarity: string; quantity: number }[] }> {
  return fetchAPI("/inventory/open-crate/", {
    method: "POST",
    token,
    body: JSON.stringify({ crate_item_slug: crateSlug, key_item_slug: keySlug }),
  });
}

// --- Marketplace ---

export interface MarketListingOut {
  id: string;
  seller_username: string;
  item: ItemOut;
  listing_type: string;
  quantity: number;
  quantity_remaining: number;
  price_per_unit: number;
  status: string;
  is_bot_listing: boolean;
  created_at: string;
  expires_at: string | null;
}

export interface MarketTransactionOut {
  id: string;
  buyer_username: string;
  seller_username: string;
  item: ItemOut;
  quantity: number;
  price_per_unit: number;
  total_price: number;
  fee: number;
  created_at: string;
}

export interface MarketConfigOut {
  transaction_fee_percent: number;
  listing_duration_hours: number;
  max_active_listings_per_user: number;
}

export async function getMarketConfig(): Promise<MarketConfigOut> {
  return fetchAPI<MarketConfigOut>("/marketplace/config/");
}

export async function getMarketListings(
  itemSlug?: string,
  listingType?: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<MarketListingOut>> {
  const params = new URLSearchParams();
  if (itemSlug) params.set("item_slug", itemSlug);
  if (listingType) params.set("listing_type", listingType);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString() ? `?${params}` : "";
  return fetchAPI<PaginatedResponse<MarketListingOut>>(`/marketplace/listings/${qs}`);
}

export async function getMyListings(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<MarketListingOut>> {
  return fetchPaginated<MarketListingOut>("/marketplace/my-listings/", { token, limit, offset });
}

export async function getMyTradeHistory(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<MarketTransactionOut>> {
  return fetchPaginated<MarketTransactionOut>("/marketplace/history/", { token, limit, offset });
}

export async function createListing(
  token: string,
  data: { item_slug: string; listing_type: string; quantity: number; price_per_unit: number },
): Promise<MarketListingOut> {
  return fetchAPI<MarketListingOut>("/marketplace/create-listing/", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export async function buyFromListing(token: string, listingId: string, quantity: number): Promise<{ message: string }> {
  return fetchAPI("/marketplace/buy/", {
    method: "POST",
    token,
    body: JSON.stringify({ listing_id: listingId, quantity }),
  });
}

export async function cancelListing(token: string, listingId: string): Promise<{ message: string }> {
  return fetchAPI(`/marketplace/cancel/${listingId}/`, {
    method: "POST",
    token,
  });
}

// --- Cosmetics ---

export interface EquippedCosmeticOut {
  slot: string;
  item_slug: string;
  item_name: string;
  asset_url: string | null;
  cosmetic_params: Record<string, unknown> | null;
  instance: ItemInstanceOut | null;
}

export interface EquippedCosmeticDetail {
  slot: string;
  item_slug: string;
  item_name: string;
  asset_url: string | null;
  cosmetic_params: Record<string, unknown> | null;
  instance: ItemInstanceOut | null;
}

export async function getEquippedCosmetics(token: string): Promise<EquippedCosmeticOut[]> {
  return fetchAPI<EquippedCosmeticOut[]>("/inventory/cosmetics/equipped/", { token });
}

export interface EquipCosmeticPayload {
  item_slug: string;
  instance_id?: string;
}

export async function equipCosmetic(token: string, payload: EquipCosmeticPayload): Promise<EquippedCosmeticDetail> {
  return fetchAPI<EquippedCosmeticDetail>("/inventory/cosmetics/equip/", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function unequipCosmetic(token: string, slot: string): Promise<{ detail: string }> {
  return fetchAPI<{ detail: string }>("/inventory/cosmetics/unequip/", {
    method: "POST",
    token,
    body: JSON.stringify({ slot }),
  });
}

// --- Crafting ---

export interface RecipeIngredientOut {
  item: ItemOut;
  quantity: number;
}

export interface RecipeOut {
  id: string;
  name: string;
  slug: string;
  description: string;
  result_item: ItemOut;
  result_quantity: number;
  gold_cost: number;
  crafting_time_seconds: number;
  ingredients: RecipeIngredientOut[];
}

export async function getRecipes(): Promise<RecipeOut[]> {
  return fetchAPI<RecipeOut[]>("/crafting/recipes/");
}

export interface CraftResult {
  message: string;
  item_name: string;
  item_slug: string;
  quantity: number;
  instance: ItemInstanceOut | null;
}

export async function craftItem(token: string, recipeSlug: string): Promise<CraftResult> {
  return fetchAPI<CraftResult>("/crafting/craft/", {
    method: "POST",
    token,
    body: JSON.stringify({ recipe_slug: recipeSlug }),
  });
}

// --- Decks ---

export interface DeckItemOut {
  item: ItemOut;
  quantity: number;
  instance: ItemInstanceOut | null;
}

export interface DeckOut {
  id: string;
  name: string;
  is_default: boolean;
  is_editable: boolean;
  items: DeckItemOut[];
}

export async function getMyDecks(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<DeckOut>> {
  return fetchPaginated<DeckOut>("/inventory/decks/", { token, limit, offset });
}

export async function createDeck(token: string, data: { name: string }): Promise<DeckOut> {
  return fetchAPI<DeckOut>("/inventory/decks/", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export async function getDeck(token: string, deckId: string): Promise<DeckOut> {
  return fetchAPI<DeckOut>(`/inventory/decks/${deckId}/`, { token });
}

export async function updateDeck(
  token: string,
  deckId: string,
  data: { name?: string; items?: { item_slug: string; quantity: number }[] },
): Promise<DeckOut> {
  return fetchAPI<DeckOut>(`/inventory/decks/${deckId}/`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

export async function deleteDeck(token: string, deckId: string): Promise<void> {
  await fetchAPI(`/inventory/decks/${deckId}/`, { method: "DELETE", token });
}

export async function setDefaultDeck(token: string, deckId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/inventory/decks/${deckId}/set-default/`, {
    method: "POST",
    token,
  });
}

// --- OAuth ---

export interface OAuthAppInfo {
  name: string;
  description: string;
}

export interface OAuthAuthorizeResult {
  code: string;
  state: string | null;
}

export async function getAppByClientId(clientId: string): Promise<OAuthAppInfo | null> {
  try {
    return await fetchAPI<OAuthAppInfo>(`/oauth/app-info/?client_id=${encodeURIComponent(clientId)}`);
  } catch {
    return null;
  }
}

export async function oauthAuthorize(data: {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
}): Promise<OAuthAuthorizeResult> {
  return fetchAPI<OAuthAuthorizeResult>("/oauth/authorize/", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function oauthDeviceAuthorize(userCode: string): Promise<void> {
  return fetchAPI<void>("/oauth/device/authorize/", {
    method: "POST",
    body: JSON.stringify({ user_code: userCode }),
  });
}

// --- Friends ---

export interface FriendUser {
  id: string;
  username: string;
  elo_rating: number;
  is_online: boolean;
  activity_status: string;
  activity_details: {
    status?: string;
    game_mode?: string;
    match_id?: string;
    players_count?: number;
    started_at?: string;
  };
  clan_tag: string | null;
}

export interface FriendshipOut {
  id: string;
  from_user: FriendUser;
  to_user: FriendUser;
  status: string;
  created_at: string;
}

export async function getFriends(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<FriendshipOut>> {
  return fetchPaginated<FriendshipOut>("/friends/", { token, limit, offset });
}

export async function getReceivedRequests(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<FriendshipOut>> {
  return fetchPaginated<FriendshipOut>("/friends/requests/received/", { token, limit, offset });
}

export async function getSentRequests(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<FriendshipOut>> {
  return fetchPaginated<FriendshipOut>("/friends/requests/sent/", { token, limit, offset });
}

export async function sendFriendRequest(token: string, username: string): Promise<FriendshipOut> {
  return fetchAPI<FriendshipOut>("/friends/request/", {
    method: "POST",
    token,
    body: JSON.stringify({ username }),
  });
}

export async function acceptFriendRequest(token: string, friendshipId: string): Promise<FriendshipOut> {
  return fetchAPI<FriendshipOut>(`/friends/${friendshipId}/accept/`, {
    method: "POST",
    token,
  });
}

export async function rejectFriendRequest(token: string, friendshipId: string): Promise<FriendshipOut> {
  return fetchAPI<FriendshipOut>(`/friends/${friendshipId}/reject/`, {
    method: "POST",
    token,
  });
}

export async function removeFriend(token: string, friendshipId: string): Promise<void> {
  await fetchAPI(`/friends/${friendshipId}/`, { method: "DELETE", token });
}

export async function inviteFriendToGame(friendshipId: string, gameMode: string): Promise<{ lobby_id: string }> {
  return fetchAPI<{ lobby_id: string }>(`/friends/${friendshipId}/invite-game/`, {
    method: "POST",
    body: JSON.stringify({ game_mode: gameMode }),
  });
}

export async function acceptGameInvite(
  token: string,
  notificationId: string,
): Promise<{ lobby_id: string; game_mode: string }> {
  return fetchAPI<{ lobby_id: string; game_mode: string }>(`/friends/invite-accept/${notificationId}/`, {
    method: "POST",
    token,
  });
}

export async function rejectGameInvite(token: string, notificationId: string): Promise<void> {
  await fetchAPI(`/friends/invite-reject/${notificationId}/`, { method: "POST", token });
}

// --- Direct Messages ---

export interface DirectMessageOut {
  id: string;
  sender: FriendUser;
  receiver: FriendUser;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface ConversationOut {
  partner: FriendUser;
  last_message: { content: string; created_at: string; is_mine: boolean };
  unread_count: number;
}

export async function getConversations(token: string): Promise<ConversationOut[]> {
  return fetchAPI<ConversationOut[]>("/messages/conversations/", { token });
}

export async function getMessages(
  token: string,
  userId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<DirectMessageOut>> {
  return fetchPaginated<DirectMessageOut>(`/messages/${userId}/`, { token, limit, offset });
}

export async function sendMessage(token: string, userId: string, content: string): Promise<DirectMessageOut> {
  return fetchAPI<DirectMessageOut>(`/messages/${userId}/`, {
    method: "POST",
    token,
    body: JSON.stringify({ content }),
  });
}

export async function getUnreadMessageCount(token: string): Promise<{ count: number }> {
  return fetchAPI<{ count: number }>("/messages/unread-total/", { token });
}

// --- Notifications ---

export interface NotificationOut {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

export async function getNotifications(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<NotificationOut>> {
  return fetchPaginated<NotificationOut>("/notifications/", { token, limit, offset });
}

export async function getUnreadNotificationCount(token: string): Promise<{ count: number }> {
  return fetchAPI<{ count: number }>("/notifications/unread-count", { token });
}

export async function markNotificationRead(token: string, id: string): Promise<void> {
  await fetchAPI(`/notifications/${id}/read/`, { method: "POST", token });
}

export async function markAllNotificationsRead(token: string): Promise<void> {
  await fetchAPI("/notifications/read-all/", { method: "POST", token });
}

// ── Clans ──

export interface ClanUser {
  id: string;
  username: string;
  elo_rating: number;
}

export interface ClanOut {
  id: string;
  name: string;
  tag: string;
  description: string;
  badge: string | null;
  color: string;
  leader: ClanUser;
  level: number;
  experience: number;
  elo_rating: number;
  member_count: number;
  max_members: number;
  is_recruiting: boolean;
  is_public: boolean;
  created_at: string;
}

export interface ClanMembershipOut {
  id: string;
  user: ClanUser;
  role: string;
  joined_at: string;
  contributions_gold: number;
}

export interface ClanDetailOut extends ClanOut {
  treasury_gold: number;
  tax_percent: number;
  my_membership: ClanMembershipOut | null;
}

export interface ClanInvitationOut {
  id: string;
  clan: ClanOut;
  invited_user: ClanUser;
  invited_by: ClanUser;
  status: string;
  created_at: string;
  expires_at: string;
}

export interface ClanJoinRequestOut {
  id: string;
  clan: ClanOut;
  user: ClanUser;
  message: string;
  status: string;
  created_at: string;
}

export interface ClanWarOut {
  id: string;
  challenger: ClanOut;
  defender: ClanOut;
  status: string;
  winner_id: string | null;
  challenger_elo_change: number;
  defender_elo_change: number;
  players_per_side: number;
  wager_gold: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  match_id: string | null;
}

export interface ClanWarParticipantOut {
  id: string;
  user: ClanUser;
  clan_id: string;
}

export interface ClanActivityLogOut {
  id: string;
  actor: ClanUser | null;
  action: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ClanChatMessageOut {
  id: string;
  user: ClanUser;
  content: string;
  created_at: string;
}

export interface ClanLeaderboardEntry {
  id: string;
  name: string;
  tag: string;
  badge: string | null;
  color: string;
  level: number;
  elo_rating: number;
  member_count: number;
}

export interface ClanStats {
  clan_id: string;
  level: number;
  experience: number;
  elo_rating: number;
  member_count: number;
  wars_total: number;
  wars_won: number;
  wars_lost: number;
  war_win_rate: number;
}

export interface MyClanResponse {
  clan: ClanOut | null;
  membership: ClanMembershipOut | null;
}

// Clan CRUD

export async function createClan(
  token: string,
  data: { name: string; tag: string; description?: string; color?: string; is_public?: boolean },
): Promise<ClanOut> {
  return fetchAPI<ClanOut>("/clans/", { method: "POST", token, body: JSON.stringify(data) });
}

export async function getClans(
  token: string,
  search?: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanOut>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  return fetchAPI<PaginatedResponse<ClanOut>>(`/clans/${qs ? `?${qs}` : ""}`, { token });
}

export async function getMyClan(token: string): Promise<MyClanResponse> {
  return fetchAPI<MyClanResponse>("/clans/my/", { token });
}

export async function getClan(token: string, clanId: string): Promise<ClanDetailOut> {
  return fetchAPI<ClanDetailOut>(`/clans/${clanId}/`, { token });
}

export async function updateClan(token: string, clanId: string, data: Record<string, unknown>): Promise<ClanOut> {
  return fetchAPI<ClanOut>(`/clans/${clanId}/`, { method: "PATCH", token, body: JSON.stringify(data) });
}

export async function dissolveClan(token: string, clanId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/${clanId}/`, { method: "DELETE", token });
}

// Members

export async function getClanMembers(
  token: string,
  clanId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanMembershipOut>> {
  return fetchPaginated<ClanMembershipOut>(`/clans/${clanId}/members/`, { token, limit, offset });
}

export async function leaveClan(token: string, clanId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/${clanId}/leave/`, { method: "POST", token });
}

export async function kickMember(token: string, clanId: string, userId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/${clanId}/kick/${userId}/`, { method: "POST", token });
}

export async function promoteMember(
  token: string,
  clanId: string,
  userId: string,
): Promise<{ ok: boolean; new_role: string }> {
  return fetchAPI<{ ok: boolean; new_role: string }>(`/clans/${clanId}/promote/${userId}/`, { method: "POST", token });
}

export async function demoteMember(
  token: string,
  clanId: string,
  userId: string,
): Promise<{ ok: boolean; new_role: string }> {
  return fetchAPI<{ ok: boolean; new_role: string }>(`/clans/${clanId}/demote/${userId}/`, { method: "POST", token });
}

export async function transferLeadership(token: string, clanId: string, userId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/${clanId}/transfer-leadership/${userId}/`, { method: "POST", token });
}

// Invitations

export async function invitePlayer(token: string, clanId: string, userId: string): Promise<ClanInvitationOut> {
  return fetchAPI<ClanInvitationOut>(`/clans/${clanId}/invite/${userId}/`, { method: "POST", token });
}

export async function getMyInvitations(
  token: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanInvitationOut>> {
  return fetchPaginated<ClanInvitationOut>("/clans/my-invitations/", { token, limit, offset });
}

export async function acceptInvitation(token: string, invitationId: string): Promise<{ ok: boolean; clan_id: string }> {
  return fetchAPI<{ ok: boolean; clan_id: string }>(`/clans/invitations/${invitationId}/accept/`, {
    method: "POST",
    token,
  });
}

export async function declineInvitation(token: string, invitationId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/invitations/${invitationId}/decline/`, { method: "POST", token });
}

// Join Requests

export async function joinClan(
  token: string,
  clanId: string,
  message?: string,
): Promise<{ ok: boolean; joined: boolean; message?: string }> {
  return fetchAPI<{ ok: boolean; joined: boolean; message?: string }>(`/clans/${clanId}/join/`, {
    method: "POST",
    token,
    body: JSON.stringify({ message: message || "" }),
  });
}

export async function getClanJoinRequests(
  token: string,
  clanId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanJoinRequestOut>> {
  return fetchPaginated<ClanJoinRequestOut>(`/clans/${clanId}/join-requests/`, { token, limit, offset });
}

export async function acceptJoinRequest(token: string, requestId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/join-requests/${requestId}/accept/`, { method: "POST", token });
}

export async function declineJoinRequest(token: string, requestId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/join-requests/${requestId}/decline/`, { method: "POST", token });
}

// Treasury

export async function getClanTreasury(
  token: string,
  clanId: string,
): Promise<{ treasury_gold: number; tax_percent: number }> {
  return fetchAPI<{ treasury_gold: number; tax_percent: number }>(`/clans/${clanId}/treasury/`, { token });
}

export async function donateGold(
  token: string,
  clanId: string,
  amount: number,
): Promise<{ ok: boolean; treasury_gold: number }> {
  return fetchAPI<{ ok: boolean; treasury_gold: number }>(`/clans/${clanId}/treasury/donate/`, {
    method: "POST",
    token,
    body: JSON.stringify({ amount }),
  });
}

export async function withdrawGold(
  token: string,
  clanId: string,
  amount: number,
  reason?: string,
): Promise<{ ok: boolean; treasury_gold: number }> {
  return fetchAPI<{ ok: boolean; treasury_gold: number }>(`/clans/${clanId}/treasury/withdraw/`, {
    method: "POST",
    token,
    body: JSON.stringify({ amount, reason: reason || "" }),
  });
}

// Wars

export async function declareWar(
  token: string,
  clanId: string,
  targetId: string,
  data: { players_per_side?: number; wager_gold?: number },
): Promise<ClanWarOut> {
  return fetchAPI<ClanWarOut>(`/clans/${clanId}/wars/declare/${targetId}/`, {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export async function acceptWar(token: string, warId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/wars/${warId}/accept/`, { method: "POST", token });
}

export async function declineWar(token: string, warId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/wars/${warId}/decline/`, { method: "POST", token });
}

export async function joinWar(token: string, warId: string): Promise<ClanWarParticipantOut> {
  return fetchAPI<ClanWarParticipantOut>(`/clans/wars/${warId}/join/`, { method: "POST", token });
}

export async function getClanWars(
  token: string,
  clanId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanWarOut>> {
  return fetchPaginated<ClanWarOut>(`/clans/${clanId}/wars/`, { token, limit, offset });
}

export async function getWarParticipants(token: string, warId: string): Promise<ClanWarParticipantOut[]> {
  return fetchAPI<ClanWarParticipantOut[]>(`/clans/wars/${warId}/participants/`, { token });
}

export async function getWar(token: string, warId: string): Promise<ClanWarOut> {
  return fetchAPI<ClanWarOut>(`/clans/wars/${warId}/`, { token });
}

export async function leaveWar(token: string, warId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/wars/${warId}/leave/`, { method: "POST", token });
}

export async function cancelWar(token: string, warId: string): Promise<{ ok: boolean }> {
  return fetchAPI<{ ok: boolean }>(`/clans/wars/${warId}/cancel/`, { method: "POST", token });
}

// Leaderboard & Stats

export async function getClanLeaderboard(
  token: string,
  sort?: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanLeaderboardEntry>> {
  const params = new URLSearchParams();
  if (sort) params.set("sort", sort);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  return fetchAPI<PaginatedResponse<ClanLeaderboardEntry>>(`/clans/leaderboard/${qs ? `?${qs}` : ""}`, { token });
}

export async function getClanStats(token: string, clanId: string): Promise<ClanStats> {
  return fetchAPI<ClanStats>(`/clans/${clanId}/stats/`, { token });
}

// Activity Log

export async function getClanActivityLog(
  token: string,
  clanId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanActivityLogOut>> {
  return fetchPaginated<ClanActivityLogOut>(`/clans/${clanId}/activity-log/`, { token, limit, offset });
}

// Chat

export async function getClanChat(
  token: string,
  clanId: string,
  limit?: number,
  offset?: number,
): Promise<PaginatedResponse<ClanChatMessageOut>> {
  return fetchPaginated<ClanChatMessageOut>(`/clans/${clanId}/chat/`, { token, limit, offset });
}

export async function sendClanChatMessage(token: string, clanId: string, content: string): Promise<ClanChatMessageOut> {
  return fetchAPI<ClanChatMessageOut>(`/clans/${clanId}/chat/`, {
    method: "POST",
    token,
    body: JSON.stringify({ content }),
  });
}

// --- Shop ---

export interface GemWalletOut {
  gems: number;
  total_purchased: number;
  total_spent: number;
}

export interface GemPackageOut {
  id: string;
  name: string;
  slug: string;
  gems: number;
  bonus_gems: number;
  total_gems: number;
  price_cents: number;
  currency: string;
  icon: string;
  is_featured: boolean;
  order: number;
}

export interface ShopItemOut {
  id: string;
  item: ItemOut;
  gem_price: number;
  original_gem_price: number | null;
  shop_category: string;
  quantity: number;
  available_until: string | null;
  order: number;
}

export interface CreateCheckoutResponse {
  session_url: string;
  order_id: string;
}

export interface BuyShopItemResponse {
  id: string;
  item: ItemOut;
  quantity: number;
  gems_spent: number;
  gem_balance: number;
  created_at: string;
}

export async function getGemWallet(): Promise<GemWalletOut> {
  return fetchAPI<GemWalletOut>("/payments/gem-wallet/");
}

export async function getGemPackages(): Promise<GemPackageOut[]> {
  return fetchAPI<GemPackageOut[]>("/payments/gem-packages/");
}

export async function getShopItems(category?: string): Promise<ShopItemOut[]> {
  const qs = category ? `?category=${encodeURIComponent(category)}` : "";
  return fetchAPI<ShopItemOut[]>(`/payments/shop/${qs}`);
}

export async function createCheckout(packageSlug: string, idempotencyKey: string): Promise<CreateCheckoutResponse> {
  return fetchAPI<CreateCheckoutResponse>("/payments/create-checkout/", {
    method: "POST",
    body: JSON.stringify({ package_slug: packageSlug, idempotency_key: idempotencyKey }),
  });
}

export async function buyShopItem(shopItemId: string): Promise<BuyShopItemResponse> {
  return fetchAPI<BuyShopItemResponse>("/payments/shop/buy/", {
    method: "POST",
    body: JSON.stringify({ shop_item_id: shopItemId }),
  });
}
