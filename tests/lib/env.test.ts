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
      expect.arrayContaining([
        'TMDB_READ_TOKEN',
        'SUPABASE_SERVICE_ROLE_KEY',
        'OMDB_API_KEY',
        'TRAKT_CLIENT_ID',
      ]),
    );
    const e = parseEnv(vars);
    expect(e.mode.isDemo).toBe(true);
    expect(e.demo.today).toBeNull();
  });
});
