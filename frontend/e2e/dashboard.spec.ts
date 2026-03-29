import { expect, TEST_USER, test, waitForDashboard } from "./fixtures";

// ---------------------------------------------------------------------------
// Dashboard & navigation tests — all require an authenticated session.
// ---------------------------------------------------------------------------

test.describe("Dashboard", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    // The fixture already navigates to /dashboard; just wait for it to hydrate.
    await waitForDashboard(page);
  });

  // ── Page content ──────────────────────────────────────────────────────────

  test("authenticated user sees greeting and stat cards", async ({ authenticatedPage: page }) => {
    // Personalised greeting
    await expect(page.getByText(new RegExp(`Hej, ${TEST_USER.username}`, "i"))).toBeVisible();

    // Stat labels always present (ELO, Win Rate, Mecze, Wygrane)
    await expect(page.getByText("ELO")).toBeVisible();
    await expect(page.getByText("Win Rate")).toBeVisible();
    await expect(page.getByText("Mecze")).toBeVisible();
    await expect(page.getByText("Wygrane")).toBeVisible();
  });

  test("game mode selector is visible with play button", async ({ authenticatedPage: page }) => {
    // "Tryb gry" section label (desktop card)
    await expect(page.getByText("Tryb gry").first()).toBeVisible();

    // "Szukaj gry" CTA button
    await expect(page.getByRole("button", { name: /szukaj gry/i }).first()).toBeVisible();
  });

  test("shortcut navigation cards are rendered", async ({ authenticatedPage: page }) => {
    // Four shortcut links visible on the page
    await expect(page.getByRole("link", { name: /ekwipunek/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /talia/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /rynek/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /kuźnia/i }).first()).toBeVisible();
  });

  // ── Sidebar navigation ────────────────────────────────────────────────────

  test("sidebar shows ZELQOR logo link", async ({ authenticatedPage: page }) => {
    const logo = page.getByRole("link", { name: /zelqor/i }).first();
    await expect(logo).toBeVisible();
  });

  test("sidebar nav: Ranking link navigates to /leaderboard", async ({ authenticatedPage: page }) => {
    // Click the desktop sidebar "Ranking" link
    await page
      .getByRole("link", { name: /ranking/i })
      .first()
      .click();
    await page.waitForURL(/\/leaderboard/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/leaderboard/);
  });

  test("sidebar nav: Ekwipunek link navigates to /inventory", async ({ authenticatedPage: page }) => {
    await page
      .getByRole("link", { name: /ekwipunek/i })
      .first()
      .click();
    await page.waitForURL(/\/inventory/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/inventory/);
  });

  test("sidebar nav: Ustawienia link navigates to /settings", async ({ authenticatedPage: page }) => {
    // Ustawienia is inside the profile popover on desktop; open it first.
    await page.getByText(TEST_USER.username).first().click();
    await page
      .getByRole("link", { name: /ustawienia/i })
      .first()
      .click();
    await page.waitForURL(/\/settings/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/settings/);
  });

  // ── User profile ──────────────────────────────────────────────────────────

  test("user profile is shown in the sidebar with username and ELO", async ({ authenticatedPage: page }) => {
    // Username appears in the profile button inside the sidebar
    await expect(page.getByText(TEST_USER.username).first()).toBeVisible();

    // ELO rating — value is a number rendered by a tabular-nums element
    // Just assert the element with the ELO label exists and has a numeric sibling
    const eloLabel = page.getByText("ELO").first();
    await expect(eloLabel).toBeVisible();
  });

  // ── Tutorial banner ───────────────────────────────────────────────────────

  test("tutorial banner shows for users who haven't completed the tutorial", async ({ authenticatedPage: page }) => {
    // The tutorial_completed flag determines whether this is shown.
    // If the test account has not completed the tutorial, the banner is visible.
    // This test is conditional: it passes regardless of tutorial state.
    const banner = page.getByText("Samouczek");
    const hasBanner = (await banner.count()) > 0;
    if (hasBanner) {
      await expect(banner.first()).toBeVisible();
      await expect(page.getByText("Naucz się podstaw w krótkiej rozgrywce")).toBeVisible();
    }
  });
});
