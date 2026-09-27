/** Nightly discover path (step 5): query building, mapping + curation, throttling, retries, guardrails. */
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CURATION_RULE } from '@/lib/curation';
import { AppError } from '@/lib/errors';
import {
  checkGuardrails,
  guardrailReport,
  countListed,
  createThrottle,
  discoverAll,
  discoverParams,
  genreMap,
  mapDiscoverResult,
  recheckMissing,
  withRetry,
  yearShards,
  type MapContext,
} from '@/server/jobs/discover';
import { mapConcurrent, paletteFromPoster, type SharpLike } from '@/server/jobs/palettes';
import {
  lastListedCounts,
  latestListedCounts,
  revalidateSite,
  selectAll,
} from '../../scripts/sync-catalog';

const rule = DEFAULT_CURATION_RULE;
const ctx: MapContext = {
  runId: 'run',
  rule,
  today: '2026-09-26',
  previouslyListed: new Set(['movie:3']),
  genreNames: new Map([
    [18, 'Drama'],
    [10764, 'Reality'],
  ]),
};
const movie = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  title: `Film ${id}`,
  original_title: `Film ${id}`,
  overview: 'An overview.',
  release_date: '2020-05-01',
  vote_average: 7.2,
  vote_count: 500,
  popularity: 10,
  genre_ids: [18],
  poster_path: '/p.jpg',
  ...over,
});

describe('discover queries', () => {
  it('shards pre-1970 by decade and then per year', () => {
    const s = yearShards(1900, 2026);
    expect(s[0]).toEqual({ gte: '1900-01-01', lte: '1909-12-31' });
    expect(s[6]).toEqual({ gte: '1960-01-01', lte: '1969-12-31' });
    expect(s[7]).toEqual({ gte: '1970-01-01', lte: '1970-12-31' });
    expect(s.at(-1)).toEqual({ gte: '2026-01-01', lte: '2026-12-31' });
    expect(s).toHaveLength(7 + 57);
  });

  it('asks TMDB for the rounding-aware floor, vote floor, date range and TV exclusions', () => {
    const m = discoverParams('movie', { gte: '2020-01-01', lte: '2020-12-31' }, rule, 3);
    expect(m).toMatchObject({
      'vote_average.gte': '6.45',
      'vote_count.gte': '200',
      'primary_release_date.gte': '2020-01-01',
      sort_by: 'vote_count.desc',
      include_adult: 'false',
      page: '3',
    });
    const t = discoverParams(
      'tv',
      { gte: '2020-01-01', lte: '2020-12-31' },
      { ...rule, keepRating: 6.3 },
      1,
    );
    expect(t).toMatchObject({
      'vote_average.gte': '6.25',
      'vote_count.gte': '100',
      'first_air_date.lte': '2020-12-31',
      without_genres: '10767,10763,10764',
    });
    expect(t.include_video).toBeUndefined();
  });
});

