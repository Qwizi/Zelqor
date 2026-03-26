import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  isAuthenticated,
  isLoggedIn,
  setAuthenticated,
  setTokens,
} from "../auth";

describe("auth utilities", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // -------------------------------------------------------------------------
  // Cookie-based auth flag (primary API)
  // -------------------------------------------------------------------------

  describe("isAuthenticated / setAuthenticated", () => {
    it("returns false when no flag is stored", () => {
      expect(isAuthenticated()).toBe(false);
    });

    it("returns true after setAuthenticated(true)", () => {
      setAuthenticated(true);
      expect(isAuthenticated()).toBe(true);
    });

    it("returns false after setAuthenticated(false)", () => {
      setAuthenticated(true);
      setAuthenticated(false);
      expect(isAuthenticated()).toBe(false);
    });

    it("removes the flag key from localStorage on setAuthenticated(false)", () => {
      setAuthenticated(true);
      setAuthenticated(false);
      expect(localStorage.getItem("maplord_authenticated")).toBeNull();
    });

    it("also removes legacy token keys on setAuthenticated(false)", () => {
      localStorage.setItem("maplord_access", "old-token");
      localStorage.setItem("maplord_refresh", "old-refresh");
      setAuthenticated(false);
      expect(localStorage.getItem("maplord_access")).toBeNull();
      expect(localStorage.getItem("maplord_refresh")).toBeNull();
    });
  });

  describe("isLoggedIn", () => {
    it("returns false when not authenticated", () => {
      expect(isLoggedIn()).toBe(false);
    });

    it("returns true when authenticated flag is set", () => {
      setAuthenticated(true);
      expect(isLoggedIn()).toBe(true);
    });

    it("returns false after setAuthenticated(false)", () => {
      setAuthenticated(true);
      setAuthenticated(false);
      expect(isLoggedIn()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Deprecated stubs (backward compat — tokens are now httpOnly cookies)
  // -------------------------------------------------------------------------

  describe("getAccessToken (deprecated stub)", () => {
    it("always returns null — tokens are in httpOnly cookies", () => {
      // Even if a legacy key exists in localStorage, the stub ignores it
      localStorage.setItem("maplord_access", "legacy-token");
      expect(getAccessToken()).toBeNull();
    });
  });

  describe("getRefreshToken (deprecated stub)", () => {
    it("always returns null — tokens are in httpOnly cookies", () => {
      localStorage.setItem("maplord_refresh", "legacy-refresh");
      expect(getRefreshToken()).toBeNull();
    });
  });

  describe("setTokens (deprecated stub)", () => {
    it("sets the authenticated flag to true", () => {
      setTokens("any-access", "any-refresh");
      expect(isAuthenticated()).toBe(true);
    });
  });

  describe("clearTokens (deprecated stub)", () => {
    it("sets the authenticated flag to false", () => {
      setAuthenticated(true);
      clearTokens();
      expect(isAuthenticated()).toBe(false);
    });

    it("does not throw when called without prior auth", () => {
      expect(() => clearTokens()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // SSR branch: typeof window === "undefined" (lines 8 and 13)
  // In jsdom window exists, so we simulate the SSR guard by temporarily
  // deleting the global window object.
  // -------------------------------------------------------------------------

  describe("SSR guard (typeof window === 'undefined')", () => {
    it("isAuthenticated() returns false when window is undefined", () => {
      const savedWindow = global.window;
      // @ts-expect-error intentional: simulate SSR environment
      delete global.window;

      const result = isAuthenticated();
      expect(result).toBe(false);

      global.window = savedWindow;
    });

    it("setAuthenticated() is a no-op when window is undefined", () => {
      const savedWindow = global.window;
      // @ts-expect-error intentional: simulate SSR environment
      delete global.window;

      // Should not throw and should have no observable effect
      expect(() => setAuthenticated(true)).not.toThrow();

      global.window = savedWindow;
      // After restoring window, the flag should not have been set
      expect(isAuthenticated()).toBe(false);
    });
  });
});
