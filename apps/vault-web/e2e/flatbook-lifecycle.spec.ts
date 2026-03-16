import { test, expect, Page, Route } from "@playwright/test";

// Unauthenticated scenario: test reachable lifecycle UI with real API endpoints
test.describe("Flatbook Lifecycle – unauthenticated", () => {
  const mockEndpoints = async (
    page: Page,
    mode: string,
    telemetryFresh = true,
    batchState = "open",
    liquidityMode = "vault_liquid",
  ) => {
    await page.route("**/api/vaults/1/cycles/current", (route: Route) => {
      const payload: any = {
        cycle: {
          cycleId: 1,
          batchState,
          riskState: null,
          executionMode: mode,
          telemetryFresh,
          liquidityMode: liquidityMode,
        },
        canSettle: true,
        timeRemainingFormatted: "2h",
      };
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    });

    await page.route("**/api/vaults/1/deposit-queue", (route: Route) => {
      const payload = {
        queued: 0,
        queuedFormatted: "0",
        queuedShares: 0,
        queuedSharesFormatted: "0",
        cycleOpenNavEstimate: null,
        cycleOpenNavFormatted: null,
        estimateBasis: null,
        queueStatus: null,
        batchState: null,
      };
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });
    });
  };

  test("instant mode: cycle status visible (unauthenticated)", async ({ page }) => {
    await mockEndpoints(page, "instant", true, "open");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.getByText("Cycle status", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Current cycle", { exact: true }).first()).toBeVisible();
  });

  test("queued mode: cycle locked label visible (unauthenticated)", async ({ page }) => {
    await mockEndpoints(page, "queued", true, "cutoff");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.getByText("Queued", { exact: true }).first()).toBeVisible();
  });

  test("stale telemetry unauthenticated: stale banner visible", async ({ page }) => {
    await mockEndpoints(page, "instant", false, "open");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.locator('[data-testid="lifecycle-stale-banner"]')).toBeVisible();
  });

  test("withdraw CTAs render disabled in unauthenticated view", async ({ page }) => {
    await mockEndpoints(page, "instant", true, "open");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    const withdrawButton = page.locator('button:has-text("Withdraw instantly")').first();
    await expect(withdrawButton).toBeVisible();
    await expect(withdrawButton).toBeDisabled();
  });

  test("instant mode: Deposit and Withdraw instantly CTAs visible", async ({ page }) => {
    await mockEndpoints(page, "instant", true, "open");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.locator('button:has-text("Deposit")')).toBeVisible();
    await expect(page.locator('button:has-text("Withdraw instantly")')).toBeVisible();
  });

  test("risk-on queued mode: Join Next Cycle and Request Withdrawal CTAs visible", async ({
    page,
  }) => {
    await mockEndpoints(page, "queued", true, "open");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.locator('button:has-text("Join Next Cycle")')).toBeVisible();
    await expect(page.locator('button:has-text("Request Withdrawal")')).toBeVisible();
  });

  test("stale/blocked mode: stale banner and blocked CTAs", async ({ page }) => {
    await mockEndpoints(page, "blocked", false, "blocked");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.locator('[data-testid="lifecycle-stale-banner"]')).toBeVisible();
    const depBlocked = page.locator('button:has-text("Deposit blocked")');
    const withBlocked = page.locator('button:has-text("Withdrawal blocked")');
    await expect(depBlocked).toBeVisible();
    await expect(depBlocked).toBeDisabled();
    await expect(withBlocked).toBeVisible();
    await expect(withBlocked).toBeDisabled();
  });

  test("recall-preflight mode: Preflight withdrawal visible", async ({ page }) => {
    await mockEndpoints(page, "instant", true, "open", "recall_required");
    const cycleResponse = page.waitForResponse((response) =>
      response.url().includes("/api/vaults/1/cycles/current"),
    );
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });
    await cycleResponse;
    await expect(page.locator('button:has-text("Preflight withdrawal")')).toBeVisible();
  });
});
test("recall preflight timeout with e2eConnected seam", async ({ page }) => {
  await page.route("**/api/vaults/1/cycles/current", (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        cycle: {
          cycleId: 1,
          batchState: "open",
          riskState: null,
          executionMode: "instant",
          telemetryFresh: true,
          liquidityMode: "recall_required",
        },
        canSettle: true,
        timeRemainingFormatted: "2h",
      }),
    });
  });

  await page.route("**/api/vaults/1/deposit-queue", (route: Route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queued: 0,
        queuedFormatted: "0",
        queuedShares: 0,
        queuedSharesFormatted: "0",
        cycleOpenNavEstimate: null,
        cycleOpenNavFormatted: null,
        estimateBasis: null,
        queueStatus: null,
        batchState: null,
      }),
    });
  });

  await page.route("**/api/vault/withdrawal-request", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        requestId: "wr1",
        status: "pending",
        message: "queued",
      }),
    });
  });

  await page.route("**/api/vault/withdrawal-queue**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ requests: [], total: 0 }),
    });
  });

  let preflightCount = 0;
  await page.route("**/api/vault/withdrawal-request/*/preflight", (route) => {
    preflightCount += 1;
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ready: false, attempts: preflightCount }),
    });
  });

  await page.goto("/vault/1?e2eConnected=1&e2ePreflightTimeout=1", {
    waitUntil: "domcontentloaded",
  });

  const withdrawCard = page.locator('div:has-text("Withdraw")').first();
  const withdrawInput = withdrawCard.locator('input[type="number"]').first();
  await withdrawInput.fill("1");
  await withdrawCard.locator('button:has-text("Preflight withdrawal")').click();

  await expect
    .poll(
      () =>
        page.evaluate(() => ((window as any).__E2E_PREFLIGHT_TIMEOUT_TRIGGERED__ === true ? 1 : 0)),
      { timeout: 5000 },
    )
    .toBe(1);
  await expect(page.getByText("Preflight timeout (e2e)", { exact: true })).toHaveCount(1);
  await expect(page.locator("text=Wallet Confirmation")).toHaveCount(0);
  await expect(page.locator("text=Launch Transaction")).toHaveCount(0);
});
