/** IMDb rating badge via OMDb (P1, ADR-004). OWNER: Backend. `none` is the default. */
import type { RatingEnricher } from '@/server/ports';

export class NoRatingEnricher implements RatingEnricher {
  readonly name = 'none' as const;
  async getImdbRating(): Promise<null> {
    return null;
  }
}

/**
 * TODO(Backend): OmdbRatingEnricher — GET https://www.omdbapi.com/?i={imdbId}&apikey=KEY,
 * cache 7 days (fetch next.revalidate + rating_enrichment table), stop at 900 calls/day.
 */
