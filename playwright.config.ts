import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for the admin panel. Playwright owns the dev-server lifecycle via
 * `webServer` (pinned port 3100), so tests are deterministic. Project convention
 * (CLAUDE.md): headed chromium.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: false },
    },
  ],
  webServer: {
    // Load the control-plane .env into the server process (Vite doesn't populate
    // process.env for server code by default); pin the port for determinism.
    command: `node --env-file=.env node_modules/@react-router/dev/bin.js dev --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
