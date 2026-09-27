/**
 * API request schemas (zod) + response types for every route in docs/04-architecture/API_CONTRACT.md.
 * Route handlers MUST parse inputs with these schemas; the typed client (api-client.ts) uses the types.
 * OWNER: Architect. FROZEN — change the contract doc and this file together.
 */
import { z } from 'zod';
import type {
  AppMode,
  DiaryEntry,
  Page,
  PublicProfile,
  Review,
  SearchResult,
  Session,
  Stub,
  TitleKey,
  TitleState,
  TitleSummary,
} from './types';

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

export const catalogQuerySchema = z.object({
  type: typeFilterSchema.default('all'),
  sort: sortKeySchema.default('release_desc'),
  genre: z
    .string()
    .regex(/^\d+(,\d+)*$/)
    .transform((s) => s.split(',').map(Number))
    .optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  type: typeFilterSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

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

/* ---------------- body schemas (mutations) ---------------- */

export const titleRefSchema = z.object({
  mediaType: mediaTypeSchema,
  tmdbId: tmdbIdSchema,
});

export const createStubSchema = titleRefSchema.extend({
  /** Defaults to "today" (server clock, or DEMO_TODAY). No future dates; not before Jan 1 of (release year - 1). */
  watchedOn: isoDateSchema.optional(),
  watchedWhere: watchedWhereSchema.nullish(),
  note: z.string().max(280).default(''),
});

export const updateStubSchema = z
  .object({
    watchedOn: isoDateSchema.optional(),
    watchedWhere: watchedWhereSchema.nullish(),
    note: z.string().max(280).optional(),
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
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  handle: handleSchema,
  displayName: z.string().trim().min(1).max(50).optional(),
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

export const revalidateSchema = z.object({
  tags: z.array(z.string().min(1).max(256)).min(1).max(50),
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

/* ---------------- response types ---------------- */

export interface MeResponse {
  session: Session | null;
  mode: AppMode;
  /** The signed-in user's total stubs (header wallet badge); 0 when signed out. */
  stubCount: number;
}
export type CatalogResponse = Page<TitleSummary>;
export type SearchResponse = SearchResult;
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
export type WatchlistListResponse = Page<TitleSummary>;
export interface ProfileResponse {
  profile: PublicProfile;
}
/**
 * Sign-up / sign-in result. v1.4 (ADR-010 ID-1): when Supabase "Confirm email" is ON, sign-up answers
 * `202 { session: null, confirmEmail: true }` and sets no cookie. Sign-in and demo mode always carry a session.
 */
export type AuthResponse = { session: Session; confirmEmail?: never } | { session: null; confirmEmail: true };
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
