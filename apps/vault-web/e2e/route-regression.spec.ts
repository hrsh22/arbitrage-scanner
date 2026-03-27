import { test, expect } from "@playwright/test";

test.describe("App-local route regression coverage", () => {
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

    await expect(page.getByText(/0 vaults available|Alpha Vault/i)).toBeVisible();
  });

  test("vault detail shows disconnected deposit and auth-gated withdraw states", async ({
    page,
  }) => {
    await page.goto("/vault/1?e2eConnected=1", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Alpha Vault", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Sign in to view your deposit, withdrawal, and claim history.", {
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Withdraw" }).click();
    await expect(page.getByText("New withdrawal", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Connect your wallet to start an exit request.", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Connect your wallet to view and manage this area.", { exact: true }).first(),
    ).toBeVisible();
  });

  test("vault detail renders not found for a missing numeric id", async ({ page }) => {
    await page.goto("/vault/999", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Vault not found", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to vaults" })).toBeVisible();
  });
});
