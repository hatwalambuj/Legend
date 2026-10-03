import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  BASELINE_MIGRATIONS,
  checkEnv,
  checkLogo,
  checkMigrations,
  exitCode,
  formatReport,
  mergeDotenv,
  PLACEHOLDER_LOGO_MARKER,
  probeLive,
  redact,
  type CheckResult,
} from './launch-check';

const LIVE: Record<string, string> = {
  TMDB_READ_TOKEN: 'tmdb-token-secret-value-123',
  OMDB_API_KEY: 'omdb-key-secret-456',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-public-789',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret-000',
  REVALIDATE_SECRET: 'r'.repeat(64),
  NEXT_PUBLIC_SITE_URL: 'https://stubbed.app',
  NEXT_PUBLIC_CONTACT_EMAIL: 'hello@stubbed.app',
  SUPABASE_DB_URL: 'postgres://postgres:dbpass-secret@db.abc.supabase.co:5432/postgres',
  VERCEL: '1',
};

const byId = (r: CheckResult[], id: string) => r.find((x) => x.id === id);
const allText = (r: CheckResult[]) => formatReport(r, 'h');

describe('checkEnv', () => {
  it('passes a complete live config and boots in live mode', () => {
    const r = checkEnv(LIVE);
    expect(r.filter((x) => x.status === 'fail')).toEqual([]);
    expect(byId(r, 'boot')?.status).toBe('pass');
    expect(exitCode(r)).toBe(0);
  });

  it('names every missing variable with a fix, and never prints a value', () => {
    const r = checkEnv({});
    const failed = r.filter((x) => x.status === 'fail').map((x) => x.id);
    expect(failed).toEqual(
      expect.arrayContaining([
        'TMDB_READ_TOKEN',
        'NEXT_PUBLIC_SUPABASE_URL',
        'NEXT_PUBLIC_SUPABASE_ANON_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'REVALIDATE_SECRET',
        'NEXT_PUBLIC_SITE_URL',
        'NEXT_PUBLIC_CONTACT_EMAIL',
        'OMDB_API_KEY',
      ]),
    );
    expect(byId(r, 'boot')?.status).toBe('skip');
    expect(exitCode(r)).toBe(1);
    for (const x of r.filter((y) => y.status === 'fail')) expect(x.fix).toBeTruthy();
  });

  it('never echoes secret values, even for bad ones', () => {
    const env = { ...LIVE, REVALIDATE_SECRET: 'short-secret', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' };
    const text = allText(checkEnv(env));
    for (const v of Object.values(env)) if (v.length > 3) expect(text).not.toContain(v);
  });

  it('F9: fails on the placeholder or an invalid contact email', () => {
    for (const v of ['contact@example.com', 'not-an-email', ''])
      expect(byId(checkEnv({ ...LIVE, NEXT_PUBLIC_CONTACT_EMAIL: v }), 'NEXT_PUBLIC_CONTACT_EMAIL')?.status).toBe(
        'fail',
      );
  });

  it('accepts TMDB_API_KEY and the publishable key name as alternatives', () => {
    const { TMDB_READ_TOKEN: _t, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, ...rest } = LIVE;
    const r = checkEnv({ ...rest, TMDB_API_KEY: 'v3', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anon });
    expect(r.filter((x) => x.status === 'fail')).toEqual([]);
  });

  it('fails on demo / E2E switches and names them', () => {
    const r = checkEnv({ ...LIVE, DEMO_MODE_PUBLIC: 'true', IMAGE_MODE: 'off', DEMO_DEV_LINKS: 'any' });
    const x = byId(r, 'demo-switches')!;
    expect(x.status).toBe('fail');
    expect(x.fix).toMatch(/DEMO_MODE_PUBLIC.*DEMO_DEV_LINKS.*IMAGE_MODE/);
  });

  it('fails when a secret sits in a NEXT_PUBLIC_ variable or service = anon', () => {
    expect(
      byId(checkEnv({ ...LIVE, NEXT_PUBLIC_SENTRY_DSN: LIVE.SUPABASE_SERVICE_ROLE_KEY! }), 'secret-leaks')
        ?.status,
    ).toBe('fail');
    const same = checkEnv({ ...LIVE, SUPABASE_SERVICE_ROLE_KEY: LIVE.NEXT_PUBLIC_SUPABASE_ANON_KEY! });
    expect(byId(same, 'secret-leaks')?.fix).toMatch(/service_role key is used as the anon key/);
    expect(allText(same)).not.toContain(LIVE.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  });

  it('warns (not fails) on unset TRUSTED_PROXY off Vercel and on missing SUPABASE_DB_URL', () => {
    const { VERCEL: _v, SUPABASE_DB_URL: _d, ...rest } = LIVE;
    const r = checkEnv(rest);
    expect(byId(r, 'TRUSTED_PROXY')?.status).toBe('warn');
    expect(byId(r, 'SUPABASE_DB_URL')?.status).toBe('warn');
    expect(exitCode(r)).toBe(0);
  });

  it('reports a production boot error, redacted', () => {
    const r = checkEnv({ ...LIVE, WATCH_REGIONS: 'US,ZZ' });
    expect(byId(r, 'boot')?.status).toBe('fail');
    expect(byId(r, 'boot')?.fix).toMatch(/WATCH_REGIONS/);
  });
});

describe('redact / mergeDotenv', () => {
  it('redacts secret values and URL passwords', () => {
    const out = redact(`x ${LIVE.TMDB_READ_TOKEN} postgres://u:pw@h/db`, LIVE);
    expect(out).not.toContain(LIVE.TMDB_READ_TOKEN);
    expect(out).not.toContain(':pw@');
  });

  it('never overrides the real environment', () => {
    const target: Record<string, string | undefined> = { A: 'real' };
    expect(mergeDotenv('A=file\nB="two"\n# c\n', target)).toEqual(['B']);
    expect(target).toEqual({ A: 'real', B: 'two' });
  });
});

describe('checkLogo (F1)', () => {
  it('fails on the placeholder in the repo today', () => {
    const svg = readFileSync(join(process.cwd(), 'public/tmdb-logo.svg'), 'utf8');
    expect(svg).toContain(PLACEHOLDER_LOGO_MARKER);
    expect(checkLogo(svg).status).toBe('fail');
  });
  it('fails when missing, passes for a file without the marker', () => {
    expect(checkLogo(null).status).toBe('fail');
    expect(checkLogo('<svg><path d="M0 0"/></svg>').status).toBe('pass');
  });
});

describe('checkMigrations', () => {
  it('passes the real supabase/migrations directory', () => {
    const r = checkMigrations(readdirSync(join(process.cwd(), 'supabase/migrations')));
    expect(byId(r, 'migrations')?.status).toBe('pass');
  });
  it('fails on bad names, duplicate timestamps and missing baseline files', () => {
    const base = [...BASELINE_MIGRATIONS];
    expect(byId(checkMigrations([...base, 'oops.sql']), 'migrations')?.fix).toMatch(/badly named/);
    expect(
      byId(checkMigrations([...base, '20260928120000_again.sql']), 'migrations')?.fix,
    ).toMatch(/duplicate/);
    expect(byId(checkMigrations(base.slice(1)), 'migrations')?.fix).toMatch(/missing baseline/);
    expect(byId(checkMigrations([...base, 'README.md']), 'migrations')?.status).toBe('pass');
  });
});

describe('probeLive (mocked fetch, no network)', () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  function fakeFetch(over: Partial<Record<string, () => Response>> = {}) {
    return vi.fn(async (url: string) => {
      const u = new URL(url);
      const key = `${u.host}${u.pathname}`;
      for (const [k, f] of Object.entries(over)) if (key.includes(k)) return f!();
      if (key.endsWith('/3/configuration')) return json({ images: {} });
      if (key.includes('/3/movie/')) return json({ id: 693134, 'watch/providers': { results: { US: {} } } });
      if (u.host === 'www.omdbapi.com') return json({ Response: 'True' });
      if (key.endsWith('/auth/v1/settings'))
        return json({ external: { email: true }, disable_signup: false, mailer_autoconfirm: true });
      if (key.endsWith('/rest/v1/rpc/health_probe')) return json(true);
      if (key.endsWith('/api/health')) return json({ ok: true, status: 'ok' });
      return json({}, 404);
    });
  }

  it('passes when every service answers as expected', async () => {
    const f = fakeFetch();
    const r = await probeLive(LIVE, f);
    expect(r.filter((x) => x.status === 'fail')).toEqual([]);
    expect(byId(r, 'live-tmdb-watch')?.status).toBe('pass');
    expect(byId(r, 'live-supabase-urls')?.status).toBe('manual');
  });

  it('fails on Confirm email ON, a missing watch/providers key and unapplied migrations', async () => {
    const r = await probeLive(
      LIVE,
      fakeFetch({
        '/auth/v1/settings': () =>
          json({ external: { email: true }, disable_signup: false, mailer_autoconfirm: false }),
        '/3/movie/': () => json({ id: 1 }),
        '/rest/v1/rpc/health_probe': () => json({ message: 'nope' }, 404),
      }),
    );
    expect(byId(r, 'live-supabase-auth')?.fix).toMatch(/Confirm email OFF/);
    expect(byId(r, 'live-tmdb-watch')?.status).toBe('fail');
    expect(byId(r, 'live-supabase-db')?.fix).toMatch(/db:apply/);
  });

  it('turns network errors into a redacted failure', async () => {
    const r = await probeLive(LIVE, async () => {
      throw Object.assign(new TypeError(`fetch failed ${LIVE.OMDB_API_KEY}`), {
        cause: { code: 'ENOTFOUND' },
      });
    });
    expect(byId(r, 'live-omdb')?.fix).toMatch(/ENOTFOUND/);
    expect(allText(r)).not.toContain(LIVE.OMDB_API_KEY);
  });

  it('skips services without keys', async () => {
    const f = fakeFetch();
    const r = await probeLive({}, f);
    expect(r.every((x) => x.status === 'skip')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});
