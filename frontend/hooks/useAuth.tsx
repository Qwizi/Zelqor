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
  type User,
  type APIError,
} from "@/lib/api";
import {
  getAccessToken,
  getRefreshToken,
  setTokens,
  clearTokens,
} from "@/lib/auth";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    username: string,
    email: string,
    password: string
  ) => Promise<void>;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async (accessToken: string) => {
    try {
      const me = await getMe(accessToken);
      setUser(me);
      setToken(accessToken);
    } catch {
      // Token might be expired, try refresh
      const refresh = getRefreshToken();
      if (refresh) {
        try {
          const newTokens = await apiRefresh(refresh);
          setTokens(newTokens.access, newTokens.refresh);
          const me = await getMe(newTokens.access);
          setUser(me);
          setToken(newTokens.access);
        } catch {
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
  }, []);

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
    await loadUser(tokens.access);
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
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
