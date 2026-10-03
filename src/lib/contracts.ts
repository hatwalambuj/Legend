/**
 * API request schemas (zod) + response types for every route in docs/04-architecture/API_CONTRACT.md.
 * Route handlers MUST parse inputs with these schemas; the typed client (api-client.ts) uses the types.
 * OWNER: Architect. FROZEN — change the contract doc and this file together.
 */
import { z } from 'zod';
import { CLIENT_EVENT_NAMES, isValidDim } from './analytics';
import { AVATAR_COLORS } from './avatar';
import type {
  AppMode,
  DiaryEntry,
  ImportSource,
  IsoDate,
  Page,
  PublicProfile,
  Review,
  SearchResult,
  Session,
  Stub,
  TitleKey,
  TitleState,
  TitleSummary,
  TitleWatch,
  WatchProviderChip,
} from './types';
import { normalizeRegionCode } from './regions';

/* ---------------- primitives ---------------- */

export const mediaTypeSchema = z.enum(['movie', 'tv']);
export const typeFilterSchema = z.enum(['all', 'movie', 'tv']);
export const sortKeySchema = z.enum([
  'release_desc',
  'release_asc',
  'rating_desc',
  'rating_asc',
  'popularity_desc',
]);
export const reviewSortSchema = z.enum(['newest', 'highest']);
export const watchedWhereSchema = z.enum(['cinema', 'streaming', 'tv', 'other']);
export const tmdbIdSchema = z.coerce.number().int().positive().max(9_999_999_999);
export const isoDateSchema = z.iso.date();
export const titleKeySchema = z
  .string()
  .regex(/^(movie|tv):[1-9]\d{0,9}$/, 'Invalid title key')
  .transform((s) => s as TitleKey);
export const cursorSchema = z.string().max(512).nullish();
export const limitSchema = z.coerce.number().int().min(1).max(50).default(20);

/** Handle rule (PRD B1-AC1): 3–20 chars of [a-z0-9_], not reserved. */
export const RESERVED_HANDLES = [
  'admin',
  'api',
  'about',
  'auth',
  'browse',
  'me',
  'u',
  'title',
  'search',
  'settings',
  'signin',
  'signup',
  'stubbed',
  'support',
  'help',
  'null',
  'undefined',
] as const;

export const handleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, '3–20 characters: a–z, 0–9 and _')
  .refine((h) => !(RESERVED_HANDLES as readonly string[]).includes(h), 'That handle is reserved');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));
export const passwordSchema = z.string().min(8, '8+ characters').max(72, 'At most 72 characters');

/* ---------------- query schemas (GET) ---------------- */

/**
 * v1.5 (ADR-012 §5): a region code in the API: 2 letters, upper-cased, `UK→GB`. Support is checked by
 * the handler against `WATCH_REGIONS` (config, not contract).
 */
export const regionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a two-letter country code')
  .transform((s) => normalizeRegionCode(s)!);

/** v1.6 (ADR-013 C-02): a TMDB provider id in a query string. */
export const providerIdSchema = z.coerce.number().int().positive().max(2_147_483_647);

export const catalogQuerySchema = z
  .object({
    type: typeFilterSchema.default('all'),
    sort: sortKeySchema.default('release_desc'),
    genre: z
      .string()
      .regex(/^\d+(,\d+)*$/)
      .transform((s) => s.split(',').map(Number))
      .optional(),
    cursor: cursorSchema,
    limit: limitSchema,
    /** v1.6 (ADR-013 C-01): items carry `watchHint`; the response echoes it. */
    region: regionCodeSchema.optional(),
    /** v1.6 (ADR-013 C-02): only with `region`. */
    provider: providerIdSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.provider !== undefined && v.region === undefined)
      ctx.addIssue({ code: 'custom', path: ['provider'], message: 'Pick a region first' });
  });

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  type: typeFilterSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  region: regionCodeSchema.optional(),
});

