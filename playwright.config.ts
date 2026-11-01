import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;

// E2E runs against the real Worker (`wrangler dev`) serving the built PWA + API with local D1.
// Build the web app first: `pnpm build` (CI does this before running E2E).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 800 } },
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        defaultBrowserType: 'chromium',
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @kharcha/api db:migrate:local && pnpm --filter @kharcha/api exec wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { CI: '1' },
  },
});
