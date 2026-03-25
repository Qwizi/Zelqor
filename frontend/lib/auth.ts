// Auth state is now managed via httpOnly cookies set by the backend.
// JS cannot read httpOnly cookies, so we keep a lightweight "is logged in"
// flag in localStorage purely to skip the /auth/me fetch on page load when
// the user is clearly not authenticated.
const AUTH_FLAG_KEY = "maplord_authenticated";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_FLAG_KEY) === "true";
}

export function setAuthenticated(value: boolean): void {
  if (typeof window === "undefined") return;
  if (value) {
    localStorage.setItem(AUTH_FLAG_KEY, "true");
  } else {
    localStorage.removeItem(AUTH_FLAG_KEY);
    // Also clear legacy token keys if they happen to exist from an old session
    localStorage.removeItem("maplord_access");
    localStorage.removeItem("maplord_refresh");
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible stubs — cookies now carry the real tokens.
// These return null/no-op but are kept so existing call sites compile without
// changes (they will be gradually removed).
// ---------------------------------------------------------------------------

/** @deprecated Tokens are in httpOnly cookies and not accessible from JS. */
export function getAccessToken(): string | null {
  return null;
}

/** @deprecated Tokens are in httpOnly cookies and not accessible from JS. */
export function getRefreshToken(): string | null {
  return null;
}

/** @deprecated Use setAuthenticated(true) instead. */
export function setTokens(_access: string, _refresh: string): void {
  setAuthenticated(true);
}

/** @deprecated Use setAuthenticated(false) instead. */
export function clearTokens(): void {
  setAuthenticated(false);
}

/** Whether the user appears to be logged in (based on the local flag). */
export function isLoggedIn(): boolean {
  return isAuthenticated();
}