describe('mapDiscoverResult', () => {
  it('builds a staging row with text keys and curation', () => {
    const r = mapDiscoverResult(
      'movie',
      movie(1, {
        title: 'Amélie',
        original_title: 'Le Fabuleux Destin d’Amélie Poulain',
        vote_average: 6.46,
      }),
      ctx,
    )!;
    expect(r).toMatchObject({
      tmdb_id: 1,
      slug: 'amelie',
      sort_title: 'amelie',
      vote_average: 6.5,
      is_listed: true,
      genres: [{ id: 18, name: 'Drama' }],
      imdb_id: null,
    });
    expect(r.search_text).toContain('amelie');
    expect(mapDiscoverResult('movie', movie(2, { vote_average: 6.44 }), ctx)!.is_listed).toBe(
      false,
    );
    expect(mapDiscoverResult('movie', movie(2, { vote_count: 199 }), ctx)!.is_listed).toBe(false);
    expect(mapDiscoverResult('movie', movie(2, { adult: true }), ctx)!.is_listed).toBe(false);
    expect(
      mapDiscoverResult('movie', movie(2, { release_date: '2027-01-01' }), ctx)!.is_listed,
    ).toBe(false);
    expect(
      mapDiscoverResult('movie', movie(2, { release_date: '' }), ctx)!.release_date,
    ).toBeNull();
  });

  it('maps TV names/dates and excludes Reality; hysteresis keeps a previously listed title', () => {
    const tv = mapDiscoverResult(
      'tv',
      {
        id: 9,
        name: 'Show',
        original_name: 'Show',
        first_air_date: '2019-01-01',
        vote_average: 8,
        vote_count: 150,
        genre_ids: [10764],
      },
      ctx,
    )!;
    expect(tv).toMatchObject({ title: 'Show', release_date: '2019-01-01', is_listed: false });
    const keep = { ...ctx, rule: { ...rule, keepRating: 6.3 } };
    expect(mapDiscoverResult('movie', movie(3, { vote_average: 6.35 }), keep)!.is_listed).toBe(
      true,
    );
    expect(mapDiscoverResult('movie', movie(4, { vote_average: 6.35 }), keep)!.is_listed).toBe(
      false,
    );
  });

  it('accepts detail bodies (genres objects, external ids) and drops malformed rows', () => {
    const d = mapDiscoverResult(
      'movie',
      {
        ...movie(5),
        genre_ids: undefined,
        genres: [{ id: 35, name: 'Comedy' }],
        external_ids: { imdb_id: 'tt1234567' },
      },
      ctx,
    )!;
    expect(d).toMatchObject({
      genre_ids: [35],
      genres: [{ id: 35, name: 'Comedy' }],
      imdb_id: 'tt1234567',
    });
    expect(mapDiscoverResult('movie', { id: 'x' }, ctx)).toBeNull();
    expect(mapDiscoverResult('movie', { ...movie(6), vote_average: 11 }, ctx)).toBeNull();
    expect(
      mapDiscoverResult('movie', { ...movie(7), title: '', original_title: '' }, ctx),
    ).toBeNull();
    expect(
      mapDiscoverResult('movie', movie(8, { overview: 'x '.repeat(400) }), ctx)!.overview_short
        .length,
    ).toBeLessThanOrEqual(300);
  });
});

describe('discoverAll / recheckMissing', () => {
  it('walks every page of every shard and dedupes across shards', async () => {
    const get = vi.fn(async (path: string, p: Record<string, string>) => {
      const page = Number(p.page);
      if (path === '/discover/tv') return { page, total_pages: 0, results: [] };
      return {
        page,
        total_pages: 2,
        results: page === 1 ? [movie(1), movie(2), { junk: true }] : [movie(2), movie(3)],
      };
    });
    const r = await discoverAll(
      { get },
      {
        types: ['movie', 'tv'],
        shards: yearShards(2020, 2021),
        ctx,
        genreNames: { movie: ctx.genreNames, tv: new Map() },
      },
    );
    expect([...r.rows.keys()].sort()).toEqual(['movie:1', 'movie:2', 'movie:3']);
    expect(r.malformed).toBe(2);
    expect(get).toHaveBeenCalledTimes(2 * 2 + 2); // 2 shards × 2 pages (movie) + 2 shards × 1 (tv)
    await expect(
      discoverAll(
        { get: async () => ({ nope: 1 }) },
        {
          types: ['movie'],
          shards: yearShards(2020, 2020),
          ctx,
          genreNames: { movie: new Map(), tv: new Map() },
        },
      ),
    ).rejects.toThrow(/malformed page/);
  });

  it('caps a shard at 500 pages and reports it', async () => {
    const get = vi.fn(async (_p: string, q: Record<string, string>) => ({
      page: Number(q.page),
      total_pages: 900,
      results: [],
    }));
    const log = vi.fn();
    const r = await discoverAll(
      { get, log },
      {
        types: ['movie'],
        shards: yearShards(2020, 2020),
        ctx,
        genreNames: { movie: new Map(), tv: new Map() },
      },
    );
    expect(get).toHaveBeenCalledTimes(500);
    expect(r.truncatedShards).toBe(1);
    expect(log).toHaveBeenCalled();
  });

  it('re-checks missing titles: 404 → gone, else a fresh row; errors are counted', async () => {
    const detail = async (_t: string, id: number) => {
      if (id === 1) return null;
      if (id === 2) throw new Error('503');
      return movie(id, { vote_average: 6.0 });
    };
    const r = await recheckMissing(
      { detail },
      ['movie:1', 'movie:2', 'movie:3', 'movie:4'],
      ctx,
      3,
    );
    expect(r.gone).toEqual(['movie:1']);
    expect(r.errors).toBe(1);
    expect(r.rows.map((x) => [x.tmdb_id, x.is_listed])).toEqual([[3, false]]);
    expect(r.skipped).toBe(1);
  });
});