/** GET /api/me/watchlist (§5.15). */
export const watchlistQuerySchema = z.object({
  cursor: cursorSchema,
  limit: limitSchema,
  region: regionCodeSchema.optional(),
});

/** GET /api/watch/providers?region= (§5.23). */
export const watchProvidersQuerySchema = z.object({ region: regionCodeSchema });

export const titleReviewsQuerySchema = z.object({
  sort: reviewSortSchema.default('newest'),
  cursor: cursorSchema,
  limit: limitSchema,
});

export const titleStatesQuerySchema = z.object({
  keys: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(titleKeySchema).min(1).max(60)),
});

export const diaryQuerySchema = z.object({
  type: typeFilterSchema.default('all'),
  cursor: cursorSchema,
  limit: limitSchema,
});

export const exportQuerySchema = z.object({
  format: z.enum(['letterboxd', 'json']),
});

/** GET /api/titles/{type}/{id}/watch?region= (§5.21): `region` is required and the ONLY region input. */
export const watchQuerySchema = z.object({ region: regionCodeSchema });

/* ---------------- body schemas (mutations) ---------------- */

/** v1.6 (ADR-013 C-10): a TV season on a stub. */
export const seasonSchema = z.number().int().min(1).max(200);

export const titleRefSchema = z.object({
  mediaType: mediaTypeSchema,
  tmdbId: tmdbIdSchema,
});

export const createStubSchema = titleRefSchema.extend({
  /** Defaults to "today" (server clock, or DEMO_TODAY). No future dates; not before Jan 1 of (release year - 1). */
  watchedOn: isoDateSchema.optional(),
  watchedWhere: watchedWhereSchema.nullish(),
  note: z.string().max(280).default(''),
  /** v1.6: TV only; null/absent = the whole show. */
  season: seasonSchema.nullish(),
});

