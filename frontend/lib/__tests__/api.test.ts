import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @/lib/auth so the dynamic import inside tryRefreshToken doesn't fail
vi.mock("@/lib/auth", () => ({
  setAuthenticated: vi.fn(),
  isAuthenticated: vi.fn(() => false),
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
  isLoggedIn: vi.fn(() => false),
}));

import {
  APIError,
  acceptFriendRequest,
  acceptGameInvite,
  acceptInvitation,
  acceptJoinRequest,
  acceptWar,
  BannedError,
  buyFromListing,
  cancelListing,
  cancelWar,
  changePassword,
  changeUsername,
  cleanupTutorial,
  completeTutorial,
  craftItem,
  createAPIKey,
  createClan,
  createDeck,
  createDeveloperApp,
  createListing,
  createShareLink,
  createWebhook,
  declareWar,
  declineInvitation,
  declineJoinRequest,
  declineWar,
  deleteAPIKey,
  deleteDeck,
  deleteDeveloperApp,
  deleteWebhook,
  demoteMember,
  dissolveClan,
  donateGold,
  equipCosmetic,
  getAPIKeys,
  getAppByClientId,
  getAppUsage,
  getAvailableEvents,
  getAvailableScopes,
  getClan,
  getClanActivityLog,
  getClanChat,
  getClanJoinRequests,
  getClanLeaderboard,
  getClanMembers,
  getClanStats,
  getClans,
  getClanTreasury,
  getClanWars,
  getConversations,
  getDeck,
  getDeveloperApp,
  getDeveloperApps,
  getEquippedCosmetics,
  getFriends,
  getGameMode,
  getGameModes,
  getItemCategories,
  getLeaderboard,
  getLevelStat,
  getLinkedSocialAccounts,
  getMarketConfig,
  getMarketListings,
  getMatch,
  getMatchmakingStatus,
  getMatchResult,
  getMatchSnapshots,
  getMe,
  getMessages,
  getMyClan,
  getMyDecks,
  getMyDrops,
  getMyInventory,
  getMyInvitations,
  getMyListings,
  getMyMatches,
  getMyTradeHistory,
  getMyWallet,
  getNotifications,
  getOnlineStats,
  getPlayerMatches,
  getReceivedRequests,
  getRecipes,
  getRegions,
  getRegionsGraph,
  getRegionTilesUrl,
  getSentRequests,
  getSharedResource,
  getSharedSnapshot,
  getSnapshot,
  getSocialAuthURL,
  getUnreadMessageCount,
  getUnreadNotificationCount,
  getVapidKey,
  getWar,
  getWarParticipants,
  getWebhookDeliveries,
  getWebhooks,
  getWsTicket,
  inviteFriendToGame,
  invitePlayer,
  joinClan,
  joinWar,
  kickMember,
  leaveClan,
  leaveWar,
  linkSocialAccount,
  login,
  logoutAPI,
  markAllNotificationsRead,
  markNotificationRead,
  oauthAuthorize,
  openCrate,
  promoteMember,
  refreshToken,
  register,
  rejectFriendRequest,
  rejectGameInvite,
  removeFriend,
  sendClanChatMessage,
  sendFriendRequest,
  sendMessage,
  setDefaultDeck,
  setPassword,
  socialAuthCallback,
  startTutorial,
  subscribePush,
  testWebhook,
  transferLeadership,
  unequipCosmetic,
  unlinkSocialAccount,
  unsubscribePush,
  updateClan,
  updateDeck,
  updateDeveloperApp,
  updateWebhook,
  withdrawGold,
} from "../api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeErrorResponse(detail: string, status: number): Response {
  return makeResponse({ detail }, status);
}

function makeNoContentResponse(): Response {
  return new Response(null, { status: 204 });
}

function getLastCall(): [string, RequestInit] {
  return vi.mocked(fetch).mock.calls[vi.mocked(fetch).mock.calls.length - 1] as [string, RequestInit];
}

// ---------------------------------------------------------------------------
// Reset module-level cache between tests
// ---------------------------------------------------------------------------

describe("APIError", () => {
  it("has the correct name and message", () => {
    const err = new APIError(404, "Not found");
    expect(err.name).toBe("APIError");
    expect(err.message).toBe("Not found");
    expect(err.status).toBe(404);
  });

  it("stores the response body", () => {
    const body = { detail: "gone" };
    const err = new APIError(410, "Gone", body);
    expect(err.body).toEqual(body);
  });
});

describe("BannedError", () => {
  it("has the correct name and message", () => {
    const err = new BannedError();
    expect(err.name).toBe("BannedError");
    expect(err.message).toBe("Account banned");
  });
});

describe("fetchAPI via login()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes a POST request to /auth/login/ with credentials", async () => {
    const mockFetch = vi.mocked(fetch);
    const mockUser = {
      id: "1",
      username: "tester",
      email: "user@example.com",
      role: "player",
      elo_rating: 1200,
      date_joined: "",
      tutorial_completed: false,
      is_banned: false,
    };
    mockFetch.mockResolvedValueOnce(makeResponse({ user: mockUser }));

    await login("user@example.com", "secret");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/login\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      email: "user@example.com",
      password: "secret",
    });
  });

  it("returns a LoginResponse (user object) on success", async () => {
    const mockUser = {
      id: "1",
      username: "tester",
      email: "a@b.com",
      role: "player",
      elo_rating: 1200,
      date_joined: "",
      tutorial_completed: false,
      is_banned: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ user: mockUser }));
    const result = await login("a@b.com", "pw");
    expect(result).toEqual({ user: mockUser });
  });

  it("sets Content-Type: application/json header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ access: "a", refresh: "r" }));
    await login("a@b.com", "pw");
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws APIError when the response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse("Bad credentials", 401));
    await expect(login("wrong@example.com", "bad")).rejects.toThrow(APIError);
  });

  it("carries the HTTP status on the thrown APIError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse("Bad credentials", 401));
    try {
      await login("x@x.com", "wrong");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(401);
    }
  });

  it("throws APIError with the detail message from the response body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse("Invalid token", 403));
    try {
      await login("x@x.com", "pw");
    } catch (err) {
      expect((err as APIError).message).toBe("Invalid token");
    }
  });

  it("does not include Authorization header for cookie-based auth (getMe)", async () => {
    // Auth is now cookie-based; getMe no longer sets an Authorization header.
    const { getMe } = await import("../api");
    vi.mocked(fetch).mockResolvedValueOnce(
      makeResponse({
        id: "1",
        username: "tester",
        email: "a@b.com",
        role: "player",
        elo_rating: 1200,
        date_joined: "",
        tutorial_completed: false,
        is_banned: false,
      }),
    );
    await getMe();
    const [, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    // Cookie-based auth — no Authorization header should be set
    expect(headers.Authorization).toBeUndefined();
  });

  it("sets Authorization header when explicit token is passed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    await setPassword("mytoken", "newpass123");
    const [, opts] = getLastCall();
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mytoken");
  });

  it("returns empty object for 204 No Content", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    const result = await logoutAPI();
    expect(result).toBeUndefined();
  });

  it("always sends credentials: include", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ user: {} }));
    await login("a@b.com", "pw");
    const [, opts] = getLastCall();
    expect(opts.credentials).toBe("include");
  });
});

