/** M1-03/09/10 env additions: TRUSTED_PROXY (ADR-001 §A3), HEALTH_MAX_SYNC_AGE_HOURS, SYNC_RECHECK_MAX. */
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/server/env';

const LIVE = {
  NODE_ENV: 'production',
  TMDB_READ_TOKEN: 't',
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k',
};

describe('TRUSTED_PROXY', () => {
  it('fails boot in live production when unset and no platform is detected', () => {
    expect(() => parseEnv(LIVE)).toThrow(/Set TRUSTED_PROXY \(see ADR-001 §A3\)/);
    // `next build` is not the running server.
    expect(parseEnv({ ...LIVE, NEXT_PHASE: 'phase-production-build' }).trustedProxy).toBe('none');
  });
  it('auto-detects Vercel and Netlify, and an explicit value wins', () => {
    expect(parseEnv({ ...LIVE, VERCEL: '1' }).trustedProxy).toBe('vercel');
    expect(parseEnv({ ...LIVE, NETLIFY: 'true' }).trustedProxy).toBe('netlify');
    expect(parseEnv({ ...LIVE, VERCEL: '1', TRUSTED_PROXY: 'cloudflare' }).trustedProxy).toBe(
      'cloudflare',
    );
    expect(parseEnv({ ...LIVE, TRUSTED_PROXY: 'XFF-2' }).trustedProxy).toBe('xff-2');
  });
  it('defaults to none in demo, dev and test; rejects unknown values', () => {
    expect(parseEnv({}).trustedProxy).toBe('none');
    expect(parseEnv({ NODE_ENV: 'production', DEMO_MODE_PUBLIC: 'true' }).trustedProxy).toBe(
      'none',
    );
    expect(() => parseEnv({ TRUSTED_PROXY: 'xff-9' })).toThrow(/TRUSTED_PROXY/);
    expect(() => parseEnv({ TRUSTED_PROXY: 'any' })).toThrow(/TRUSTED_PROXY/);
  });
});

describe('ops numbers', () => {
  it('health max sync age (36 h) and recheck cap (500) with overrides', () => {
    const d = parseEnv({});
    expect(d.health.maxSyncAgeHours).toBe(36);
    expect(d.sync.recheckMax).toBe(500);
    const o = parseEnv({ HEALTH_MAX_SYNC_AGE_HOURS: '48', SYNC_RECHECK_MAX: '1200' });
    expect(o.health.maxSyncAgeHours).toBe(48);
    expect(o.sync.recheckMax).toBe(1200);
    expect(() => parseEnv({ SYNC_RECHECK_MAX: 'lots' })).toThrow(/SYNC_RECHECK_MAX/);
  });
});
