import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '@/server/env';

describe('env / mode resolution (ADR-006)', () => {
  it('zero env vars → full demo mode', () => {
    const e = parseEnv({});
    expect(e.mode).toMatchObject({
      catalog: 'fixtures',
      data: 'local',
      isDemo: true,
      images: 'tmdb',
    });
    expect(e.demo.sessionSecret.length).toBeGreaterThan(16);
    expect(e.curation.minRating).toBe(6.5);
    expect(e.mode.demoAccounts.length).toBeGreaterThan(0);
  });
  it('keys present → live mode automatically', () => {
    const e = parseEnv({
      TMDB_READ_TOKEN: 't',
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k',
    });
    expect(e.mode).toMatchObject({ catalog: 'tmdb', data: 'supabase', isDemo: false });
    expect(e.mode.demoAccounts).toEqual([]);
  });
  it('partial Supabase config fails fast', () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' })).toThrow(EnvError);
  });
  it('explicit CATALOG_MODE=tmdb without a key fails fast', () => {
    expect(() => parseEnv({ CATALOG_MODE: 'tmdb' })).toThrow(EnvError);
  });
  it('OMDb and the enrich step are job-only config', () => {
    expect(parseEnv({}).omdb).toBeNull();
    expect(parseEnv({ OMDB_API_KEY: 'k' }).omdb).toEqual({
      apiKey: 'k',
      dailyBudget: 900,
      hotTtlDays: 7,
      ttlDays: 30,
      hotCount: 1000,
    });
    // A paid key just raises the budget (ADR-008 §3).
    expect(parseEnv({ OMDB_API_KEY: 'k', OMDB_DAILY_BUDGET: '20000' }).omdb?.dailyBudget).toBe(
      20000,
    );
    // OMDb never changes the app mode (the request path does not call it).
    expect(parseEnv({ OMDB_API_KEY: 'k' }).mode.isDemo).toBe(true);
    expect(parseEnv({}).sync).toEqual({
      guardMin: { movie: 3000, tv: 1000 },
      guardMax: 25000,
      guardMaxDelta: 0.2,
      enrichMax: 3000,
      enrichTtlDays: 30,
      certificationRegion: 'US',
    });
  });
  it('sync guard minimums are per type (GAP-03); the legacy SYNC_GUARD_MIN still applies to both', () => {
    expect(
      parseEnv({ SYNC_GUARD_MIN_MOVIE: '4000', SYNC_GUARD_MIN_TV: '800' }).sync.guardMin,
    ).toEqual({ movie: 4000, tv: 800 });
    expect(parseEnv({ SYNC_GUARD_MIN: '2000' }).sync.guardMin).toEqual({ movie: 2000, tv: 2000 });
    expect(parseEnv({ SYNC_GUARD_MIN: '2000', SYNC_GUARD_MIN_TV: '500' }).sync.guardMin).toEqual({
      movie: 2000,
      tv: 500,
    });
    expect(() => parseEnv({ SYNC_GUARD_MIN_TV: 'lots' })).toThrow(/SYNC_GUARD_MIN_TV must be/);
    expect(() => parseEnv({ SYNC_GUARD_MIN: '-1' })).toThrow(EnvError);
  });
  it('production demo mode needs DEMO_MODE_PUBLIC=true (GAP-04)', () => {
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/DEMO_MODE_PUBLIC=true/);
    // Half-live is still demo: the message names what is missing.
    expect(() => parseEnv({ NODE_ENV: 'production', TMDB_READ_TOKEN: 't' })).toThrow(
      /Set NEXT_PUBLIC_SUPABASE_URL/,
    );
    // `next build` runs with NODE_ENV=production; only the running server is gated.
    expect(
      parseEnv({ NODE_ENV: 'production', NEXT_PHASE: 'phase-production-build' }).mode.isDemo,
    ).toBe(true);
    const pub = parseEnv({ NODE_ENV: 'production', DEMO_MODE_PUBLIC: 'true' });
    expect(pub.demo).toMatchObject({ public: true, devLinks: 'seeded' });
    expect(pub.mode.demoResets).toBe(true);
    // E2E needs dev links for fresh accounts.
    expect(
      parseEnv({ NODE_ENV: 'production', DEMO_MODE_PUBLIC: 'true', DEMO_DEV_LINKS: 'any' }).demo
        .devLinks,
    ).toBe('any');
    // Live production needs no flag; dev keeps every dev link and durable local data.
    expect(
      parseEnv({
        NODE_ENV: 'production',
        TMDB_READ_TOKEN: 't',
        NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k',
      }).mode,
    ).toMatchObject({ isDemo: false, demoResets: false });
    const dev = parseEnv({ NODE_ENV: 'development' });
    expect(dev.demo).toMatchObject({ public: false, devLinks: 'any' });
    expect(dev.mode.demoResets).toBe(false);
    expect(parseEnv({ DEMO_RESET_ON_BOOT: 'true' }).mode.demoResets).toBe(true);
  });
  it('reads curation overrides', () => {
    const e = parseEnv({
      CATALOG_MIN_RATING: '7',
      CATALOG_MIN_VOTES_MOVIE: '500',
      CATALOG_EXCLUDE_TV_GENRES: '',
    });
    expect(e.curation).toMatchObject({
      minRating: 7,
      minVotesMovie: 500,
      keepRating: 7,
      excludeTvGenreIds: [],
    });
  });
});

describe('.env.example', () => {
  it('copied verbatim still boots in demo mode', async () => {
    const { readFileSync } = await import('node:fs');
    const vars: Record<string, string> = {};
    for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) vars[m[1]!] = m[2]!;
    }
    expect(Object.keys(vars)).toEqual(
      expect.arrayContaining(['TMDB_READ_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'OMDB_API_KEY']),
    );
    // ADR-008: no third-party posting → no Trakt / sync-token / feature-flag variables at all.
    expect(Object.keys(vars).filter((k) => /TRAKT|SYNC_TOKEN|FEATURE_/.test(k))).toEqual([]);
    // D15: no AI/LLM provider configuration anywhere.
    expect(
      Object.keys(vars).filter((k) => /OPENAI|ANTHROPIC|GEMINI|MISTRAL|LLM|_AI_|^AI_/.test(k)),
    ).toEqual([]);
    const e = parseEnv(vars);
    expect(e.mode.isDemo).toBe(true);
    expect(e.demo.today).toBeNull();
    expect(e.omdb).toBeNull();
  });
});