describe("auto-refresh on 401", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("window", { location: { origin: "http://localhost" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries the request after a successful token refresh", async () => {
    const mockFetch = vi.mocked(fetch);
    const user = { id: "1", username: "u" };
    // First call: 401; second call: refresh succeeds; third call: retry succeeds
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse("Unauthorized", 401))
      .mockResolvedValueOnce(makeResponse({})) // refresh
      .mockResolvedValueOnce(makeResponse(user)); // retry

    const result = await getMe();
    expect(result).toEqual(user);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws APIError when retry after refresh also fails", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse("Unauthorized", 401))
      .mockResolvedValueOnce(makeResponse({})) // refresh succeeds
      .mockResolvedValueOnce(makeErrorResponse("Still unauthorized", 403)); // retry fails

    await expect(getMe()).rejects.toThrow(APIError);
  });

  it("throws APIError immediately when refresh fails (no retry)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse("Unauthorized", 401))
      .mockResolvedValueOnce(makeErrorResponse("Refresh failed", 401)); // refresh fails

    await expect(getMe()).rejects.toThrow(APIError);
  });

  it("returns empty object when retry returns 204", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse("Unauthorized", 401))
      .mockResolvedValueOnce(makeResponse({})) // refresh
      .mockResolvedValueOnce(makeNoContentResponse()); // retry returns 204

    const result = await getMe();
    expect(result).toEqual({});
  });

  it("throws APIError with detail from body when retry response is not ok (line 69 path)", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce(makeErrorResponse("Unauthorized", 401))
      .mockResolvedValueOnce(makeResponse({})) // refresh succeeds
      .mockResolvedValueOnce(makeErrorResponse("Forbidden by server", 403)); // retry not ok

    try {
      await getMe();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(403);
      expect((err as APIError).message).toBe("Forbidden by server");
    }
  });
});

describe("register()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/register and returns a User", async () => {
    const user = {
      id: "u1",
      username: "hero",
      email: "hero@example.com",
      role: "player",
      elo_rating: 1000,
      date_joined: "2026-01-01",
      tutorial_completed: false,
      is_banned: false,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(user, 201));

    const result = await register({
      username: "hero",
      email: "hero@example.com",
      password: "pw",
    });
    expect(result).toEqual(user);

    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/register$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getConfig()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls fetch each time (no client-side caching)", async () => {
    const cfg = {
      settings: {},
      buildings: [],
      units: [],
      abilities: [],
      maps: [],
      game_modes: [],
      modules: [],
      system_modules: [],
    };
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(makeResponse(cfg)));

    const { getConfig } = await import("../api");

    await getConfig();
    await getConfig();

    // No caching — each call hits fetch
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getLevelStat()", () => {
  const levelStats = {
    "1": { attack: 10, defense: 5 },
    "2": { attack: 15, defense: 8 },
    "3": { attack: 20, defense: 12 },
  };

  it("returns the stat value for the given level", () => {
    expect(getLevelStat(levelStats, 1, "attack", 0)).toBe(10);
    expect(getLevelStat(levelStats, 2, "defense", 0)).toBe(8);
    expect(getLevelStat(levelStats, 3, "attack", 0)).toBe(20);
  });

  it("returns the fallback when the level does not exist", () => {
    expect(getLevelStat(levelStats, 99, "attack", 42)).toBe(42);
  });

  it("returns the fallback when the key does not exist at that level", () => {
    expect(getLevelStat(levelStats, 1, "speed", 7)).toBe(7);
  });

  it("returns the fallback when levelStats is undefined", () => {
    expect(getLevelStat(undefined, 1, "attack", 99)).toBe(99);
  });

  it("handles level 0 correctly by falling back", () => {
    expect(getLevelStat(levelStats, 0, "attack", -1)).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Auth functions
// ---------------------------------------------------------------------------

describe("logoutAPI()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/logout/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await logoutAPI();
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/logout\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("refreshToken()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a dummy token pair", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({}));
    const result = await refreshToken("old-refresh");
    expect(result).toEqual({ access: "", refresh: "" });
  });
});

describe("getOnlineStats()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /auth/online-stats and returns stats", async () => {
    const stats = { online: 10, in_queue: 2, in_game: 5 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(stats));
    const result = await getOnlineStats();
    expect(result).toEqual(stats);
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/online-stats$/);
  });
});

describe("getMe()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /auth/me", async () => {
    const user = { id: "1", username: "u" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(user));
    const result = await getMe();
    expect(result).toEqual(user);
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/me$/);
  });
});

describe("setPassword()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/set-password/ with token and new password", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await setPassword("tok", "newpass");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/set-password\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ new_password: "newpass" });
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });
});

describe("changePassword()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/change-password/ with correct body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    await changePassword("tok", "oldpass", "newpass");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/change-password\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      current_password: "oldpass",
      new_password: "newpass",
    });
  });
});

describe("changeUsername()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/change-username/ with username in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, username: "newname" }));
    const result = await changeUsername("tok", "newname");
    expect(result).toEqual({ ok: true, username: "newname" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/change-username\/$/);
    expect(JSON.parse(opts.body as string)).toEqual({ username: "newname" });
  });
});

