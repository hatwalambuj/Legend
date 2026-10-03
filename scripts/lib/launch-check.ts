/**
 * Launch readiness checks (C-14, FOUNDER_INPUTS F1 F2 F4 F9). Pure functions + injected `fetch`, so the
 * unit tests run with zero network. CLI: scripts/launch-check.ts (`npm run launch:check [-- --live]`).
 *
 * Rules
 * - Never print a value. Results name variables only; any text that could echo config (boot errors,
 *   probe errors) goes through `redact()` first.
 * - Offline checks: every live-mode env var, forbidden demo/E2E switches, key leaks into NEXT_PUBLIC_*,
 *   the production boot (`parseEnv`), the placeholder TMDB logo, the placeholder contact email and the
 *   migration files (count, naming, order).
 * - `--live` probes: TMDB (+ `watch/providers` append), OMDb, Supabase Auth settings (email on, sign-up
 *   on, Confirm email OFF), the `health_probe` RPC (migrations applied) and the deployed /api/health.
 */
import { parseEnv as parseDotenv } from 'node:util';
import { CONTACT_EMAIL_PLACEHOLDER, resolveContactEmail } from '../../src/lib/contact';
import { parseEnv as parseServerEnv } from '../../src/server/env';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'manual' | 'skip';

export interface CheckResult {
  id: string;
  status: CheckStatus;
  /** What was checked, in plain English. Never contains a value. */
  title: string;
  /** What to do about it (fail / warn / manual). */
  fix?: string;
}

type Env = Record<string, string | undefined>;

/** Comment the placeholder `public/tmdb-logo.svg` carries; the official file never has it. */
export const PLACEHOLDER_LOGO_MARKER = 'STUBBED-PLACEHOLDER-LOGO';

/** supabase/migrations/ at the time of the close-out (2026-10-03). New files may be added after these. */
export const BASELINE_MIGRATIONS = [
  '20260926000000_init.sql',
  '20260926120000_user_data_reads.sql',
  '20260926180000_review_hardening.sql',
  '20260927000000_ops_health.sql',
  '20260928120000_where_to_watch.sql',
] as const;

/** Variables whose values are secrets: never printed, and redacted from any message we pass through. */
export const SECRET_VARS = [
  'TMDB_READ_TOKEN',
  'TMDB_API_KEY',
  'OMDB_API_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REVALIDATE_SECRET',
  'SUPABASE_DB_URL',
  'BACKUP_PASSPHRASE',
  'DEMO_SESSION_SECRET',
  'SENTRY_DSN',
] as const;

/** Probe title: Dune: Part Two (in the demo fixtures; popular, so TMDB has providers for it). */
export const PROBE_MOVIE_ID = 693134;

const val = (env: Env, k: string) => {
  const v = env[k]?.trim();
  return v ? v : undefined;
};
const truthy = (v: string | undefined) => v === 'true' || v === '1';

/** Replaces every secret value (and any URL password) in `text` with `***`. */
export function redact(text: string, env: Env): string {
  let out = text.replace(/(\/\/[^:/\s]+:)[^@/\s]+@/g, '$1***@');
  for (const k of SECRET_VARS) {
    const v = val(env, k);
    if (v && v.length >= 4) out = out.split(v).join('***');
  }
  return out;
}

/**
 * Reads `.env`-style text into `target` without overriding variables that are already set (the real
 * environment wins, like `next` and `node --env-file`). Returns the names it added.
 */
export function mergeDotenv(text: string, target: Env): string[] {
  const added: string[] = [];
  for (const [k, v] of Object.entries(parseDotenv(text))) {
    if (target[k] === undefined) {
      target[k] = v;
      added.push(k);
    }
  }
  return added;
}

