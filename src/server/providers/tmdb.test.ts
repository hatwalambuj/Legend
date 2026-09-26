import { describe, expect, it, vi } from 'vitest';
import type { DetailCacheStore } from '@/server/ports';
import { CircuitBreaker } from './circuit-breaker';
import { TmdbDetailProvider, UpstreamError, mapTmdbDetail, safeReviewUrl } from './tmdb';

const movieBody = {
  overview: 'Paul unites with the Fremen.',
  tagline: '  Long live the fighters.  ',
  runtime: 166,
  credits: {
    cast: [
      { name: 'Zendaya', character: 'Chani', profile_path: '/z.jpg', order: 1 },
      { name: 'Timothée Chalamet', character: 'Paul', profile_path: null, order: 0 },
      { bogus: true },
    ],
    crew: [
      { name: 'Denis Villeneuve', job: 'Director' },
      { name: 'Hans Zimmer', job: 'Original Music Composer' },
    ],
  },
  videos: {
    results: [
      { site: 'YouTube', key: 'teaser', name: 'Teaser', type: 'Teaser', official: true },
      {
        site: 'YouTube',
        key: 'trailer',
        name: 'Official Trailer',
        type: 'Trailer',
        official: true,
      },
      { site: 'Dailymotion', key: 'x', name: 'x', type: 'Trailer' },
    ],
  },
  reviews: {
    results: [
      {
        id: 'r1',
        author: 'critic',
        content: 'Great.',
        created_at: '2024-03-01T00:00:00Z',
        url: 'https://tmdb/r1',
        author_details: { rating: 9 },
      },
    ],
  },
  unknown_field: 'ignored',
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('mapTmdbDetail', () => {
  it('maps movie credits, trailer, reviews and patches the runtime', () => {
    const r = mapTmdbDetail('movie', movieBody);
    expect(r.fields).toEqual({
      overview: 'Paul unites with the Fremen.',
      tagline: 'Long live the fighters.',
      directors: ['Denis Villeneuve'],
      cast: [
        { name: 'Timothée Chalamet', character: 'Paul', profilePath: null },
        { name: 'Zendaya', character: 'Chani', profilePath: '/z.jpg' },
      ],
      trailer: { site: 'YouTube', key: 'trailer', name: 'Official Trailer' },
      tmdbReviews: [
        {
          id: 'r1',
          author: 'critic',
          rating: 9,
          content: 'Great.',
          createdAt: '2024-03-01T00:00:00Z',
          url: 'https://tmdb/r1',
        },
      ],
    });
    expect(r.summaryPatch).toEqual({ runtimeMinutes: 166 });
  });

  it('maps TV creators and aggregate credits; tolerates garbage', () => {
    const r = mapTmdbDetail('tv', {
      overview: 'o',
      created_by: [{ name: 'Greg Daniels' }],
      number_of_seasons: 9,
      number_of_episodes: 201,
      aggregate_credits: {
        cast: [{ name: 'Steve Carell', roles: [{ character: 'Michael Scott' }], order: 0 }],
      },
      videos: 'nope',
    });
    expect(r.fields.directors).toEqual(['Greg Daniels']);
    expect(r.fields.cast[0]).toEqual({
      name: 'Steve Carell',
      character: 'Michael Scott',
      profilePath: null,
    });
    expect(r.fields.trailer).toBeNull();
    expect(r.summaryPatch).toEqual({ seasonCount: 9, episodeCount: 201 });
    expect(mapTmdbDetail('movie', null).fields).toMatchObject({
      overview: '',
      cast: [],
      tagline: null,
    });
  });
});

describe('TmdbDetailProvider', () => {
  it('uses the bearer token, the L1 data-cache tag and the appends', async () => {
    const fetchImpl = vi.fn(async (_u: URL | RequestInfo, _i?: RequestInit) => ok(movieBody));
    const p = new TmdbDetailProvider(
      { readToken: 'tok' },
      { fetchImpl: fetchImpl as typeof fetch },
    );
    const d = await p.getDetail('movie', 693134);
    expect(d!.stale).toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/3/movie/693134?append_to_response=credits%2Cvideos%2Creviews');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect((init as { next?: unknown }).next).toEqual({
      revalidate: 86400,
      tags: ['title:movie:693134'],
    });
    const keyOnly = vi.fn(async () => ok(movieBody));
    await new TmdbDetailProvider({ apiKey: 'k' }, { fetchImpl: keyOnly as typeof fetch }).getDetail(
      'tv',
      1,
    );
    expect(String((keyOnly.mock.calls[0] as unknown[])[0])).toContain('api_key=k');
  });

  it('coalesces concurrent requests for the same title', async () => {
    let resolve!: (r: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => (resolve = r)));
    const p = new TmdbDetailProvider({ readToken: 't' }, { fetchImpl: fetchImpl as typeof fetch });
    const a = p.getDetail('movie', 1);
    const b = p.getDetail('movie', 1);
    resolve(ok(movieBody));
    expect(await a).toEqual(await b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('404 → null (index-only) and does not trip the breaker', async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    const p = new TmdbDetailProvider(
      { readToken: 't' },
      { fetchImpl: (async () => new Response('{}', { status: 404 })) as typeof fetch, breaker },
    );
    expect(await p.getDetail('movie', 1)).toBeNull();
    expect(breaker.state()).toBe('closed');
  });

  it('on outage serves the last good copy as stale, then L2, else throws UpstreamError', async () => {
    let up = true;
    const fetchImpl = (async () =>
      up ? ok(movieBody) : new Response('oops', { status: 503 })) as typeof fetch;
    const p = new TmdbDetailProvider(
      { readToken: 't' },
      { fetchImpl, breaker: new CircuitBreaker({ threshold: 100 }) },
    );
    const fresh = await p.getDetail('movie', 1);
    up = false;
    const stale = await p.getDetail('movie', 1);
    expect(stale).toMatchObject({
      stale: true,
      fetchedAt: fresh!.fetchedAt,
      fields: fresh!.fields,
    });
    await expect(p.getDetail('movie', 2)).rejects.toBeInstanceOf(UpstreamError);

    const l2: DetailCacheStore = {
      get: vi.fn(async () => ({
        result: mapTmdbDetail('movie', movieBody),
        fetchedAt: '2026-01-01T00:00:00.000Z',
      })),
      put: vi.fn(async () => {}),
    };
    const withL2 = new TmdbDetailProvider({ readToken: 't' }, { fetchImpl, cache: l2 });
    expect(await withL2.getDetail('movie', 3)).toMatchObject({
      stale: true,
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('times out slow calls, opens the circuit after repeated failures, writes L2 at most every 12 h', async () => {
    const slow = ((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('t'), { name: 'TimeoutError' })),
        );
      })) as typeof fetch;
    const breaker = new CircuitBreaker({ threshold: 2 });
    const p = new TmdbDetailProvider(
      { readToken: 't' },
      { fetchImpl: slow, timeoutMs: 20, breaker },
    );
    await expect(p.getDetail('movie', 1)).rejects.toThrow(/timeout/);
    await expect(p.getDetail('movie', 1)).rejects.toThrow();
    expect(breaker.state()).toBe('open');
    await expect(p.getDetail('movie', 1)).rejects.toBeInstanceOf(UpstreamError); // fast-fail, no fetch

    const put = vi.fn(async () => {});
    let now = 0;
    const q = new TmdbDetailProvider(
      { readToken: 't' },
      {
        fetchImpl: (async () => ok(movieBody)) as typeof fetch,
        cache: { get: async () => null, put },
        now: () => (now += 1000),
      },
    );
    await q.getDetail('movie', 9);
    await q.getDetail('movie', 9);
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe('safeReviewUrl (review links are rendered as <a href>)', () => {
  it('keeps https links and replaces anything else with the TMDB review page', () => {
    expect(safeReviewUrl('https://www.themoviedb.org/review/abc', 'abc')).toBe(
      'https://www.themoviedb.org/review/abc',
    );
    expect(safeReviewUrl('javascript:alert(1)', 'abc')).toBe(
      'https://www.themoviedb.org/review/abc',
    );
    expect(safeReviewUrl('', 'a b')).toBe('https://www.themoviedb.org/review/a%20b');
  });
});
