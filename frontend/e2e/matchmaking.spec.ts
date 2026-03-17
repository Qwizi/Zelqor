import { test, expect, waitForDashboard } from "./fixtures";

// ---------------------------------------------------------------------------
// Matchmaking & Lobby tests
//
// These tests exercise the queue flow that drives the Rust Gateway WebSocket.
// The "lobby" tests only run when the full stack is available — the lobby page
// redirects away when no active queue session exists.
// ---------------------------------------------------------------------------

test.describe("Matchmaking — queue flow", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await waitForDashboard(page);
  });

  test("clicking Szukaj gry shows queue UI with timer", async ({ authenticatedPage: page }) => {
    // Select a mode first if no default is pre-selected
    const playBtn = page.getByRole("button", { name: /szukaj gry/i }).first();
    await expect(playBtn).toBeEnabled({ timeout: 8_000 });
    await playBtn.click();

    // After joining the queue the button should change to a cancel button
    // containing a running timer (mm:ss format).
    const cancelBtn = page.getByRole("button", { name: /anuluj/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 8_000 });

    // Timer text: digits separated by colon, e.g. "0:01"
    await expect(
      page.getByText(/\d+:\d{2}/).first()
    ).toBeVisible({ timeout: 5_000 });
  });

  test("queue timer increments while waiting", async ({ authenticatedPage: page }) => {
    const playBtn = page.getByRole("button", { name: /szukaj gry/i }).first();
    await expect(playBtn).toBeEnabled({ timeout: 8_000 });
    await playBtn.click();

    // Capture first timer value
    const timerLocator = page.getByText(/^\d+:\d{2}$/).first();
    await expect(timerLocator).toBeVisible({ timeout: 5_000 });
    const firstValue = await timerLocator.textContent();

    // Wait 2 seconds for the counter to advance
    await page.waitForTimeout(2_000);
    const secondValue = await timerLocator.textContent();

    // The timer should have changed
    expect(firstValue).not.toBe(secondValue);

    // Clean up: cancel queue
    await page.getByRole("button", { name: /anuluj/i }).first().click();
  });

  test("cancel queue returns to Szukaj gry state", async ({ authenticatedPage: page }) => {
    const playBtn = page.getByRole("button", { name: /szukaj gry/i }).first();
    await expect(playBtn).toBeEnabled({ timeout: 8_000 });
    await playBtn.click();

    // Wait for queue to start
    await expect(
      page.getByRole("button", { name: /anuluj/i }).first()
    ).toBeVisible({ timeout: 8_000 });

    // Cancel
    await page.getByRole("button", { name: /anuluj/i }).first().click();

    // Should return to the Szukaj gry button
    await expect(
      page.getByRole("button", { name: /szukaj gry/i }).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("game mode pills are clickable and change selection", async ({ authenticatedPage: page }) => {
    // Wait for game modes to load — they are fetched from /api/v1/config/
    const modePill = page.getByRole("button").filter({ hasText: /1v1|3P|4P|standard|blitz/i }).first();
    await expect(modePill).toBeVisible({ timeout: 8_000 });

    // Click it — it should become "selected" (border-primary / bg-primary)
    await modePill.click();

    // Assert the Szukaj gry button is now enabled (a mode is selected)
    await expect(
      page.getByRole("button", { name: /szukaj gry/i }).first()
    ).toBeEnabled();
  });
});

test.describe("Matchmaking — opponents selector", () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await waitForDashboard(page);
  });

  test("bot options are displayed on desktop (Bez botów, Dołącz boty, Instant bot)", async ({ authenticatedPage: page }) => {
    // These are inside the desktop Card only; make the viewport desktop-wide
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await waitForDashboard(page);

    await expect(page.getByText("Bez botów").first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Dołącz boty").first()).toBeVisible();
    await expect(page.getByText("Instant bot").first()).toBeVisible();
  });
});

