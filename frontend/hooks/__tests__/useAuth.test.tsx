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

  // -------------------------------------------------------------------------
  // loadUser — rethrows unexpected errors (leaves existing state intact)
  // -------------------------------------------------------------------------

  it("loadUser() rethrows errors that are not 401/403 APIError, leaving existing state intact", async () => {
    // First load a valid user
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toEqual(mockUser);

    // Now simulate an unexpected error on refreshUser (calls loadUser internally)
    const unexpectedError = new Error("Server crash");
    mockGetMe.mockRejectedValue(unexpectedError);

    // loadUser rethrows on unexpected errors — refreshUser() will propagate the rejection
    await expect(
      act(async () => {
        await result.current.refreshUser();
      }),
    ).rejects.toThrow("Server crash");

    // Existing state should remain intact (user not cleared)
    expect(result.current.user).toEqual(mockUser);
    // setAuthenticated(false) should NOT have been called for unexpected errors
    expect(mockSetAuthenticated).not.toHaveBeenCalledWith(false);
  });

  it("loadUser() clears state on 403 APIError (forbidden)", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockRejectedValue(new APIError(403, "Forbidden"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
  });

  // -------------------------------------------------------------------------
  // register()
  // -------------------------------------------------------------------------

  it("register() calls apiRegister then login", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockRegister.mockResolvedValue(undefined);
    mockLogin.mockResolvedValue({ user: mockUser });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    await act(async () => {
      await result.current.register("Alice", "alice@example.com", "password123");
    });

    expect(mockRegister).toHaveBeenCalledWith({
      username: "Alice",
      email: "alice@example.com",
      password: "password123",
    });
    // login is called internally after register
    expect(mockLogin).toHaveBeenCalledWith("alice@example.com", "password123");
    expect(result.current.user).toEqual(mockUser);
  });

  it("register() propagates errors from apiRegister", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockRegister.mockRejectedValue(new Error("Username taken"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    await expect(
      act(async () => {
        await result.current.register("Alice", "alice@example.com", "password123");
      }),
    ).rejects.toThrow("Username taken");
  });

  // -------------------------------------------------------------------------
  // loginWithTokens()
  // -------------------------------------------------------------------------

  it("loginWithTokens() calls loadUser and sets the user", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    // After loginWithTokens, getMe should succeed
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    // Set isAuthenticated=true so loadUser proceeds
    mockIsAuthenticated.mockReturnValue(true);

    await act(async () => {
      await result.current.loginWithTokens("access-token", "refresh-token");
    });

    expect(mockGetMe).toHaveBeenCalled();
    expect(result.current.user).toEqual(mockUser);
  });

  it("loginWithTokens() ignores the provided token arguments (cookie-based auth)", async () => {
    mockIsAuthenticated.mockReturnValue(false);
    mockGetMe.mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    mockIsAuthenticated.mockReturnValue(true);

    await act(async () => {
      await result.current.loginWithTokens("dummy-access", "dummy-refresh");
    });

    // Tokens are not passed anywhere — only getMe is called
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockGetMe).toHaveBeenCalled();
    // token is always null in cookie auth
    expect(result.current.token).toBeNull();
  });

  // -------------------------------------------------------------------------
  // logout() — logoutAPI failure still clears state
  // -------------------------------------------------------------------------

  it("logout() clears user state even when logoutAPI throws", async () => {
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue(mockUser);
    mockLogoutAPI.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.user).toEqual(mockUser);

    await act(async () => {
      await result.current.logout();
    });

    // Should still clear despite API error
    expect(result.current.user).toBeNull();
    expect(mockSetAuthenticated).toHaveBeenCalledWith(false);
  });

  // -------------------------------------------------------------------------
  // refreshUser() — skips when not authenticated and no user
  // -------------------------------------------------------------------------

  it("refreshUser() is a no-op when user is null and not authenticated", async () => {
    mockIsAuthenticated.mockReturnValue(false);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    const callsBefore = mockGetMe.mock.calls.length;

    await act(async () => {
      await result.current.refreshUser();
    });

    // getMe should not have been called
    expect(mockGetMe.mock.calls.length).toBe(callsBefore);
  });

  // -------------------------------------------------------------------------
  // login() clears isBanned on success
  // -------------------------------------------------------------------------

  it("login() sets isBanned=false on successful login after a previous ban", async () => {
    // Simulate previously banned state
    mockIsAuthenticated.mockReturnValue(true);
    mockGetMe.mockResolvedValue({ ...mockUser, is_banned: true });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {});

    expect(result.current.isBanned).toBe(true);

    // Now login succeeds with non-banned user
    mockLogin.mockResolvedValue({ user: mockUser });

    await act(async () => {
      await result.current.login("alice@example.com", "password");
    });

    expect(result.current.isBanned).toBe(false);
    expect(result.current.user).toEqual(mockUser);
  });
});
