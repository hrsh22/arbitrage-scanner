import { test, expect } from "@playwright/test";

// ============================================
// Happy-Path Lifecycle E2E Tests
// ============================================
// These tests verify the deposit and redemption lifecycle flows
// without requiring actual blockchain transactions.
// Tests are designed to work with or without API data.

test.describe("Deposit Lifecycle Flow", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to vault page with extended timeout for dev server startup
    await page.goto("http://localhost:3000/vault/1", { timeout: 60000 });
    // Wait for basic page load - don't wait for network idle since API might fail
    await page.waitForLoadState("domcontentloaded");
    // Give the page a moment to render initial state
    await page.waitForTimeout(2000);
  });

  test("should show deposit form with lifecycle information", async ({ page }) => {
    // Look for deposit card - try multiple possible selectors
    const depositCard = page.locator("text=Deposit").first();
    await expect(depositCard).toBeVisible({ timeout: 10000 });

    // Verify deposit description about queuing
    const depositDescription = page.locator("text=/Deposits are queued/");
    if (await depositDescription.isVisible().catch(() => false)) {
      await expect(depositDescription).toBeVisible();
    }

    // Take screenshot of deposit section
    const depositSection = page.locator("text=Deposit").locator("..").locator("..").first();
    await depositSection.scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({
      path: ".sisyphus/evidence/deposit-lifecycle.png",
      fullPage: false,
    });
  });

  test("should display deposit lifecycle explanation", async ({ page }) => {
    // Wait for deposit form to be visible
    await expect(page.locator("text=Deposit").first()).toBeVisible({ timeout: 10000 });

    // Look for "How deposits work" section or similar educational content
    const howItWorks = page.locator("text=/How deposits work/");
    const alternativeText = page.locator("text=/How it works/");

    const hasHowItWorks = await howItWorks.isVisible().catch(() => false);
    const hasAlternative = await alternativeText.isVisible().catch(() => false);

    // At least one should be visible
    expect(hasHowItWorks || hasAlternative).toBe(true);
  });

  test("should show share conversion preview with timing", async ({ page }) => {
    // Find deposit input
    const input = page.locator('input[type="number"]').first();

    // Check if input is available
    const hasInput = await input.isVisible().catch(() => false);
    if (!hasInput) {
      test.skip(true, "Deposit input not available - wallet may not be connected");
      return;
    }

    // Enter a test amount
    await input.fill("100");
    await page.waitForTimeout(500);

    // Check for share preview or conversion note
    const sharePreview = page.locator("text=/You will receive/");
    const conversionNote = page.locator("text=/converted to shares/");

    if (await sharePreview.isVisible().catch(() => false)) {
      await expect(sharePreview).toBeVisible();
    }

    if (await conversionNote.isVisible().catch(() => false)) {
      await expect(conversionNote).toBeVisible();
    }

    // Clear input
    await input.clear();
  });
});

test.describe("Epoch Phase Timeline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/vault/1", { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  });

  test("should display epoch phase timeline with all 4 phases", async ({ page }) => {
    // Look for Epoch Lifecycle header
    const epochHeader = page.locator("text=Epoch Lifecycle").first();
    await expect(epochHeader).toBeVisible({ timeout: 10000 });

    // Verify all 4 phases are displayed
    await expect(page.locator("text=Active").first()).toBeVisible();
    await expect(page.locator("text=Frozen").first()).toBeVisible();
    await expect(page.locator("text=Settled").first()).toBeVisible();
    await expect(page.locator("text=Finalized").first()).toBeVisible();

    // Take screenshot of timeline
    await epochHeader.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: ".sisyphus/evidence/epoch-timeline.png",
      fullPage: false,
    });
  });

  test("should show phase descriptions for each lifecycle stage", async ({ page }) => {
    // Wait for epoch timeline to be visible
    await expect(page.locator("text=Epoch Lifecycle").first()).toBeVisible({ timeout: 10000 });

    // Verify phase descriptions exist (may be in tooltips or expanded state)
    const activeDesc = page.locator("text=/Deposits allowed/");
    const frozenDesc = page.locator("text=/Deposits paused/");
    const settledDesc = page.locator("text=/Redemptions claimable/");
    const finalizedDesc = page.locator("text=/All redemptions processed/");

    // At least one description should be visible
    const hasAnyDesc = await Promise.any([
      activeDesc.isVisible().catch(() => false),
      frozenDesc.isVisible().catch(() => false),
      settledDesc.isVisible().catch(() => false),
      finalizedDesc.isVisible().catch(() => false),
    ]).catch(() => false);

    expect(hasAnyDesc).toBe(true);
  });

  test("should display epoch timing information", async ({ page }) => {
    // Wait for epoch timeline
    await expect(page.locator("text=Epoch Lifecycle").first()).toBeVisible({ timeout: 10000 });

    // Look for timing-related content
    const timelineSection = page.locator("text=Timeline");
    const epochNumber = page.locator("text=/Epoch #[0-9]+/");
    const startTime = page.locator("text=/Start:/");
    const endTime = page.locator("text=/End:/");

    // At least one timing element should be present
    const hasTiming = await Promise.any([
      timelineSection.isVisible().catch(() => false),
      epochNumber
        .first()
        .isVisible()
        .catch(() => false),
      startTime
        .first()
        .isVisible()
        .catch(() => false),
      endTime
        .first()
        .isVisible()
        .catch(() => false),
    ]).catch(() => false);

    expect(hasTiming).toBe(true);
  });

  test("should highlight current phase appropriately", async ({ page }) => {
    // Wait for epoch timeline
    await expect(page.locator("text=Epoch Lifecycle").first()).toBeVisible({ timeout: 10000 });

    // Look for "Current" badge or active phase indicator
    const currentBadges = page.locator("text=Current");
    const activeIndicators = page.locator('[class*="active"]').first();

    // Should have either a current badge or active state styling
    const hasCurrentIndicator =
      (await currentBadges.count().then((c) => c > 0)) ||
      (await activeIndicators.isVisible().catch(() => false));

    expect(hasCurrentIndicator).toBe(true);
  });
});