describe('throttle + retry', () => {
  it('spaces calls at the given rate', async () => {
    let now = 0;
    const waits: number[] = [];
    const t = createThrottle(
      10,
      () => now,
      async (ms) => {
        waits.push(ms);
        now += ms;
      },
    );
    await t();
    await t();
    await t();
    expect(waits).toEqual([100, 100]);
  });

  it('retries 429 with Retry-After and 5xx with backoff, never 404, at most 5 times', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => {
      sleeps.push(ms);
    };
    let n = 0;
    const flaky = () => {
      n++;
      if (n === 1) throw Object.assign(new Error('429'), { status: 429, retryAfter: 3 });
      if (n === 2) throw Object.assign(new Error('502'), { status: 502 });
      return Promise.resolve('ok');
    };
    expect(await withRetry(async () => flaky(), { sleep, random: () => 0.5 })).toBe('ok');
    expect(sleeps).toEqual([3000, 1000]);
    await expect(
      withRetry(
        async () => {
          throw new AppError('not_found', 'x');
        },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(AppError);
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new Error('network');
        },
        { sleep },
      ),
    ).rejects.toThrow('network');
    expect(calls).toBe(6);
  });
});

describe('guardrails', () => {
  const cfg = { guardMin: { movie: 3000, tv: 1000 }, guardMax: 25000, guardMaxDelta: 0.2 };
  it('pass within bounds and delta', () => {
    expect(checkGuardrails({ movie: 9000, tv: 5200 }, { movie: 8800, tv: 5100 }, cfg)).toEqual({
      ok: true,
      reasons: [],
      warnings: [],
    });
    expect(checkGuardrails({ movie: 9000, tv: 5200 }, null, cfg).ok).toBe(true);
    // GAP-03: a TV catalogue far below the movie one passes on its own floor.
    expect(checkGuardrails({ movie: 9000, tv: 1800 }, null, cfg).ok).toBe(true);
  });
  it('abort on too few/many or a large swing', () => {
    const r = checkGuardrails({ movie: 100, tv: 30000 }, { movie: 9000, tv: 5000 }, cfg);
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(4);
    expect(r.reasons[0]).toBe('movie: 100 listed is below the minimum 3000');
    expect(
      checkGuardrails({ movie: 9000, tv: 6000 }, { movie: 9000, tv: 5000 }, cfg).reasons[0],
    ).toMatch(/tv: 6000 vs 5000/);
    expect(
      checkGuardrails({ movie: 9000, tv: 900 }, { movie: 9000, tv: 950 }, cfg).reasons,
    ).toEqual(['tv: 900 listed is below the minimum 1000']);
  });
  it('first run (empty catalogue): below the floor only warns; zero or too many still abort', () => {
    const first = checkGuardrails({ movie: 2500, tv: 400 }, null, cfg, { firstRun: true });
    expect(first.ok).toBe(true);
    expect(first.warnings).toEqual([
      'movie: 2500 listed is below the minimum 3000 (first run: continuing)',
      'tv: 400 listed is below the minimum 1000 (first run: continuing)',
    ]);
    expect(checkGuardrails({ movie: 2500, tv: 0 }, null, cfg, { firstRun: true }).reasons).toEqual([
      'tv: 0 listed is below the minimum 1000',
    ]);
    expect(checkGuardrails({ movie: 30000, tv: 400 }, null, cfg, { firstRun: true }).ok).toBe(
      false,
    );
    // Not the first run → the same numbers abort.
    expect(checkGuardrails({ movie: 2500, tv: 400 }, null, cfg).ok).toBe(false);
  });
  it('prints clear per-type counts, limits and a fix hint', () => {
    const counts = { movie: 8123, tv: 640 };
    const last = { movie: 8000, tv: 700 };
    const r = checkGuardrails(counts, last, cfg);
    const lines = guardrailReport(counts, last, cfg, r);
    expect(lines[0]).toBe('[sync] listed movie   8123  (min 3000, max 25000, last ok run 8000)');
    expect(lines[1]).toBe('[sync] listed tv       640  (min 1000, max 25000, last ok run 700)');
    expect(lines).toContain('[sync] guardrail failed: tv: 640 listed is below the minimum 1000');
    expect(lines).toContain('[sync] hint: if 640 tv titles is expected, set SYNC_GUARD_MIN_TV=512');
    expect(lines.at(-1)).toBe('[sync] guardrails: ABORT (index untouched)');
    const first = checkGuardrails(counts, null, cfg, { firstRun: true });
    const ok = guardrailReport(counts, null, cfg, first, { firstRun: true });
    expect(ok).toContain('[sync] first run (empty catalogue): the minimums only warn');
    expect(ok.at(-1)).toBe('[sync] guardrails: OK');
  });
  it('counts listed per type; parses last run counts; genre maps', () => {
    const rows = [
      mapDiscoverResult('movie', movie(1), ctx)!,
      mapDiscoverResult('movie', movie(2, { vote_count: 1 }), ctx)!,
    ];
    expect(countListed(rows)).toEqual({ movie: 1, tv: 0 });
    expect(lastListedCounts({ discover: { listed: { movie: 1, tv: 2 } } })).toEqual({
      movie: 1,
      tv: 2,
    });
    expect(lastListedCounts({ discover: { skipped: 'x' } })).toBeNull();
    expect(lastListedCounts(null)).toBeNull();
    // A single-step run (--only=imdb|enrich) is the newest ok run but has no discover counts: the
    // delta guardrail must compare against the last run that did discover, not switch itself off.
    expect(
      latestListedCounts([
        { counts: { imdb: { requested: 5 } } },
        { counts: { enrich: { due: 0 } } },
        { counts: { discover: { listed: { movie: 9000, tv: 2500 } } } },
        { counts: { discover: { listed: { movie: 1, tv: 1 } } } },
      ]),
    ).toEqual({ movie: 9000, tv: 2500 });
    expect(latestListedCounts([{ counts: { imdb: {} } }])).toBeNull();
    expect(latestListedCounts(null)).toBeNull();
    expect(genreMap({ genres: [{ id: 18, name: 'Drama' }] }).get(18)).toBe('Drama');
    expect(genreMap('bad').size).toBe(0);
  });
});

