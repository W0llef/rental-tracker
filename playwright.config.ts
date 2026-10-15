import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the production build (served by `vite preview`).
 * In this workspace a Chromium is pre-installed; set PLAYWRIGHT_CHROMIUM_PATH to use it.
 * Everywhere else (CI, your laptop) run `npx playwright install chromium` once.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'chromium-laptop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-phone',
      use: {
        ...devices['Pixel 7'],
        // Pixel 7 defaults to Chromium already; keep the same executable override.
        launchOptions: { executablePath },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
