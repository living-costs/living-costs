import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  use: { baseURL: 'http://localhost:4173/' },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
  },
  reporter: 'list',
});