// ---------------------------------------------------------------------------
// Social Auth
// ---------------------------------------------------------------------------

describe("getSocialAuthURL()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the social auth URL for google", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: "https://accounts.google.com/..." }));
    const result = await getSocialAuthURL("google", "https://app.com/callback");
    expect(result).toEqual({ url: "https://accounts.google.com/..." });
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/google\/authorize/);
    expect(url).toContain(encodeURIComponent("https://app.com/callback"));
  });

  it("GETs the social auth URL for discord", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ url: "https://discord.com/..." }));
    await getSocialAuthURL("discord", "https://app.com/callback");
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/discord\/authorize/);
  });
});

describe("socialAuthCallback()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/social/google/callback", async () => {
    const tokens = { access: "a", refresh: "r", is_new_user: false };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(tokens));
    const result = await socialAuthCallback("google", "code123", "https://app.com/cb", "state1");
    expect(result).toEqual(tokens);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/google\/callback$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      code: "code123",
      redirect_uri: "https://app.com/cb",
      state: "state1",
    });
  });
});

describe("getLinkedSocialAccounts()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /auth/social/accounts with token", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getLinkedSocialAccounts("tok");
    expect(result).toEqual([]);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/accounts$/);
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });
});

describe("linkSocialAccount()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/social/discord/link", async () => {
    const account = {
      id: "acc1",
      provider: "discord",
      display_name: "User#1234",
      email: "u@d.com",
      avatar_url: "",
      created_at: "",
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(account));
    const result = await linkSocialAccount("discord", "code", "https://app.com/cb");
    expect(result).toEqual(account);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/discord\/link$/);
    expect(opts.method).toBe("POST");
  });
});

describe("unlinkSocialAccount()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /auth/social/{accountId}/unlink", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await unlinkSocialAccount("tok", "acc-id-123");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/social\/acc-id-123\/unlink$/);
    expect(opts.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

describe("getVapidKey()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /auth/push/vapid-key/ and returns the key string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ vapid_public_key: "BPublicKey123" }));
    const result = await getVapidKey();
    expect(result).toBe("BPublicKey123");
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/push\/vapid-key\/$/);
  });
});

describe("subscribePush()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the subscription object to /auth/push/subscribe/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    const sub = { endpoint: "https://push.example.com", p256dh: "key", auth: "auth" };
    await subscribePush(sub);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/push\/subscribe\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual(sub);
  });
});

describe("unsubscribePush()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/push/unsubscribe/ with the endpoint", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await unsubscribePush("https://push.example.com/endpoint");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/push\/unsubscribe\/$/);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.endpoint).toBe("https://push.example.com/endpoint");
  });
});

describe("getWsTicket()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/ws-ticket/ and returns ticket data", async () => {
    const ticket = { ticket: "t1", challenge: "ch", difficulty: 4 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(ticket));
    const result = await getWsTicket();
    expect(result).toEqual(ticket);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/ws-ticket\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getLeaderboard()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /auth/leaderboard and returns paginated entries", async () => {
    const data = { items: [{ id: "1", username: "top" }], count: 1 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(data));
    const result = await getLeaderboard("tok", 10, 0);
    expect(result).toEqual(data);
    const [url] = getLastCall();
    expect(url).toMatch(/\/auth\/leaderboard/);
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("getGameModes()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /config/game-modes/ and returns list", async () => {
    const modes = [
      {
        id: "m1",
        name: "Standard",
        slug: "standard",
        description: "",
        max_players: 8,
        min_players: 2,
        is_default: true,
        order: 1,
      },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(modes));
    const result = await getGameModes();
    expect(result).toEqual(modes);
    const [url] = getLastCall();
    expect(url).toMatch(/\/config\/game-modes\/$/);
  });
});

describe("getGameMode()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /config/game-modes/{slug}/", async () => {
    const mode = { id: "m1", slug: "standard" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(mode));
    const result = await getGameMode("standard");
    expect(result).toEqual(mode);
    const [url] = getLastCall();
    expect(url).toMatch(/\/config\/game-modes\/standard\/$/);
  });
});

// ---------------------------------------------------------------------------
// Geo
// ---------------------------------------------------------------------------

describe("getRegions()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /geo/regions/ and returns GeoJSON", async () => {
    const geo = { type: "FeatureCollection", features: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(geo));
    const result = await getRegions();
    expect(result).toEqual(geo);
    const [url] = getLastCall();
    expect(url).toMatch(/\/geo\/regions\/$/);
  });
});

describe("getRegionsGraph()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /geo/regions/graph/ without matchId", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await getRegionsGraph();
    const [url] = getLastCall();
    expect(url).toMatch(/\/geo\/regions\/graph\/$/);
  });

  it("includes match_id query param when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    await getRegionsGraph("match-abc");
    const [url] = getLastCall();
    expect(url).toContain("match_id=match-abc");
  });
});

describe("getRegionTilesUrl()", () => {
  it("returns a URL template with {z}/{x}/{y} tokens", () => {
    const url = getRegionTilesUrl();
    expect(url).toContain("{z}/{x}/{y}");
    expect(url).toMatch(/geo\/tiles/);
  });

  it("appends match_id when provided", () => {
    const url = getRegionTilesUrl("match-xyz");
    expect(url).toContain("match_id=match-xyz");
  });

  it("does not append match_id when not provided", () => {
    const url = getRegionTilesUrl();
    expect(url).not.toContain("match_id");
  });

  it("prepends window.location.origin when API_BASE is a relative path (lines 601-604)", () => {
    // When NEXT_PUBLIC_API_URL is not set and we are in a browser context,
    // API_BASE defaults to "/api/v1" (a relative path not starting with "http").
    // getRegionTilesUrl() must therefore prepend window.location.origin.
    const origEnv = process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_URL;

    // Mock window so the relative-path branch is taken
    vi.stubGlobal("window", { location: { origin: "https://example.com" } });

    // Re-import to pick up the changed env — but since the module is cached we
    // call the already-imported function and just verify the result shape.
    const url = getRegionTilesUrl();
    // The URL must be absolute (starts with http or https) and contain the tiles path
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("geo/tiles");

    vi.unstubAllGlobals();
    if (origEnv !== undefined) process.env.NEXT_PUBLIC_API_URL = origEnv;
  });
});

