import { defineConfig, devices } from "@playwright/test";

const runFullSuite = process.env.PLAYWRIGHT_FULL_SUITE === "1";

export default defineConfig({
  testDir: "./e2e",
  testMatch: runFullSuite ? /.*\.spec\.ts/ : /route-regression\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: runFullSuite && !process.env.CI ? undefined : 1,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: "pnpm dev:e2e",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
