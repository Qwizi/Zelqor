import { type BrowserContext, test as base, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Environment-driven credentials
// ---------------------------------------------------------------------------

export const TEST_USER = {
  email: process.env.TEST_USER_EMAIL || "e2e@zelqor.gg",
  password: process.env.TEST_USER_PASSWORD || "testpassword123",
  // Expected username for the test account — used in UI assertions.
  username: process.env.TEST_USER_USERNAME || "e2euser",
} as const;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Login via the REST API, write the JWT tokens into localStorage, and return
 * the access token so callers can make additional API requests.
 *
 * Uses the Next.js rewrite so the request is proxied through the same origin
 * (`/api/v1/...`) and the cookies / storage key matches exactly what the app
 * expects.
 */
export async function loginViaAPI(page: Page): Promise<string> {
  // 1. Obtain a token pair.
  const tokenRes = await page.request.post("/api/v1/token/pair", {
    data: {
      identifier: TEST_USER.email,
      password: TEST_USER.password,
    },
  });

  if (!tokenRes.ok()) {
    throw new Error(`Login API returned ${tokenRes.status()}: ${await tokenRes.text()}`);
  }

  const { access, refresh } = await tokenRes.json();

  // 2. Write tokens into localStorage — the app reads these on mount.
  await page.addInitScript(
    ({ accessToken, refreshToken }) => {
      localStorage.setItem("zelqor_access", accessToken);
      localStorage.setItem("zelqor_refresh", refreshToken);
    },
    { accessToken: access, refreshToken: refresh },
  );

  return access;
}

/**
 * Clear all Zelqor auth state from localStorage/sessionStorage.
 */
export async function clearAuthState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.removeItem("zelqor_access");
    localStorage.removeItem("zelqor_refresh");
    localStorage.removeItem("zelqor_profiles");
    sessionStorage.removeItem("zelqor_queue");
  });
}

// ---------------------------------------------------------------------------
// Fixture types
// ---------------------------------------------------------------------------

interface ZelqorFixtures {
  /** A page that already has JWT tokens set — navigating to any protected
   *  route will succeed without going through the login flow. */
  authenticatedPage: Page;
  /** Convenience: the raw access token obtained during auth setup. */
  accessToken: string;
}

// ---------------------------------------------------------------------------
// Extended test object
// ---------------------------------------------------------------------------

export const test = base.extend<ZelqorFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Navigate to a neutral page first so the origin is set before we write
    // to localStorage via addInitScript.
    await loginViaAPI(page);

    // Now navigate to the dashboard — the app will read the tokens and hydrate.
    await page.goto("/dashboard");

    await use(page);
  },

  accessToken: async ({ page }, use) => {
    const token = await loginViaAPI(page);
    await use(token);
  },
});

export { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Page Object Model helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight login helper used by tests that exercise the login form
 * (i.e. tests that want to interact with the form UI, not bypass it).
 */
export async function fillLoginForm(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel("Login lub email").fill(email);
  await page.getByLabel("Hasło").fill(password);
  await page.getByRole("button", { name: /wejdź do gry/i }).click();
}

/**
 * Wait for the dashboard to be fully loaded (user data rendered).
 */
export async function waitForDashboard(page: Page): Promise<void> {
  await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
  // Wait for the greeting header that includes the username.
  await page.getByText(/^Hej,/).waitFor({ timeout: 10_000 });
}

/**
 * Inject tokens into a fresh context's storage state so every page in that
 * context starts as authenticated. Useful for multi-page / context tests.
 */
export async function injectAuthTokens(context: BrowserContext, access: string, refresh: string): Promise<void> {
  await context.addInitScript(
    ({ accessToken, refreshToken }) => {
      localStorage.setItem("zelqor_access", accessToken);
      localStorage.setItem("zelqor_refresh", refreshToken);
    },
    { accessToken: access, refreshToken: refresh },
  );
}
