import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3210);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    // Google Chrome channel: Playwright's bundled Chromium has no H.264 decoder.
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    {
      name: "mobile",
      use: { ...devices["iPhone 14"], browserName: "chromium", channel: "chrome" },
      grep: /@mobile/,
    },
  ],
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: { MOCK_AI: "1", DEMO_MODE: "0", NEXT_PUBLIC_E2E: "1", NEXT_DIST_DIR: ".next-e2e", MOCK_DELAY_MS: "800" },
  },
});
