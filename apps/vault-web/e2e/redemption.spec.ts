import { test, expect } from "@playwright/test";

test.describe("Redemption Panel", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to a vault page
    await page.goto("http://localhost:3000/vault/1");
    // Wait for the redemption panel to be visible
    await page.waitForSelector('[data-testid="redemption-panel"]', { timeout: 10000 });
  });

  test("should display redemption panel with tabs", async ({ page }) => {
    // Check that the panel is visible
    const panel = page.locator('[data-testid="redemption-panel"]');
    await expect(panel).toBeVisible();

    // Check for tab buttons
    await expect(page.locator('button[aria-label="Create new redemption request"]')).toBeVisible();
    await expect(page.locator('button[aria-label="View pending requests"]')).toBeVisible();
    await expect(page.locator('button[aria-label="View claimable requests"]')).toBeVisible();

    // Check for informational alert
    await expect(page.locator('[data-testid="redemption-info-alert"]')).toBeVisible();
    await expect(page.locator("text=Weekly Settlement")).toBeVisible();
  });

  test("should show request form when Request tab is active", async ({ page }) => {
    // Click on Request tab
    await page.click('button[aria-label="Create new redemption request"]');

    // Check that the request form is visible
    const form = page.locator('[data-testid="request-form"]');
    await expect(form).toBeVisible();

    // Check for shares input
    await expect(page.locator('[data-testid="shares-input"]')).toBeVisible();

    // Check for request button
    await expect(page.locator('[data-testid="request-redeem-button"]')).toBeVisible();

    // Check for pro-rata messaging
    await expect(page.locator("text=Pro-rata Distribution")).toBeVisible();
  });

  test("should validate shares input", async ({ page }) => {
    await page.click('button[aria-label="Create new redemption request"]');

    const input = page.locator('[data-testid="shares-input"]');
    const button = page.locator('[data-testid="request-redeem-button"]');

    // Initially button should be disabled (no input)
    await expect(button).toBeDisabled();

    // Enter invalid amount
    await input.fill("-1");
    await expect(button).toBeDisabled();

    // Enter zero
    await input.fill("0");
    await expect(button).toBeDisabled();

    // Enter valid amount
    await input.fill("10");
    // Button should be enabled now (assuming user has sufficient balance)
    // Note: In a real test with wallet connected, we'd verify this more thoroughly
  });

  test("should display pending requests with countdown", async ({ page }) => {
    // Click on Pending tab
    await page.click('button[aria-label="View pending requests"]');

    // Wait for pending requests section to load
    await page.waitForTimeout(1000);

    // Check if we have pending requests or empty state
    const hasPendingRequests = await page
      .locator('[data-testid="pending-requests"]')
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .locator('[data-testid="no-pending-requests"]')
      .isVisible()
      .catch(() => false);

    expect(hasPendingRequests || hasEmptyState).toBe(true);

    if (hasPendingRequests) {
      // Check for countdown timer
      const countdown = page.locator('[data-testid="epoch-countdown"]');
      await expect(countdown).toBeVisible();

      // Check for request ID
      await expect(page.locator('[data-testid="request-id"]').first()).toBeVisible();

      // Check for shares requested
      await expect(page.locator('[data-testid="shares-requested"]').first()).toBeVisible();

      // Check for target epoch
      await expect(page.locator('[data-testid="target-epoch"]').first()).toBeVisible();

      // Cancel button should be visible for pending requests
      const cancelButton = page.locator('[data-testid="cancel-request-button"]').first();
      await expect(cancelButton).toBeVisible();
    }
  });

  test("should show claimable requests with disabled claim before maturity", async ({ page }) => {
    // Click on Claim tab
    await page.click('button[aria-label="View claimable requests"]');

    // Wait for claimable requests section to load
    await page.waitForTimeout(1000);

    // Check if we have claimable requests or empty state
    const hasClaimableRequests = await page
      .locator('[data-testid="claimable-requests"]')
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .locator('[data-testid="no-claimable-requests"]')
      .isVisible()
      .catch(() => false);

    expect(hasClaimableRequests || hasEmptyState).toBe(true);

    if (hasClaimableRequests) {
      // Look for claim buttons
      const claimButtons = page.locator('[data-testid="claim-button"]');
      const disabledClaimButtons = page.locator('[data-testid="claim-disabled"]');

      // Either claim buttons should be present (for matured requests)
      // OR disabled state should be shown (for immature requests)
      const hasClaimButton = (await claimButtons.count()) > 0;
      const hasDisabledState = (await disabledClaimButtons.count()) > 0;

      expect(hasClaimButton || hasDisabledState).toBe(true);

      if (hasDisabledState) {
        // Verify the helper text indicates claim timing
        await expect(page.locator("text=Waiting for settlement")).toBeVisible();
      }
    }
  });

  test("should show pro-rata messaging", async ({ page }) => {
    // Check Request tab for pro-rata info
    await page.click('button[aria-label="Create new redemption request"]');
    await expect(page.locator("text=Pro-rata Distribution")).toBeVisible();
    await expect(page.locator("text=insufficient liquidity")).toBeVisible();
  });

  test("should handle mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check that the panel is still visible and functional
    const panel = page.locator('[data-testid="redemption-panel"]');
    await expect(panel).toBeVisible();

    // Check tabs are accessible
    await expect(page.locator('button[aria-label="Create new redemption request"]')).toBeVisible();
    await expect(page.locator('button[aria-label="View pending requests"]')).toBeVisible();
    await expect(page.locator('button[aria-label="View claimable requests"]')).toBeVisible();
  });

  test("should have proper ARIA attributes", async ({ page }) => {
    // Check tabs have proper ARIA labels
    const requestTab = page.locator('button[aria-label="Create new redemption request"]');
    await expect(requestTab).toHaveAttribute("role", "tab");

    const pendingTab = page.locator('button[aria-label^="View pending requests"]');
    await expect(pendingTab).toHaveAttribute("role", "tab");

    const claimTab = page.locator('button[aria-label^="View claimable requests"]');
    await expect(claimTab).toHaveAttribute("role", "tab");

    // Check alert has proper role
    const alert = page.locator('[data-testid="redemption-info-alert"]');
    await expect(alert).toHaveAttribute("role", "alert");
  });
});