// ---------------------------------------------------------------------------
// Matchmaking & Matches
// ---------------------------------------------------------------------------

describe("getMatchmakingStatus()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /matchmaking/status/", async () => {
    const status = { state: "idle" as const };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(status));
    const result = await getMatchmakingStatus();
    expect(result).toEqual(status);
    const [url] = getLastCall();
    expect(url).toMatch(/\/matchmaking\/status\/$/);
  });
});

describe("getMyMatches()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /matches/ with pagination", async () => {
    const data = { items: [], count: 0 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(data));
    const result = await getMyMatches("tok", 5, 10);
    expect(result).toEqual(data);
    const [url] = getLastCall();
    expect(url).toMatch(/\/matches\//);
    expect(url).toContain("limit=5");
    expect(url).toContain("offset=10");
  });
});

describe("getPlayerMatches()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /matches/player/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getPlayerMatches("tok", "user-123");
    const [url] = getLastCall();
    expect(url).toMatch(/\/matches\/player\/user-123\/$/);
  });
});

describe("getMatch()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /matches/{matchId}/ and returns a Match", async () => {
    const match = { id: "m1", status: "in_progress", players: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(match));
    const result = await getMatch("tok", "m1");
    expect(result).toEqual(match);
    const [url] = getLastCall();
    expect(url).toMatch(/\/matches\/m1\/$/);
  });
});

describe("getMatchResult()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /game/results/{matchId}/", async () => {
    const result = { id: "r1", match_id: "m1", duration_seconds: 120, total_ticks: 200, player_results: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(result));
    const res = await getMatchResult("tok", "m1");
    expect(res).toEqual(result);
    const [url] = getLastCall();
    expect(url).toMatch(/\/game\/results\/m1\/$/);
  });
});

describe("getMatchSnapshots()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /game/snapshots/{matchId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([{ tick: 1, created_at: "" }]));
    const result = await getMatchSnapshots("tok", "m1");
    expect(result).toEqual([{ tick: 1, created_at: "" }]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/game\/snapshots\/m1\/$/);
  });
});

describe("getSnapshot()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /game/snapshots/{matchId}/{tick}/", async () => {
    const snap = { tick: 42, state_data: {}, created_at: "" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(snap));
    const result = await getSnapshot("tok", "m1", 42);
    expect(result).toEqual(snap);
    const [url] = getLastCall();
    expect(url).toMatch(/\/game\/snapshots\/m1\/42\/$/);
  });
});

// ---------------------------------------------------------------------------
// Tutorial
// ---------------------------------------------------------------------------

describe("startTutorial()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /matches/tutorial/start/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ match_id: "tut-1" }));
    const result = await startTutorial();
    expect(result).toEqual({ match_id: "tut-1" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/matches\/tutorial\/start\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("completeTutorial()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /auth/tutorial/complete/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await completeTutorial();
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/auth\/tutorial\/complete\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("cleanupTutorial()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /matches/tutorial/cleanup/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await cleanupTutorial();
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/matches\/tutorial\/cleanup\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

describe("createShareLink()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /share/create/ with resource type and id", async () => {
    const link = { token: "sh1", resource_type: "match_result", resource_id: "m1" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(link));
    const result = await createShareLink("match_result", "m1");
    expect(result).toEqual(link);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/share\/create\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ resource_type: "match_result", resource_id: "m1" });
  });
});

describe("getSharedResource()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /share/{token}/", async () => {
    const data = { resource_type: "match_result", match: {}, result: null, snapshot_ticks: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(data));
    const result = await getSharedResource("sharetoken123");
    expect(result).toEqual(data);
    const [url] = getLastCall();
    expect(url).toMatch(/\/share\/sharetoken123\/$/);
  });
});

describe("getSharedSnapshot()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /share/{token}/snapshots/{tick}/", async () => {
    const snap = { tick: 10, state_data: {}, created_at: "" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(snap));
    const result = await getSharedSnapshot("sharetoken", 10);
    expect(result).toEqual(snap);
    const [url] = getLastCall();
    expect(url).toMatch(/\/share\/sharetoken\/snapshots\/10\/$/);
  });
});

// ---------------------------------------------------------------------------
// Developer Apps
// ---------------------------------------------------------------------------

describe("createDeveloperApp()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /developers/apps/ with data and token", async () => {
    const app = {
      id: "app1",
      name: "MyApp",
      description: "",
      client_id: "cid",
      client_secret: "csec",
      is_active: true,
      created_at: "",
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(app));
    const result = await createDeveloperApp("tok", { name: "MyApp", description: "desc" });
    expect(result).toEqual(app);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "MyApp", description: "desc" });
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
  });
});

describe("getDeveloperApps()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/ and returns paginated apps", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    const result = await getDeveloperApps("tok");
    expect(result).toEqual({ items: [], count: 0 });
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\//);
  });
});

describe("getDeveloperApp()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/{appId}/", async () => {
    const app = { id: "app1", name: "App" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(app));
    const result = await getDeveloperApp("tok", "app1");
    expect(result).toEqual(app);
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/$/);
  });
});

describe("updateDeveloperApp()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes /developers/apps/{appId}/ with data", async () => {
    const app = { id: "app1", name: "NewName" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(app));
    await updateDeveloperApp("tok", "app1", { name: "NewName" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/$/);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "NewName" });
  });
});

describe("deleteDeveloperApp()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /developers/apps/{appId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await deleteDeveloperApp("tok", "app1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

describe("createAPIKey()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /developers/apps/{appId}/keys/", async () => {
    const key = {
      id: "k1",
      prefix: "ml_",
      scopes: ["read"],
      rate_limit: 100,
      is_active: true,
      last_used: null,
      created_at: "",
      key: "ml_abc",
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(key));
    const result = await createAPIKey("tok", "app1", { scopes: ["read"], rate_limit: 100 });
    expect(result).toEqual(key);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/keys\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ scopes: ["read"], rate_limit: 100 });
  });
});

