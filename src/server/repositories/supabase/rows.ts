/**
 * Postgres row → domain mapping + Postgres/PostgREST error → AppError mapping (live mode).
 * Pure; unit-tested in src/server/repositories/supabase/supabase.test.ts. OWNER: Backend.
 */
import { AppError, ERROR_COPY } from '@/lib/errors';
import { isTitleKey } from '@/lib/keys';
import type {
  Genre,
  MediaType,
  Palette,
  PublicProfile,
  Review,
  SeriesStatus,
  Stub,
  TitleEnrichment,
  TitleKey,
  TitleSummary,
  WatchedWhere,
  WatchStore,
} from '@/lib/types';
import type { StoredWatch } from '@/server/watch';

/** A `public.catalog_index` row as returned by PostgREST / to_jsonb(). */
export interface CatalogRow {
  title_key: string;
  media_type: MediaType;
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  slug: string;
  overview_short: string | null;
  release_date: string | null;
  vote_average: number | string;
  vote_count: number;
  imdb_rating: number | string | null;
  imdb_votes: number | null;
  popularity: number | string;
  genres: Genre[] | null;
  poster_path: string | null;
  backdrop_path: string | null;
  palette: Palette | null;
  runtime_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  episode_runtime: number | null;
  is_listed: boolean;
  tagline?: string | null;
  pitch_hook?: string | null;
  certification?: string | null;
  series_status?: SeriesStatus | null;
  keywords?: string[] | null;
  recommendation_keys?: string[] | null;
  /** v1.5 (ADR-012 §3). Absent before the where-to-watch migration → treated as never fetched. */
  watch?: unknown;
  watch_checked_at?: string | null;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const posOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n !== null && n > 0 ? n : null;
};

export function rowToSummary(r: CatalogRow): TitleSummary {
  const releaseDate = (r.release_date ?? '').slice(0, 10);
  return {
    key: r.title_key as TitleKey,
    mediaType: r.media_type,
    tmdbId: Number(r.tmdb_id),
    imdbId: r.imdb_id ?? null,
    title: r.title,
    originalTitle: r.original_title,
    slug: r.slug,
    releaseDate,
    year: Number(releaseDate.slice(0, 4)) || 0,
    voteAverage: numOrNull(r.vote_average) ?? 0,
    voteCount: Number(r.vote_count) || 0,
    imdbRating: posOrNull(r.imdb_rating),
    imdbVotes: numOrNull(r.imdb_votes),
    popularity: numOrNull(r.popularity) ?? 0,
    genres: Array.isArray(r.genres) ? r.genres : [],
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
    palette: r.palette ?? null,
    overviewShort: r.overview_short ?? '',
    runtimeMinutes: posOrNull(r.runtime_minutes),
    seasonCount: posOrNull(r.season_count),
    episodeCount: posOrNull(r.episode_count),
    episodeRuntimeMinutes: posOrNull(r.episode_runtime),
    isListed: Boolean(r.is_listed),
  };
}

export function rowToEnrichment(r: CatalogRow): TitleEnrichment {
  return {
    tagline: r.tagline ?? null,
    pitchHook: r.pitch_hook ?? null,
    certification: r.certification ?? null,
    seriesStatus: r.series_status ?? null,
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    recommendationKeys: (r.recommendation_keys ?? []).filter(isTitleKey) as TitleKey[],
  };
}

/** Stored availability of a row; a non-object `watch` (or a missing column) is "never fetched". */
export function rowToWatch(r: CatalogRow): StoredWatch {
  const w = r.watch;
  return {
    store: w && typeof w === 'object' && !Array.isArray(w) ? (w as WatchStore) : null,
    checkedAt: typeof r.watch_checked_at === 'string' ? r.watch_checked_at : null,
  };
}

export interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export function rowToProfile(r: ProfileRow): PublicProfile {
  return {
    id: r.id,
    handle: String(r.handle),
    displayName: r.display_name,
    bio: r.bio ?? '',
    avatarUrl: r.avatar_url ?? null,
    createdAt: r.created_at,
  };
}

/** `public.stub_details` / `user_diary()` row. */
export interface StubRow {
  id: string;
  user_id?: string;
  title_key: string;
  watched_on: string;
  watched_where: WatchedWhere | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  number: number;
}

export function rowToStub(r: StubRow, userId: string): Stub {
  return {
    id: r.id,
    userId: r.user_id ?? userId,
    titleKey: r.title_key as TitleKey,
    watchedOn: String(r.watched_on).slice(0, 10),
    watchedWhere: r.watched_where ?? null,
    note: r.note ?? '',
    number: Number(r.number) || 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** `public.review_details` row. */
export interface ReviewRow {
  id: string;
  user_id: string;
  title_key: string;
  rating_10: number;
  body: string;
  is_spoiler: boolean;
  stub_id: string | null;
  stub_number: number | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  author: PublicProfile;
}

export function rowToReview(r: ReviewRow): Review {
  return {
    id: r.id,
    titleKey: r.title_key as TitleKey,
    author: {
      id: r.author.id,
      handle: String(r.author.handle),
      displayName: r.author.displayName,
      bio: r.author.bio ?? '',
      avatarUrl: r.author.avatarUrl ?? null,
      createdAt: r.author.createdAt,
    },
    rating10: Number(r.rating_10),
    body: r.body ?? '',
    isSpoiler: Boolean(r.is_spoiler),
    stubId: r.stub_id ?? null,
    stubNumber: r.stub_number ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    editedAt: r.edited_at ?? null,
  };
}

/* ---------------- errors ---------------- */

export interface PgError {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
}

const invalid = (field: string, msg: string) =>
  new AppError('validation_failed', 'Please check the highlighted fields.', {
    fields: { [field]: msg },
  });

/**
 * Maps trigger/constraint/RLS errors to the contract's error model (API_CONTRACT §2).
 * `context` picks the right rate-limit copy.
 */
export function mapPgError(e: PgError, context: 'stub' | 'review' | 'other' = 'other'): AppError {
  const msg = e.message ?? '';
  if (e.code === 'P0001' && msg.includes('rate_limited')) {
    const m = /retry_after=(\d+)/.exec(e.hint ?? '');
    return new AppError(
      'rate_limited',
      context === 'review' ? ERROR_COPY.rate_limited_review : ERROR_COPY.rate_limited_stub,
      { retryAfter: m ? Number(m[1]) : 60 },
    );
  }
  if (e.code === '22023') {
    if (msg.includes('watched_on_in_future'))
      return invalid('watchedOn', "That date hasn't happened yet.");
    if (msg.includes('watched_on_before_release'))
      return invalid('watchedOn', 'That date is before this title came out.');
    if (msg.includes('stub_mismatch'))
      return invalid('stubId', 'That stub is not one of yours for this title.');
    return new AppError('validation_failed', 'Please check the highlighted fields.');
  }
  if (e.code === '23514' || e.code === '22001')
    return new AppError('validation_failed', 'Please check the highlighted fields.');
  if (e.code === 'P0002' || e.code === 'PGRST116')
    return new AppError('not_found', "This ticket doesn't exist.");
  if (e.code === '23505') return new AppError('conflict', 'That already exists.');
  if (e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST302' || e.code === '28000')
    return new AppError('unauthenticated', ERROR_COPY.unauthenticated);
  return new AppError('internal', 'Something went wrong. Try again.', { cause: e });
}

/** Unwraps a supabase-js result or throws the mapped AppError. */
export function unwrap<T>(
  res: { data: T | null; error: PgError | null },
  context: 'stub' | 'review' | 'other' = 'other',
): T {
  if (res.error) throw mapPgError(res.error, context);
  return res.data as T;
}