describe('job plumbing', () => {
  it('selectAll pages through PostgREST ranges', async () => {
    const data = Array.from({ length: 2500 }, (_, i) => i);
    const out = await selectAll<number>(
      async (from, to) => ({ data: data.slice(from, to + 1), error: null }),
      1000,
    );
    expect(out).toHaveLength(2500);
  });

  it('revalidates the site with the shared secret, or skips without one', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(
      await revalidateSite('https://s.app', undefined, ['catalog'], f as typeof fetch),
    ).toEqual({ skipped: 'no REVALIDATE_SECRET' });
    expect(await revalidateSite('https://s.app', 'sec', ['catalog'], f as typeof fetch)).toEqual({
      status: 200,
    });
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://s.app/api/revalidate');
    expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('sec');
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog'] });
  });

  it('computes a poster palette + LQIP with sharp', async () => {
    const png = await sharp({
      create: { width: 92, height: 138, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .png()
      .toBuffer();
    const p = await paletteFromPoster(png, sharp as unknown as SharpLike);
    expect(p.v).toBe(1);
    expect(p.vibrant).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.lqip).toMatch(/^data:image\/webp;base64,/);
    const r = await mapConcurrent([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('x');
      return x * 2;
    });
    expect(r.ok.map((o) => o.value).sort()).toEqual([2, 6]);
    expect(r.failed).toHaveLength(1);
  });
});