function isHttpsPublic(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(u.hostname) &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

/** Every env check that needs no network. */
export function checkEnv(env: Env): CheckResult[] {
  const r: CheckResult[] = [];
  const need = (id: string, ok: boolean, title: string, fix: string) =>
    r.push(ok ? { id, status: 'pass', title } : { id, status: 'fail', title, fix });

  need(
    'TMDB_READ_TOKEN',
    Boolean(val(env, 'TMDB_READ_TOKEN') || val(env, 'TMDB_API_KEY')),
    'TMDB_READ_TOKEN (or TMDB_API_KEY) is set',
    'themoviedb.org → Settings → API → copy the "API Read Access Token" into TMDB_READ_TOKEN (README "Going live" §1).',
  );
  const sbUrl = val(env, 'NEXT_PUBLIC_SUPABASE_URL');
  need(
    'NEXT_PUBLIC_SUPABASE_URL',
    isHttpsPublic(sbUrl),
    'NEXT_PUBLIC_SUPABASE_URL is set to an https:// URL',
    sbUrl
      ? 'NEXT_PUBLIC_SUPABASE_URL must be the https:// Project URL from Supabase → Project Settings → API.'
      : 'Supabase → Project Settings → API → copy the Project URL into NEXT_PUBLIC_SUPABASE_URL (§3).',
  );
  const anon =
    val(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? val(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  need(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    Boolean(anon),
    'NEXT_PUBLIC_SUPABASE_ANON_KEY (or _PUBLISHABLE_KEY) is set',
    'Supabase → Project Settings → API → copy the anon / publishable key into NEXT_PUBLIC_SUPABASE_ANON_KEY (§3).',
  );
  const service = val(env, 'SUPABASE_SERVICE_ROLE_KEY');
  need(
    'SUPABASE_SERVICE_ROLE_KEY',
    Boolean(service),
    'SUPABASE_SERVICE_ROLE_KEY is set (export, detail cache, account deletion)',
    'Supabase → Project Settings → API → copy the service_role key into SUPABASE_SERVICE_ROLE_KEY. Server only (§3).',
  );
  const rs = val(env, 'REVALIDATE_SECRET');
  need(
    'REVALIDATE_SECRET',
    Boolean(rs && rs.length >= 32),
    'REVALIDATE_SECRET is set (32+ characters)',
    rs
      ? 'REVALIDATE_SECRET is too short: use `openssl rand -hex 32`, same value in Vercel and GitHub (§4).'
      : 'Set REVALIDATE_SECRET to the output of `openssl rand -hex 32`, same value in Vercel and GitHub (§4).',
  );
  need(
    'NEXT_PUBLIC_SITE_URL',
    isHttpsPublic(val(env, 'NEXT_PUBLIC_SITE_URL')),
    'NEXT_PUBLIC_SITE_URL is your public https:// domain',
    'Set NEXT_PUBLIC_SITE_URL to your domain, e.g. https://stubbed.app (not localhost), in Vercel and as a GitHub variable (§4).',
  );
  const contact = val(env, 'NEXT_PUBLIC_CONTACT_EMAIL');
  need(
    'NEXT_PUBLIC_CONTACT_EMAIL',
    Boolean(contact) && resolveContactEmail(contact) !== CONTACT_EMAIL_PLACEHOLDER,
    'NEXT_PUBLIC_CONTACT_EMAIL is a real inbox (not the placeholder)',
    contact
      ? `NEXT_PUBLIC_CONTACT_EMAIL is not a valid address or is still ${CONTACT_EMAIL_PLACEHOLDER}: set the inbox you read (F9).`
      : 'Set NEXT_PUBLIC_CONTACT_EMAIL to the inbox that receives Contact and review reports (F9).',
  );
  need(
    'OMDB_API_KEY',
    Boolean(val(env, 'OMDB_API_KEY')),
    'OMDB_API_KEY is set (GitHub secret for the nightly IMDb step)',
    'Get a free key at omdbapi.com/apikey.aspx, click the activation link, add it as the GitHub secret OMDB_API_KEY (§2).',
  );

  // Optional but worth knowing.
  if (val(env, 'TRUSTED_PROXY') || truthy(val(env, 'VERCEL')))
    r.push({ id: 'TRUSTED_PROXY', status: 'pass', title: 'Proxy trust is configured' });
  else
    r.push({
      id: 'TRUSTED_PROXY',
      status: 'warn',
      title: 'TRUSTED_PROXY is unset (fine on Vercel: auto-detected)',
      fix: 'Only off Vercel: set TRUSTED_PROXY (netlify | cloudflare | xff-1..xff-5 | none), or the server refuses to boot.',
    });
  if (!val(env, 'SUPABASE_DB_URL'))
    r.push({
      id: 'SUPABASE_DB_URL',
      status: 'warn',
      title: 'SUPABASE_DB_URL is unset here (needed by db:apply and backups, as a GitHub secret)',
      fix: 'Supabase → Connect → Session pooler connection string → GitHub secret SUPABASE_DB_URL.',
    });

  // Switches that must never be on for the real site.
  const forbidden: [string, boolean, string][] = [
    ['DEMO_MODE_PUBLIC', truthy(val(env, 'DEMO_MODE_PUBLIC')), 'turns on a public DEMO'],
    ['DEMO_DEV_LINKS', Boolean(val(env, 'DEMO_DEV_LINKS')), 'is for E2E only'],
    ['DEMO_RESET_ON_BOOT', truthy(val(env, 'DEMO_RESET_ON_BOOT')), 'wipes demo data at boot'],
    ['DEMO_TODAY', Boolean(val(env, 'DEMO_TODAY')), 'freezes the clock'],
    ['IMAGE_MODE', val(env, 'IMAGE_MODE') === 'off', '=off hides real posters'],
    [
      'CATALOG_MODE',
      val(env, 'CATALOG_MODE') === 'fixtures',
      '=fixtures forces the demo catalogue',
    ],
    ['DATA_MODE', val(env, 'DATA_MODE') === 'local', '=local forces the demo store'],
  ];
  const bad = forbidden.filter(([, on]) => on);
  r.push(
    bad.length
      ? {
          id: 'demo-switches',
          status: 'fail',
          title: 'No demo / E2E switches are set',
          fix: `Remove ${bad.map(([k, , why]) => `${k} (${why})`).join(', ')} from the live environment.`,
        }
      : { id: 'demo-switches', status: 'pass', title: 'No demo / E2E switches are set' },
  );

  // Secrets must not sit in a browser-visible variable.
  const secrets = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'TMDB_READ_TOKEN',
    'TMDB_API_KEY',
    'OMDB_API_KEY',
    'REVALIDATE_SECRET',
  ]
    .map((k) => [k, val(env, k)] as const)
    .filter((e): e is readonly [string, string] => Boolean(e[1]));
  const leaks = Object.keys(env)
    .filter((k) => k.startsWith('NEXT_PUBLIC_'))
    .flatMap((pub) =>
      secrets.filter(([, v]) => val(env, pub) === v).map(([k]) => `${k} in ${pub}`),
    );
  if (service && anon && service === anon)
    leaks.push('the service_role key is used as the anon key');
  r.push(
    leaks.length
      ? {
          id: 'secret-leaks',
          status: 'fail',
          title: 'No secret is exposed to the browser',
          fix: `Fix now and rotate the key: ${leaks.join('; ')}.`,
        }
      : { id: 'secret-leaks', status: 'pass', title: 'No secret is exposed to the browser' },
  );

  // The real production boot, once every required value is there.
  const missing = r.filter((x) => x.status === 'fail');
  if (missing.length) {
    r.push({
      id: 'boot',
      status: 'skip',
      title: 'Production boot check (runs once the items above pass)',
    });
  } else {
    try {
      const e = parseServerEnv({
        ...env,
        NODE_ENV: 'production',
        NEXT_PHASE: undefined,
        VERCEL: env.VERCEL ?? (val(env, 'TRUSTED_PROXY') ? undefined : '1'),
      });
      r.push(
        e.mode.isDemo
          ? {
              id: 'boot',
              status: 'fail',
              title: 'A production server boots in LIVE mode',
              fix: `It resolves to demo mode (catalog=${e.mode.catalog}, data=${e.mode.data}).`,
            }
          : { id: 'boot', status: 'pass', title: 'A production server boots in LIVE mode' },
      );
    } catch (err) {
      r.push({
        id: 'boot',
        status: 'fail',
        title: 'A production server boots in LIVE mode',
        fix: redact(err instanceof Error ? err.message : String(err), env),
      });
    }
  }
  return r;
}

/** F1: the official TMDB logo replaced the placeholder. `svg` = file contents, null when missing. */
export function checkLogo(svg: string | null): CheckResult {
  const title = 'public/tmdb-logo.svg is the official TMDB logo';
  const fix =
    'Download the logo from themoviedb.org/about/logos-attribution and overwrite public/tmdb-logo.svg (F1).';
  if (svg === null || svg.trim() === '')
    return { id: 'tmdb-logo', status: 'fail', title, fix: `File missing or empty. ${fix}` };
  if (svg.includes(PLACEHOLDER_LOGO_MARKER) || /PLACEHOLDER/i.test(svg))
    return { id: 'tmdb-logo', status: 'fail', title, fix: `It is still the placeholder. ${fix}` };
  return { id: 'tmdb-logo', status: 'pass', title };
}

const MIGRATION_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** F3: supabase/migrations/ file names (`*.sql` only): naming, unique ordered timestamps, baseline. */
export function checkMigrations(files: string[]): CheckResult[] {
  const sql = files.filter((f) => f.endsWith('.sql')).sort();
  const r: CheckResult[] = [];
  const badNames = sql.filter((f) => !MIGRATION_NAME.test(f));
  const stamps = sql.map((f) => f.slice(0, 14));
  const dupes = stamps.filter((s, i) => stamps.indexOf(s) !== i);
  const missing = BASELINE_MIGRATIONS.filter((b) => !sql.includes(b));
  const title = `supabase/migrations: ${sql.length} files, named <14-digit timestamp>_<name>.sql, unique and in order`;
  const problems = [
    badNames.length ? `badly named: ${badNames.join(', ')}` : null,
    dupes.length ? `duplicate timestamps: ${[...new Set(dupes)].join(', ')}` : null,
    missing.length ? `missing baseline files: ${missing.join(', ')}` : null,
    sql.length < BASELINE_MIGRATIONS.length
      ? `expected at least ${BASELINE_MIGRATIONS.length} files`
      : null,
  ].filter((x): x is string => x !== null);
  r.push(
    problems.length
      ? { id: 'migrations', status: 'fail', title, fix: `${problems.join('; ')}.` }
      : { id: 'migrations', status: 'pass', title },
  );
  r.push({
    id: 'migrations-applied',
    status: 'manual',
    title: 'Migrations are applied to the live database',
    fix: 'Run `npm run db:apply` (dry run) then `npm run db:apply -- --yes` with SUPABASE_DB_URL, or the "Apply database migrations" workflow (F3).',
  });
  return r;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function errName(e: unknown): string {
  if (e && typeof e === 'object') {
    const cause = (e as { cause?: { code?: string } }).cause;
    if (cause?.code) return cause.code;
    const name = (e as { name?: string }).name;
    if (name) return name;
  }
  return 'error';
}

/** `--live`: probes each service whose keys are present. Never prints a value or a keyed URL. */
export async function probeLive(
  env: Env,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<CheckResult[]> {
  const r: CheckResult[] = [];
  const get = async (url: string, init: RequestInit = {}) =>
    fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const probe = async (
    id: string,
    title: string,
    run: () => Promise<Omit<CheckResult, 'id' | 'title'>>,
  ) => {
    try {
      r.push({ id, title, ...(await run()) });
    } catch (e) {
      r.push({
        id,
        title,
        status: 'fail',
        fix: redact(`Request failed (${errName(e)}). Check the value and network.`, env),
      });
    }
  };

  const token = val(env, 'TMDB_READ_TOKEN');
  const apiKey = val(env, 'TMDB_API_KEY');
  if (token || apiKey) {
    const tmdb = (path: string) =>
      get(
        `https://api.themoviedb.org/3${path}${apiKey && !token ? `${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(apiKey)}` : ''}`,
        token ? { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } } : {},
      );
    await probe('live-tmdb', 'TMDB accepts the key', async () => {
      const res = await tmdb('/configuration');
      return res.ok
        ? { status: 'pass' }
        : { status: 'fail', fix: `TMDB answered HTTP ${res.status}: copy the token again (§1).` };
    });
    await probe(
      'live-tmdb-watch',
      'TMDB detail responses include the "watch/providers" key (Where to watch)',
      async () => {
        const res = await tmdb(`/movie/${PROBE_MOVIE_ID}?append_to_response=watch/providers`);
        if (!res.ok) return { status: 'fail', fix: `TMDB answered HTTP ${res.status}.` };
        const body = (await res.json()) as Record<string, unknown>;
        return 'watch/providers' in body
          ? { status: 'pass' }
          : {
              status: 'fail',
              fix: 'The key is missing: TMDB changed the append format; see src/server/jobs/watch-map.ts.',
            };
      },
    );
  } else r.push({ id: 'live-tmdb', status: 'skip', title: 'TMDB probe (no key)' });

  const omdb = val(env, 'OMDB_API_KEY');
  if (omdb) {
    await probe('live-omdb', 'OMDb accepts the key', async () => {
      const res = await get(
        `https://www.omdbapi.com/?i=tt0111161&apikey=${encodeURIComponent(omdb)}`,
      );
      const body = (await res.json().catch(() => ({}))) as { Response?: string; Error?: string };
      if (body.Response === 'True') return { status: 'pass' };
      if (/limit/i.test(body.Error ?? ''))
        return { status: 'warn', fix: 'Daily OMDb limit reached; try again tomorrow.' };
      return {
        status: 'fail',
        fix: 'OMDb rejected the key: click the activation link in the OMDb email, then copy the key again (§2).',
      };
    });
  } else r.push({ id: 'live-omdb', status: 'skip', title: 'OMDb probe (no key)' });

  const sbUrl = val(env, 'NEXT_PUBLIC_SUPABASE_URL');
  const anon =
    val(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? val(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (sbUrl && anon && isHttpsPublic(sbUrl)) {
    const base = sbUrl.replace(/\/+$/, '');
    const headers = { apikey: anon, Authorization: `Bearer ${anon}` };
    await probe(
      'live-supabase-auth',
      'Supabase Auth: email sign-up on, Confirm email OFF',
      async () => {
        const res = await get(`${base}/auth/v1/settings`, { headers });
        if (!res.ok) return { status: 'fail', fix: `Supabase Auth answered HTTP ${res.status}.` };
        const s = (await res.json()) as {
          external?: { email?: boolean };
          disable_signup?: boolean;
          mailer_autoconfirm?: boolean;
        };
        const issues = [
          s.external?.email === false ? 'turn ON Authentication → Providers → Email' : null,
          s.disable_signup ? 'allow new sign-ups (Authentication → Sign In / Providers)' : null,
          s.mailer_autoconfirm === false
            ? 'turn Confirm email OFF (Authentication → Providers → Email)'
            : null,
        ].filter(Boolean);
        return issues.length
          ? { status: 'fail', fix: `${issues.join('; ')} (§3).` }
          : { status: 'pass' };
      },
    );
    r.push({
      id: 'live-supabase-urls',
      status: 'manual',
      title: 'Supabase Auth redirect URLs and custom SMTP (not readable with the anon key)',
      fix: 'Authentication → URL Configuration: Site URL + <domain>/auth/callback; Emails → SMTP: custom SMTP (§3, F4). Then send yourself a magic link.',
    });
    await probe(
      'live-supabase-db',
      'Supabase database answers health_probe() (migrations applied)',
      async () => {
        const res = await get(`${base}/rest/v1/rpc/health_probe`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: '{}',
        });
        if (res.ok) return { status: 'pass' };
        return {
          status: 'fail',
          fix:
            res.status === 404
              ? 'health_probe() not found: apply the migrations (`npm run db:apply -- --yes`).'
              : `Supabase REST answered HTTP ${res.status}.`,
        };
      },
    );
  } else
    r.push({ id: 'live-supabase', status: 'skip', title: 'Supabase probe (no URL / anon key)' });

  const site = val(env, 'NEXT_PUBLIC_SITE_URL');
  if (isHttpsPublic(site)) {
    await probe('live-site', 'The deployed site answers /api/health with "ok"', async () => {
      const res = await get(`${site!.replace(/\/+$/, '')}/api/health`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      if (res.ok && body.status === 'ok') return { status: 'pass' };
      if (res.ok && body.status === 'degraded')
        return { status: 'warn', fix: 'Health is "degraded": run the first catalogue sync (§6).' };
      return { status: 'fail', fix: `/api/health answered HTTP ${res.status}.` };
    });
  } else
    r.push({
      id: 'live-site',
      status: 'skip',
      title: 'Site probe (no https NEXT_PUBLIC_SITE_URL)',
    });

  return r;
}

const MARK: Record<CheckStatus, string> = {
  pass: '[ok]  ',
  fail: '[FAIL]',
  warn: '[warn]',
  manual: '[todo]',
  skip: '[skip]',
};

/** Plain-English checklist: every check, then the numbered list of things to fix. */
export function formatReport(results: CheckResult[], heading: string): string {
  const lines = [heading, ''];
  for (const x of results) lines.push(`${MARK[x.status]} ${x.title}`);
  const todo = results.filter((x) => x.status === 'fail');
  const soft = results.filter((x) => (x.status === 'warn' || x.status === 'manual') && x.fix);
  lines.push('');
  if (todo.length) {
    lines.push(`${todo.length} thing${todo.length === 1 ? '' : 's'} to fix before launch:`);
    todo.forEach((x, i) => lines.push(`  ${i + 1}. ${x.fix ?? x.title}`));
  } else lines.push('All required checks pass.');
  if (soft.length) {
    lines.push('', 'Also check:');
    for (const x of soft) lines.push(`  - ${x.fix}`);
  }
  return lines.join('\n');
}

export function exitCode(results: CheckResult[]): number {
  return results.some((x) => x.status === 'fail') ? 1 : 0;
}