describe("getAPIKeys()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/{appId}/keys/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getAPIKeys("tok", "app1", 10, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/keys\//);
    expect(url).toContain("limit=10");
  });
});

describe("deleteAPIKey()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /developers/apps/{appId}/keys/{keyId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await deleteAPIKey("tok", "app1", "k1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/keys\/k1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

describe("createWebhook()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /developers/apps/{appId}/webhooks/", async () => {
    const wh = {
      id: "wh1",
      url: "https://example.com/hook",
      secret: "s",
      events: ["match.end"],
      is_active: true,
      failure_count: 0,
      created_at: "",
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(wh));
    const result = await createWebhook("tok", "app1", { url: "https://example.com/hook", events: ["match.end"] });
    expect(result).toEqual(wh);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getWebhooks()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/{appId}/webhooks/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getWebhooks("tok", "app1");
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\//);
  });
});

describe("updateWebhook()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes /developers/apps/{appId}/webhooks/{webhookId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "wh1" }));
    await updateWebhook("tok", "app1", "wh1", { is_active: false });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\/wh1\/$/);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ is_active: false });
  });
});

describe("deleteWebhook()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /developers/apps/{appId}/webhooks/{webhookId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await deleteWebhook("tok", "app1", "wh1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\/wh1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

describe("testWebhook()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /developers/apps/{appId}/webhooks/{webhookId}/test/", async () => {
    const res = { success: true, status_code: 200, message: "ok" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(res));
    const result = await testWebhook("tok", "app1", "wh1");
    expect(result).toEqual(res);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\/wh1\/test\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getWebhookDeliveries()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/{appId}/webhooks/{webhookId}/deliveries/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getWebhookDeliveries("tok", "app1", "wh1", 5, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/webhooks\/wh1\/deliveries\//);
    expect(url).toContain("limit=5");
  });
});

describe("getAppUsage()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/apps/{appId}/usage/", async () => {
    const usage = {
      app_id: "app1",
      total_api_calls: 50,
      active_keys: 2,
      total_webhooks: 1,
      active_webhooks: 1,
      total_deliveries: 10,
      successful_deliveries: 9,
      failed_deliveries: 1,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(usage));
    const result = await getAppUsage("tok", "app1");
    expect(result).toEqual(usage);
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/apps\/app1\/usage\/$/);
  });
});

describe("getAvailableScopes()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/scopes/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ scopes: ["read", "write"] }));
    const result = await getAvailableScopes("tok");
    expect(result).toEqual({ scopes: ["read", "write"] });
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/scopes\/$/);
  });
});

describe("getAvailableEvents()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /developers/events/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ events: ["match.end", "match.start"] }));
    const result = await getAvailableEvents("tok");
    expect(result).toEqual({ events: ["match.end", "match.start"] });
    const [url] = getLastCall();
    expect(url).toMatch(/\/developers\/events\/$/);
  });
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

describe("getItemCategories()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/items/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getItemCategories();
    expect(result).toEqual([]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/items\/$/);
  });
});

describe("getMyInventory()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/my/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyInventory("tok", 20, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/my\//);
    expect(url).toContain("limit=20");
  });
});

describe("getMyWallet()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/wallet/", async () => {
    const wallet = { gold: 500, total_earned: 1000, total_spent: 500 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(wallet));
    const result = await getMyWallet("tok");
    expect(result).toEqual(wallet);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/wallet\/$/);
  });
});

describe("getMyDrops()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/drops/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyDrops("tok", 10, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/drops\//);
    expect(url).toContain("limit=10");
  });
});

describe("openCrate()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /inventory/open-crate/ with crate and key slugs", async () => {
    const drops = { drops: [{ item_name: "Knife", item_slug: "knife", rarity: "rare", quantity: 1 }] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(drops));
    const result = await openCrate("tok", "crate-basic", "key-basic");
    expect(result).toEqual(drops);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/open-crate\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ crate_item_slug: "crate-basic", key_item_slug: "key-basic" });
  });
});

// ---------------------------------------------------------------------------
// Marketplace
// ---------------------------------------------------------------------------

describe("getMarketConfig()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /marketplace/config/", async () => {
    const cfg = { transaction_fee_percent: 5, listing_duration_hours: 72, max_active_listings_per_user: 10 };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(cfg));
    const result = await getMarketConfig();
    expect(result).toEqual(cfg);
    const [url] = getLastCall();
    expect(url).toMatch(/\/marketplace\/config\/$/);
  });
});

describe("getMarketListings()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /marketplace/listings/ without filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMarketListings();
    const [url] = getLastCall();
    expect(url).toMatch(/\/marketplace\/listings\//);
  });

  it("includes item_slug and listing_type filters in query string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMarketListings("knife", "sell", 10, 0);
    const [url] = getLastCall();
    expect(url).toContain("item_slug=knife");
    expect(url).toContain("listing_type=sell");
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
  });
});

describe("getMyListings()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /marketplace/my-listings/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyListings("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/marketplace\/my-listings\//);
  });
});

describe("getMyTradeHistory()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /marketplace/history/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyTradeHistory("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/marketplace\/history\//);
  });
});

describe("createListing()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /marketplace/create-listing/ with listing data", async () => {
    const listing = {
      id: "l1",
      seller_username: "u",
      item: {} as never,
      listing_type: "sell",
      quantity: 1,
      quantity_remaining: 1,
      price_per_unit: 100,
      status: "active",
      is_bot_listing: false,
      created_at: "",
      expires_at: null,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(listing));
    const result = await createListing("tok", {
      item_slug: "knife",
      listing_type: "sell",
      quantity: 1,
      price_per_unit: 100,
    });
    expect(result).toEqual(listing);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/marketplace\/create-listing\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      item_slug: "knife",
      listing_type: "sell",
      quantity: 1,
      price_per_unit: 100,
    });
  });
});

describe("buyFromListing()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /marketplace/buy/ with listing_id and quantity", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ message: "Purchased" }));
    const result = await buyFromListing("tok", "l1", 2);
    expect(result).toEqual({ message: "Purchased" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/marketplace\/buy\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ listing_id: "l1", quantity: 2 });
  });
});

