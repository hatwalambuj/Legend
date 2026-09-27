/** dal.getTitle when our DB is down (ADR-011 §4): last-good → TMDB-derived → 503; stats fallbacks. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CURATION_RULE, isListed } from '@/lib/curation';
import { AppError } from '@/lib/errors';
import { LastGoodEntries, summaryFromDetail } from '@/server/degraded';
import { mapTmdbDetail } from '@/server/providers/tmdb';

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

const dbDown = () => new AppError('internal', 'Something went wrong. Try again.');
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetContainer();
  resetDemoStoreSingleton();
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('dal.getTitle degraded', () => {
  it('normal reads carry degraded: null', async () => {
    const t = await dal.getTitle('movie', 693134);
    expect(t!.degraded).toBeNull();
  });

  it('getEntry throws + last-good copy → that copy, degraded "catalog"', async () => {
    const good = await dal.getTitle('movie', 693134); // fills the last-good LRU
    vi.spyOn(container().catalog, 'getEntry').mockRejectedValue(dbDown());
    const t = await dal.getTitle('movie', 693134);
    expect(t!.degraded).toBe('catalog');
    expect(t!.title).toBe(good!.title);
    expect(t!.imdbRating).toBe(good!.imdbRating);
    expect(t!.worthIt.verdict.word).toBeTruthy();
    expect(log).toHaveBeenCalledWith('[dal.getTitle] degraded', {
      key: 'movie:693134',
      degraded: 'catalog',
      code: 'internal',
    });
  });

  it('getEntry throws, no copy → TMDB-derived summary: curation rule, IMDb hidden, genre tint', async () => {
    const c = container();
    vi.spyOn(c.catalog, 'getEntry').mockRejectedValue(dbDown());
    vi.spyOn(c.titleStates, 'stats').mockRejectedValue(dbDown());
    vi.spyOn(c.catalog, 'getMany').mockRejectedValue(dbDown());
    const t = await dal.getTitle('tv', 1396);
    expect(t).not.toBeNull();
    expect(t!.degraded).toBe('catalog'); // stats failing too doesn't downgrade it to 'community'
    expect(t!.title).toBe('Breaking Bad');
    expect(t!.imdbRating).toBeNull();
    expect(t!.imdbVotes).toBeNull();
    expect(t!.palette).toBeNull();
    expect(t!.slug).toBe('breaking-bad');
    expect(t!.isListed).toBe(
      isListed(
        {
          mediaType: 'tv',
          voteAverage: t!.voteAverage,
          voteCount: t!.voteCount,
          genreIds: t!.genres.map((g) => g.id),
          releaseDate: t!.releaseDate,
        },
        DEFAULT_CURATION_RULE,
        '2026-09-27',
      ),
    );
    expect(t!.worthIt.likeCandidates).toEqual([]);
    expect(t!.worthIt.verdict.sources).not.toContain('imdb');
  });

  it('getEntry throws and TMDB says unknown → null (404); TMDB fails too → upstream_unavailable', async () => {
    const c = container();
    vi.spyOn(c.catalog, 'getEntry').mockRejectedValue(dbDown());
    const detail = vi.spyOn(c.detail, 'getDetail').mockResolvedValueOnce(null);
    expect(await dal.getTitle('movie', 424242)).toBeNull();
    detail.mockRejectedValue(new Error('TMDB timeout'));
    await expect(dal.getTitle('movie', 424243)).rejects.toMatchObject({
      code: 'upstream_unavailable',
      status: 503,
    });
    // A payload without catalogue fields (old L2 copy) can't be rebuilt either.
    detail.mockResolvedValue({
      fields: {
        overview: '',
        tagline: null,
        directors: [],
        cast: [],
        trailer: null,
        tmdbReviews: [],
      },
    });
    await expect(dal.getTitle('movie', 424244)).rejects.toMatchObject({
      code: 'upstream_unavailable',
    });
  });

  it('stats throws → zero stats, degraded "community"; recommended throws → no candidates', async () => {
    const c = container();
    vi.spyOn(c.titleStates, 'stats').mockRejectedValue(dbDown());
    const t = await dal.getTitle('movie', 1858);
    expect(t!.degraded).toBe('community');
    expect(t!.worthIt.verdict.sources).not.toContain('stubbed');
    vi.restoreAllMocks();
    vi.spyOn(c.catalog, 'getMany').mockRejectedValue(dbDown());
    const u = await dal.getTitle('movie', 693134);
    expect(u!.degraded).toBeNull();
    expect(u!.worthIt.likeCandidates).toEqual([]);
  });
});

describe('degraded helpers', () => {
  it('LastGoodEntries is a bounded LRU', () => {
    const lru = new LastGoodEntries(2);
    const e = (title: string) => ({ summary: { title }, enrichment: {} }) as never;
    lru.set('movie:1', e('a'));
    lru.set('movie:2', e('b'));
    lru.set('movie:1', e('a2')); // refresh → movie:2 is now the oldest
    lru.set('movie:3', e('c'));
    expect(lru.size).toBe(2);
    expect(lru.get('movie:2')).toBeUndefined();
    expect((lru.get('movie:1') as unknown as { summary: { title: string } }).summary.title).toBe(
      'a2',
    );
  });

  it('summaryFromDetail maps a TMDB body; null without catalogue fields', () => {
    const body = {
      title: 'Test Film',
      original_title: 'Film Test',
      release_date: '2020-05-01',
      vote_average: 7.26,
      vote_count: 350,
      popularity: 12.5,
      genres: [{ id: 18, name: 'Drama' }],
      poster_path: '/p.jpg',
      backdrop_path: null,
      imdb_id: 'tt1234567',
      overview: 'A   story.',
      runtime: 101,
    };
    const d = mapTmdbDetail('movie', body);
    const s = summaryFromDetail('movie', 99, d, DEFAULT_CURATION_RULE, '2026-09-27')!;
    expect(s).toMatchObject({
      key: 'movie:99',
      title: 'Test Film',
      originalTitle: 'Film Test',
      slug: 'test-film',
      year: 2020,
      voteAverage: 7.3,
      voteCount: 350,
      imdbId: 'tt1234567',
      imdbRating: null,
      palette: null,
      runtimeMinutes: 101,
      overviewShort: 'A story.',
      isListed: true,
    });
    const low = mapTmdbDetail('movie', { ...body, vote_count: 10 });
    expect(summaryFromDetail('movie', 99, low, DEFAULT_CURATION_RULE, '2026-09-27')!.isListed).toBe(
      false,
    );
    expect(
      summaryFromDetail('movie', 99, { fields: d.fields }, DEFAULT_CURATION_RULE, '2026-09-27'),
    ).toBeNull();
  });
});