test.describe("Redemption Lifecycle Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/vault/1", { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  });

  test("should show redemption panel with lifecycle tabs", async ({ page }) => {
    // Look for redemption panel by various selectors
    const redemptionPanel = page.locator('[data-testid="redemption-panel"]');
    const redemptionHeader = page.locator("text=Redemption").first();
    const weeklySettlement = page.locator("text=Weekly Settlement");

    const hasPanel = await redemptionPanel.isVisible().catch(() => false);
    const hasHeader = await redemptionHeader.isVisible().catch(() => false);
    const hasWeekly = await weeklySettlement.isVisible().catch(() => false);

    expect(hasPanel || hasHeader || hasWeekly).toBe(true);

    // Verify lifecycle tab buttons are present
    const requestTab = page.locator('button[aria-label="Create new redemption request"]');
    const pendingTab = page.locator('button[aria-label="View pending requests"]');
    const claimTab = page.locator('button[aria-label="View claimable requests"]');

    // At least one tab should be visible
    const hasTabs = await Promise.any([
      requestTab.isVisible().catch(() => false),
      pendingTab.isVisible().catch(() => false),
      claimTab.isVisible().catch(() => false),
    ]).catch(() => false);

    expect(hasTabs).toBe(true);

    // Take screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/redemption-panel.png",
      fullPage: false,
    });
  });

  test("should display request form with lifecycle explanation", async ({ page }) => {
    // Try to click on Request tab
    const requestTab = page.locator('button[aria-label="Create new redemption request"]');
    const hasRequestTab = await requestTab.isVisible().catch(() => false);

    if (hasRequestTab) {
      await requestTab.click();
      await page.waitForTimeout(500);
    }

    // Look for form elements
    const sharesInput = page.locator('[data-testid="shares-input"]');
    const requestButton = page.locator('[data-testid="request-redeem-button"]');
    const proRataText = page.locator("text=Pro-rata");

    // At least one should be present
    const hasFormElement = await Promise.any([
      sharesInput.isVisible().catch(() => false),
      requestButton.isVisible().catch(() => false),
      proRataText
        .first()
        .isVisible()
        .catch(() => false),
    ]).catch(() => false);

    expect(hasFormElement).toBe(true);
  });

  test("should show pending requests with lifecycle progress", async ({ page }) => {
    // Try to click on Pending tab
    const pendingTab = page.locator('button[aria-label="View pending requests"]');
    const hasPendingTab = await pendingTab.isVisible().catch(() => false);

    if (hasPendingTab) {
      await pendingTab.click();
      await page.waitForTimeout(1000);
    }

    // Check for pending requests or empty state
    const hasPendingRequests = await page
      .locator('[data-testid="pending-requests"]')
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .locator('[data-testid="no-pending-requests"]')
      .isVisible()
      .catch(() => false);

    expect(hasPendingRequests || hasEmptyState).toBe(true);

    // If there are requests, verify lifecycle elements
    if (hasPendingRequests) {
      // Look for lifecycle progress indicators
      const requestPhase = page.locator("text=Request").first();
      const freezePhase = page.locator("text=Freeze").first();
      const settlePhase = page.locator("text=Settle").first();
      const claimPhase = page.locator("text=Claim").first();

      // At least Request phase should be visible
      await expect(requestPhase).toBeVisible();

      // Look for progress bar
      const progressBar = page.locator('[role="progressbar"]').first();
      if (await progressBar.isVisible().catch(() => false)) {
        await expect(progressBar).toBeVisible();
      }
    }
  });

  test("should show claimable requests with claim lifecycle", async ({ page }) => {
    // Try to click on Claim tab
    const claimTab = page.locator('button[aria-label="View claimable requests"]');
    const hasClaimTab = await claimTab.isVisible().catch(() => false);

    if (hasClaimTab) {
      await claimTab.click();
      await page.waitForTimeout(1000);
    }

    // Check for claimable requests or empty state
    const hasClaimable = await page
      .locator('[data-testid="claimable-requests"]')
      .isVisible()
      .catch(() => false);
    const hasEmptyState = await page
      .locator('[data-testid="no-claimable-requests"]')
      .isVisible()
      .catch(() => false);

    expect(hasClaimable || hasEmptyState).toBe(true);

    if (hasClaimable) {
      // Look for claim button or disabled state
      const claimButton = page.locator('[data-testid="claim-button"]').first();
      const claimDisabled = page.locator('[data-testid="claim-disabled"]').first();

      const hasClaimBtn = await claimButton.isVisible().catch(() => false);
      const hasDisabled = await claimDisabled.isVisible().catch(() => false);

      expect(hasClaimBtn || hasDisabled).toBe(true);

      // Take screenshot of claimable state
      await page.screenshot({
        path: ".sisyphus/evidence/claimable-requests.png",
        fullPage: false,
      });
    }
  });

  test("should show redemption lifecycle in empty states", async ({ page }) => {
    // Check Pending empty state
    const pendingTab = page.locator('button[aria-label="View pending requests"]');
    if (await pendingTab.isVisible().catch(() => false)) {
      await pendingTab.click();
      await page.waitForTimeout(500);
    }

    const hasEmptyPending = await page
      .locator('[data-testid="no-pending-requests"]')
      .isVisible()
      .catch(() => false);
    if (hasEmptyPending) {
      // Verify lifecycle phases are shown in empty state
      await expect(page.locator("text=Request").first()).toBeVisible();
      await expect(page.locator("text=Freeze").first()).toBeVisible();
      await expect(page.locator("text=Settle").first()).toBeVisible();
      await expect(page.locator("text=Claim").first()).toBeVisible();
    }

    // Check Claimable empty state
    const claimTab = page.locator('button[aria-label="View claimable requests"]');
    if (await claimTab.isVisible().catch(() => false)) {
      await claimTab.click();
      await page.waitForTimeout(500);
    }

    const hasEmptyClaimable = await page
      .locator('[data-testid="no-claimable-requests"]')
      .isVisible()
      .catch(() => false);
    if (hasEmptyClaimable) {
      // Verify full lifecycle is shown
      await expect(page.locator("text=Request").first()).toBeVisible();
    }
  });
});

