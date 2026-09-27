/**
 * Title pages survive a database outage (ADR-011 §4): an in-process last-good copy of catalogue entries,
 * and a pure TMDB-derived summary when there is none. Used only by `dal.getTitle`. OWNER: Backend.
 * Per instance on serverless (may be empty after a cold start): acceptable by the ADR.
 */
import { isListed, type CurationRule } from '@/lib/curation';
import { toTitleKey } from '@/lib/keys';
import { slugify, truncate } from '@/lib/text';
import type { MediaType, TitleEnrichment, TitleKey, TitleSummary } from '@/lib/types';
import type { DetailResult } from './ports';

export interface CatalogEntry {
  summary: TitleSummary;
  enrichment: TitleEnrichment;
}

export const EMPTY_ENRICHMENT: TitleEnrichment = {
  tagline: null,
  pitchHook: null,
  certification: null,
  seriesStatus: null,
  keywords: [],
  recommendationKeys: [],
};

/** Bounded LRU (Map insertion order); filled on every successful `getEntry`. */
export class LastGoodEntries {
  private readonly map = new Map<TitleKey, CatalogEntry>();
  constructor(private readonly max = 1000) {}

  set(key: TitleKey, entry: CatalogEntry): void {
    this.map.delete(key);
    this.map.set(key, entry);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get(key: TitleKey): CatalogEntry | undefined {
    return this.map.get(key);
  }

  get size(): number {
    return this.map.size;
  }
}

/**
 * A catalogue summary rebuilt from the TMDB detail payload (ADR-011 §4.1b): `isListed` by the curation
 * rule, `palette: null` (genre tint), IMDb fields null (chip hidden, ADR-008). Null when the payload has
 * no catalogue fields (an old L2 cache copy).
 */
export function summaryFromDetail(
  mediaType: MediaType,
  tmdbId: number,
  detail: DetailResult,
  rule: CurationRule,
  today: string,
): TitleSummary | null {
  const s = detail.source;
  if (!s) return null;
  const releaseDate = s.releaseDate ?? '';
  const patch = detail.summaryPatch ?? {};
  return {
    key: toTitleKey(mediaType, tmdbId),
    mediaType,
    tmdbId,
    imdbId: s.imdbId,
    title: s.title,
    originalTitle: s.originalTitle,
    slug: slugify(s.title),
    releaseDate,
    year: Number(releaseDate.slice(0, 4)) || 0,
    voteAverage: s.voteAverage,
    voteCount: s.voteCount,
    imdbRating: null,
    imdbVotes: null,
    popularity: s.popularity,
    genres: s.genres,
    posterPath: s.posterPath,
    backdropPath: s.backdropPath,
    palette: null,
    overviewShort: truncate(detail.fields.overview.replace(/\s+/g, ' ').trim(), 300),
    runtimeMinutes: mediaType === 'movie' ? (patch.runtimeMinutes ?? null) : null,
    seasonCount: mediaType === 'tv' ? (patch.seasonCount ?? null) : null,
    episodeCount: mediaType === 'tv' ? (patch.episodeCount ?? null) : null,
    episodeRuntimeMinutes: null,
    isListed: isListed(
      {
        mediaType,
        voteAverage: s.voteAverage,
        voteCount: s.voteCount,
        genreIds: s.genres.map((g) => g.id),
        releaseDate: s.releaseDate,
        adult: s.adult,
      },
      rule,
      today,
    ),
  };
}
