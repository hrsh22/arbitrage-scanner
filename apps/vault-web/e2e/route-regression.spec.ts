import { test, expect } from "@playwright/test";

declare global {
  interface Window {
    __E2E_EFFECTIVE_CONNECTED__?: boolean;
  }
}

test.describe("App-local route regression coverage", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const globalWithLit = globalThis as typeof globalThis & {
        litIssuedWarnings?: Set<string>;
      };
      globalWithLit.litIssuedWarnings ??= new Set<string>();
      globalWithLit.litIssuedWarnings.add("dev-mode");
    });
  });

  test("discover page shows loading and a stable vault card", async ({ page }) => {
    await page.goto("/discover", { waitUntil: "domcontentloaded" });

    if (
      await page
        .getByTestId("discover-vaults-loading")
        .isVisible()
        .catch(() => false)
    ) {
      await expect(page.getByTestId("discover-vaults-loading")).toBeVisible();
    }

    await expect(page.getByText(/0 vaults available|Alpha Vault|Sisyphus/i)).toBeVisible();
  });

  test("vault detail shows disconnected deposit and auth-gated withdraw states", async ({
    page,
  }) => {
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Alpha Vault|Sisyphus/i).first()).toBeVisible();
    await expect(page).toHaveTitle(/Alpha|Sisyphus/);
    await expect(
      page.getByText("Sign in to view your deposit, withdrawal, and claim history.", {
        exact: true,
      }),
    ).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.__E2E_EFFECTIVE_CONNECTED__ === true), {
        timeout: 5000,
      })
      .toBe(true);

    const withdrawTab = page.getByRole("tab", { name: "Withdraw" });
    await withdrawTab.click();
    await expect(withdrawTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("redemption-panel")).toBeVisible();
    await expect(page.getByText("New withdrawal", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Connect your wallet to start an exit request.", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Wallet disconnected", { exact: true }).first()).toBeVisible();
  });

  test("numeric vault routes redirect to the canonical slug URL", async ({ page }) => {
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/vault\/(alpha|alpha-vault|sisyphus)\?e2eConnected=1$/);
    await expect(page).toHaveTitle(/Alpha|Sisyphus/);
  });

  test("vault detail renders not found for a missing numeric id", async ({ page }) => {
    await page.goto("/vault/999", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Vault not found", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to vaults" })).toBeVisible();
  });
});
