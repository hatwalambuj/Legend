import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the production build in demo mode (zero env vars, zero network).
 * Chromium comes from /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH). Never run `playwright install`.
 * @playwright/test is pinned to 1.56.1 because that release matches the pre-installed chromium-1194.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      // 375 px touch phone (PRD A1-AC3): Pixel 7 emulation (isMobile, hasTouch) at a 375 px viewport.
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
      },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // The net guard (QA) records every outbound socket/DNS lookup of the *running* server, so
        // e2e/platform.spec.ts can prove demo mode makes zero outbound requests. Build runs without it.
        command: `npm run build && NODE_OPTIONS="--require ./e2e/support/net-guard.cjs" npx next start -p ${PORT}`,
        url: `${baseURL}/api/health`,
        timeout: 240_000,
        // Never silently attach to a server we didn't start: agents run the suite concurrently, and a
        // foreign server on this port (other tree, no net guard, killed/restarted by its owner) caused the
        // platform.spec.ts:57 "socket hang up" flake. A busy port now fails fast; pick another with
        // E2E_PORT, or opt in with E2E_REUSE_SERVER=1 (docs/08-clearpath/QA_VERIFICATION.md §Flake root cause).
        reuseExistingServer: process.env.E2E_REUSE_SERVER === '1',
        env: {
          // Force demo mode even if a developer has keys in .env.local.
          CATALOG_MODE: 'fixtures',
          DATA_MODE: 'local',
          // `next start` is a production server: demo mode needs the explicit opt-in (GAP-04), and the
          // auth specs need magic-link dev links for freshly created accounts (never set this publicly).
          DEMO_MODE_PUBLIC: 'true',
          DEMO_DEV_LINKS: 'any',
          // Container cannot reach image.tmdb.org; render generated posters so the console stays clean.
          IMAGE_MODE: 'off',
          DEMO_DATA_DIR: '.data/e2e',
          DEMO_RESET_ON_BOOT: 'true',
          DEMO_TODAY: '2026-09-26',
          E2E_NET_LOG: '.data/e2e-net.jsonl',
        },
      },
});
