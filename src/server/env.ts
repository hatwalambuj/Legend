/**
 * Server-side environment parsing + mode resolution (ADR-006). OWNER: Architect. FROZEN.
 *
 * - Zero env vars  → full demo mode (fixtures catalogue, local JSON store, local auth). No network.
 * - Keys present   → live providers switch on automatically (`auto`).
 * - PARTIAL config → fail fast at boot (e.g. Supabase URL without anon key), never silently demo.
 *
 * Deliberately NOT marked `server-only` so offline scripts (tsx) can import it. Never import this
 * from client components (ESLint enforces it for src/components and src/hooks).
 */
import { z } from 'zod';
import { DEFAULT_CURATION_RULE, type CurationRule } from '@/lib/curation';
import {
  DEFAULT_WATCH_REGION,
  DEFAULT_WATCH_REGIONS,
  isKnownRegion,
  normalizeRegionCode,
  regionName,
} from '@/lib/regions';
import type { AppMode } from '@/lib/types';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const num = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? Number(v) : def))
    .pipe(z.number().finite());

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  NEXT_PUBLIC_SITE_URL: optionalString,

  CATALOG_MODE: z.enum(['auto', 'fixtures', 'tmdb']).default('auto'),
  DATA_MODE: z.enum(['auto', 'local', 'supabase']).default('auto'),
  IMAGE_MODE: z.enum(['tmdb', 'off']).default('tmdb'),

  TMDB_READ_TOKEN: optionalString,
  TMDB_API_KEY: optionalString,
  /** OMDb key: used ONLY by the nightly job to cache IMDb ratings on catalog_index (ADR-008). */
  OMDB_API_KEY: optionalString,
  OMDB_DAILY_BUDGET: num(900),
  OMDB_HOT_TTL_DAYS: num(7),
  OMDB_TTL_DAYS: num(30),
  OMDB_HOT_COUNT: num(1000),

  NEXT_PUBLIC_SUPABASE_URL: optionalString,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: optionalString,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  REVALIDATE_SECRET: optionalString,

  CATALOG_MIN_RATING: num(DEFAULT_CURATION_RULE.minRating),
  CATALOG_MIN_VOTES_MOVIE: num(DEFAULT_CURATION_RULE.minVotesMovie),
  CATALOG_MIN_VOTES_TV: num(DEFAULT_CURATION_RULE.minVotesTv),
  CATALOG_KEEP_RATING: optionalString,
  CATALOG_EXCLUDE_TV_GENRES: z.string().default(DEFAULT_CURATION_RULE.excludeTvGenreIds.join(',')),

  RATE_LIMIT_STUBS_PER_MIN: num(30),
  RATE_LIMIT_REVIEWS_PER_MIN: num(10),

  DEMO_SESSION_SECRET: optionalString,
  DEMO_DATA_DIR: optionalString,
  DEMO_PERSIST: z.enum(['file', 'memory']).default('file'),
  DEMO_RESET_ON_BOOT: bool,
  /** Production opt-in for demo/local data mode (GAP-04). Without it a production server refuses to boot. */
  DEMO_MODE_PUBLIC: bool,
  /**
   * Which emails get a magic-link `devLink` in demo mode: `seeded` = only the @demo.stubbed.app accounts,
   * `any` = every email. Default: `seeded` in production (a public demo), `any` in dev/test. E2E only.
   */
  DEMO_DEV_LINKS: z
    .enum(['seeded', 'any'])
    .optional()
    .or(z.literal('').transform(() => undefined)),
  DEMO_TODAY: z.iso
    .date()
    .optional()
    .or(z.literal('').transform(() => undefined)),

  /** Legacy single floor for both types; the per-type values below win when set. */
  SYNC_GUARD_MIN: optionalString,
  SYNC_GUARD_MIN_MOVIE: optionalString,
  SYNC_GUARD_MIN_TV: optionalString,
  SYNC_GUARD_MAX: num(25000),
  SYNC_GUARD_MAX_DELTA: num(0.2),
  SYNC_ENRICH_MAX: num(3000),
  SYNC_ENRICH_TTL_DAYS: num(30),
  CERTIFICATION_REGION: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('US'),

  /** Where to watch (ADR-012 §4): max standalone watch/providers calls per night, re-check ages in days. */
  SYNC_WATCH_MAX: num(3000),
  SYNC_WATCH_TTL_DAYS: num(7),
  SYNC_WATCH_HOT_DAYS: num(1),
  /** Where to watch (ADR-012 §5): default + supported regions, optional trusted geo header name. */
  WATCH_REGION_DEFAULT: optionalString,
  WATCH_REGIONS: optionalString,
  WATCH_GEO_HEADER: optionalString,

  /** ADR-001 §A3: which proxy headers to trust for client IP and forwarded host/proto. */
  TRUSTED_PROXY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() !== '' ? v.trim().toLowerCase() : undefined))
    .pipe(
      z
        .string()
        .regex(
          /^(vercel|netlify|cloudflare|none|xff-[1-5])$/,
          'expected vercel | netlify | cloudflare | xff-1..xff-5 | none',
        )
        .optional(),
    ),
  /** /api/health turns `degraded` when the last full sync is older than this (ADR-011 §3). */
  HEALTH_MAX_SYNC_AGE_HOURS: num(36),
  /** Max previously listed titles re-checked per night; more missing aborts apply (ADR-011 §10). */
  SYNC_RECHECK_MAX: num(500),

  VERCEL: optionalString,
  NETLIFY: optionalString,
  /** Set by `next build` ('phase-production-build'): the production demo opt-in is checked at runtime only. */
  NEXT_PHASE: optionalString,
});

