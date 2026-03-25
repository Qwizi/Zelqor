"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  APIError,
  login as apiLogin,
  register as apiRegister,
  BannedError,
  getMe,
  logoutAPI,
  type User,
} from "@/lib/api";
import { isAuthenticated, setAuthenticated } from "@/lib/auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isBanned: boolean;
  login: (email: string, password: string) => Promise<void>;
  /** @deprecated Pass tokens to the new cookie-based login. Use login() instead. */
  loginWithTokens: (access: string, refresh: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** @deprecated Tokens are in httpOnly cookies. This is always null. */
  token: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBanned, setIsBanned] = useState(false);

  const handleBanned = useCallback(() => {
    setAuthenticated(false);
    setUser(null);
    setIsBanned(true);
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const me = await getMe();
      if (me.is_banned) {
        handleBanned();
        return;
      }
      setAuthenticated(true);
      setUser(me);
      setIsBanned(false);
    } catch (err) {
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        // Cookie invalid / expired and refresh also failed — user is not authenticated
        setAuthenticated(false);
        setUser(null);
        setIsBanned(false);
        return;
      }
      // Unexpected error — leave existing state intact
      throw err;
    }
  }, [handleBanned]);

  // On mount: if the auth flag says we might be logged in, verify with /auth/me.
  // If the flag is absent we skip the network call (fast path for logged-out users).
  useEffect(() => {
    if (isAuthenticated()) {
      loadUser().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    const { user: me } = await apiLogin(email, password);
    if (me.is_banned) {
      setAuthenticated(false);
      throw new BannedError();
    }
    setAuthenticated(true);
    setUser(me);
    setIsBanned(false);
  };

  /**
   * @deprecated The cookie-based auth flow returns a User directly from login().
   * This method is kept for call sites (e.g. social auth callbacks) that still
   * receive tokens and need to set the session.
   */
  const loginWithTokens = async (_access: string, _refresh: string) => {
    // Tokens are ignored — the cookie has already been set by the OAuth callback.
    // Just verify the session is valid and load the user.
    await loadUser();
  };

  const register = async (username: string, email: string, password: string) => {
    await apiRegister({ username, email, password });
    await login(email, password);
  };

  const logout = async () => {
    try {
      await logoutAPI();
    } catch {
      // Even if the server call fails, clear local state
    }
    setAuthenticated(false);
    setUser(null);
    setIsBanned(false);
    queryClient.clear();
  };

  const refreshUser = useCallback(async () => {
    if (!isAuthenticated() && !user) return;
    await loadUser();
  }, [loadUser, user]);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isBanned,
        login,
        loginWithTokens,
        register,
        logout,
        refreshUser,
        // Always null — tokens live in httpOnly cookies now
        token: null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
