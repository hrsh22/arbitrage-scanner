import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function captureEvidence() {
  const evidenceDir = path.join(__dirname, "../../.sisyphus/evidence");

  // Ensure evidence directory exists
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  try {
    console.log("Navigating to vault page...");
    await page.goto("http://localhost:3000/vault/1", { timeout: 30000 });

    // Wait for the page to load
    await page.waitForTimeout(3000);

    // Take screenshot of Request tab (default)
    console.log("Capturing request form...");
    await page.screenshot({
      path: path.join(evidenceDir, "task-14-request-pending.png"),
      fullPage: false,
    });

    // Try to click on Pending tab to see pending requests
    try {
      const pendingTab = await page.locator('button:has-text("Pending")').first();
      if (await pendingTab.isVisible().catch(() => false)) {
        await pendingTab.click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: path.join(evidenceDir, "task-14-request-pending.png"),
          fullPage: false,
        });
        console.log("Captured pending requests view");
      }
    } catch (e) {
      console.log("Could not navigate to Pending tab:", e.message);
    }

    // Try to click on Claim tab to see disabled claim state
    try {
      const claimTab = await page.locator('button:has-text("Claim")').first();
      if (await claimTab.isVisible().catch(() => false)) {
        await claimTab.click();
        await page.waitForTimeout(1000);

        await page.screenshot({
          path: path.join(evidenceDir, "task-14-claim-disabled.png"),
          fullPage: false,
        });
        console.log("Captured claim view (disabled state)");
      }
    } catch (e) {
      console.log("Could not navigate to Claim tab:", e.message);
    }

    console.log("Screenshots captured successfully!");
  } catch (error) {
    console.error("Error capturing screenshots:", error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

captureEvidence();
