/**
 * Nightly enrich step (tickets + "Worth it?", PRD §4.2): one TMDB detail call per new or stale row,
 *   GET /3/{movie|tv}/{id}?append_to_response=external_ids,keywords,recommendations,similar,
 *       release_dates (movie) | content_ratings (tv),watch/providers
 * mapped by the pure `mapTmdbEnrichment()` below and stored with rpc('catalog_set_enrichment').
 * The appended `watch/providers` part (ADR-012 §1) is mapped by `mapTmdbWatch()` (./watch-map.ts) and
 * stored with rpc('catalog_set_watch') in the same batch: zero extra TMDB calls.
 * Deterministic field mapping only — no AI/LLM (D15). pitch_hook is ours and never written here.
 * OWNER: Backend (reference mapping by Architect, tests in tests/server/enrich.test.ts).
 */
import { normalizeKeyword } from '@/lib/vibes';
import { normalizeSearch, slugify, sortTitle, truncate } from '@/lib/text';
import type { Genre, MediaType, SeriesStatus, TitleKey } from '@/lib/types';

/** Row shape accepted by public.catalog_set_enrichment(jsonb). */
export interface EnrichmentRow {
  id: number;
  imdb_id: string | null;
  runtime_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  episode_runtime: number | null;
  series_status: SeriesStatus | null;
  tagline: string | null;
  certification: string | null;
  keywords: string[];
  recommendation_keys: TitleKey[];
  /**
   * v1.6 (ADR-013 C-06): catalogue core fields from the same detail body. The SQL applies them only to
   * UNLISTED rows (discover owns listed rows) and stamps synced_at; is_listed/pitch_hook never change.
   */
  core?: EnrichmentCore;
}

export interface EnrichmentCore {
  title: string;
  original_title: string;
  slug: string;
  sort_title: string;
  search_text: string;
  overview_short: string;
  release_date: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genre_ids: number[];
  genres: Genre[];
}

export const RECOMMENDATION_LIMIT = 12;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 32767 ? Math.round(v) : null;
const tmdbIdOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1e10 ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** TMDB TV `status` + `type` → our SeriesStatus. "Miniseries" wins (a limited series). */
export function mapSeriesStatus(status: unknown, type: unknown): SeriesStatus | null {
  if (type === 'Miniseries') return 'limited';
  switch (status) {
    case 'Returning Series':
      return 'returning';
    case 'Ended':
      return 'ended';
    case 'Canceled':
    case 'Cancelled':
      return 'canceled';
    case 'In Production':
      return 'in_production';
    case 'Planned':
    case 'Pilot':
      return 'planned';
    default:
      return null;
  }
}

/** Movie: prefer theatrical (type 3), then any non-empty certification for the region. */
function movieCertification(detail: Obj, region: string): string | null {
  const entry = arr(obj(detail.release_dates).results)
    .map(obj)
    .find((r) => r.iso_3166_1 === region);
  const dates = arr(entry?.release_dates).map(obj);
  const pick = (d: Obj[]) => d.map((x) => str(x.certification)).find(Boolean) ?? null;
  return pick(dates.filter((d) => d.type === 3)) ?? pick(dates);
}

function tvCertification(detail: Obj, region: string): string | null {
  const entry = arr(obj(detail.content_ratings).results)
    .map(obj)
    .find((r) => r.iso_3166_1 === region);
  return str(entry?.rating);
}

function recommendationKeys(detail: Obj, mediaType: MediaType, selfId: number): TitleKey[] {
  const out: TitleKey[] = [];
  const seen = new Set<string>();
  for (const src of [obj(detail.recommendations).results, obj(detail.similar).results]) {
    for (const r of arr(src).map(obj)) {
      const id = tmdbIdOf(r.id);
      const type = (r.media_type as MediaType | undefined) ?? mediaType;
      if (!id || (type !== 'movie' && type !== 'tv') || (type === mediaType && id === selfId))
        continue;
      const key = `${type}:${id}` as TitleKey;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= RECOMMENDATION_LIMIT) return out;
    }
  }
  return out;
}

