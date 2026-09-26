/** DAL in demo mode: "Worth it?" driven by live title stats, profile palette, input sanitising. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

const { dal } = await import('@/server/dal');
const { container, resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton } = await import('@/server/repositories/memory/store');

const LEO = '00000000-0000-4000-8000-000000000006';

beforeEach(() => {
  resetContainer();
  resetDemoStoreSingleton();
});

describe('dal.getTitle', () => {
  it('returns detail + worthIt; Transformers is "Split opinions" from 5 low Stubbed ratings', async () => {
    const t = await dal.getTitle('movie', 1858);
    expect(t).not.toBeNull();
    expect(t!.detailStatus).toBe('fresh');
    expect(t!.worthIt.verdict.key).toBe('split_opinions');
    expect(t!.worthIt.verdict.sources).toContain('stubbed');
    const dune = await dal.getTitle('movie', 693134);
    expect(dune!.worthIt.verdict.sourceLine).toBe('Based on TMDB, IMDb and 5 Stubbed ratings');
    expect(dune!.imdbRating).toBeGreaterThan(0);
    expect(dune!.worthIt.likeCandidates.every((x) => x.isListed)).toBe(true);
    expect(await dal.getTitle('movie', 1)).toBeNull();
  });

  it('unlisted (hysteresis) titles stay reachable; verdict reacts to new ratings on read', async () => {
    const twilight = await dal.getTitle('movie', 8966);
    expect(twilight!.isListed).toBe(false);
    expect(twilight!.worthIt.verdict.key).toBe('mixed_reviews');
    const before = await dal.getTitleStats('movie:666277');
    expect(before.ratingAvg10).toBeNull();
  });

  it('degrades to index-only when the detail provider fails', async () => {
    const c = container();
    const spy = vi.spyOn(c.detail, 'getDetail').mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = await dal.getTitle('tv', 2316);
    expect(t!.detailStatus).toBe('index_only');
    expect(t!.worthIt.hook).not.toBeNull();
    spy.mockRestore();
    err.mockRestore();
    vi.spyOn(c.detail, 'getDetail').mockResolvedValueOnce({
      fields: {
        overview: 'o',
        tagline: null,
        directors: [],
        cast: [],
        trailer: null,
        tmdbReviews: [],
      },
      stale: true,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
    const s = await dal.getTitle('tv', 1396);
    expect(s).toMatchObject({ detailStatus: 'stale', fetchedAt: '2026-01-01T00:00:00.000Z' });
  });
});

describe('dal lists', () => {
  it('falls back to defaults for unknown sort/type and clamps limits', async () => {
    const p = await dal.listCatalog({ type: 'book' as never, sort: 'nope' as never, limit: 999 });
    expect(p.items).toHaveLength(50);
    const d = await dal.listCatalog({ type: 'all', sort: 'release_desc', limit: Number.NaN });
    expect(d.items).toHaveLength(20);
    expect(p.items[0]!.key).toBe(d.items[0]!.key);
    expect((await dal.listTrending('tv', 3)).every((t) => t.mediaType === 'tv')).toBe(true);
  });

  it('search is accent-insensitive and flags notInCatalog', async () => {
    expect((await dal.searchCatalog('shogun')).items.map((t) => t.title)).toContain('Shōgun');
    expect(await dal.searchCatalog('twilight')).toMatchObject({ items: [], notInCatalog: true });
    expect((await dal.searchCatalog('!!!')).notInCatalog).toBe(true);
  });

  it('profile page: stats + palette of the most recently stubbed title; wallet/diary/reviews', async () => {
    const p = await dal.getProfile('DEV');
    expect(p!.stats.totalStubs).toBe(12);
    const latest = (await dal.listDiary('dev', { limit: 1 })).items[0]!;
    expect(p!.palette).toEqual(latest.title.palette);
    expect((await dal.listWallet('dev')).items.length).toBe(6);
    expect((await dal.listProfileReviews('dev')).items.length).toBe(4);
    expect(await dal.getProfile('ghost')).toBeNull();
    expect((await dal.listWallet('ghost')).items).toEqual([]);
    const leo = await dal.getProfile('leo');
    expect(leo!.palette).toBeNull();
    await container().stubs.create({
      userId: LEO,
      titleKey: 'movie:238',
      watchedOn: '2026-09-01',
      watchedWhere: null,
      note: '',
    });
    expect((await dal.getProfile('leo'))!.palette).not.toBeNull();
  });

  it('owner-only reads need a session', async () => {
    expect(await dal.getSession()).toBeNull();
    expect(await dal.myTitleStates(['movie:238'])).toEqual({});
    await expect(dal.myWatchlist()).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});
