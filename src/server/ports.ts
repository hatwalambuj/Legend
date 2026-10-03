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
import type { ProviderDirectory, StoredWatch } from './watch';
import type {
  AvatarColor,
  CatalogQuery,
  DiaryEntry,
  Genre,
  ImportSource,
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
  WatchProviderChip,
} from '@/lib/types';
import type { AnalyticsEventName } from '@/lib/analytics';

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

/** The curated index (catalog_index table in live mode, fixtures in demo mode). */
export interface CatalogIndexRepository {
  /**
   * v1.6: `query.provider` (with `query.region`) keeps rows whose stream/free/ads list in that region has
   * the provider and whose watch data is fresh (<= 30 days). `query.region` alone filters nothing; the
   * DAL adds `watchHint` from `storedWatch`.
   */
  list(query: CatalogQuery): Promise<Page<TitleSummary>>;
  trending(type: TypeFilter, limit: number): Promise<TitleSummary[]>;
  /** `normalizedQuery` = normalizeSearch(q). Listed titles only. */
  search(normalizedQuery: string, type: TypeFilter, limit: number): Promise<TitleSummary[]>;
  /** Listed OR unlisted row (hysteresis). */
  get(mediaType: MediaType, tmdbId: number): Promise<TitleSummary | null>;
  /**
   * Same row plus its stored enrichment (the "Worth it?" inputs) and, v1.5, its stored availability
   * (`catalog_index.watch` + `watch_checked_at`, ADR-012 §6.1). Used by dal.getTitle.
   */
  getEntry(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<{ summary: TitleSummary; enrichment: TitleEnrichment; watch?: StoredWatch } | null>;
  getMany(keys: TitleKey[]): Promise<Map<TitleKey, TitleSummary>>;
  /**
   * v1.6 (ADR-013 C-01): stored availability of these titles (for `watchHint`). Live: served from the
   * rows the last list/search read in this process when possible (no extra round trip), else one query.
   * A key without data is absent.
   */
  storedWatch(keys: TitleKey[]): Promise<Map<TitleKey, StoredWatch>>;
  /**
   * v1.6 (ADR-013 C-11): match import rows against the index only (listed or not): tmdbId+type →
   * imdbId → normalised title + year ±1 + type (highest vote_count). Map key = `ref`. No outbound call.
   */
  match(items: CatalogMatchItem[]): Promise<Map<string, TitleSummary>>;
  count(): Promise<number>;
  /** Last FULL catalogue sync (discover applied, status ok; F1). */
  lastSyncAt(): Promise<string | null>;
  /**
   * GET /api/health (ADR-011 §3): one uncached round trip (live: rpc `health_probe` on the cookie-less
   * public client, aborted after `timeoutMs`). Throws when the DB is unreachable.
   */
  probe(opts: { timeoutMs: number }): Promise<HealthProbe>;
}

export interface CatalogMatchItem {
  ref: string;
  mediaType?: MediaType;
  tmdbId?: number;
  imdbId?: string;
  /** normalizeSearch(title) (= `catalog_index.sort_title`). */
  titleNorm?: string;
  year?: number;
}

export interface HealthProbe {
  catalogCount: number;
  lastFullSyncAt: string | null;
}

/** Heavy per-title detail (live: TMDB with L1/L2 cache; demo: fixtures). */
export type DetailFields = Omit<
  TitleDetail,
  keyof TitleSummary | 'detailStatus' | 'fetchedAt' | 'worthIt' | 'degraded' | 'watch'
>;

export interface CatalogDetailProvider {
  readonly name: 'tmdb' | 'fixtures';
  /** null = TMDB says the title doesn't exist. Throws UpstreamError on network/5xx/timeout. */
  getDetail(mediaType: MediaType, tmdbId: number): Promise<DetailResult | null>;
}

/**
 * Catalogue-row fields of the TMDB detail body. Only used to rebuild a summary when our DB is down
 * (ADR-011 §4, `summaryFromDetail`). Optional: older L2 cache payloads don't carry it.
 */
export interface DetailSource {
  title: string;
  originalTitle: string;
  releaseDate: string | null;
  voteAverage: number;
  voteCount: number;
  popularity: number;
  genres: Genre[];
  posterPath: string | null;
  backdropPath: string | null;
  imdbId: string | null;
  adult: boolean;
}

export interface DetailResult {
  fields: DetailFields;
  summaryPatch?: Partial<TitleSummary>;
  source?: DetailSource;
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
  /**
   * Creates user + profile atomically and signs in (sets cookies). Throws AppError email_taken/handle_taken.
   * Returns null when the account exists but needs email confirmation first (Supabase "Confirm email"
   * ON, ADR-010 ID-1): no session, no cookie. The local provider never returns null.
   */
  signUp(input: {
    email: string;
    password: string;
    handle: string;
    displayName: string;
  }): Promise<Session | null>;
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
  /**
   * DELETE /api/me (GAP-06): erase the account and everything it owns — profile, stubs, reviews,
   * watchlist, rate events (live: `auth.admin.deleteUser` + the `on delete cascade` chain; demo: one
   * store mutation) — then clear the session cookies. The id always comes from the session.
   */
  deleteAccount(userId: string): Promise<void>;
  /**
   * PUT /api/auth/password (ADR-010 ID-2): set a new password for the signed-in user. Throws
   * `unauthenticated` without a session and `reauth_required` when the last sign-in is older than
   * `REAUTH_WINDOW_MS` (10 min). Other sessions stay valid.
   */
  updatePassword(password: string): Promise<void>;
}

/** ADR-010 ID-2: a password change needs a sign-in (password or magic link) at most this old. */
export const REAUTH_WINDOW_MS = 10 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* User data (always scoped to the acting user; live mode enforces RLS)  */
/* ------------------------------------------------------------------ */

export interface ProfileRepository {
  getByHandle(handle: string): Promise<PublicProfile | null>;
  getById(id: string): Promise<PublicProfile | null>;
  stats(userId: string, year: number): Promise<ProfileStats>;
  update(
    userId: string,
    patch: {
      displayName?: string;
      bio?: string;
      avatarUrl?: string | null;
      avatarColor?: AvatarColor | null;
    },
  ): Promise<PublicProfile>;
}

export interface StubRepository {
  create(input: {
    userId: string;
    titleKey: TitleKey;
    watchedOn: string;
    watchedWhere: WatchedWhere | null;
    note: string;
    /** v1.6 (ADR-013 C-10): TV only (checked by the service + DB trigger). */
    season?: number | null;
  }): Promise<Stub>;
  /** Throws AppError not_found if the stub isn't the user's. */
  update(
    userId: string,
    id: string,
    patch: {
      watchedOn?: string;
      watchedWhere?: WatchedWhere | null;
      note?: string;
      season?: number | null;
    },
  ): Promise<Stub>;
  delete(userId: string, id: string): Promise<Stub>;
  get(userId: string, id: string): Promise<Stub | null>;
  /** v1.6 (ADR-013 C-08): public read of any stub by id (stubs are public-read, ADR-005); share routes only. */
  getById(id: string): Promise<Stub | null>;
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

/* ------------------------------------------------------------------ */
/* Where to watch (ADR-012)                                            */
/* ------------------------------------------------------------------ */

/** Provider names + logos (live: `watch_provider`, cached ≤ 1 h; demo: src/fixtures/watch.json). */
export interface WatchProviderRepository {
  /** Throws when unavailable; the caller then hides the block (never renders unnamed tiles). */
  all(): Promise<ProviderDirectory>;
  /**
   * v1.6 (ADR-013 C-02): browse chips for a region: <= 6 providers by TMDB priority in the region, each
   * with >= 1 listed title with fresh (<= 30 d) stream/free/ads data (live: rpc `watch_provider_counts`).
   */
  chips(region: string): Promise<WatchProviderChip[]>;
}

/* ------------------------------------------------------------------ */
/* Analytics (ADR-013 C-09): anonymous daily counters                  */
/* ------------------------------------------------------------------ */

export interface EventCount {
  name: AnalyticsEventName;
  dim: string;
  n: number;
}

/** Upsert-add into today's (UTC) bucket. Live: service-role `events_track`; demo: the store. */
export interface EventRepository {
  track(rows: EventCount[]): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Imports (ADR-013 C-11)                                              */
/* ------------------------------------------------------------------ */

/** One row ready to write: already matched, validated and keyed by the import service. */
export interface ImportApplyRow {
  titleKey: TitleKey;
  /** sha256 hex (64), or null when no stub is wanted. */
  importKey: string | null;
  /** Stub date; null = no stub. */
  watchedOn: string | null;
  season: number | null;
  /** Review rating; null = no review. */
  rating10: number | null;
  body: string;
  isSpoiler: boolean;
}

export interface ImportExisting {
  /** `${titleKey}|${watchedOn}` of the user's stubs (any source). Re-uploads land here (duplicate). */
  stubDays: Set<string>;
  /** Titles the user already reviewed (never overwritten). */
  reviewed: Set<TitleKey>;
}

export interface ImportRepository {
  existing(userId: string, keys: TitleKey[]): Promise<ImportExisting>;
  /** Stubs with `source='import'` created since `sinceIso` (24 h row budget). */
  importedSince(userId: string, sinceIso: string): Promise<number>;
  /**
   * Inserts stubs (`on conflict (user_id, import_key) do nothing`, `source='import'`, no per-minute
   * limit) and reviews only where none exist. Live: rpc `import_apply` (RLS applies). <= 1000 rows.
   */
  apply(
    userId: string,
    source: ImportSource,
    rows: ImportApplyRow[],
  ): Promise<{ stubs: number; reviews: number }>;
}

/** Owner-only per-user settings (`user_settings`, RLS). Never part of a public payload. */
export interface UserSettingsRepository {
  get(userId: string): Promise<{ watchRegion: string | null }>;
  /** null = automatic (clears the saved region). */
  setWatchRegion(userId: string, region: string | null): Promise<void>;
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
  watchProviders: WatchProviderRepository;
  settings: UserSettingsRepository;
  /** Non-write-path limits (export, auth). Stub/review limits live with the writes (DB trigger / repo). */
  rateLimiter: RateLimiter;
  /** v1.6 (ADR-013 C-09). */
  events: EventRepository;
  /** v1.6 (ADR-013 C-11). */
  imports: ImportRepository;
}
