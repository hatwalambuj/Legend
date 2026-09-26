/**
 * Data-access layer: the ONLY server module pages import (`import { dal } from '@/server/dal'`).
 * Implements the frozen `DataAccess` interface from src/lib/data-access.ts.
 * OWNER: Backend. The scaffold wires catalogue reads end-to-end in demo mode; the rest delegates to
 * repositories that Backend completes.
 */
import 'server-only';
import { cache } from 'react';
import { AppError } from '@/lib/errors';
import type { DataAccess } from '@/lib/data-access';
import { normalizeSearch } from '@/lib/text';
import type { TitleDetail, TitleSummary } from '@/lib/types';
import { buildWorthIt } from '@/lib/worth-it';
import { container } from './container';
import { env, today } from './env';

const clampLimit = (n: number | undefined, def = 20) => Math.min(Math.max(n ?? def, 1), 50);

/** Per-request memoised session (React cache dedupes across a single render). */
const getSession = cache(async () => container().auth.getSession());

export const dal: DataAccess = {
  getMode: () => env().mode,

  async listCatalog(query) {
    return container().catalog.list({ ...query, limit: clampLimit(query.limit) });
  },

  async listTrending(type, limit = 10) {
    return container().catalog.trending(type, clampLimit(limit, 10));
  },

  async searchCatalog(q, type = 'all', limit = 20) {
    const norm = normalizeSearch(q);
    const items = norm ? await container().catalog.search(norm, type, clampLimit(limit)) : [];
    return { query: q, items, notInCatalog: norm.length > 0 && items.length === 0 };
  },

  async getTitle(mediaType, tmdbId) {
    const c = container();
    const entry = await c.catalog.getEntry(mediaType, tmdbId);
    if (!entry) return null; // TODO(Backend, live): lazy-insert unlisted titles reachable by URL (SYSTEM_DESIGN §4.4)
    const { summary, enrichment } = entry;
    const [stats, recommended, base] = await Promise.all([
      c.titleStates.stats(summary.key),
      c.catalog.getMany(enrichment.recommendationKeys),
      loadDetail(summary, enrichment.tagline),
    ]);
    // "Worth it?" is computed on read from stored data by pure rules (PRD §4.2, D15: no AI).
    const worthIt = buildWorthIt({
      title: base,
      enrichment: { ...enrichment, tagline: base.tagline ?? enrichment.tagline },
      overview: base.overview,
      directors: base.directors,
      stats,
      recommended: [...recommended.values()],
    });
    return { ...base, worthIt };
  },

  async getTitleStats(key) {
    return container().titleStates.stats(key);
  },

  async listTitleReviews(key, opts = {}) {
    return container().reviews.listForTitle(key, {
      sort: opts.sort ?? 'newest',
      cursor: opts.cursor,
      limit: clampLimit(opts.limit),
    });
  },

  async getProfile(handle) {
    const c = container();
    const profile = await c.profiles.getByHandle(handle);
    if (!profile) return null;
    const stats = await c.profiles.stats(profile.id, Number(today().slice(0, 4)));
    // TODO(Backend): palette of the MOST RECENTLY stubbed title (DESIGN §4.1), not the most-stubbed one.
    return { profile, stats, palette: stats.mostStubbed?.title.palette ?? null };
  },

  async listWallet(handle, opts = {}) {
    const c = container();
    const p = await c.profiles.getByHandle(handle);
    if (!p) return { items: [], nextCursor: null };
    return c.stubs.wallet(p.id, { cursor: opts.cursor, limit: clampLimit(opts.limit, 40) });
  },

  async listDiary(handle, opts = {}) {
    const c = container();
    const p = await c.profiles.getByHandle(handle);
    if (!p) return { items: [], nextCursor: null };
    return c.stubs.diary(p.id, {
      type: opts.type ?? 'all',
      cursor: opts.cursor,
      limit: clampLimit(opts.limit, 40),
    });
  },

  async listProfileReviews(handle, opts = {}) {
    const c = container();
    const p = await c.profiles.getByHandle(handle);
    if (!p) return { items: [], nextCursor: null };
    return c.reviews.listForUser(p.id, { cursor: opts.cursor, limit: clampLimit(opts.limit) });
  },

  getSession,

  async myTitleStates(keys) {
    const s = await getSession();
    if (!s || keys.length === 0) return {};
    return container().titleStates.states(s.user.id, keys, today());
  },

  async myWatchlist(opts = {}) {
    const s = await getSession();
    if (!s) throw new AppError('unauthenticated', 'Sign in to see your watchlist.');
    return container().watchlist.list(s.user.id, {
      cursor: opts.cursor,
      limit: clampLimit(opts.limit),
    });
  },
};

type DetailWithoutPitch = Omit<TitleDetail, 'worthIt'>;

async function loadDetail(
  summary: TitleSummary,
  storedTagline: string | null,
): Promise<DetailWithoutPitch> {
  try {
    const d = await container().detail.getDetail(summary.mediaType, summary.tmdbId);
    if (!d) return indexOnly(summary, storedTagline);
    return {
      ...summary,
      ...d.summaryPatch,
      ...d.fields,
      detailStatus: 'fresh',
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    if (!(e instanceof AppError && e.code === 'not_implemented'))
      console.error('[dal.getTitle] detail failed, degrading to index-only', e);
    return indexOnly(summary, storedTagline);
  }
}

function indexOnly(summary: TitleSummary, tagline: string | null): DetailWithoutPitch {
  return {
    ...summary,
    overview: summary.overviewShort,
    tagline,
    directors: [],
    cast: [],
    trailer: null,
    tmdbReviews: [],
    detailStatus: 'index_only',
    fetchedAt: null,
  };
}
