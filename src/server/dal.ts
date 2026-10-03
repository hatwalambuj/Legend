/**
 * Data-access layer: the ONLY server module pages import (`import { dal } from '@/server/dal'`).
 * Implements the frozen `DataAccess` interface from src/lib/data-access.ts.
 * OWNER: Backend. Every method delegates to the ports of the container (demo or live, ADR-006) and
 * keeps the contract rules: public methods never read the cookie, "not found" is null, limits clamp.
 */
import 'server-only';
import { cache } from 'react';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { DataAccess } from '@/lib/data-access';
import { normalizeSearch } from '@/lib/text';
import { SORT_KEYS } from '@/lib/catalog-order';
import { parseTitleKey, toTitleKey } from '@/lib/keys';
import type {
  CatalogQuery,
  MediaType,
  StubShareCard,
  TitleDegraded,
  TitleDetail,
  TitleKey,
  TitleStats,
  TitleSummary,
  TitleWatch,
  TypeFilter,
  WatchProviderChip,
  WatchRegionInfo,
} from '@/lib/types';
import { buildWorthIt } from '@/lib/worth-it';
import { container } from './container';
import {
  EMPTY_ENRICHMENT,
  LastGoodEntries,
  summaryFromDetail,
  type CatalogEntry,
} from './degraded';
import { env, today } from './env';
import { log } from './log';
import { regionInfo, requestWatchRegion, watchRegionConfig } from './region';
import { isProfileShareable } from './share';
import { buildTitleWatch, watchHintFor, type StoredWatch } from './watch';

const safeType = (t: TypeFilter | undefined): TypeFilter =>
  t === 'movie' || t === 'tv' ? t : 'all';

const clampLimit = (n: number | undefined, def = 20) =>
  Math.min(Math.max(Math.floor(Number.isFinite(n) ? n! : def), 1), 50);

/** Per-request memoised session (React cache dedupes across a single render). */
const getSession = cache(async () => container().auth.getSession());

const ZERO_STATS: TitleStats = { stubCount: 0, reviewCount: 0, ratingAvg10: null, ratingCount: 0 };

/** Process-wide last-good catalogue entries: the first fallback when our DB is down (ADR-011 §4). */
const lastGood = new LastGoodEntries(1000);

const errCode = (e: unknown) =>
  e instanceof AppError ? e.code : e instanceof Error ? e.name : 'error';

function logDegraded(key: TitleKey, degraded: TitleDegraded, e: unknown) {
  log.error('dal_degraded', { key, degraded, code: errCode(e) });
}

/**
 * Catalogue entry with the ADR-011 §4 fallbacks: DB → last-good copy → TMDB-derived summary.
 * `null` = unknown title (404). Throws `upstream_unavailable` only when both our DB and TMDB fail.
 */
const loadEntry = cache(loadEntryUncached);

async function loadEntryUncached(
  mediaType: MediaType,
  tmdbId: number,
): Promise<{ entry: CatalogEntry; degraded: TitleDegraded } | null> {
  const c = container();
  const key = toTitleKey(mediaType, tmdbId);
  try {
    const entry = await c.catalog.getEntry(mediaType, tmdbId);
    if (entry) lastGood.set(key, entry);
    return entry ? { entry, degraded: null } : null;
  } catch (e) {
    if (e instanceof AppError && e.code === 'not_found') return null;
    logDegraded(key, 'catalog', e);
    const kept = lastGood.get(key);
    if (kept) return { entry: kept, degraded: 'catalog' };
    let summary: TitleSummary | null;
    try {
      const d = await c.detail.getDetail(mediaType, tmdbId);
      if (!d) return null;
      summary = summaryFromDetail(mediaType, tmdbId, d, env().curation, today());
    } catch (tmdbError) {
      throw new AppError('upstream_unavailable', ERROR_COPY.upstream_unavailable, {
        cause: tmdbError,
      });
    }
    if (!summary)
      throw new AppError('upstream_unavailable', ERROR_COPY.upstream_unavailable, { cause: e });
    return { entry: { summary, enrichment: EMPTY_ENRICHMENT }, degraded: 'catalog' };
  }
}

type TitleBase = { detail: Omit<TitleDetail, 'watch'>; watch: StoredWatch | undefined };

/**
 * Deduped per request: generateMetadata + the page both call getTitle (TitleDetail incl. worthIt).
 * Region-agnostic: the "Where to watch" block is built per call on top of it (ADR-012 §6.1).
 */
