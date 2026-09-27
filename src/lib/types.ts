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
  /** TV only: total episodes (null if unknown). Drives the ticket time line (PRD F2). */
  episodeCount: number | null;
  /** TV only: typical minutes per episode (null if unknown → ticket prints "4 SEASONS" without hours). */
  episodeRuntimeMinutes: number | null;
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
 * Full title page payload. `detailStatus`:
 * - 'fresh'      : fetched live (or cached < 24h)
 * - 'stale'      : TMDB failed, served from the last good copy (show "details may be out of date")
 * - 'index_only' : no detail available; only TitleSummary fields are real (show "More details unavailable")
 */
export interface TitleDetail extends TitleSummary {
  overview: string;
  tagline: string | null;
  /** Movie: directors. TV: creators. */
  directors: string[];
  cast: CastMember[];
  trailer: Trailer | null;
  /** "S01–S04" style range is derived by the UI from seasonCount. */
  tmdbReviews: TmdbReview[];
  /** The "Worth it?" decision block (PRD §4.2, F1). Computed on read by rules, never by AI (D15). */
  worthIt: WorthIt;
  detailStatus: 'fresh' | 'stale' | 'index_only';
  fetchedAt: IsoDateTime | null;
  /**
   * v1.4 (ADR-011 §4): null = normal. 'catalog' = our DB was unreachable; the page is built from a
   * last-good copy or from TMDB (IMDb chip hidden, stubs/reviews/watchlist paused). 'community' = only
   * community stats are missing. The UI shows `data-testid="degraded-banner"` when non-null.
   * Always set by `dal.getTitle`; optional in the type only so the frozen fixture schema
   * (`src/fixtures/schema.ts`, an Omit of TitleDetail) needs no edit. Treat undefined as null.
   */
  degraded?: TitleDegraded;
}

export type TitleDegraded = null | 'community' | 'catalog';

/* ------------------------------------------------------------------ */
/* "Worth it?" (PRD §4.2, Epic F). Deterministic: stored data + rules  */
/* + templates only (D15, no AI). Rules: src/lib/worth-it.ts.          */
/* ------------------------------------------------------------------ */

/** Mood tags from our versioned mapping table (src/lib/vibes.ts). Labels are <= 18 chars. */
export type VibeId =
  | 'feel_good'
  | 'mind_bending'
  | 'slow_burn'
  | 'edge_of_seat'
  | 'tearjerker'
  | 'cosy'
  | 'dark'
  | 'funny'
  | 'epic'
  | 'true_story'
  | 'family_friendly'
  | 'bingeable'
  | 'romantic'
  | 'thought_provoking'
  | 'action_packed'
  | 'spooky'
  | 'stylish'
  | 'quirky';

export interface Vibe {
  id: VibeId;
  /** e.g. "Slow burn". */
  label: string;
}

export type SeriesStatus =
  'returning' | 'ended' | 'limited' | 'canceled' | 'in_production' | 'planned';

export interface PitchHook {
  /** <= 120 chars, spoiler-free, one sentence. */
  text: string;
  /**
   * 'stubbed' = our hand-written hook · 'tmdb_tagline' / 'tmdb_overview' = from TMDB (UI shows "FROM TMDB")
   * · 'template' = built from structured fields ("A 2016 drama movie from Jim Jarmusch.").
   */
  source: 'stubbed' | 'tmdb_tagline' | 'tmdb_overview' | 'template';
}

export type TimeBadge = 'short_one' | 'long_one' | 'weekend_binge' | 'big_commitment';

export interface TimeCommitment {
  /** Movie runtime or TV total (episodes × episode runtime) in minutes; null when unknown. */
  totalMinutes: number | null;
  badge: TimeBadge | null;
  /** Detail-page print line, e.g. "2H 46M · LONG ONE" or "4 SEASONS · 36 EPS · ~55 MIN · ≈33 H · ENDED". */
  label: string;
  /** Plain-language version for screen readers. */
  ariaLabel: string;
}

export type VerdictKey =
  'widely_loved' | 'well_liked' | 'solid_pick' | 'split_opinions' | 'mixed_reviews';

export interface Verdict {
  key: VerdictKey;
  /** "Widely loved" | "Well liked" | "Solid pick" | "Split opinions" | "Mixed reviews". Never a number. */
  word: string;
  /** "Based on TMDB, IMDb and 12 Stubbed ratings". Names only the sources used. */
  sourceLine: string;
  /** Only for split_opinions, e.g. "IMDb rates it higher than TMDB". */
  splitNote: string | null;
  sources: ('tmdb' | 'imdb' | 'stubbed')[];
}

/**
 * Per-title enrichment stored on the catalogue row (live: nightly enrich step from TMDB; demo: fixtures).
 * These are the stored inputs of "Worth it?" besides TitleSummary. `pitchHook` is ours (editorial).
 */
export interface TitleEnrichment {
  tagline: string | null;
  /** Our hand-written, spoiler-free one-liner (<= 120 chars). Never overwritten by the sync. */
  pitchHook: string | null;
  certification: string | null;
  seriesStatus: SeriesStatus | null;
  /** TMDB keyword names, lowercased. Only allowlisted ones map to vibes (src/lib/vibes.ts). */
  keywords: string[];
  /** TMDB recommendations/similar as keys; filtered to listed catalogue titles on read. */
  recommendationKeys: TitleKey[];
}

/** The detail-page "Worth it?" block. Every part may be missing; the UI hides missing lines (F1-AC2). */
export interface WorthIt {
  hook: PitchHook | null;
  /** 0–3 tags. */
  vibes: Vibe[];
  time: TimeCommitment | null;
  /** Age rating for the configured region (CERTIFICATION_REGION, default US), e.g. "PG-13". */
  certification: string | null;
  verdict: Verdict;
  /**
   * P1 "If you liked…": recommended titles that are in our curated catalogue, most popular first (<= 6).
   * The UI shows the first one, or — in a private island — the first one the user has stubbed
   * ("You stubbed …"). Empty = hide the line.
   */
  likeCandidates: TitleSummary[];
  /** "{hook} {time} · {verdict}", <= 160 chars, for meta description / og:description (F5). */
  metaDescription: string;
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
  /**
   * True when demo data is not durable (a production/public demo, DEMO_RESET_ON_BOOT, in-memory or
   * Vercel /tmp store) → the pill reads "Demo: data resets" (GAP-04). Absent/false otherwise.
   */
  demoResets?: boolean;
}

/** Keyset-paginated list. `nextCursor` is opaque; pass it back unchanged. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  /** Total matching rows (catalogue lists and the diary; omitted elsewhere). */
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
