/**
 * The server-side read interface that PAGES (React Server Components) call directly.
 * Implemented by Backend in `src/server/dal.ts` (`export const dal: DataAccess`).
 * OWNER: Architect. FROZEN. Types only — importing this file never pulls server code into a bundle.
 *
 * Rules (ADR-001 / API_CONTRACT §1)
 * - Public methods never read the session cookie, so public pages stay cacheable later.
 * - Methods whose name starts with `my`/`getSession` read the cookie and are request-scoped.
 * - "Not found" is `null`, never a thrown error. Unexpected failures throw AppError.
 * - All mutations go through route handlers (`/api/**`), called from client components via
 *   `@/lib/api-client`. Pages never mutate.
 */
import type {
  AppMode,
  CatalogQuery,
  DiaryEntry,
  Page,
  ProfilePage,
  Review,
  ReviewSort,
  ReviewWithTitle,
  SearchResult,
  Session,
  TitleDetail,
  TitleKey,
  TitleState,
  TitleStats,
  TitleSummary,
  TypeFilter,
  WalletItem,
  MediaType,
  WatchRegionInfo,
} from './types';

export interface DataAccess {
  /** Resolved once per process from env (ADR-006). Cheap, sync-safe. */
  getMode(): AppMode;

  /* ---------- public catalogue ---------- */
  /** Browse grid. Only `isListed` titles. Keyset-paginated; `total` = matching row count. */
  listCatalog(query: CatalogQuery): Promise<Page<TitleSummary>>;
  /** Home "Trending" rail: popularity_desc, listed only. */
  listTrending(type: TypeFilter, limit?: number): Promise<TitleSummary[]>;
  /** Accent/case-insensitive partial title match within listed titles (A4). */
  searchCatalog(q: string, type?: TypeFilter, limit?: number): Promise<SearchResult>;
  /**
   * Title page payload (listed OR unlisted — hysteresis titles stay reachable by URL, D4).
   * null → 404. Never throws for TMDB outages: degrades to detailStatus 'stale' | 'index_only'.
   * Always includes `imdbRating` (null = hide the chip, ADR-008) and a computed `worthIt` block
   * (ADR-009), even when index-only.
   */
  getTitle(
    mediaType: MediaType,
    tmdbId: number,
    opts?: { region?: WatchRegionInfo },
  ): Promise<TitleDetail | null>;
  /**
   * v1.5 (ADR-012 §5): the "Where to watch" region for this request — `stubbed_region` cookie → trusted
   * geo header (only when WATCH_GEO_HEADER and TRUSTED_PROXY≠none) → Accept-Language → WATCH_REGION_DEFAULT.
   * Never reads the session. Pass the result to `getTitle(…, { region })`; `TitleDetail.watch` is built for
   * it (the default region when omitted).
   */
  getWatchRegion(): Promise<WatchRegionInfo>;
  getTitleStats(key: TitleKey): Promise<TitleStats>;
  /** Stubbed reviews for a title (TMDB reviews are on TitleDetail.tmdbReviews). */
  listTitleReviews(
    key: TitleKey,
    opts?: { sort?: ReviewSort; cursor?: string | null; limit?: number },
  ): Promise<Page<Review>>;

  /* ---------- public profiles ---------- */
  getProfile(handle: string): Promise<ProfilePage | null>;
  /** Wallet tab: one item per stubbed title, newest last-watched first. */
  listWallet(
    handle: string,
    opts?: { cursor?: string | null; limit?: number },
  ): Promise<Page<WalletItem>>;
  /** Diary tab (public diaries, PRD B3). Newest first (watchedOn DESC, createdAt DESC). */
  listDiary(
    handle: string,
    opts?: { type?: TypeFilter; cursor?: string | null; limit?: number },
  ): Promise<Page<DiaryEntry>>;
  listProfileReviews(
    handle: string,
    opts?: { cursor?: string | null; limit?: number },
  ): Promise<Page<ReviewWithTitle>>;

  /* ---------- request-scoped (reads the session cookie) ---------- */
  getSession(): Promise<Session | null>;
  /** Signed-in user's state per title; empty object when signed out. */
  myTitleStates(keys: TitleKey[]): Promise<Record<TitleKey, TitleState>>;
  /** Owner-only watchlist. Throws AppError('unauthenticated') when signed out. */
  myWatchlist(opts?: { cursor?: string | null; limit?: number }): Promise<Page<TitleSummary>>;
}