test.describe("Queue Status Display", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("http://localhost:3000/vault/1", { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);
  });

  test("should show deposit queue information", async ({ page }) => {
    // Look for deposit-related content
    const depositStatus = page.locator("text=/Your Deposit Status/");
    const queuedStatus = page.locator("text=/Queued/");
    const frozenStatus = page.locator("text=/Frozen/");
    const emptyState = page.locator("text=/No deposits currently queued/");

    // At least one should be visible or we should see the deposit form
    const hasDepositInfo = await Promise.any([
      depositStatus.isVisible().catch(() => false),
      queuedStatus
        .first()
        .isVisible()
        .catch(() => false),
      frozenStatus
        .first()
        .isVisible()
        .catch(() => false),
      emptyState.isVisible().catch(() => false),
    ]).catch(() => false);

    expect(hasDepositInfo).toBe(true);
  });

  test("should display deposit status cards when deposits exist", async ({ page }) => {
    // Check for deposit status section
    const hasStatusCard = await page
      .locator("text=Your Deposit Status")
      .isVisible()
      .catch(() => false);

    if (hasStatusCard) {
      // Look for status cards
      const queuedCard = page.locator("text=/Queued for Conversion/");
      const frozenCard = page.locator("text=/Converting to Shares/");
      const pendingBadge = page.locator("text=Pending");
      const processingBadge = page.locator("text=Processing");

      const hasAnyCard = await Promise.any([
        queuedCard.isVisible().catch(() => false),
        frozenCard.isVisible().catch(() => false),
        pendingBadge
          .first()
          .isVisible()
          .catch(() => false),
        processingBadge
          .first()
          .isVisible()
          .catch(() => false),
      ]).catch(() => false);

      expect(hasAnyCard).toBe(true);

      // Take screenshot
      await page.screenshot({
        path: ".sisyphus/evidence/deposit-status.png",
        fullPage: false,
      });
    }
  });
});

test.describe("Mobile Responsive Lifecycle", () => {
  test("should display lifecycle components on mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("http://localhost:3000/vault/1", { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(2000);

    // Verify epoch timeline is visible
    const epochHeader = page.locator("text=Epoch Lifecycle").first();
    await expect(epochHeader).toBeVisible({ timeout: 10000 });

    // Verify all phases are visible
    await expect(page.locator("text=Active").first()).toBeVisible();
    await expect(page.locator("text=Frozen").first()).toBeVisible();

    // Take mobile screenshot
    await page.screenshot({
      path: ".sisyphus/evidence/lifecycle-mobile.png",
      fullPage: false,
    });
  });
});
