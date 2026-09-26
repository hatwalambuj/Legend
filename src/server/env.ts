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
  DEMO_TODAY: z.iso
    .date()
    .optional()
    .or(z.literal('').transform(() => undefined)),

  SYNC_GUARD_MIN: num(5000),
  SYNC_GUARD_MAX: num(25000),
  SYNC_GUARD_MAX_DELTA: num(0.2),
  SYNC_ENRICH_MAX: num(3000),
  SYNC_ENRICH_TTL_DAYS: num(30),
  CERTIFICATION_REGION: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('US'),

  VERCEL: optionalString,
});

export interface ServerEnv {
  nodeEnv: 'development' | 'production' | 'test';
  siteUrl: string;
  mode: AppMode;
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
  };
  /** Nightly job settings (ADR-002, ADR-008). */
  sync: {
    /** Guardrails: listed count per type within [guardMin, guardMax], delta vs last ok run < guardMaxDelta. */
    guardMin: number;
    guardMax: number;
    guardMaxDelta: number;
    /** Max TMDB detail calls per night for the enrich step (new rows first, then older than enrichTtlDays). */
    enrichMax: number;
    enrichTtlDays: number;
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
const DEMO_FALLBACK_SECRET = 'stubbed-demo-mode-not-a-secret-change-me-if-you-deploy-demo-publicly';

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

  const mode: AppMode = {
    catalog,
    data,
    isDemo,
    images: e.IMAGE_MODE,
    demoAccounts: data === 'local' ? DEMO_ACCOUNTS : [],
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

  // Vercel's filesystem is read-only except /tmp (demo data there is per-instance and ephemeral).
  const dataDir =
    e.DEMO_PERSIST === 'memory'
      ? null
      : (e.DEMO_DATA_DIR ?? (e.VERCEL ? '/tmp/stubbed-demo' : '.data/demo'));

  return {
    nodeEnv: e.NODE_ENV,
    siteUrl: e.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    mode,
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
    },
    sync: {
      guardMin: e.SYNC_GUARD_MIN,
      guardMax: e.SYNC_GUARD_MAX,
      guardMaxDelta: e.SYNC_GUARD_MAX_DELTA,
      enrichMax: Math.max(0, Math.floor(e.SYNC_ENRICH_MAX)),
      enrichTtlDays: Math.max(1, Math.floor(e.SYNC_ENRICH_TTL_DAYS)),
      certificationRegion: e.CERTIFICATION_REGION,
    },
  };
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