export const updateStubSchema = z
  .object({
    watchedOn: isoDateSchema.optional(),
    watchedWhere: watchedWhereSchema.nullish(),
    note: z.string().max(280).optional(),
    /** v1.6: null clears it. */
    season: seasonSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const upsertReviewSchema = titleRefSchema.extend({
  rating10: z.number().int().min(1).max(10),
  body: z.string().max(5000).default(''),
  isSpoiler: z.boolean().default(false),
  stubId: z.uuid().nullish(),
});

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(50).optional(),
    bio: z.string().trim().max(160).optional(),
    avatarUrl: z.url().max(500).nullish(),
    /** v1.6 (ADR-013 C-12): null = the handle-derived colour. */
    avatarColor: z.enum(AVATAR_COLORS).nullish(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(50).optional(),
  /** v1.6 (ADR-013 C-07): only feeds the anonymous `signup_completed` dim; anything else is ignored. */
  ref: z.enum(['share']).optional().catch(undefined),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(72),
});

/** PUT /api/auth/password (v1.4, ADR-010 ID-2): same length rule as sign-up. */
export const setPasswordSchema = z.object({ password: passwordSchema });

export const magicLinkSchema = z.object({
  email: emailSchema,
  next: z.string().max(500).optional(),
});

/** DELETE /api/me (GAP-06): the body must spell out the intent, so a stray request can't erase data. */
export const deleteAccountSchema = z.object({ confirm: z.literal('DELETE') });

export const handleAvailableQuerySchema = z.object({ handle: z.string().max(40) });

/** PUT /api/me/watch-region (§5.22): null = automatic (clears the saved region). */
export const setWatchRegionSchema = z.object({ region: regionCodeSchema.nullable() });

export const revalidateSchema = z.object({
  tags: z.array(z.string().min(1).max(256)).min(1).max(50),
});

/* ---------------- v1.6 analytics, client logs, imports (ADR-013 C-09/C-11/C-13) ---------------- */

/** POST /api/events (§5.24): only the client events; `dim` validated per event. */
export const trackEventsSchema = z.object({
  events: z
    .array(
      z
        .object({ name: z.enum(CLIENT_EVENT_NAMES), dim: z.string().max(80) })
        .refine((e) => isValidDim(e.name, e.dim), { message: 'Invalid dim', path: ['dim'] }),
    )
    .min(1)
    .max(20),
});

/** POST /api/log (§5.25). `path` = location.pathname only (the server strips query/hash again). */
export const clientLogSchema = z.object({
  kind: z.enum(['boundary', 'global', 'unhandled', 'rejection']),
  message: z.string().max(300),
  digest: z.string().max(64).optional(),
  stack: z.string().max(2000).optional(),
  path: z.string().max(200),
});

export const importSourceSchema = z.enum(['letterboxd', 'imdb', 'tvtime']);
export const IMPORT_PREVIEW_MAX_ROWS = 20_000;
export const IMPORT_COMMIT_MAX_ROWS = 1000;

/** One normalised import row (ADR-013 C-11), parsed in the browser by src/lib/import. */
export const importRowSchema = z.object({
  ref: z.string().min(1).max(64),
  mediaType: mediaTypeSchema.optional(),
  tmdbId: z.number().int().positive().max(9_999_999_999).optional(),
  imdbId: z
    .string()
    .regex(/^tt\d{7,10}$/)
    .optional(),
  title: z.string().max(200).optional(),
  year: z.number().int().min(1870).max(2100).optional(),
  watchedOn: isoDateSchema.nullish(),
  rating10: z.number().int().min(1).max(10).nullish(),
  rewatch: z.boolean().optional(),
  review: z.string().max(5000).optional(),
  hasReview: z.boolean().optional(),
  isSpoiler: z.boolean().optional(),
  season: seasonSchema.nullish(),
});

/** POST /api/me/imports/preview (§5.26): review bodies omitted (hasReview instead). Row cap → 413. */
export const importPreviewSchema = z.object({
  source: importSourceSchema,
  rows: z.array(importRowSchema.omit({ review: true })),
});

/** POST /api/me/imports (§5.27): one chunk of <= 1000 rows. Row cap → 413. */
export const importCommitSchema = z.object({
  source: importSourceSchema,
  importId: z.uuid(),
  final: z.boolean(),
  options: z.object({ createStubs: z.boolean(), ratings: z.boolean(), reviews: z.boolean() }),
  rows: z.array(importRowSchema),
});

/* ---------------- inferred input types ---------------- */

export type CreateStubInput = z.input<typeof createStubSchema>;
export type UpdateStubInput = z.input<typeof updateStubSchema>;
export type UpsertReviewInput = z.input<typeof upsertReviewSchema>;
export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignInInput = z.input<typeof signInSchema>;
export type MagicLinkInput = z.input<typeof magicLinkSchema>;
export type SetPasswordInput = z.input<typeof setPasswordSchema>;
export type DeleteAccountInput = z.input<typeof deleteAccountSchema>;
export type SetWatchRegionInput = z.input<typeof setWatchRegionSchema>;
export type TrackEventsInput = z.input<typeof trackEventsSchema>;
export type ClientLogInput = z.input<typeof clientLogSchema>;
export type ImportRowInput = z.input<typeof importRowSchema>;
export type ImportPreviewInput = z.input<typeof importPreviewSchema>;
export type ImportCommitInput = z.input<typeof importCommitSchema>;

/* ---------------- response types ---------------- */

export interface MeResponse {
  session: Session | null;
  mode: AppMode;
  /** The signed-in user's total stubs (header wallet badge); 0 when signed out. */
  stubCount: number;
}
/** v1.6: `region` is echoed when the request had one (items then carry `watchHint`). */
export type CatalogResponse = Page<TitleSummary> & { region?: string };
export type SearchResponse = SearchResult & { region?: string };
export type TitleReviewsResponse = Page<Review>;
export type TitleStatesResponse = { states: Record<TitleKey, TitleState> };
export interface StubMutationResponse {
  stub: Stub;
  state: TitleState;
}
export interface StubDeleteResponse {
  state: TitleState;
}
/** Diary page; `total` = all stubs matching the `type` filter (not just this page). */
export type DiaryResponse = Page<DiaryEntry> & { total: number };
export interface ReviewUpsertResponse {
  review: Review;
  created: boolean;
  /** True if the user has no stub for this title → UI offers "Add a stub too?" (D1-AC4). */
  suggestStub: boolean;
}
export interface WatchlistResponse {
  watchlisted: boolean;
}
export type WatchlistListResponse = Page<TitleSummary> & { region?: string };
export interface ProfileResponse {
  profile: PublicProfile;
}
/**
 * Sign-up / sign-in result. v1.4 (ADR-010 ID-1): when Supabase "Confirm email" is ON, sign-up answers
 * `202 { session: null, confirmEmail: true }` and sets no cookie. Sign-in and demo mode always carry a session.
 */
export type AuthResponse =
  { session: Session; confirmEmail?: never } | { session: null; confirmEmail: true };
export interface MagicLinkResponse {
  sent: true;
  /** Demo mode only: the link that would have been emailed (shown in a dev toast). */
  devLink?: string;
}
export interface HandleAvailableResponse {
  available: boolean;
  reason?: string;
}
export type HealthStatus = 'ok' | 'degraded' | 'down';
export type HealthReason = 'db_unreachable' | 'sync_never' | 'sync_stale' | 'catalog_empty';
/** GET/HEAD /api/health (v1.4, ADR-011 §3). Never contains error messages, hosts or stack traces. */
export interface HealthResponse {
  /** status === 'ok' (kept for v1.3 clients). */
  ok: boolean;
  status: HealthStatus;
  mode: Pick<AppMode, 'catalog' | 'data' | 'isDemo'>;
  /** Listed titles; null when down. */
  catalogCount: number | null;
  /** Last FULL sync (discover applied, status ok); F1. */
  lastSyncAt: string | null;
  /** Rounded to 0.1. */
  syncAgeHours: number | null;
  checks: {
    db: 'ok' | 'fail' | 'skipped';
    sync: 'ok' | 'stale' | 'never' | 'unknown' | 'skipped';
  };
  reasons: HealthReason[];
}

/** GET /api/titles/{type}/{id}/watch (§5.21). `watch: null` = hide the block (same rules as §1b). */
export interface TitleWatchResponse {
  watch: TitleWatch | null;
}
/** PUT /api/me/watch-region (§5.22): the saved region, null = automatic. */
export interface SetWatchRegionResponse {
  region: string | null;
}

/** GET /api/watch/providers (§5.23): <= 6 chips by TMDB priority in the region, count >= 1. */
export interface WatchProvidersResponse {
  region: string;
  providers: WatchProviderChip[];
}

export interface ImportPreviewItem {
  ref: string;
  title: TitleSummary;
  watchedOn: IsoDate | null;
  rating10: number | null;
  season: number | null;
}

export interface ImportUnmatched {
  ref: string;
  title: string;
  year: number | null;
  reason: 'not_in_stubbed' | 'invalid';
}

/** POST /api/me/imports/preview (§5.26). Writes nothing. */
export interface ImportPreviewResponse {
  counts: {
    total: number;
    matched: number;
    duplicate: number;
    notInStubbed: number;
    invalid: number;
  };
  /** <= 50 matched rows. */
  sample: ImportPreviewItem[];
  /** <= 500. */
  unmatched: ImportUnmatched[];
}

/** POST /api/me/imports (§5.27). */
export interface ImportCommitResponse {
  created: { stubs: number; reviews: number };
  skipped: { duplicate: number; notInStubbed: number; invalid: number; existingReview: number };
}

export type { ImportSource };
