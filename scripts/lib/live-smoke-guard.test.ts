/**
 * Security review SR-2: the live smoke uploads Playwright traces (`trace: 'retain-on-failure'`) in a
 * GitHub artifact, and the runner traces every APIRequestContext with its headers and query. So no
 * secret may travel through a Playwright request context in e2e-live/ (use plain `fetch` instead).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'e2e-live');
const SECRET_ENV = /TMDB_READ_TOKEN|TMDB_API_KEY|OMDB_API_KEY|SERVICE_ROLE|SUPABASE_DB_URL/;

describe('e2e-live keeps secrets out of Playwright traces (SR-2)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it('has spec files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f}: no secret-bearing request context`, () => {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src).not.toMatch(/request\.newContext\(/);
      expect(src).not.toMatch(/extraHTTPHeaders/);
      // Any secret env read must be paired with plain fetch, never page.request / request fixtures.
      if (SECRET_ENV.test(src)) expect(src).toMatch(/\bfetch\(/);
    });
  }
});
