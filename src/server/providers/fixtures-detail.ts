/** Demo detail provider: serves TitleDetail fields straight from the bundled fixtures. No network. */
import { toTitleKey } from '@/lib/keys';
import type { MediaType } from '@/lib/types';
import type { CatalogDetailProvider, DetailFields } from '@/server/ports';
import { fixtureTitles } from '@/server/repositories/memory/store';

export class FixturesDetailProvider implements CatalogDetailProvider {
  readonly name = 'fixtures' as const;

  async getDetail(mediaType: MediaType, tmdbId: number) {
    const key = toTitleKey(mediaType, tmdbId);
    const t = fixtureTitles().find((x) => x.key === key);
    if (!t) return null;
    const fields: DetailFields = {
      overview: t.overview,
      tagline: t.tagline,
      directors: t.directors,
      cast: t.cast,
      trailer: t.trailer,
      tmdbReviews: t.tmdbReviews,
    };
    return { fields };
  }
}
