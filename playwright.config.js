import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // GitHub's Linux runners have 4 vCPUs; Playwright's default is half that.
  workers: process.env.CI ? 4 : undefined,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:4173/' },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
