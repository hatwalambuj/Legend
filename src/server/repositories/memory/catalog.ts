/**
 * Demo catalogue index over the bundled fixtures. Same semantics as `public.catalog_page()` in SQL:
 * curation via isListed(), order + keyset cursor via src/lib/catalog-order.ts.
 * v1.5: demo "Where to watch" availability from src/fixtures/watch.json (ADR-012 §8, W6): 20 titles ×
 * US/GB/IN; `watch_checked_at = now − ageDays` on every read, so the stale fixture stays stale and the
 * others stay fresh forever. A title not in the file has no availability (block hidden). No network.
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
  TitleEnrichment,
  TitleKey,
  TitleSummary,
  TypeFilter,
} from '@/lib/types';
import watchJson from '@/fixtures/watch.json';
import type { FixtureTitle, FixtureWatch } from '@/fixtures/schema';
import { env, today } from '@/server/env';
import type { CatalogIndexRepository, HealthProbe, WatchProviderRepository } from '@/server/ports';
import type { ProviderDirectory, StoredWatch } from '@/server/watch';
import { fixtureTitles } from './store';

const watchFixtures = watchJson as unknown as FixtureWatch;
const watchByKey: ReadonlyMap<TitleKey, FixtureWatch['titles'][number]> = new Map(
  watchFixtures.titles.map((t) => [t.key, t]),
);

/** Demo availability of one title (ADR-012 §8), or undefined when the title has none. */
export function fixtureWatch(key: TitleKey, now: number = Date.now()): StoredWatch | undefined {
  const w = watchByKey.get(key);
  if (!w) return undefined;
  return { store: w.watch, checkedAt: new Date(now - w.ageDays * 86_400_000).toISOString() };
}

/** Demo provider names + monogram tiles; logos are always null (nothing fetched, W6-AC3). */
export class MemoryWatchProviders implements WatchProviderRepository {
  private static readonly map: ProviderDirectory = new Map(
    watchFixtures.providers.map((p) => [
      p.id,
      { name: p.name, logoPath: null, monogram: p.monogram, tile: p.tile },
    ]),
  );

  async all(): Promise<ProviderDirectory> {
    return MemoryWatchProviders.map;
  }
}

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
    episodeCount: t.episodeCount,
    episodeRuntimeMinutes: t.episodeRuntimeMinutes,
    isListed: listed,
  };
}

export function toEnrichment(t: FixtureTitle): TitleEnrichment {
  return {
    tagline: t.tagline,
    pitchHook: t.pitchHook,
    certification: t.certification,
    seriesStatus: t.seriesStatus,
    keywords: t.keywords,
    recommendationKeys: t.recommendationKeys,
  };
}

interface Indexed {
  all: TitleSummary[];
  listed: TitleSummary[];
  byKey: Map<TitleKey, TitleSummary>;
  enrichment: Map<TitleKey, TitleEnrichment>;
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
    enrichment: new Map(fixtureTitles().map((t) => [t.key, toEnrichment(t)])),
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

  async getEntry(mediaType: MediaType, tmdbId: number) {
    const key = toTitleKey(mediaType, tmdbId);
    const summary = index().byKey.get(key);
    const enrichment = index().enrichment.get(key);
    return summary && enrichment ? { summary, enrichment, watch: fixtureWatch(key) } : null;
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

  /** Demo: the fixture count; there is no sync. */
  async probe(): Promise<HealthProbe> {
    return { catalogCount: index().listed.length, lastFullSyncAt: null };
  }
}

/** Synchronous lookup (listed or not) for the demo user-data repositories. */
export function summaryByKey(key: TitleKey): TitleSummary | undefined {
  return index().byKey.get(key);
}

/** Tests only. */
export function resetCatalogIndexCache(): void {
  cache = null;
}
