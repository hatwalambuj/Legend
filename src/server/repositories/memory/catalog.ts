/**
 * Demo catalogue index over the bundled fixtures. Same semantics as `public.catalog_page()` in SQL:
 * curation via isListed(), order + keyset cursor via src/lib/catalog-order.ts.
 * OWNER: Backend (reference implementation by Architect).
 */
import { paginate } from '@/lib/catalog-order';
import { isListed } from '@/lib/curation';
import { toTitleKey } from '@/lib/keys';
import { normalizeSearch } from '@/lib/text';
import type {
  CatalogQuery,
  MediaType,
  Page,
  TitleKey,
  TitleSummary,
  TypeFilter,
} from '@/lib/types';
import type { FixtureTitle } from '@/fixtures/schema';
import { env, today } from '@/server/env';
import type { CatalogIndexRepository } from '@/server/ports';
import { fixtureTitles } from './store';

export function toSummary(t: FixtureTitle, listed: boolean): TitleSummary {
  return {
    key: t.key,
    mediaType: t.mediaType,
    tmdbId: t.tmdbId,
    imdbId: t.imdbId,
    title: t.title,
    originalTitle: t.originalTitle,
    slug: t.slug,
    releaseDate: t.releaseDate,
    year: t.year,
    voteAverage: t.voteAverage,
    voteCount: t.voteCount,
    imdbRating: t.imdbRating,
    imdbVotes: t.imdbVotes,
    popularity: t.popularity,
    genres: t.genres,
    posterPath: t.posterPath,
    backdropPath: t.backdropPath,
    palette: t.palette,
    overviewShort: t.overviewShort,
    runtimeMinutes: t.runtimeMinutes,
    seasonCount: t.seasonCount,
    isListed: listed,
  };
}

interface Indexed {
  all: TitleSummary[];
  listed: TitleSummary[];
  byKey: Map<TitleKey, TitleSummary>;
  searchText: Map<TitleKey, string>;
}

let cache: Indexed | null = null;

function index(): Indexed {
  if (cache) return cache;
  const rule = env().curation;
  const day = today();
  const all = fixtureTitles().map((t) =>
    toSummary(
      t,
      isListed(
        {
          mediaType: t.mediaType,
          voteAverage: t.voteAverage,
          voteCount: t.voteCount,
          genreIds: t.genres.map((g) => g.id),
          releaseDate: t.releaseDate,
        },
        rule,
        day,
      ),
    ),
  );
  cache = {
    all,
    listed: all.filter((t) => t.isListed),
    byKey: new Map(all.map((t) => [t.key, t])),
    searchText: new Map(
      fixtureTitles().map((t) => [t.key, normalizeSearch(`${t.title} ${t.originalTitle}`)]),
    ),
  };
  return cache;
}

function byType(rows: TitleSummary[], type: TypeFilter): TitleSummary[] {
  return type === 'all' ? rows : rows.filter((r) => r.mediaType === type);
}

export class MemoryCatalogIndex implements CatalogIndexRepository {
  async list(q: CatalogQuery): Promise<Page<TitleSummary>> {
    let rows = byType(index().listed, q.type);
    if (q.genreIds?.length)
      rows = rows.filter((r) => r.genres.some((g) => q.genreIds!.includes(g.id)));
    const { items, nextCursor } = paginate(rows, q.sort, q.cursor, q.limit ?? 20);
    return { items, nextCursor, total: rows.length };
  }

  async trending(type: TypeFilter, limit: number): Promise<TitleSummary[]> {
    return paginate(byType(index().listed, type), 'popularity_desc', null, limit).items;
  }

  async search(normalizedQuery: string, type: TypeFilter, limit: number): Promise<TitleSummary[]> {
    if (!normalizedQuery) return [];
    const { searchText } = index();
    const hits = byType(index().listed, type).filter((t) =>
      searchText.get(t.key)?.includes(normalizedQuery),
    );
    // Prefix matches first, then popularity (mirrors similarity DESC, popularity DESC in SQL closely enough).
    return hits
      .sort((a, b) => {
        const pa = searchText.get(a.key)!.startsWith(normalizedQuery) ? 0 : 1;
        const pb = searchText.get(b.key)!.startsWith(normalizedQuery) ? 0 : 1;
        return pa - pb || b.popularity - a.popularity;
      })
      .slice(0, limit);
  }

  async get(mediaType: MediaType, tmdbId: number): Promise<TitleSummary | null> {
    return index().byKey.get(toTitleKey(mediaType, tmdbId)) ?? null;
  }

  async getMany(keys: TitleKey[]): Promise<Map<TitleKey, TitleSummary>> {
    const m = new Map<TitleKey, TitleSummary>();
    for (const k of keys) {
      const t = index().byKey.get(k);
      if (t) m.set(k, t);
    }
    return m;
  }

  async count(): Promise<number> {
    return index().listed.length;
  }

  async lastSyncAt(): Promise<string | null> {
    return null;
  }
}

/** Tests only. */
export function resetCatalogIndexCache(): void {
  cache = null;
}
