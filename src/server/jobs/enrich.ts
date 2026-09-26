/**
 * Nightly enrich step (tickets + "Worth it?", PRD §4.2): one TMDB detail call per new or stale row,
 *   GET /3/{movie|tv}/{id}?append_to_response=external_ids,keywords,recommendations,similar,
 *       release_dates (movie) | content_ratings (tv)
 * mapped by the pure `mapTmdbEnrichment()` below and stored with rpc('catalog_set_enrichment').
 * Deterministic field mapping only — no AI/LLM (D15). pitch_hook is ours and never written here.
 * OWNER: Backend (reference mapping by Architect, tests in tests/server/enrich.test.ts).
 */
import { normalizeKeyword } from '@/lib/vibes';
import type { MediaType, SeriesStatus, TitleKey } from '@/lib/types';

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
  ].join(',');
}
