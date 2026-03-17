import { defineConfig, devices } from "@playwright/test";

/**
 * MapLord E2E test configuration.
 *
 * Run against a locally running dev server on port 3002 (matches docker-compose
 * port mapping for the frontend service). The webServer block starts the dev
 * server automatically when tests are run outside of Docker.
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",

  /* Maximum time one test can run for. */
  timeout: 30_000,

  /* Fail the build on CI if you accidentally left test.only in the source. */
  forbidOnly: !!process.env.CI,

  /* No retries by default; CI also uses 0 so failures are immediately visible. */
  retries: 0,

  /* Reporter: list for local, GitHub-annotated for CI. */
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],

  /* Shared settings for all projects. */
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3002",

    /* Collect trace on first retry (useful for debugging flaky tests). */
    trace: "on-first-retry",

    /* Record screenshots on failure. */
    screenshot: "only-on-failure",

    /* Default navigation timeout. */
    navigationTimeout: 15_000,
  },

  /* Only chromium — keeps the suite fast and deterministic. */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Start the Next.js dev server before tests if not already running.
   * The `reuseExistingServer` flag means running `pnpm dev` manually
   * (or via docker-compose) also works without a second server process. */
  webServer: {
    command: "pnpm dev --port 3002",
    url: "http://localhost:3002",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      PORT: "3002",
    },
  },
});
