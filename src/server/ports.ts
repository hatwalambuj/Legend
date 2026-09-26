/**
 * Provider / repository interfaces ("ports") behind which every external dependency lives (ADR-001, ADR-006).
 * Authored by Architect; OWNED BY BACKEND after hand-off (Frontend never imports src/server/**).
 * Backend may ADD methods; removing/renaming requires updating the ADRs.
 *
 * Two implementations of each data port:
 *   live  : Supabase (Postgres + RLS + Auth), TMDB (detail), OMDb (nightly job only)
 *   demo  : in-memory store persisted to a JSON file (src/server/repositories/memory), fixtures, local auth
 * Selection happens once in src/server/container.ts from env().mode.
 */
import type { RateLimiter } from './rate-limit';
import type {
  CatalogQuery,
  DiaryEntry,
  MediaType,
  Page,
  ProfileStats,
  PublicProfile,
  Review,
  ReviewSort,
  ReviewWithTitle,
  Session,
  Stub,
  TitleDetail,
  TitleEnrichment,
  TitleKey,
  TitleState,
  TitleStats,
  TitleSummary,
  TypeFilter,
  WalletItem,
  WatchedWhere,
} from '@/lib/types';

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/** The curated index (catalog_index table in live mode, fixtures in demo mode). */
export interface CatalogIndexRepository {
  list(query: CatalogQuery): Promise<Page<TitleSummary>>;
  trending(type: TypeFilter, limit: number): Promise<TitleSummary[]>;
  /** `normalizedQuery` = normalizeSearch(q). Listed titles only. */
  search(normalizedQuery: string, type: TypeFilter, limit: number): Promise<TitleSummary[]>;
  /** Listed OR unlisted row (hysteresis). */
  get(mediaType: MediaType, tmdbId: number): Promise<TitleSummary | null>;
  /** Same row plus its stored enrichment (the "Worth it?" inputs). Used by dal.getTitle. */
  getEntry(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<{ summary: TitleSummary; enrichment: TitleEnrichment } | null>;
  getMany(keys: TitleKey[]): Promise<Map<TitleKey, TitleSummary>>;
  count(): Promise<number>;
  lastSyncAt(): Promise<string | null>;
}

/** Heavy per-title detail (live: TMDB with L1/L2 cache; demo: fixtures). */
export type DetailFields = Omit<
  TitleDetail,
  keyof TitleSummary | 'detailStatus' | 'fetchedAt' | 'worthIt'
>;

export interface CatalogDetailProvider {
  readonly name: 'tmdb' | 'fixtures';
  /** null = TMDB says the title doesn't exist. Throws UpstreamError on network/5xx/timeout. */
  getDetail(mediaType: MediaType, tmdbId: number): Promise<DetailResult | null>;
}

export interface DetailResult {
  fields: DetailFields;
  summaryPatch?: Partial<TitleSummary>;
  /** True when served from the L2 cache after an upstream failure (→ detailStatus 'stale'). */
  stale?: boolean;
  /** When the payload was fetched from the source (ISO). Defaults to now. */
  fetchedAt?: string;
}

/**
 * L2 detail cache (live: `title_detail_cache`, SYSTEM_DESIGN §4.3): last good TMDB payload per title,
 * served as 'stale' when TMDB is down. `put` is best-effort and may be a no-op without a service role.
 */
export interface DetailCacheStore {
  get(key: TitleKey): Promise<{ result: Omit<DetailResult, 'stale'>; fetchedAt: string } | null>;
  put(key: TitleKey, result: Omit<DetailResult, 'stale'>, fetchedAt: string): Promise<void>;
}

/**
 * IMDb rating lookup (ADR-008). Used ONLY by the nightly job (scripts/sync-catalog.ts), which caches the
 * result on catalog_index.imdb_rating / imdb_votes. Never called while serving a request, so it is not
 * part of the Container. Implementation: src/server/providers/omdb.ts.
 */
export interface ImdbRating {
  /** 1.0–10.0, one decimal; null when OMDb has no rating ("N/A"). */
  rating: number | null;
  votes: number | null;
}

export interface ImdbRatingProvider {
  readonly name: 'omdb';
  /**
   * null = OMDb does not know this id. Throws `OmdbLimitError` when the daily quota is exhausted
   * (the job stops and resumes tomorrow) and `UpstreamError`-like errors on network/5xx.
   */
  getImdbRating(imdbId: string): Promise<ImdbRating | null>;
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export interface AuthProvider {
  readonly name: 'supabase' | 'local';
  /** Reads (and, for Supabase, refreshes) the session from request cookies. */
  getSession(): Promise<Session | null>;
  /** Creates user + profile atomically and signs in (sets cookies). Throws AppError email_taken/handle_taken. */
  signUp(input: {
    email: string;
    password: string;
    handle: string;
    displayName: string;
  }): Promise<Session>;
  /** Throws AppError('invalid_credentials') with the generic message (B2-AC1). */
  signIn(input: { email: string; password: string }): Promise<Session>;
  signOut(): Promise<void>;
  /** Live: emails a magic link. Demo: returns the link instead of sending it. */
  sendMagicLink(input: { email: string; redirectTo: string }): Promise<{ devLink?: string }>;
  isHandleAvailable(handle: string): Promise<boolean>;
  /**
   * `/auth/callback`: live = PKCE/magic-link `code` exchange, demo = signed `demoToken` from the dev link.
   * Sets the session cookie and returns true on success; false for any invalid/expired input.
   */
  completeCallback(input: { code?: string | null; demoToken?: string | null }): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* User data (always scoped to the acting user; live mode enforces RLS)  */
/* ------------------------------------------------------------------ */

export interface ProfileRepository {
  getByHandle(handle: string): Promise<PublicProfile | null>;
  getById(id: string): Promise<PublicProfile | null>;
  stats(userId: string, year: number): Promise<ProfileStats>;
  update(
    userId: string,
    patch: { displayName?: string; bio?: string; avatarUrl?: string | null },
  ): Promise<PublicProfile>;
}

export interface StubRepository {
  create(input: {
    userId: string;
    titleKey: TitleKey;
    watchedOn: string;
    watchedWhere: WatchedWhere | null;
    note: string;
  }): Promise<Stub>;
  /** Throws AppError not_found if the stub isn't the user's. */
  update(
    userId: string,
    id: string,
    patch: { watchedOn?: string; watchedWhere?: WatchedWhere | null; note?: string },
  ): Promise<Stub>;
  delete(userId: string, id: string): Promise<Stub>;
  get(userId: string, id: string): Promise<Stub | null>;
  /** Newest first; `total` counts every stub matching `type` (API_CONTRACT §5.10). */
  diary(
    userId: string,
    opts: { type: TypeFilter; cursor?: string | null; limit: number },
  ): Promise<Page<DiaryEntry> & { total: number }>;
  /** Number of the user's stubs (optionally one media type). Header wallet badge (`MeResponse.stubCount`). */
  count(userId: string, type?: TypeFilter): Promise<number>;
  wallet(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<WalletItem>>;
  /** Created in the last 60s — for rate limiting in demo mode (live mode: DB trigger). */
  countRecent(userId: string, sinceIso: string): Promise<number>;
}

export interface ReviewRepository {
  /** One per (user, title): insert or update. Sets editedAt when rating/body change on update. */
  upsert(input: {
    userId: string;
    titleKey: TitleKey;
    rating10: number;
    body: string;
    isSpoiler: boolean;
    stubId: string | null;
  }): Promise<{ review: Review; created: boolean }>;
  delete(userId: string, id: string): Promise<void>;
  listForTitle(
    titleKey: TitleKey,
    opts: { sort: ReviewSort; cursor?: string | null; limit: number },
  ): Promise<Page<Review>>;
  listForUser(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<ReviewWithTitle>>;
  countRecent(userId: string, sinceIso: string): Promise<number>;
}

export interface WatchlistRepository {
  add(userId: string, titleKey: TitleKey): Promise<void>;
  remove(userId: string, titleKey: TitleKey): Promise<void>;
  list(
    userId: string,
    opts: { cursor?: string | null; limit: number },
  ): Promise<Page<TitleSummary>>;
}

export interface TitleStateRepository {
  states(userId: string, keys: TitleKey[], today: string): Promise<Record<TitleKey, TitleState>>;
  stats(titleKey: TitleKey): Promise<TitleStats>;
}

/**
 * Everything the data-access layer and route handlers need, resolved once per process.
 * There is deliberately no outbound sync adapter: nothing is ever posted to IMDb, TMDB or
 * any other third party (ADR-008). User data leaves only via the user's own export (§5.16).
 */
export interface Container {
  catalog: CatalogIndexRepository;
  detail: CatalogDetailProvider;
  auth: AuthProvider;
  profiles: ProfileRepository;
  stubs: StubRepository;
  reviews: ReviewRepository;
  watchlist: WatchlistRepository;
  titleStates: TitleStateRepository;
  /** Non-write-path limits (export, auth). Stub/review limits live with the writes (DB trigger / repo). */
  rateLimiter: RateLimiter;
}
