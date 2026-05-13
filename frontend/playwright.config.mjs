import { defineConfig } from '@playwright/test';

const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER !== '1';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
  },
  webServer: shouldStartWebServer
    ? {
        command: 'PORT=3000 BROWSER=none npm start',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
