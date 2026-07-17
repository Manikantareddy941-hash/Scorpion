import { defineConfig, devices } from '@playwright/test';

/**
 * E2E smoke suite for the unauthenticated surface. Runs against a production
 * build served by `vite preview` (started automatically). Authenticated flows
 * need a live backend + Appwrite + Redis and are intentionally out of scope
 * here — these tests guard the public routes against silent UI breakage.
 *
 * SSO button test needs VITE_SSO_ENABLED=true at build time:
 *   VITE_SSO_ENABLED=true npm run build && npm run test:e2e
 */
// basic-ssl serves preview over HTTPS with a self-signed cert (ignored below).
const PORT = 4173;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // The app dev server uses basic-ssl; preview serves plain http on PORT.
    ignoreHTTPSErrors: true,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run preview -- --port ${PORT}`,
    url: BASE_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
