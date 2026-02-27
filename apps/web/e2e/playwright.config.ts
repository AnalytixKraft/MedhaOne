import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:1729";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  retries: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "./reports/html", open: "never" }],
  ],
  outputDir: "./reports/test-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
