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

export interface PaginatedResponse<T> {
  items: T[];
  count: number;
}

async function fetchPaginated<T>(
  path: string,
  options: FetchOptions & { limit?: number; offset?: number } = {}
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
}

export class BannedError extends Error {
  constructor() {
    super("Account banned");
    this.name = "BannedError";
  }
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

// --- Social Auth ---

export interface SocialAuthURL {
  url: string;
}

export interface SocialAuthTokens {
  access: string;
  refresh: string;
  is_new_user: boolean;
}

export async function getSocialAuthURL(
  provider: 'google' | 'discord',
  redirectUri: string
): Promise<SocialAuthURL> {
  return fetchAPI<SocialAuthURL>(
    `/auth/social/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`
  );
}

export async function socialAuthCallback(
  provider: 'google' | 'discord',
  code: string,
  redirectUri: string,
  state?: string | null
): Promise<SocialAuthTokens> {
  return fetchAPI<SocialAuthTokens>(`/auth/social/${provider}/callback`, {
    method: 'POST',
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

export async function getLinkedSocialAccounts(
  token: string
): Promise<SocialAccountOut[]> {
  return fetchAPI<SocialAccountOut[]>('/auth/social/accounts', { token });
}

export async function linkSocialAccount(
  token: string,
  provider: 'google' | 'discord',
  code: string,
  redirectUri: string,
  state?: string | null
): Promise<SocialAccountOut> {
  return fetchAPI<SocialAccountOut>(`/auth/social/${provider}/link`, {
    method: 'POST',
    token,
    body: JSON.stringify({ code, redirect_uri: redirectUri, state }),
  });
}

export async function unlinkSocialAccount(
  token: string,
  accountId: string
): Promise<void> {
  await fetchAPI(`/auth/social/${accountId}/unlink`, {
    method: 'DELETE',
    token,
  });
}

// --- Push Notifications ---

export async function getVapidKey(): Promise<string> {
  const res = await fetchAPI<{ vapid_public_key: string }>("/auth/push/vapid-key/");
  return res.vapid_public_key;
}

export async function subscribePush(
  token: string,
  subscription: { endpoint: string; p256dh: string; auth: string }
): Promise<void> {
  await fetchAPI("/auth/push/subscribe/", {
    method: "POST",
    token,
    body: JSON.stringify(subscription),
  });
}

export async function unsubscribePush(
  token: string,
  endpoint: string
): Promise<void> {
  await fetchAPI("/auth/push/unsubscribe/", {
    method: "POST",
    token,
    body: JSON.stringify({ endpoint, p256dh: "", auth: "" }),
  });
}

export interface WsTicketResponse {
  ticket: string;
  challenge: string;
  difficulty: number;
}

export async function getWsTicket(token: string): Promise<WsTicketResponse> {
  return fetchAPI<WsTicketResponse>("/auth/ws-ticket/", {
    method: "POST",
    token,
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
}

export async function getLeaderboard(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<LeaderboardEntry>> {
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
  is_active: boolean;
  order: number;
}

export interface SystemModule {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
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

let _configCache: FullConfig | null = null;
export async function getConfig(): Promise<FullConfig> {
  if (_configCache) return _configCache;
  const config = await fetchAPI<FullConfig>("/config/");
  _configCache = config;
  return config;
}

/** Returns the numeric stat for a given level from level_stats, falling back to a base value. */
export function getLevelStat(
  levelStats: Record<string, Record<string, number>> | undefined,
  level: number,
  key: string,
  fallback: number
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

export async function getMyMatches(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<Match>> {
  return fetchPaginated<Match>("/matches/", { token, limit, offset });
}

export async function getPlayerMatches(token: string, userId: string, limit?: number, offset?: number): Promise<PaginatedResponse<Match>> {
  return fetchPaginated<Match>(`/matches/player/${userId}/`, { token, limit, offset });
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

export async function createShareLink(
  token: string,
  resourceType: string,
  resourceId: string
): Promise<ShareLink> {
  return fetchAPI<ShareLink>("/share/create/", {
    method: "POST",
    token,
    body: JSON.stringify({ resource_type: resourceType, resource_id: resourceId }),
  });
}

export async function getSharedResource(shareToken: string): Promise<SharedMatchData> {
  return fetchAPI<SharedMatchData>(`/share/${shareToken}/`);
}

export async function getSharedSnapshot(
  shareToken: string,
  tick: number
): Promise<SnapshotDetail> {
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
  data: { name: string; description?: string }
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

export async function getDeveloperApp(
  token: string,
  appId: string
): Promise<DeveloperApp> {
  return fetchAPI<DeveloperApp>(`/developers/apps/${appId}/`, { token });
}

export async function updateDeveloperApp(
  token: string,
  appId: string,
  data: { name?: string; description?: string }
): Promise<DeveloperApp> {
  return fetchAPI<DeveloperApp>(`/developers/apps/${appId}/`, {
    method: "PATCH",
    body: JSON.stringify(data),
    token,
  });
}

export async function deleteDeveloperApp(
  token: string,
  appId: string
): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/`, { method: "DELETE", token });
}

// API Keys

export async function createAPIKey(
  token: string,
  appId: string,
  data: { scopes: string[]; rate_limit?: number }
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
  offset?: number
): Promise<PaginatedResponse<APIKeyOut>> {
  return fetchPaginated<APIKeyOut>(`/developers/apps/${appId}/keys/`, { token, limit, offset });
}

export async function deleteAPIKey(
  token: string,
  appId: string,
  keyId: string
): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/keys/${keyId}/`, {
    method: "DELETE",
    token,
  });
}

// Webhooks

export async function createWebhook(
  token: string,
  appId: string,
  data: { url: string; events: string[] }
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
  offset?: number
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
  data: { url?: string; events?: string[]; is_active?: boolean }
): Promise<WebhookOut> {
  return fetchAPI<WebhookOut>(
    `/developers/apps/${appId}/webhooks/${webhookId}/`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
      token,
    }
  );
}

export async function deleteWebhook(
  token: string,
  appId: string,
  webhookId: string
): Promise<void> {
  await fetchAPI(`/developers/apps/${appId}/webhooks/${webhookId}/`, {
    method: "DELETE",
    token,
  });
}

export async function testWebhook(
  token: string,
  appId: string,
  webhookId: string
): Promise<WebhookTestResult> {
  return fetchAPI<WebhookTestResult>(
    `/developers/apps/${appId}/webhooks/${webhookId}/test/`,
    { method: "POST", token }
  );
}

export async function getWebhookDeliveries(
  token: string,
  appId: string,
  webhookId: string,
  limit?: number,
  offset?: number
): Promise<PaginatedResponse<WebhookDelivery>> {
  return fetchPaginated<WebhookDelivery>(
    `/developers/apps/${appId}/webhooks/${webhookId}/deliveries/`,
    { token, limit, offset }
  );
}

// Usage & Meta

export async function getAppUsage(
  token: string,
  appId: string
): Promise<UsageStats> {
  return fetchAPI<UsageStats>(`/developers/apps/${appId}/usage/`, { token });
}

export async function getAvailableScopes(
  token: string
): Promise<AvailableScopes> {
  return fetchAPI<AvailableScopes>("/developers/scopes/", { token });
}

export async function getAvailableEvents(
  token: string
): Promise<AvailableEvents> {
  return fetchAPI<AvailableEvents>("/developers/events/", { token });
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
  asset_key: string;
  is_stackable: boolean;
  is_tradeable: boolean;
  is_consumable: boolean;
  base_value: number;
  level: number;
  blueprint_ref: string;
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

export async function getMyInventory(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<InventoryItemOut>> {
  return fetchPaginated<InventoryItemOut>("/inventory/my/", { token, limit, offset });
}

export async function getMyWallet(token: string): Promise<WalletOut> {
  return fetchAPI<WalletOut>("/inventory/wallet/", { token });
}

export async function getMyDrops(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<ItemDropOut>> {
  return fetchPaginated<ItemDropOut>("/inventory/drops/", { token, limit, offset });
}

export async function openCrate(
  token: string,
  crateSlug: string,
  keySlug: string
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
  offset?: number
): Promise<PaginatedResponse<MarketListingOut>> {
  const params = new URLSearchParams();
  if (itemSlug) params.set("item_slug", itemSlug);
  if (listingType) params.set("listing_type", listingType);
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString() ? `?${params}` : "";
  return fetchAPI<PaginatedResponse<MarketListingOut>>(`/marketplace/listings/${qs}`);
}

export async function getMyListings(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<MarketListingOut>> {
  return fetchPaginated<MarketListingOut>("/marketplace/my-listings/", { token, limit, offset });
}

export async function getMyTradeHistory(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<MarketTransactionOut>> {
  return fetchPaginated<MarketTransactionOut>("/marketplace/history/", { token, limit, offset });
}

export async function createListing(
  token: string,
  data: { item_slug: string; listing_type: string; quantity: number; price_per_unit: number }
): Promise<MarketListingOut> {
  return fetchAPI<MarketListingOut>("/marketplace/create-listing/", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export async function buyFromListing(
  token: string,
  listingId: string,
  quantity: number
): Promise<{ message: string }> {
  return fetchAPI("/marketplace/buy/", {
    method: "POST",
    token,
    body: JSON.stringify({ listing_id: listingId, quantity }),
  });
}

export async function cancelListing(
  token: string,
  listingId: string
): Promise<{ message: string }> {
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
}

export interface EquippedCosmeticDetail {
  slot: string;
  item_slug: string;
  item_name: string;
  asset_url: string | null;
}

export async function getEquippedCosmetics(token: string): Promise<EquippedCosmeticOut[]> {
  return fetchAPI<EquippedCosmeticOut[]>("/inventory/cosmetics/equipped/", { token });
}

export async function equipCosmetic(
  token: string,
  item_slug: string
): Promise<EquippedCosmeticDetail> {
  return fetchAPI<EquippedCosmeticDetail>("/inventory/cosmetics/equip/", {
    method: "POST",
    token,
    body: JSON.stringify({ item_slug }),
  });
}

export async function unequipCosmetic(
  token: string,
  slot: string
): Promise<{ detail: string }> {
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

export async function craftItem(
  token: string,
  recipeSlug: string
): Promise<CraftResult> {
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
  items: DeckItemOut[];
}

export async function getMyDecks(token: string, limit?: number, offset?: number): Promise<PaginatedResponse<DeckOut>> {
  return fetchPaginated<DeckOut>("/inventory/decks/", { token, limit, offset });
}

export async function createDeck(
  token: string,
  data: { name: string }
): Promise<DeckOut> {
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
  data: { name?: string; items?: { item_slug: string; quantity: number }[] }
): Promise<DeckOut> {
  return fetchAPI<DeckOut>(`/inventory/decks/${deckId}/`, {
    method: "PUT",
    token,
    body: JSON.stringify(data),
  });
}

export async function deleteDeck(
  token: string,
  deckId: string
): Promise<void> {
  await fetchAPI(`/inventory/decks/${deckId}/`, { method: "DELETE", token });
}

export async function setDefaultDeck(
  token: string,
  deckId: string
): Promise<{ ok: boolean }> {
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

export async function getAppByClientId(
  clientId: string
): Promise<OAuthAppInfo | null> {
  try {
    return await fetchAPI<OAuthAppInfo>(
      `/oauth/app-info/?client_id=${encodeURIComponent(clientId)}`
    );
  } catch {
    return null;
  }
}

export async function oauthAuthorize(
  token: string,
  data: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    state?: string;
  }
): Promise<OAuthAuthorizeResult> {
  return fetchAPI<OAuthAuthorizeResult>("/oauth/authorize/", {
    method: "POST",
    body: JSON.stringify(data),
    token,
  });
}
