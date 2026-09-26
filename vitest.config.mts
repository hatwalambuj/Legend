import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only` throws outside a React Server environment; tests import server modules directly.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    // Default to node; component tests opt in with `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    testTimeout: 20_000,
    env: {
      // Unit tests always run in demo mode with an isolated, throwaway JSON store.
      CATALOG_MODE: 'fixtures',
      DATA_MODE: 'local',
      DEMO_PERSIST: 'memory',
    },
  },
});
