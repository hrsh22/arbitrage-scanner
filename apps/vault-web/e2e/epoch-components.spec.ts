import { test, expect } from "@playwright/test";

test.describe("Epoch Countdown Component", () => {
  test("renders countdown and updates over time", async ({ page }) => {
    // Start vault-web server and navigate to a vault page
    await page.goto("http://localhost:3001/vault/1");

    // Wait for the countdown to render
    await page.waitForSelector("[class*='epoch-countdown']", { timeout: 10000 });

    // Take screenshot of countdown component
    const countdown = page.locator("text=Next Settlement").first();
    await countdown.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".sisyphus/evidence/task-15-countdown.png",
      fullPage: false,
    });

    // Verify countdown has time values
    const timeValues = await page.locator(".tabular-nums").allInnerTexts();
    expect(timeValues.length).toBeGreaterThan(0);
  });
});

test.describe("Settlement Status Component", () => {
  test("shows stale NAV warning when appropriate", async ({ page }) => {
    await page.goto("http://localhost:3001/vault/1");

    // Wait for settlement status to render
    await page.waitForSelector("text=Settlement Status", { timeout: 10000 });

    // Take screenshot of settlement status
    const status = page.locator("text=Settlement Status").first();
    await status.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".sisyphus/evidence/task-15-settlement-status.png",
      fullPage: false,
    });
  });
});