const getTitleBase = cache(
  async (mediaType: MediaType, tmdbId: number): Promise<TitleBase | null> => {
    const c = container();
    const loaded = await loadEntry(mediaType, tmdbId);
    if (!loaded) return null;
    const { summary, enrichment } = loaded.entry;
    let degraded = loaded.degraded;
    const [stats, recommended, base] = await Promise.all([
      c.titleStates.stats(summary.key).catch((e: unknown) => {
        if (!degraded) logDegraded(summary.key, 'community', e);
        degraded ??= 'community';
        return ZERO_STATS;
      }),
      c.catalog
        .getMany(enrichment.recommendationKeys)
        .catch(() => new Map<TitleKey, TitleSummary>()),
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
    return { detail: { ...base, worthIt, degraded }, watch: loaded.entry.watch };
  },
);

/** Provider names/logos, once per request (the live repository also caches in process ≤ 1 h). */
const providerDirectory = cache(async () => container().watchProviders.all());

/**
 * `TitleDetail.watch` for one region (ADR-012 §6.1): pure `buildTitleWatch` over the stored data. Any
 * failure (e.g. provider names unavailable) hides the block; it never fails the page.
 */
async function watchBlock(
  title: { mediaType: MediaType; tmdbId: number; title: string },
  stored: StoredWatch | undefined,
  region: WatchRegionInfo,
  degraded: TitleDegraded | undefined,
): Promise<TitleWatch | null> {
  if (!stored || degraded === 'catalog') return null;
  try {
    return buildTitleWatch(stored, region, title, new Date(), await providerDirectory(), {
      degraded,
    });
  } catch (e) {
    log.warn('dal_watch_unavailable', { code: errCode(e) });
    return null;
  }
}

/**
 * v1.6 (ADR-013 C-01): a list request's region → the supported region it resolves to (unsupported →
 * the default region), or undefined when the call had none (then `watchHint` stays absent).
 */
function listRegion(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return regionInfo(code, 'query', watchRegionConfig()).region;
}

/** Adds `watchHint` for `region` to every item (null when unknown/stale; never fails the list). */
async function withHints<T extends TitleSummary>(items: T[], region: string | undefined) {
  if (!region || items.length === 0) return items;
  try {
    const [providers, stored] = await Promise.all([
      providerDirectory(),
      container().catalog.storedWatch(items.map((t) => t.key)),
    ]);
    const now = new Date();
    return items.map((t) => {
      const w = stored.get(t.key);
      return {
        ...t,
        watchHint: w ? watchHintFor(w.store, w.checkedAt, region, providers, now) : null,
      };
    });
  } catch (e) {
    log.warn('dal_watch_hint_unavailable', { code: errCode(e) });
    return items.map((t) => ({ ...t, watchHint: null }));
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deduped per request: the share landing, its metadata and image routes all read it. */
const getStubShare = cache(async (id: string): Promise<StubShareCard | null> => {
  if (!UUID_RE.test(id)) return null;
  const c = container();
  const stub = await c.stubs.getById(id);
  if (!stub) return null;
  const ref = parseTitleKey(stub.titleKey);
  const [profile, title] = await Promise.all([
    c.profiles.getById(stub.userId),
    ref ? c.catalog.get(ref.mediaType, ref.tmdbId) : Promise.resolve(null),
  ]);
  if (!profile || !isProfileShareable(profile) || !title) return null;
  let host = 'localhost';
  try {
    host = new URL(env().siteUrl).host;
  } catch {
    /* keep the placeholder */
  }
  // Explicit picks only: never the note, review text or spoiler content (ADR-013 C-08).
  return {
    stubId: stub.id,
    number: stub.number,
    watchedOn: stub.watchedOn,
    season: stub.season,
    title: {
      key: title.key,
      mediaType: title.mediaType,
      title: title.title,
      year: title.year,
      voteAverage: title.voteAverage,
      imdbRating: title.imdbRating,
      posterPath: title.posterPath,
      palette: title.palette,
    },
    handle: profile.handle,
    displayName: profile.displayName,
    avatarColor: profile.avatarColor ?? null,
    profileUrl: `${host}/u/${profile.handle}`,
  };
});

const defaultRegion = () => regionInfo(null, 'default', watchRegionConfig());

async function getTitle(
  mediaType: MediaType,
  tmdbId: number,
  opts: { region?: WatchRegionInfo } = {},
): Promise<TitleDetail | null> {
  const base = await getTitleBase(mediaType, tmdbId);
  if (!base) return null;
  const watch = await watchBlock(
    base.detail,
    base.watch,
    opts.region ?? defaultRegion(),
    base.detail.degraded,
  );
  return { ...base.detail, watch };
}

/**
 * GET /api/titles/{type}/{id}/watch (API_CONTRACT §5.21): the block for an explicit region, from the
 * catalogue entry only (no TMDB detail call, no cookie). `undefined` = unknown title (404).
 */
export async function titleWatchFor(
  mediaType: MediaType,
  tmdbId: number,
  region: WatchRegionInfo,
): Promise<TitleWatch | null | undefined> {
  const loaded = await loadEntry(mediaType, tmdbId);
  if (!loaded) return undefined;
  const { summary, watch } = loaded.entry;
  return watchBlock(summary, watch, region, loaded.degraded);
}

export const dal: DataAccess = {
  getMode: () => env().mode,

  async listCatalog(query) {
    const region = listRegion(query.region);
    const provider =
      region && Number.isInteger(query.provider) && query.provider! > 0
        ? query.provider
        : undefined;
    // Unknown sort/type values fall back to the defaults, never an error (ADR-003 §2).
    const q: CatalogQuery = {
      type: safeType(query.type),
      sort: (SORT_KEYS as readonly string[]).includes(query.sort) ? query.sort : 'release_desc',
      genreIds: query.genreIds?.filter((g) => Number.isInteger(g) && g > 0).slice(0, 20),
      cursor: query.cursor,
      limit: clampLimit(query.limit),
      ...(region ? { region } : {}),
      ...(provider ? { provider } : {}),
    };
    const page = await container().catalog.list(q);
    if (!region) return page;
    return { ...page, items: await withHints(page.items, region), region };
  },

  async listTrending(type, limit = 10, opts = {}) {
    const items = await container().catalog.trending(safeType(type), clampLimit(limit, 10));
    return withHints(items, listRegion(opts.region));
  },

  async searchCatalog(q, type = 'all', limit = 20, opts = {}) {
    const query = q.trim().slice(0, 100);
    const norm = normalizeSearch(query);
    const region = listRegion(opts.region);
    const found = norm
      ? await container().catalog.search(norm, safeType(type), clampLimit(limit))
      : [];
    const items = await withHints(found, region);
    return {
      query,
      items,
      notInCatalog: query.length > 0 && items.length === 0,
      ...(region ? { region } : {}),
    };
  },

  async resolveTitle(mediaType, tmdbId) {
    const loaded = await loadEntry(mediaType, tmdbId);
    return loaded ? { slug: loaded.entry.summary.slug } : null;
  },

  async listWatchProviders(region): Promise<WatchProviderChip[]> {
    const code = listRegion(region);
    if (!code) return [];
    try {
      return await container().watchProviders.chips(code);
    } catch (e) {
      log.warn('dal_watch_providers_unavailable', { code: errCode(e) });
      return [];
    }
  },

  getStubShare,

  getTitle,

  // Reads the region cookie + Accept-Language (+ the geo header only behind a trusted proxy), never the
  // session (ADR-012 §5). The title page is dynamic SSR and private, so this never leaks into a cache.
  getWatchRegion: () => requestWatchRegion(),

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
    const [stats, latest] = await Promise.all([
      c.profiles.stats(profile.id, Number(today().slice(0, 4))),
      c.stubs.diary(profile.id, { type: 'all', limit: 1 }),
    ]);
    // Adaptive background = palette of the most recently stubbed title (DESIGN §4.1).
    return { profile, stats, palette: latest.items[0]?.title.palette ?? null };
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
    if (!p) return { items: [], nextCursor: null, total: 0 };
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
    const page = await container().watchlist.list(s.user.id, {
      cursor: opts.cursor,
      limit: clampLimit(opts.limit),
    });
    const region = listRegion(opts.region);
    if (!region) return page;
    return { ...page, items: await withHints(page.items, region), region };
  },
};

type DetailWithoutPitch = Omit<TitleDetail, 'worthIt' | 'degraded' | 'watch'>;

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
      // Identity + curation fields always come from the index row.
      key: summary.key,
      isListed: summary.isListed,
      detailStatus: d.stale ? 'stale' : 'fresh',
      fetchedAt: d.fetchedAt ?? new Date().toISOString(),
    };
  } catch (e) {
    if (!(e instanceof AppError && e.code === 'not_implemented'))
      log.error('dal_detail_failed', { key: summary.key, code: errCode(e) });
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