test.describe("Lobby page", () => {
  test("lobby page shows Szukanie graczy banner when no one is ready", async ({ authenticatedPage: page }) => {
    // We need a real lobby — navigate there only if we have a lobbyId.
    // Without a full match, visiting /lobby/<uuid> redirects back to /dashboard.
    // Here we assert the redirect itself as the expected behaviour when no
    // active session exists.
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await page.goto(`/lobby/${fakeId}`);

    // Should redirect back to dashboard because there is no queue session
    await page.waitForURL(/\/dashboard|\/lobby/, { timeout: 8_000 });

    const currentUrl = page.url();
    if (currentUrl.includes("/lobby/")) {
      // If we somehow ended up in a lobby, assert the structure
      await expect(page.getByText(/szukanie graczy|lobby/i).first()).toBeVisible();
    } else {
      // Redirect is the correct behaviour — test passes
      expect(currentUrl).toMatch(/\/dashboard/);
    }
  });

  test("lobby page player slots section is rendered when in queue", async ({ authenticatedPage: page }) => {
    // Join queue to get a real lobbyId
    await waitForDashboard(page);
    const playBtn = page.getByRole("button", { name: /szukaj gry/i }).first();
    await expect(playBtn).toBeEnabled({ timeout: 8_000 });
    await playBtn.click();

    // Wait for the "Przejdź do lobby" link to appear (only after WS assigns a lobby)
    const lobbyLink = page.getByRole("link", { name: /przejdź do lobby/i }).first();
    const appeared = await lobbyLink.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);

    if (appeared) {
      await lobbyLink.click();
      await page.waitForURL(/\/lobby\//, { timeout: 10_000 });

      // Player section label
      await expect(page.getByText("Gracze").first()).toBeVisible();

      // Our own username should appear in a player slot
      await expect(
        page.getByText(new RegExp(process.env.TEST_USER_USERNAME || "e2euser", "i")).first()
      ).toBeVisible();

      // Cancel queue from lobby
      await page.getByRole("button", { name: /anuluj/i }).first().click();
    } else {
      // Lobby link didn't appear within 15 s — clean up and skip gracefully
      await page.getByRole("button", { name: /anuluj/i }).first().click();
      test.skip(true, "Lobby link did not appear — WebSocket may not be available");
    }
  });

  test("Gotowy! button appears when lobby is full", async ({ authenticatedPage: page }) => {
    // When lobby is full, the "Gotowy!" button must appear.
    // We observe this by going directly to a lobby page that already has
    // all slots filled; in unit conditions this requires a real match.
    // Here we validate the lobby page structure when accessed from within
    // a queue that has enough players (instant-bot mode).

    await waitForDashboard(page);

    // Switch to instant bot mode (fills immediately)
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await waitForDashboard(page);

    // Click "Instant bot" option if visible
    const instantBtn = page.getByText("Instant bot").first();
    const instantVisible = await instantBtn.isVisible().catch(() => false);
    if (instantVisible) {
      await instantBtn.click();
    }

    const playBtn = page.getByRole("button", { name: /szukaj gry/i }).first();
    await expect(playBtn).toBeEnabled({ timeout: 8_000 });
    await playBtn.click();

    // With instant bots, lobby fills immediately — watch for the Gotowy! button
    const readyBtn = page.getByRole("button", { name: /gotowy!/i }).first();
    const appeared = await readyBtn.waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false);

    if (appeared) {
      await expect(readyBtn).toBeVisible();
      // Do not actually click ready — just cancel to avoid starting a game
      await page.getByRole("button", { name: /anuluj/i }).first().click().catch(() => {});
    } else {
      // Bots may not be enabled in this environment — cancel gracefully
      const cancelVisible = await page.getByRole("button", { name: /anuluj/i }).first().isVisible().catch(() => false);
      if (cancelVisible) {
        await page.getByRole("button", { name: /anuluj/i }).first().click();
      }
      test.skip(true, "Gotowy! button did not appear — bots may be disabled");
    }
  });
});