/** Pure mapping of one TMDB detail response (with the appends above) to an enrichment row. */
export function mapTmdbEnrichment(
  rowId: number,
  mediaType: MediaType,
  tmdbId: number,
  body: unknown,
  region = 'US',
): EnrichmentRow {
  const d = obj(body);
  const imdb = str(obj(d.external_ids).imdb_id) ?? str(d.imdb_id);
  const kw = mediaType === 'movie' ? obj(d.keywords).keywords : obj(d.keywords).results;
  const keywords = [
    ...new Set(
      arr(kw)
        .map((k) => str(obj(k).name))
        .filter((k): k is string => k !== null)
        .map(normalizeKeyword),
    ),
  ];
  const epRuntime =
    arr(d.episode_run_time)
      .map(posInt)
      .find((n) => n !== null) ?? posInt(obj(d.last_episode_to_air).runtime);
  return {
    id: rowId,
    imdb_id: imdb && /^tt\d{7,10}$/.test(imdb) ? imdb : null,
    runtime_minutes: mediaType === 'movie' ? posInt(d.runtime) : null,
    season_count: mediaType === 'tv' ? posInt(d.number_of_seasons) : null,
    episode_count: mediaType === 'tv' ? posInt(d.number_of_episodes) : null,
    episode_runtime: mediaType === 'tv' ? (epRuntime ?? null) : null,
    series_status: mediaType === 'tv' ? mapSeriesStatus(d.status, d.type) : null,
    tagline: str(d.tagline),
    certification:
      mediaType === 'movie' ? movieCertification(d, region) : tvCertification(d, region),
    keywords,
    recommendation_keys: recommendationKeys(d, mediaType, tmdbId),
  };
}

export function enrichmentAppends(mediaType: MediaType): string {
  return [
    'external_ids',
    'keywords',
    'recommendations',
    'similar',
    mediaType === 'movie' ? 'release_dates' : 'content_ratings',
    // ADR-012 §1: availability rides on the same call (6 appends, TMDB allows 20).
    'watch/providers',
  ].join(',');
}

const isoDay = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/**
 * v1.6 (ADR-013 C-06): the catalogue core of a TMDB detail body (same normalisation as discover:
 * src/lib/text.ts). null when the body has no title (never overwrite a row with an empty one).
 */
export function mapTmdbCore(mediaType: MediaType, body: unknown): EnrichmentCore | null {
  const d = obj(body);
  const title = str(mediaType === 'movie' ? d.title : d.name);
  if (!title) return null;
  const originalTitle = str(mediaType === 'movie' ? d.original_title : d.original_name) ?? title;
  const genres: Genre[] = arr(d.genres)
    .map(obj)
    .flatMap((g) =>
      typeof g.id === 'number' && Number.isInteger(g.id) && g.id > 0
        ? [{ id: g.id, name: str(g.name) ?? 'Other' }]
        : [],
    );
  const path = (v: unknown) => (typeof v === 'string' && /^\/[\w.-]+$/.test(v) ? v : null);
  return {
    title,
    original_title: originalTitle,
    slug: slugify(title),
    sort_title: sortTitle(title),
    search_text: normalizeSearch(`${title} ${originalTitle}`),
    overview_short: truncate((str(d.overview) ?? '').replace(/\s+/g, ' '), 300),
    release_date: isoDay(mediaType === 'movie' ? d.release_date : d.first_air_date),
    vote_average: Math.round(Math.min(Math.max(num(d.vote_average), 0), 10) * 10) / 10,
    vote_count: Math.max(0, Math.round(num(d.vote_count))),
    popularity: Math.max(0, num(d.popularity)),
    poster_path: path(d.poster_path),
    backdrop_path: path(d.backdrop_path),
    genre_ids: genres.map((g) => g.id),
    genres,
  };
}
