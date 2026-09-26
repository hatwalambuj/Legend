/**
 * Shared domain types — the contract between Frontend, Backend and QA.
 * OWNER: Architect. FROZEN (see docs/04-architecture/WORK_SPLIT.md). Change only via an ADR/contract update.
 *
 * Conventions
 * - Dates: `IsoDate` = 'YYYY-MM-DD' (calendar date, no TZ). `IsoDateTime` = full ISO-8601 UTC string.
 * - Ratings: TMDB `voteAverage` is 0–10 with one decimal. User ratings are `rating10` = 1..10
 *   (1 = half a star, 10 = five stars).
 * - A title is addressed by `TitleKey` = `${mediaType}:${tmdbId}` (e.g. "movie:693134", "tv:1396").
 */

export type MediaType = 'movie' | 'tv';
export type TypeFilter = 'all' | MediaType;
export type TitleKey = `${MediaType}:${number}`;

export type IsoDate = string;
export type IsoDateTime = string;

/** Browse sort keys. `popularity_desc` is used by the home "Trending" rail only (PRD D5). */
export type SortKey =
  'release_desc' | 'release_asc' | 'rating_desc' | 'rating_asc' | 'popularity_desc';

export type WatchedWhere = 'cinema' | 'streaming' | 'tv' | 'other';

/** Poster palette computed at ingest (DESIGN §4.2). Hex colours are '#rrggbb'. */
export interface Palette {
  /** Most characterful colour (heaviest saturated bin). */
  vibrant: string;
  /** Mean "mood" colour. */
  base: string;
  /** vibrant clamped to relative luminance <= 0.06. Use for --tint-1. */
  tint1: string;
  /** base clamped to relative luminance <= 0.02. Use for --tint-2. */
  tint2: string;
  /** 8x12 WebP data URI for the blurred-poster layer, or null. */
  lqip: string | null;
  /** Algorithm version; bump to force recomputation. */
  v: 1;
}

export interface Genre {
  id: number;
  name: string;
}

/**
 * Everything a ticket card / list row needs. Comes from catalog_index; never requires a TMDB or OMDb call.
 * IMDb fields (ADR-008) are filled by the nightly job from OMDb and cached on the catalogue row.
 */
export interface TitleSummary {
  key: TitleKey;
  mediaType: MediaType;
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string;
  /** URL slug, e.g. "dune-part-two". Route: /title/{mediaType}/{tmdbId}-{slug} */
  slug: string;
  /** Movie primary release date or TV first-air date. */
  releaseDate: IsoDate;
  year: number;
  /** TMDB community average, 0–10, one decimal. Always present (curation input). */
  voteAverage: number;
  voteCount: number;
  /**
   * IMDb user rating 1.0–10.0 (one decimal) via OMDb, or null when unknown (no imdbId, OMDb "N/A",
   * or not fetched yet). UI: show the "IMDb x.x" chip only when non-null — never render null as 0.
   */
  imdbRating: number | null;
  /** IMDb vote count via OMDb, or null when unknown. */
  imdbVotes: number | null;
  popularity: number;
  genres: Genre[];
  posterPath: string | null;
  backdropPath: string | null;
  palette: Palette | null;
  /** <= 300 chars. */
  overviewShort: string;
  /** Movies only (null if unknown). */
  runtimeMinutes: number | null;
  /** TV only (null if unknown). */
  seasonCount: number | null;
  /** False = hidden from browse/search by the curation rule but still reachable by URL (PRD D4). */
  isListed: boolean;
}

export interface CastMember {
  name: string;
  character: string;
  profilePath: string | null;
}

export interface Trailer {
  site: 'YouTube' | 'Vimeo';
  key: string;
  name: string;
}

/** Read-only review from TMDB's community (PRD D11). Attributed, never editable. */
export interface TmdbReview {
  id: string;
  author: string;
  /** TMDB author rating 0–10, if given. */
  rating: number | null;
  content: string;
  createdAt: IsoDateTime;
  url: string;
}

/**
 * RESERVED for the deterministic "Worth it?" decision block (PRD §4.2 / D14). Every field is optional
 * until the PM spec is handed over: producers may omit them and the UI must treat "absent" as "unknown"
 * (hide the line). Everything here is computed from API data, our own mapping tables and templates —
 * never by an AI/LLM, at runtime or in the nightly job (BRIEF: no AI).
 */
export interface TitlePitchFields {
  /** Our own hand-written, spoiler-free one-liner (<= 120 chars). Not TMDB text. */
  pitchHook?: string | null;
  /** Up to 3 mood tags from our versioned genre/keyword mapping (e.g. "Slow burn"). */
  vibes?: string[];
  /** Age rating for the configured region, e.g. "PG-13", "TV-MA". */
  certification?: string | null;
  /** TV: typical episode length in minutes. */
  episodeRuntimeMinutes?: number | null;
  /** TV: TMDB series status, normalised. */
  seriesStatus?: 'returning' | 'ended' | 'canceled' | 'in_production' | 'planned' | null;
  /** TMDB recommendations filtered to our catalogue ("If you liked…"). */
  recommendationKeys?: TitleKey[];
}