/** Default per-type listed-count floors for the nightly sync (GAP-03): TV is a much smaller catalogue. */
export const SYNC_GUARD_MIN_DEFAULTS = { movie: 3000, tv: 1000 } as const;

/**
 * ADR-001 §A3. `vercel`/`netlify`/`cloudflare`: that edge overwrites the client-IP header and
 * x-forwarded-host/-proto. `xff-N`: the N-th X-Forwarded-For entry from the right (N proxies we control).
 * `none`: trust no header (all clients share one per-IP key; auth limits get 20× headroom).
 */
export type TrustedProxy =
  'vercel' | 'netlify' | 'cloudflare' | 'none' | `xff-${1 | 2 | 3 | 4 | 5}`;

export interface ServerEnv {
  nodeEnv: 'development' | 'production' | 'test';
  siteUrl: string;
  mode: AppMode;
  /** ADR-001 §A3: explicit TRUSTED_PROXY, else auto-detected (VERCEL=1, NETLIFY=true), else `none`. */
  trustedProxy: TrustedProxy;
  /** GET /api/health (ADR-011 §3). */
  health: { maxSyncAgeHours: number };
  /**
   * Where to watch (ADR-012 §5). `regions` = WATCH_REGIONS (each in src/lib/regions.ts, contains
   * `defaultRegion`). `geoHeader` = lower-cased WATCH_GEO_HEADER, only honoured when `trustedProxy` is
   * not `none` (see `watchRegionConfig`).
   */
  watch: {
    defaultRegion: string;
    regions: string[];
    geoHeader: string | null;
    /** Nightly watch step (ADR-012 §4): standalone calls per night, re-check ages in days. */
    sync: { max: number; ttlDays: number; hotDays: number };
  };
  tmdb: { readToken?: string; apiKey?: string } | null;
  /**
   * OMDb (IMDb ratings) for the nightly job only — the request path never calls OMDb (ADR-008).
   * Rolling tiered refresh within `dailyBudget` calls/night (default 900 < the free tier's 1,000/day):
   * never-checked first, the `hotCount` most popular listed titles every `hotTtlDays`, the rest every
   * `ttlDays`. A paid OMDb key only needs a bigger budget / shorter TTL.
   */
  omdb: {
    apiKey: string;
    dailyBudget: number;
    hotTtlDays: number;
    ttlDays: number;
    hotCount: number;
  } | null;
  supabase: { url: string; anonKey: string; serviceRoleKey?: string } | null;
  revalidateSecret?: string;
  curation: CurationRule;
  rateLimits: { stubsPerMin: number; reviewsPerMin: number };
  demo: {
    sessionSecret: string;
    /** Directory of the JSON store, or null when DEMO_PERSIST=memory. */
    dataDir: string | null;
    resetOnBoot: boolean;
    /** Fixed "today" for deterministic demos/E2E ('YYYY-MM-DD'), else null (use the clock). */
    today: string | null;
    /** DEMO_MODE_PUBLIC=true: a production demo deploy was explicitly opted into. */
    public: boolean;
    /** Magic-link devLinks for `seeded` demo accounts only, or `any` email (dev/E2E). */
    devLinks: 'seeded' | 'any';
  };
  /** Nightly job settings (ADR-002, ADR-008). */
  sync: {
    /**
     * Guardrails: listed count per type within [guardMin[type], guardMax], delta vs last ok run <
     * guardMaxDelta. The min floor only warns on the first run (empty catalogue), see checkGuardrails.
     */
    guardMin: { movie: number; tv: number };
    guardMax: number;
    guardMaxDelta: number;
    /** Max TMDB detail calls per night for the enrich step (new rows first, then older than enrichTtlDays). */
    enrichMax: number;
    enrichTtlDays: number;
    /** Max re-checks of missing previously listed titles; `skipped > 0` aborts apply (ADR-011 §10). */
    recheckMax: number;
    /** ISO 3166-1 region for certifications ("Worth it?" line 4). Default US. */
    certificationRegion: string;
  };
}

