"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  getMe,
  login as apiLogin,
  register as apiRegister,
  refreshToken as apiRefresh,
  APIError,
  BannedError,
  type User,
} from "@/lib/api";
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  isBanned: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithTokens: (access: string, refresh: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  token: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBanned, setIsBanned] = useState(false);

  const handleBanned = useCallback(() => {
    clearTokens();
    setUser(null);
    setToken(null);
    setIsBanned(true);
  }, []);

  const applyUser = useCallback((me: User, accessToken: string) => {
    if (me.is_banned) {
      handleBanned();
      return;
    }
    setUser(me);
    setToken(accessToken);
    setIsBanned(false);
  }, [handleBanned]);

  const loadUser = useCallback(async (accessToken: string) => {
    try {
      const me = await getMe(accessToken);
      applyUser(me, accessToken);
    } catch (err) {
      // Banned users receive 401/403 from the API
      if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
        handleBanned();
        return;
      }
      // Token might be expired, try refresh
      const refresh = getRefreshToken();
      if (refresh) {
        try {
          const newTokens = await apiRefresh(refresh);
          setTokens(newTokens.access, newTokens.refresh);
          const me = await getMe(newTokens.access);
          applyUser(me, newTokens.access);
        } catch (refreshErr) {
          if (refreshErr instanceof APIError && (refreshErr.status === 401 || refreshErr.status === 403)) {
            handleBanned();
            return;
          }
          clearTokens();
          setUser(null);
          setToken(null);
        }
      } else {
        clearTokens();
        setUser(null);
        setToken(null);
      }
    }
  }, [applyUser, handleBanned]);

  useEffect(() => {
    const accessToken = getAccessToken();
    if (accessToken) {
      // loadUser is async — setState is called inside promise callbacks, not synchronously
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadUser(accessToken).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [loadUser]);

  const login = async (email: string, password: string) => {
    const tokens = await apiLogin(email, password);
    setTokens(tokens.access, tokens.refresh);
    const me = await getMe(tokens.access);
    if (me.is_banned) {
      clearTokens();
      throw new BannedError();
    }
    setUser(me);
    setToken(tokens.access);
    setIsBanned(false);
  };

  const loginWithTokens = async (access: string, refresh: string) => {
    setTokens(access, refresh);
    const me = await getMe(access);
    if (me.is_banned) {
      clearTokens();
      throw new BannedError();
    }
    setUser(me);
    setToken(access);
    setIsBanned(false);
  };

  const register = async (
    username: string,
    email: string,
    password: string
  ) => {
    await apiRegister({ username, email, password });
    await login(email, password);
  };

  const logout = () => {
    clearTokens();
    setUser(null);
    setToken(null);
    setIsBanned(false);
    queryClient.clear();
  };

  const refreshUser = useCallback(async () => {
    const accessToken = getAccessToken();
    if (!accessToken) return;
    await loadUser(accessToken);
  }, [loadUser]);

  return (
    <AuthContext.Provider value={{ user, loading, isBanned, login, loginWithTokens, register, logout, refreshUser, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