/**
 * Full title page payload. `detailStatus`:
 * - 'fresh'      : fetched live (or cached < 24h)
 * - 'stale'      : TMDB failed, served from the last good copy (show "details may be out of date")
 * - 'index_only' : no detail available; only TitleSummary fields are real (show "More details unavailable")
 */
export interface TitleDetail extends TitleSummary, TitlePitchFields {
  overview: string;
  tagline: string | null;
  /** Movie: directors. TV: creators. */
  directors: string[];
  cast: CastMember[];
  trailer: Trailer | null;
  episodeCount: number | null;
  /** "S01–S04" style range is derived by the UI from seasonCount. */
  tmdbReviews: TmdbReview[];
  detailStatus: 'fresh' | 'stale' | 'index_only';
  fetchedAt: IsoDateTime | null;
}

/** Community aggregates (trigger-maintained in Postgres). */
export interface TitleStats {
  stubCount: number;
  reviewCount: number;
  /** Average user rating on the 1..10 scale; null until >= 5 ratings (PRD D6). */
  ratingAvg10: number | null;
  ratingCount: number;
}

export interface PublicProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  createdAt: IsoDateTime;
}

export interface ProfileStats {
  totalStubs: number;
  stubsThisYear: number;
  /** Stubs that are not the first stub of their title. */
  rewatches: number;
  titlesStubbed: number;
  reviewCount: number;
  mostStubbed: { title: TitleSummary; count: number } | null;
}

export interface ProfilePage {
  profile: PublicProfile;
  stats: ProfileStats;
  /** Palette of the most recently stubbed title (profile adaptive background), or null. */
  palette: Palette | null;
}

export interface Stub {
  id: string;
  userId: string;
  titleKey: TitleKey;
  watchedOn: IsoDate;
  watchedWhere: WatchedWhere | null;
  /** <= 280 chars. */
  note: string;
  /** 1-based: which watch of this title this stub is, ordered by (watchedOn, createdAt). */
  number: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface DiaryEntry extends Stub {
  title: TitleSummary;
}

/** One torn stub in the wallet: one per title, newest first. */
export interface WalletItem {
  title: TitleSummary;
  count: number;
  lastWatchedOn: IsoDate;
}

/** A Stubbed review. Stored only in our database; never posted to IMDb, TMDB or anyone else (ADR-008). */
export interface Review {
  id: string;
  titleKey: TitleKey;
  author: PublicProfile;
  /** 1..10 (half-star steps of a 5-star UI). */
  rating10: number;
  /** Plain text, <= 5000 chars. Render as text, never as HTML. */
  body: string;
  isSpoiler: boolean;
  stubId: string | null;
  /** The `number` of the linked stub ("STUB #2"), if any. */
  stubNumber: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Non-null if the body/rating changed after creation ("EDITED" tag). */
  editedAt: IsoDateTime | null;
}

export interface ReviewWithTitle extends Review {
  title: TitleSummary;
}

/** The signed-in user's relationship to one title. Always private (never CDN cached). */
export interface TitleState {
  stubCount: number;
  lastWatchedOn: IsoDate | null;
  /** True if a stub already exists for "today" (drives the "Stub again today?" confirm, C3-AC3). */
  hasStubToday: boolean;
  watchlisted: boolean;
  myReview: Review | null;
}

export interface SessionUser {
  id: string;
  email: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface Session {
  user: SessionUser;
}

/** Resolved once at boot on the server and passed to the UI (header pill, image mode). */
export interface AppMode {
  catalog: 'tmdb' | 'fixtures';
  data: 'supabase' | 'local';
  /** True if either side is non-live → show the "DEMO DATA" pill (PRD E2). */
  isDemo: boolean;
  /** 'tmdb' = hot-link image.tmdb.org; 'off' = always render generated posters (offline/E2E). */
  images: 'tmdb' | 'off';
  /** Demo credentials shown in the demo pill tooltip / auth sheet (demo mode only). */
  demoAccounts: { handle: string; email: string; password: string }[];
}

/** Keyset-paginated list. `nextCursor` is opaque; pass it back unchanged. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Total matching rows (catalog lists only; omitted elsewhere). */
  total?: number;
}

export interface CatalogQuery {
  type: TypeFilter;
  sort: SortKey;
  /** Optional TMDB genre ids (AND-less: any of). P1. */
  genreIds?: number[];
  cursor?: string | null;
  /** Default 20, max 50. */
  limit?: number;
}

export interface SearchResult {
  query: string;
  items: TitleSummary[];
  /**
   * True when nothing in the curated catalogue matched (PRD A4-AC2) — UI shows
   * "Not in Stubbed — we only list titles rated 6.5+". Never an error.
   */
  notInCatalog: boolean;
}

export type ReviewSort = 'newest' | 'highest';