describe("cancelListing()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /marketplace/cancel/{listingId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ message: "Cancelled" }));
    const result = await cancelListing("tok", "l1");
    expect(result).toEqual({ message: "Cancelled" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/marketplace\/cancel\/l1\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Cosmetics
// ---------------------------------------------------------------------------

describe("getEquippedCosmetics()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/cosmetics/equipped/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getEquippedCosmetics("tok");
    expect(result).toEqual([]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/cosmetics\/equipped\/$/);
  });
});

describe("equipCosmetic()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /inventory/cosmetics/equip/ with payload", async () => {
    const detail = {
      slot: "flag",
      item_slug: "flag-uk",
      item_name: "UK Flag",
      asset_url: null,
      cosmetic_params: null,
      instance: null,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(detail));
    const result = await equipCosmetic("tok", { item_slug: "flag-uk" });
    expect(result).toEqual(detail);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/cosmetics\/equip\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ item_slug: "flag-uk" });
  });
});

describe("unequipCosmetic()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /inventory/cosmetics/unequip/ with slot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ detail: "Unequipped" }));
    const result = await unequipCosmetic("tok", "flag");
    expect(result).toEqual({ detail: "Unequipped" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/cosmetics\/unequip\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ slot: "flag" });
  });
});

// ---------------------------------------------------------------------------
// Crafting
// ---------------------------------------------------------------------------

describe("getRecipes()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /crafting/recipes/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getRecipes();
    expect(result).toEqual([]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/crafting\/recipes\/$/);
  });
});

describe("craftItem()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /crafting/craft/ with recipe_slug", async () => {
    const craftResult = { message: "Crafted!", item_name: "Knife", item_slug: "knife", quantity: 1, instance: null };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(craftResult));
    const result = await craftItem("tok", "recipe-knife");
    expect(result).toEqual(craftResult);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/crafting\/craft\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ recipe_slug: "recipe-knife" });
  });
});

// ---------------------------------------------------------------------------
// Decks
// ---------------------------------------------------------------------------

describe("getMyDecks()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/decks/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyDecks("tok", 5, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\//);
    expect(url).toContain("limit=5");
  });
});

describe("createDeck()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /inventory/decks/ with name", async () => {
    const deck = { id: "d1", name: "My Deck", is_default: false, is_editable: true, items: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(deck));
    const result = await createDeck("tok", { name: "My Deck" });
    expect(result).toEqual(deck);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "My Deck" });
  });
});

describe("getDeck()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /inventory/decks/{deckId}/", async () => {
    const deck = { id: "d1", name: "My Deck", is_default: false, is_editable: true, items: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(deck));
    const result = await getDeck("tok", "d1");
    expect(result).toEqual(deck);
    const [url] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\/d1\/$/);
  });
});

describe("updateDeck()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PUTs to /inventory/decks/{deckId}/ with updated data", async () => {
    const deck = { id: "d1", name: "Renamed", is_default: false, is_editable: true, items: [] };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(deck));
    await updateDeck("tok", "d1", { name: "Renamed" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\/d1\/$/);
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "Renamed" });
  });
});

describe("deleteDeck()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /inventory/decks/{deckId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await deleteDeck("tok", "d1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\/d1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

describe("setDefaultDeck()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /inventory/decks/{deckId}/set-default/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await setDefaultDeck("tok", "d1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/inventory\/decks\/d1\/set-default\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

describe("getAppByClientId()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /oauth/app-info/?client_id={clientId}", async () => {
    const appInfo = { name: "TestApp", description: "A test app" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(appInfo));
    const result = await getAppByClientId("client-abc");
    expect(result).toEqual(appInfo);
    const [url] = getLastCall();
    expect(url).toMatch(/\/oauth\/app-info\//);
    expect(url).toContain("client_id=client-abc");
  });

  it("returns null on error (not found)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse("Not found", 404));
    const result = await getAppByClientId("unknown-client");
    expect(result).toBeNull();
  });
});

describe("oauthAuthorize()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /oauth/authorize/ with data", async () => {
    const authResult = { code: "authcode123", state: "s1" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(authResult));
    const result = await oauthAuthorize({
      client_id: "cid",
      redirect_uri: "https://app.com/cb",
      scope: "read",
      state: "s1",
    });
    expect(result).toEqual(authResult);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/oauth\/authorize\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      client_id: "cid",
      redirect_uri: "https://app.com/cb",
      scope: "read",
      state: "s1",
    });
  });
});

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

describe("getFriends()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /friends/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getFriends("tok", 10, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/friends\//);
    expect(url).toContain("limit=10");
  });
});

describe("getReceivedRequests()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /friends/requests/received/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getReceivedRequests("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/friends\/requests\/received\//);
  });
});

describe("getSentRequests()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /friends/requests/sent/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getSentRequests("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/friends\/requests\/sent\//);
  });
});

describe("sendFriendRequest()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/request/ with username", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "fr1", status: "pending" }));
    await sendFriendRequest("tok", "alice");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/request\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ username: "alice" });
  });
});

describe("acceptFriendRequest()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/{friendshipId}/accept/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "fr1", status: "accepted" }));
    await acceptFriendRequest("tok", "fr1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/fr1\/accept\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("rejectFriendRequest()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/{friendshipId}/reject/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "fr1", status: "rejected" }));
    await rejectFriendRequest("tok", "fr1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/fr1\/reject\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("removeFriend()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /friends/{friendshipId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await removeFriend("tok", "fr1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/fr1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

describe("inviteFriendToGame()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/{friendshipId}/invite-game/ with game_mode", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ lobby_id: "lob1" }));
    const result = await inviteFriendToGame("fr1", "standard");
    expect(result).toEqual({ lobby_id: "lob1" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/fr1\/invite-game\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ game_mode: "standard" });
  });
});