/** Well-known demo accounts from src/fixtures/users.json (password shown in the demo pill). */
export const DEMO_PASSWORD = 'stubbed-demo';
export const DEMO_ACCOUNTS = [
  { handle: 'maya', email: 'maya@demo.stubbed.app', password: DEMO_PASSWORD },
  { handle: 'dev', email: 'dev@demo.stubbed.app', password: DEMO_PASSWORD },
  { handle: 'priya', email: 'priya@demo.stubbed.app', password: DEMO_PASSWORD },
];

/** Public, non-secret fallback so demo mode works with zero env vars. Never used in live data mode. */
export const DEMO_FALLBACK_SECRET =
  'stubbed-demo-mode-not-a-secret-change-me-if-you-deploy-demo-publicly';

export class EnvError extends Error {
  override name = 'EnvError';
}

export function parseEnv(source: Record<string, string | undefined> = process.env): ServerEnv {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvError(
      `Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    );
  }
  const e = parsed.data;

  const hasTmdb = Boolean(e.TMDB_READ_TOKEN || e.TMDB_API_KEY);
  const anonKey = e.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const hasSupabaseUrl = Boolean(e.NEXT_PUBLIC_SUPABASE_URL);
  if (hasSupabaseUrl !== Boolean(anonKey)) {
    throw new EnvError(
      'Partial Supabase config: set BOTH NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or neither (demo mode).',
    );
  }

  const catalog: AppMode['catalog'] =
    e.CATALOG_MODE === 'auto' ? (hasTmdb ? 'tmdb' : 'fixtures') : e.CATALOG_MODE;
  if (catalog === 'tmdb' && !hasTmdb) {
    throw new EnvError('CATALOG_MODE=tmdb requires TMDB_READ_TOKEN or TMDB_API_KEY.');
  }
  const data: AppMode['data'] =
    e.DATA_MODE === 'auto' ? (hasSupabaseUrl ? 'supabase' : 'local') : e.DATA_MODE;
  if (data === 'supabase' && !hasSupabaseUrl) {
    throw new EnvError(
      'DATA_MODE=supabase requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }

  const isDemo = catalog !== 'tmdb' || data !== 'supabase';
  const production = e.NODE_ENV === 'production';
  if (production && isDemo && !e.DEMO_MODE_PUBLIC && e.NEXT_PHASE !== 'phase-production-build') {
    const missing = [
      catalog !== 'tmdb' ? 'TMDB_READ_TOKEN' : null,
      data !== 'supabase' ? 'NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY' : null,
    ].filter(Boolean);
    throw new EnvError(
      `Refusing to start a production server in demo mode (catalog=${catalog}, data=${data}). ` +
        `Demo data resets and demo sign-in is not safe for real users. Set ${missing.join(' and ')} ` +
        'to go live, or set DEMO_MODE_PUBLIC=true to knowingly run a public demo (see README "Going live").',
    );
  }

  // ADR-001 §A3: never trust proxy headers by accident. A live production server must know its edge.
  const trustedProxy: TrustedProxy =
    (e.TRUSTED_PROXY as TrustedProxy | undefined) ??
    (e.VERCEL === '1' || e.VERCEL === 'true'
      ? 'vercel'
      : e.NETLIFY === 'true'
        ? 'netlify'
        : undefined) ??
    ((): TrustedProxy => {
      if (production && !isDemo && e.NEXT_PHASE !== 'phase-production-build')
        throw new EnvError(
          'Set TRUSTED_PROXY (see ADR-001 §A3): vercel | netlify | cloudflare | xff-1..xff-5 | none.',
        );
      return 'none';
    })();

  const watch: ServerEnv['watch'] = {
    ...parseWatchConfig(e.WATCH_REGION_DEFAULT, e.WATCH_REGIONS, e.WATCH_GEO_HEADER),
    sync: {
      max: Math.max(0, Math.floor(e.SYNC_WATCH_MAX)),
      ttlDays: Math.max(1, Math.floor(e.SYNC_WATCH_TTL_DAYS)),
      hotDays: Math.max(0, Math.floor(e.SYNC_WATCH_HOT_DAYS)),
    },
  };

  // Vercel's filesystem is read-only except /tmp (demo data there is per-instance and ephemeral).
  const dataDir =
    e.DEMO_PERSIST === 'memory'
      ? null
      : (e.DEMO_DATA_DIR ?? (e.VERCEL ? '/tmp/stubbed-demo' : '.data/demo'));

  const mode: AppMode = {
    catalog,
    data,
    isDemo,
    images: e.IMAGE_MODE,
    demoAccounts: data === 'local' ? DEMO_ACCOUNTS : [],
    // Local demo data is not durable on a production server (cold starts, instances, resets).
    demoResets:
      data === 'local' && (production || e.DEMO_RESET_ON_BOOT || dataDir === null || !!e.VERCEL),
    watchRegions: watch.regions.map((code) => ({ code, name: regionName(code)! })),
  };

  const keep = e.CATALOG_KEEP_RATING ? Number(e.CATALOG_KEEP_RATING) : e.CATALOG_MIN_RATING;
  const curation: CurationRule = {
    minRating: e.CATALOG_MIN_RATING,
    minVotesMovie: e.CATALOG_MIN_VOTES_MOVIE,
    minVotesTv: e.CATALOG_MIN_VOTES_TV,
    keepRating: Number.isFinite(keep) ? keep : e.CATALOG_MIN_RATING,
    excludeTvGenreIds: e.CATALOG_EXCLUDE_TV_GENRES.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0),
  };

  const guardMin = (name: string, v: string | undefined, def: number) => {
    const [key, raw] = v ? [name, v] : e.SYNC_GUARD_MIN ? ['SYNC_GUARD_MIN', e.SYNC_GUARD_MIN] : [];
    const n = raw === undefined ? def : Number(raw);
    if (!Number.isFinite(n) || n < 0)
      throw new EnvError(`${key} must be a number >= 0, got "${raw}".`);
    return Math.floor(n);
  };

  return {
    nodeEnv: e.NODE_ENV,
    siteUrl: e.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    mode,
    trustedProxy,
    health: { maxSyncAgeHours: Math.max(1, e.HEALTH_MAX_SYNC_AGE_HOURS) },
    watch,
    tmdb: hasTmdb ? { readToken: e.TMDB_READ_TOKEN, apiKey: e.TMDB_API_KEY } : null,
    omdb: e.OMDB_API_KEY
      ? {
          apiKey: e.OMDB_API_KEY,
          dailyBudget: Math.max(0, Math.floor(e.OMDB_DAILY_BUDGET)),
          hotTtlDays: Math.max(1, Math.floor(e.OMDB_HOT_TTL_DAYS)),
          ttlDays: Math.max(1, Math.floor(e.OMDB_TTL_DAYS)),
          hotCount: Math.max(0, Math.floor(e.OMDB_HOT_COUNT)),
        }
      : null,
    supabase:
      hasSupabaseUrl && anonKey
        ? { url: e.NEXT_PUBLIC_SUPABASE_URL!, anonKey, serviceRoleKey: e.SUPABASE_SERVICE_ROLE_KEY }
        : null,
    revalidateSecret: e.REVALIDATE_SECRET,
    curation,
    rateLimits: {
      stubsPerMin: e.RATE_LIMIT_STUBS_PER_MIN,
      reviewsPerMin: e.RATE_LIMIT_REVIEWS_PER_MIN,
    },
    demo: {
      sessionSecret: e.DEMO_SESSION_SECRET ?? DEMO_FALLBACK_SECRET,
      dataDir,
      resetOnBoot: e.DEMO_RESET_ON_BOOT,
      today: e.DEMO_TODAY ?? null,
      public: e.DEMO_MODE_PUBLIC,
      devLinks: e.DEMO_DEV_LINKS ?? (production ? 'seeded' : 'any'),
    },
    sync: {
      guardMin: {
        movie: guardMin(
          'SYNC_GUARD_MIN_MOVIE',
          e.SYNC_GUARD_MIN_MOVIE,
          SYNC_GUARD_MIN_DEFAULTS.movie,
        ),
        tv: guardMin('SYNC_GUARD_MIN_TV', e.SYNC_GUARD_MIN_TV, SYNC_GUARD_MIN_DEFAULTS.tv),
      },
      guardMax: e.SYNC_GUARD_MAX,
      guardMaxDelta: e.SYNC_GUARD_MAX_DELTA,
      enrichMax: Math.max(0, Math.floor(e.SYNC_ENRICH_MAX)),
      enrichTtlDays: Math.max(1, Math.floor(e.SYNC_ENRICH_TTL_DAYS)),
      recheckMax: Math.max(0, Math.floor(e.SYNC_RECHECK_MAX)),
      certificationRegion: e.CERTIFICATION_REGION,
    },
  };
}

/**
 * ADR-012 §5 boot validation: every WATCH_REGIONS code must be in src/lib/regions.ts and the default
 * must be one of them; a bad value fails the boot with a clear message (never a silent fallback).
 */
export function parseWatchConfig(
  rawDefault: string | undefined,
  rawRegions: string | undefined,
  rawGeoHeader: string | undefined,
): Omit<ServerEnv['watch'], 'sync'> {
  const code = (v: string, name: string) => {
    const c = normalizeRegionCode(v);
    if (!c || !isKnownRegion(c))
      throw new EnvError(
        `${name}: "${v}" is not a supported region code (see src/lib/regions.ts), e.g. US,GB,IN.`,
      );
    return c;
  };
  const regions = rawRegions
    ? [
        ...new Set(
          rawRegions
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((v) => code(v, 'WATCH_REGIONS')),
        ),
      ]
    : [...DEFAULT_WATCH_REGIONS];
  if (regions.length === 0) throw new EnvError('WATCH_REGIONS: list at least one region code.');
  const defaultRegion = rawDefault
    ? code(rawDefault, 'WATCH_REGION_DEFAULT')
    : DEFAULT_WATCH_REGION;
  if (!regions.includes(defaultRegion))
    throw new EnvError(
      `WATCH_REGION_DEFAULT=${defaultRegion} must be one of WATCH_REGIONS (${regions.join(',')}).`,
    );
  let geoHeader: string | null = null;
  if (rawGeoHeader) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(rawGeoHeader))
      throw new EnvError(
        `WATCH_GEO_HEADER: "${rawGeoHeader}" is not a header name (e.g. x-vercel-ip-country, cf-ipcountry).`,
      );
    geoHeader = rawGeoHeader.toLowerCase();
  }
  return { defaultRegion, regions, geoHeader };
}

let cached: ServerEnv | null = null;

/** Memoised env for the running process. Logs the resolved mode once. */
export function env(): ServerEnv {
  if (!cached) {
    cached = parseEnv();
    if (cached.nodeEnv !== 'test') {
      const m = cached.mode;
      console.info(
        `[stubbed] mode: catalog=${m.catalog} data=${m.data} images=${m.images}${m.isDemo ? ' (DEMO)' : ''}`,
      );
    }
  }
  return cached;
}

/** Test helper. */
export function resetEnvCache(): void {
  cached = null;
}

/** "Today" as 'YYYY-MM-DD' in UTC, or DEMO_TODAY when set. */
export function today(): string {
  return env().demo.today ?? new Date().toISOString().slice(0, 10);
}
