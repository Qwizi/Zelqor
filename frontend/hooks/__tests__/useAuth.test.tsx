import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockGetMe = vi.fn();
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockLogoutAPI = vi.fn();

vi.mock("@/lib/api", () => ({
  getMe: (...args: unknown[]) => mockGetMe(...args),
  login: (...args: unknown[]) => mockLogin(...args),
  register: (...args: unknown[]) => mockRegister(...args),
  logoutAPI: (...args: unknown[]) => mockLogoutAPI(...args),
  APIError: class APIError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body?: unknown) {
      super(message);
      this.name = "APIError";
      this.status = status;
      this.body = body;
    }
  },
  BannedError: class BannedError extends Error {
    constructor() {
      super("Account banned");
      this.name = "BannedError";
    }
  },
}));

const mockIsAuthenticated = vi.fn();
const mockSetAuthenticated = vi.fn();

vi.mock("@/lib/auth", () => ({
  isAuthenticated: () => mockIsAuthenticated(),
  setAuthenticated: (value: boolean) => mockSetAuthenticated(value),
  // Keep deprecated stubs for any indirect usage
  getAccessToken: vi.fn(() => null),
  getRefreshToken: vi.fn(() => null),
  setTokens: vi.fn(),
  clearTokens: vi.fn(),
}));

import { APIError } from "@/lib/api";

// Import the hook/provider after mocks are set up.
import { AuthProvider, useAuth } from "../useAuth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockUser = {
  id: "user-1",
  username: "Alice",
  email: "alice@example.com",
  role: "player",
  elo_rating: 1200,
  date_joined: "2026-01-01T00:00:00Z",
  tutorial_completed: true,
  is_banned: false,
};

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(AuthProvider, null, children),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not authenticated
    mockIsAuthenticated.mockReturnValue(false);
    mockLogoutAPI.mockResolvedValue(undefined);
  });

  it("throws when used outside of AuthProvider", () => {
    // Suppress the React error boundary console.error noise
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow("useAuth must be used within AuthProvider");
    spy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Initial loading state
  // -------------------------------------------------------------------------

  it("has loading=true initially when auth flag is set", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    // Delay resolution so we can catch the loading state
    mockGetMe.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.loading).toBe(true);
  });

  it("has loading=false and user=null when not authenticated", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    const { result } = renderHook(() => useAuth(), { wrapper });
    // No async work — loading should become false synchronously via useEffect
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.user).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Authenticated user loaded on mount
  // -------------------------------------------------------------------------

  it("loads user from cookie session on mount", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.loading).toBe(false);
    // token is always null in cookie-based auth
    expect(result.current.token).toBeNull();
  });

  it("clears user and auth flag when getMe returns 401", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockRejectedValue(new APIError(401, "Unauthorized"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
  });

  // -------------------------------------------------------------------------
  // login()
  // -------------------------------------------------------------------------

  it("login() sets user on success", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockLogin.mockResolvedValue({ user: mockUser });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.login("alice@example.com", "password");
    });

    expect(mockSetAuthenticated).toHaveBeenCalledWith(true);
    expect(result.current.user).toEqual(mockUser);
    // token is always null in cookie-based auth
    expect(result.current.token).toBeNull();
  });

  it("login() throws BannedError when user is banned", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockLogin.mockResolvedValue({ user: { ...mockUser, is_banned: true } });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    await expect(
      act(async () => {
        await result.current.login("banned@example.com", "password");
      }),
    ).rejects.toThrow();

    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
  });

  // -------------------------------------------------------------------------
  // logout()
  // -------------------------------------------------------------------------

  it("logout() clears user and calls logoutAPI", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toEqual(mockUser);

    await act(async () => {
      await result.current.logout();
    });

    expect(mockLogoutAPI).toHaveBeenCalled();
    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.isBanned).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Banned state
  // -------------------------------------------------------------------------

  it("sets isBanned=true and clears auth when getMe returns a banned user", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue({ ...mockUser, is_banned: true });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.isBanned).toBe(true);
    expect(result.current.user).toBeNull();
    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
  });

  // -------------------------------------------------------------------------
  // refreshUser()
  // -------------------------------------------------------------------------

  it("refreshUser() re-fetches and updates the user", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const updatedUser = { ...mockUser, elo_rating: 1300 };
    mockGetMe.mockResolvedValue(updatedUser);

    await act(async () => {
      await result.current.refreshUser();
    });

    expect(result.current.user?.elo_rating).toBe(1300);
  });
});