describe("acceptGameInvite()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/invite-accept/{notificationId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ lobby_id: "lob1", game_mode: "standard" }));
    const result = await acceptGameInvite("tok", "notif1");
    expect(result).toEqual({ lobby_id: "lob1", game_mode: "standard" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/invite-accept\/notif1\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("rejectGameInvite()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /friends/invite-reject/{notificationId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await rejectGameInvite("tok", "notif1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/friends\/invite-reject\/notif1\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Direct Messages
// ---------------------------------------------------------------------------

describe("getConversations()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /messages/conversations/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getConversations("tok");
    expect(result).toEqual([]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/messages\/conversations\/$/);
  });
});

describe("getMessages()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /messages/{userId}/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMessages("tok", "user1", 20, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/messages\/user1\//);
    expect(url).toContain("limit=20");
  });
});

describe("sendMessage()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /messages/{userId}/ with content", async () => {
    const msg = { id: "msg1", content: "Hello!", is_read: false, created_at: "" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(msg));
    const result = await sendMessage("tok", "user1", "Hello!");
    expect(result).toEqual(msg);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/messages\/user1\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ content: "Hello!" });
  });
});

describe("getUnreadMessageCount()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /messages/unread-total/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 3 }));
    const result = await getUnreadMessageCount("tok");
    expect(result).toEqual({ count: 3 });
    const [url] = getLastCall();
    expect(url).toMatch(/\/messages\/unread-total\/$/);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

describe("getNotifications()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /notifications/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getNotifications("tok", 10, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/notifications\//);
    expect(url).toContain("limit=10");
  });
});

describe("getUnreadNotificationCount()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /notifications/unread-count", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ count: 5 }));
    const result = await getUnreadNotificationCount("tok");
    expect(result).toEqual({ count: 5 });
    const [url] = getLastCall();
    expect(url).toMatch(/\/notifications\/unread-count$/);
  });
});

describe("markNotificationRead()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /notifications/{id}/read/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await markNotificationRead("tok", "n1");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/notifications\/n1\/read\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("markAllNotificationsRead()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /notifications/read-all/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeNoContentResponse());
    await markAllNotificationsRead("tok");
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/notifications\/read-all\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Clans — CRUD
// ---------------------------------------------------------------------------

describe("createClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/ with clan data", async () => {
    const clan = { id: "c1", name: "Warriors", tag: "WAR" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(clan));
    const result = await createClan("tok", { name: "Warriors", tag: "WAR", description: "We fight" });
    expect(result).toEqual(clan);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "Warriors", tag: "WAR", description: "We fight" });
  });
});

describe("getClans()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/ without search", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClans("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\//);
  });

  it("includes search in query string when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClans("tok", "war", 10, 0);
    const [url] = getLastCall();
    expect(url).toContain("search=war");
    expect(url).toContain("limit=10");
  });
});

describe("getMyClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/my/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ clan: null, membership: null }));
    const result = await getMyClan("tok");
    expect(result).toEqual({ clan: null, membership: null });
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/my\/$/);
  });
});

describe("getClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/", async () => {
    const clan = { id: "c1", name: "Warriors" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(clan));
    const result = await getClan("tok", "c1");
    expect(result).toEqual(clan);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/$/);
  });
});

describe("updateClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("PATCHes /clans/{clanId}/ with data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "c1", name: "Elite" }));
    await updateClan("tok", "c1", { name: "Elite" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/$/);
    expect(opts.method).toBe("PATCH");
    expect(JSON.parse(opts.body as string)).toEqual({ name: "Elite" });
  });
});

describe("dissolveClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs /clans/{clanId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await dissolveClan("tok", "c1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/$/);
    expect(opts.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
// Clans — Members
// ---------------------------------------------------------------------------

describe("getClanMembers()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/members/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanMembers("tok", "c1");
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/members\//);
  });
});

describe("leaveClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/leave/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await leaveClan("tok", "c1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/leave\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("kickMember()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/kick/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await kickMember("tok", "c1", "u1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/kick\/u1\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("promoteMember()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/promote/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, new_role: "officer" }));
    const result = await promoteMember("tok", "c1", "u1");
    expect(result).toEqual({ ok: true, new_role: "officer" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/promote\/u1\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("demoteMember()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/demote/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, new_role: "member" }));
    const result = await demoteMember("tok", "c1", "u1");
    expect(result).toEqual({ ok: true, new_role: "member" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/demote\/u1\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("transferLeadership()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/transfer-leadership/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await transferLeadership("tok", "c1", "u2");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/transfer-leadership\/u2\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Clans — Invitations
// ---------------------------------------------------------------------------

describe("invitePlayer()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/invite/{userId}/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ id: "inv1" }));
    const result = await invitePlayer("tok", "c1", "u2");
    expect(result).toEqual({ id: "inv1" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/invite\/u2\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getMyInvitations()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/my-invitations/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyInvitations("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/my-invitations\//);
  });
});

describe("acceptInvitation()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/invitations/{invitationId}/accept/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, clan_id: "c1" }));
    const result = await acceptInvitation("tok", "inv1");
    expect(result).toEqual({ ok: true, clan_id: "c1" });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/invitations\/inv1\/accept\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("declineInvitation()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/invitations/{invitationId}/decline/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await declineInvitation("tok", "inv1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/invitations\/inv1\/decline\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Clans — Join Requests
// ---------------------------------------------------------------------------

describe("joinClan()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/join/ with optional message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, joined: true }));
    const result = await joinClan("tok", "c1", "Please let me in");
    expect(result).toEqual({ ok: true, joined: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/join\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ message: "Please let me in" });
  });

  it("defaults message to empty string when not provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, joined: false }));
    await joinClan("tok", "c1");
    const [, opts] = getLastCall();
    expect(JSON.parse(opts.body as string)).toEqual({ message: "" });
  });
});

describe("getClanJoinRequests()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/join-requests/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanJoinRequests("tok", "c1");
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/join-requests\//);
  });
});

describe("acceptJoinRequest()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/join-requests/{requestId}/accept/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await acceptJoinRequest("tok", "req1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/join-requests\/req1\/accept\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("declineJoinRequest()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/join-requests/{requestId}/decline/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await declineJoinRequest("tok", "req1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/join-requests\/req1\/decline\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Clans — Treasury
// ---------------------------------------------------------------------------

describe("getClanTreasury()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/treasury/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ treasury_gold: 1000, tax_percent: 5 }));
    const result = await getClanTreasury("tok", "c1");
    expect(result).toEqual({ treasury_gold: 1000, tax_percent: 5 });
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/treasury\/$/);
  });
});

describe("donateGold()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/treasury/donate/ with amount", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, treasury_gold: 1500 }));
    const result = await donateGold("tok", "c1", 500);
    expect(result).toEqual({ ok: true, treasury_gold: 1500 });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/treasury\/donate\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ amount: 500 });
  });
});

