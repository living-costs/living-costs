import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // GitHub's Linux runners have 4 vCPUs; Playwright's default is half that.
  workers: process.env.CI ? 4 : undefined,
  // CI runs about five times slower than a local Mac, so axe-heavy tests get more room there.
  timeout: process.env.CI ? 60_000 : 30_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:4173/' },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
