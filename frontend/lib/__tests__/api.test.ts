import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIError, BannedError, getLevelStat, login, register } from "../api";

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

// ---------------------------------------------------------------------------
// Reset module-level cache between tests
// ---------------------------------------------------------------------------

// The _configCache variable lives at module scope in api.ts.  We reset it by
// re-importing a fresh module instance via vi.resetModules() in a separate
// describe block where needed.

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
