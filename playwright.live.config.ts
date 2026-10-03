import { defineConfig, devices } from '@playwright/test';

/**
 * LIVE staging smoke (C-14, FOUNDER_INPUTS F6): e2e-live/ against a real deploy with real keys.
 * Never part of `npm run test:e2e` (that config's testDir is ./e2e and it runs offline in demo mode).
 * Run: `npm run smoke:live -- --url https://<deploy>` (sets SMOKE_URL) or .github/workflows/smoke-live.yml.
 */
const baseURL = process.env.SMOKE_URL;
if (!baseURL) throw new Error('SMOKE_URL is not set: run `npm run smoke:live -- --url https://<deploy>`.');

export default defineConfig({
  testDir: './e2e-live',
  outputDir: 'test-results-live',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-live' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
});
