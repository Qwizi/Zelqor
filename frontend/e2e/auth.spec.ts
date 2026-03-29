import { clearAuthState, expect, fillLoginForm, TEST_USER, test, waitForDashboard } from "./fixtures";

// ---------------------------------------------------------------------------
// Auth flow — login, register, logout, redirect guard
// ---------------------------------------------------------------------------

test.describe("Auth — login page", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
    await page.goto("/login");
  });

  test("login page loads with form fields", async ({ page }) => {
    // Title / heading
    await expect(page.getByText("Zaloguj się")).toBeVisible();

    // Identifier + password fields
    await expect(page.getByLabel("Login lub email")).toBeVisible();
    await expect(page.getByLabel("Hasło")).toBeVisible();

    // Submit button
    await expect(page.getByRole("button", { name: /wejdź do gry/i })).toBeVisible();

    // Link to register
    await expect(page.getByRole("link", { name: /zarejestruj się/i })).toBeVisible();
  });

  test("shows validation errors when form is submitted empty", async ({ page }) => {
    // Wait for form view (no saved profiles)
    await page.getByRole("button", { name: /wejdź do gry/i }).click();

    // Zod / RHF inline errors
    await expect(page.getByText("Nazwa użytkownika lub email jest wymagana")).toBeVisible();
    await expect(page.getByText("Hasło jest wymagane")).toBeVisible();
  });

  test("shows error for wrong credentials", async ({ page }) => {
    await page.getByLabel("Login lub email").fill("nobody@zelqor.gg");
    await page.getByLabel("Hasło").fill("wrongpassword");
    await page.getByRole("button", { name: /wejdź do gry/i }).click();

    await expect(page.getByText(/nieprawidłowy login lub hasło/i)).toBeVisible({ timeout: 10_000 });
  });

  test("successful login redirects to /dashboard", async ({ page }) => {
    await fillLoginForm(page, TEST_USER.email, TEST_USER.password);
    await waitForDashboard(page);

    await expect(page).toHaveURL(/\/dashboard/);
    // Greeting with the test user's username
    await expect(page.getByText(new RegExp(`Hej, ${TEST_USER.username}`, "i"))).toBeVisible();
  });
});

test.describe("Auth — register page", () => {
  test.beforeEach(async ({ page }) => {
    await clearAuthState(page);
    await page.goto("/register");
  });

  test("register page loads with all form fields", async ({ page }) => {
    // Title
    await expect(page.getByText("Nowe konto")).toBeVisible();
    await expect(page.getByText("Utwórz profil i zacznij walkę")).toBeVisible();

    // Fields
    await expect(page.getByLabel("Nazwa użytkownika")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Hasło")).toBeVisible();
    await expect(page.getByLabel("Powtórz hasło")).toBeVisible();

    // Submit
    await expect(page.getByRole("button", { name: /utwórz konto/i })).toBeVisible();

    // Back to login link
    await expect(page.getByRole("link", { name: /zaloguj się/i })).toBeVisible();
  });

  test("shows validation errors when register form is submitted empty", async ({ page }) => {
    await page.getByRole("button", { name: /utwórz konto/i }).click();

    // At minimum expect the username or email error
    await expect(page.getByText(/musi miec co najmniej 3 znaki/i)).toBeVisible();
    await expect(page.getByText(/email jest wymagany/i)).toBeVisible();
  });

  test("shows password strength indicator when typing", async ({ page }) => {
    const passwordInput = page.getByLabel("Hasło");
    await passwordInput.fill("short");
    // Strength bar should appear (at least one coloured div)
    await expect(page.locator(".bg-red-500, .bg-amber-500, .bg-green-500").first()).toBeVisible();
  });
});

test.describe("Auth — logout", () => {
  test("logout clears tokens and redirects to /login", async ({ authenticatedPage: page }) => {
    // Should already be on /dashboard from the fixture
    await expect(page).toHaveURL(/\/dashboard/);

    // Open the profile popover in the sidebar
    await page.getByText(TEST_USER.username).first().click();

    // Click logout
    await page.getByRole("button", { name: /wyloguj/i }).click();

    // Should end up on /login
    await page.waitForURL(/\/login/, { timeout: 10_000 });

    // Tokens should be gone from localStorage
    const accessToken = await page.evaluate(() => localStorage.getItem("zelqor_access"));
    expect(accessToken).toBeNull();
  });
});

test.describe("Auth — redirect guard", () => {
  test("unauthenticated user is redirected to /login from /dashboard", async ({ page }) => {
    await clearAuthState(page);
    await page.goto("/dashboard");

    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated user is redirected to /login from /inventory", async ({ page }) => {
    await clearAuthState(page);
    await page.goto("/inventory");

    await page.waitForURL(/\/login/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("authenticated user on /login is redirected to /dashboard", async ({ authenticatedPage: page }) => {
    await page.goto("/login");
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
