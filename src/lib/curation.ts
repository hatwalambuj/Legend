/**
 * The curation rule (ADR-003). One function, used by the sync job, the demo store and tests.
 * Postgres mirrors it in the sync job's is_listed computation — never re-implement it elsewhere.
 * OWNER: Architect. FROZEN.
 */
import type { MediaType } from './types';

export interface CurationRule {
  minRating: number; // CATALOG_MIN_RATING, default 6.5
  minVotesMovie: number; // CATALOG_MIN_VOTES_MOVIE, default 200
  minVotesTv: number; // CATALOG_MIN_VOTES_TV, default 100
  /** Hysteresis: already-listed titles stay listed down to this rating (default = minRating, i.e. off). */
  keepRating: number; // CATALOG_KEEP_RATING
  /** TMDB TV genres excluded from the catalogue: Talk 10767, News 10763, Reality 10764 (default). */
  excludeTvGenreIds: number[]; // CATALOG_EXCLUDE_TV_GENRES
}

export const DEFAULT_CURATION_RULE: CurationRule = {
  minRating: 6.5,
  minVotesMovie: 200,
  minVotesTv: 100,
  keepRating: 6.5,
  excludeTvGenreIds: [10767, 10763, 10764],
};

export interface CurationInput {
  mediaType: MediaType;
  voteAverage: number;
  voteCount: number;
  genreIds: number[];
  releaseDate: string | null;
  adult?: boolean;
  /** Whether the title was listed after the previous sync (for hysteresis). */
  wasListed?: boolean;
}

/** Returns true if the title belongs in browse/search. `today` = 'YYYY-MM-DD'. */
export function isListed(t: CurationInput, rule: CurationRule, today: string): boolean {
  if (t.adult) return false;
  if (!t.releaseDate || t.releaseDate > today) return false;
  const minVotes = t.mediaType === 'movie' ? rule.minVotesMovie : rule.minVotesTv;
  if (t.voteCount < minVotes) return false;
  if (t.mediaType === 'tv' && t.genreIds.some((g) => rule.excludeTvGenreIds.includes(g)))
    return false;
  // Ratings are compared at one-decimal precision, like numeric(3,1) in Postgres.
  const rating = Math.round(t.voteAverage * 10) / 10;
  const threshold = t.wasListed ? Math.min(rule.keepRating, rule.minRating) : rule.minRating;
  return rating >= threshold;
}