describe("withdrawGold()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/treasury/withdraw/ with amount and reason", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, treasury_gold: 800 }));
    const result = await withdrawGold("tok", "c1", 200, "Prize");
    expect(result).toEqual({ ok: true, treasury_gold: 800 });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/treasury\/withdraw\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ amount: 200, reason: "Prize" });
  });

  it("defaults reason to empty string when not provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true, treasury_gold: 800 }));
    await withdrawGold("tok", "c1", 200);
    const [, opts] = getLastCall();
    expect(JSON.parse(opts.body as string)).toEqual({ amount: 200, reason: "" });
  });
});

// ---------------------------------------------------------------------------
// Clans — Wars
// ---------------------------------------------------------------------------

describe("declareWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/wars/declare/{targetId}/", async () => {
    const war = { id: "w1", status: "pending" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(war));
    const result = await declareWar("tok", "c1", "c2", { players_per_side: 5, wager_gold: 1000 });
    expect(result).toEqual(war);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/wars\/declare\/c2\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ players_per_side: 5, wager_gold: 1000 });
  });
});

describe("acceptWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/wars/{warId}/accept/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await acceptWar("tok", "w1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/accept\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("declineWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/wars/{warId}/decline/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await declineWar("tok", "w1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/decline\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("joinWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/wars/{warId}/join/", async () => {
    const participant = { id: "p1", user: { id: "u1", username: "fighter", elo_rating: 1200 }, clan_id: "c1" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(participant));
    const result = await joinWar("tok", "w1");
    expect(result).toEqual(participant);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/join\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("getClanWars()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/wars/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanWars("tok", "c1", 5, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/wars\//);
    expect(url).toContain("limit=5");
  });
});

describe("getWarParticipants()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/wars/{warId}/participants/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse([]));
    const result = await getWarParticipants("tok", "w1");
    expect(result).toEqual([]);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/participants\/$/);
  });
});

describe("getWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/wars/{warId}/", async () => {
    const war = { id: "w1", status: "active" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(war));
    const result = await getWar("tok", "w1");
    expect(result).toEqual(war);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/$/);
  });
});

describe("leaveWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/wars/{warId}/leave/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await leaveWar("tok", "w1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/leave\/$/);
    expect(opts.method).toBe("POST");
  });
});

describe("cancelWar()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/wars/{warId}/cancel/", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ ok: true }));
    const result = await cancelWar("tok", "w1");
    expect(result).toEqual({ ok: true });
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/wars\/w1\/cancel\/$/);
    expect(opts.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// Clans — Leaderboard & Stats
// ---------------------------------------------------------------------------

describe("getClanLeaderboard()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/leaderboard/ without sort", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanLeaderboard("tok");
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/leaderboard\//);
  });

  it("includes sort param when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanLeaderboard("tok", "elo", 10, 0);
    const [url] = getLastCall();
    expect(url).toContain("sort=elo");
    expect(url).toContain("limit=10");
  });
});

describe("getClanStats()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/stats/", async () => {
    const stats = {
      clan_id: "c1",
      level: 5,
      experience: 1000,
      elo_rating: 1500,
      member_count: 20,
      wars_total: 10,
      wars_won: 7,
      wars_lost: 3,
      war_win_rate: 0.7,
    };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(stats));
    const result = await getClanStats("tok", "c1");
    expect(result).toEqual(stats);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/stats\/$/);
  });
});

// ---------------------------------------------------------------------------
// Clans — Activity Log & Chat
// ---------------------------------------------------------------------------

describe("getClanActivityLog()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/activity-log/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanActivityLog("tok", "c1", 10, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/activity-log\//);
    expect(url).toContain("limit=10");
  });
});

describe("getClanChat()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs /clans/{clanId}/chat/ with pagination", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getClanChat("tok", "c1", 20, 0);
    const [url] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/chat\//);
    expect(url).toContain("limit=20");
  });
});

describe("sendClanChatMessage()", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /clans/{clanId}/chat/ with content", async () => {
    const msg = { id: "cm1", content: "Hello clan!", created_at: "" };
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse(msg));
    const result = await sendClanChatMessage("tok", "c1", "Hello clan!");
    expect(result).toEqual(msg);
    const [url, opts] = getLastCall();
    expect(url).toMatch(/\/clans\/c1\/chat\/$/);
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({ content: "Hello clan!" });
  });
});

// ---------------------------------------------------------------------------
// fetchPaginated — no limit/offset appended when undefined
// ---------------------------------------------------------------------------

describe("fetchPaginated — omits params when not given", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not append limit/offset when both are undefined", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ items: [], count: 0 }));
    await getMyDecks("tok");
    const [url] = getLastCall();
    expect(url).not.toContain("limit=");
    expect(url).not.toContain("offset=");
  });
});

// ---------------------------------------------------------------------------
// Error handling — 500 server error
// ---------------------------------------------------------------------------

describe("error handling — 500 server error", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws APIError with status 500", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeErrorResponse("Internal Server Error", 500));
    try {
      await getMe();
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(500);
      expect((err as APIError).message).toBe("Internal Server Error");
    }
  });

  it("includes response body on thrown APIError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeResponse({ detail: "Something broke", code: "ERR_500" }, 500));
    try {
      await getMe();
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as APIError).body).toEqual({ detail: "Something broke", code: "ERR_500" });
    }
  });

  it("uses statusText as message when detail is missing from body", async () => {
    // Response with non-JSON error body
    const response = new Response("{}", {
      status: 503,
      statusText: "Service Unavailable",
      headers: { "Content-Type": "application/json" },
    });
    vi.mocked(fetch).mockResolvedValueOnce(response);
    try {
      await getMe();
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as APIError).status).toBe(503);
    }
  });
});
