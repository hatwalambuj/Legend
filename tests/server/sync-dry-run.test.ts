/**
 * The nightly job's real step wiring (scripts/sync-catalog.ts buildSteps + runSync) against a recording
 * fake Supabase client and a stubbed global fetch:
 * - ADR-011 §1: a dry run makes 0 OMDb calls, 0 TMDB detail calls, 0 image fetches and 0 DB writes,
 *   for the full run and for each --only.
 * - ADR-011 §10 (F2): more missing titles than SYNC_RECHECK_MAX abort apply; errored re-checks are
 *   carried forward unchanged (still listed).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { runSync, type SyncStep } from '@/server/jobs/sync-runner';
import { buildSteps } from '../../scripts/sync-catalog';

type Op = [string, unknown[]];
interface Query {
  kind: 'from' | 'rpc';
  name: string;
  ops: Op[];
}
const WRITE_RPCS = new Set([
  'catalog_apply_staging',
  'catalog_set_enrichment',
  'catalog_set_imdb',
  'catalog_purge_stale',
]);
const WRITE_OPS = new Set(['insert', 'update', 'upsert', 'delete']);

/** Chainable PostgREST look-alike: every call is recorded; awaiting it asks `handler` for data. */
function fakeDb(handler: (q: Query) => unknown) {
  const writes: Query[] = [];
  const queries: Query[] = [];
  const builder = (kind: Query['kind'], name: string, ops: Op[]): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then')
            return (res: (v: unknown) => void, rej: (e: unknown) => void) => {
              const q = { kind, name, ops };
              queries.push(q);
              if ((kind === 'rpc' && WRITE_RPCS.has(name)) || ops.some(([m]) => WRITE_OPS.has(m)))
                writes.push(q);
              Promise.resolve()
                .then(() => ({ data: handler(q) ?? null, error: null }))
                .then(res, rej);
            };
          return (...args: unknown[]) => builder(kind, name, [...ops, [String(prop), args]]);
        },
      },
    );
  const db = {
    from: (t: string) => builder('from', t, []),
    rpc: (fn: string, args?: unknown) => builder('rpc', fn, [['args', [args]]]),
  } as unknown as SupabaseClient;
  return { db, writes, queries };
}

const has = (q: Query, method: string) => q.ops.some(([m]) => m === method);
const selectOf = (q: Query) => q.ops.find(([m]) => m === 'select')?.[1][0];

const PREVIOUSLY_LISTED = ['movie:900001', 'movie:900002', 'tv:900003'];
const movie = (id: number) => ({
  id,
  title: `Film ${id}`,
  original_title: `Film ${id}`,
  overview: 'x',
  name: `Film ${id}`,
  release_date: '2020-05-01',
  first_air_date: '2020-05-01',
  vote_average: 7.4,
  vote_count: 900,
  popularity: 5,
  genre_ids: [18],
});
const currentRow = (key: string) => {
  const [media_type, id] = key.split(':');
  return {
    media_type,
    tmdb_id: Number(id),
    imdb_id: null,
    title: `Kept ${id}`,
    original_title: `Kept ${id}`,
    slug: `kept-${id}`,
    overview_short: '',
    release_date: '2019-01-01',
    vote_average: 7,
    vote_count: 500,
    popularity: 1,
    genre_ids: [18],
    genres: [{ id: 18, name: 'Drama' }],
    original_language: 'en',
    poster_path: null,
    backdrop_path: null,
    sort_title: `kept ${id}`,
    search_text: `kept ${id}`,
    is_listed: true,
  };
};

function dbHandler(q: Query): unknown {
  if (q.kind === 'rpc') {
    if (q.name === 'catalog_enrich_due') return [{ id: 1, media_type: 'movie', tmdb_id: 11 }];
    if (q.name === 'catalog_imdb_due') return [{ id: 1, imdb_id: 'tt0000001' }];
    if (q.name === 'catalog_rating_disagreements') return [];
    if (q.name === 'catalog_apply_staging') return { upserted: 1 };
    return null;
  }
  if (q.name === 'catalog_index' && selectOf(q) === 'title_key')
    return PREVIOUSLY_LISTED.map((title_key) => ({ title_key }));
  if (q.name === 'catalog_index' && has(q, 'in') && has(q, 'select')) {
    const keys = q.ops.find(([m]) => m === 'in')![1][1] as string[];
    return keys.map(currentRow);
  }
  if (q.name === 'catalog_index' && selectOf(q) === 'id, poster_path')
    return [{ id: 1, poster_path: '/p.jpg' }];
  if (q.name === 'sync_runs' && has(q, 'select')) return [];
  return null;
}

let fetched: string[] = [];
/** status for GET /{type}/{id} (re-check) calls. */
let detailStatus = 404;

beforeEach(() => {
  fetched = [];
  detailStatus = 404;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      fetched.push(url.toString());
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        });
      if (url.pathname.endsWith('/genre/movie/list') || url.pathname.endsWith('/genre/tv/list'))
        return json({ genres: [{ id: 18, name: 'Drama' }] });
      const d = url.pathname.match(/\/3\/discover\/(movie|tv)$/);
      if (d) {
        const year = Number(
          (
            url.searchParams.get('primary_release_date.gte') ??
            url.searchParams.get('first_air_date.gte') ??
            '2000'
          ).slice(0, 4),
        );
        const base = (d[1] === 'movie' ? 1 : 5) * 100_000 + year * 10;
        return json({ page: 1, total_pages: 1, results: [movie(base + 1), movie(base + 2)] });
      }
      if (/\/3\/(movie|tv)\/\d+$/.test(url.pathname)) return json({}, detailStatus);
      return json({}, 500);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const env = (over: Record<string, string> = {}) =>
  parseEnv({
    TMDB_READ_TOKEN: 't',
    OMDB_API_KEY: 'k',
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
    REVALIDATE_SECRET: 'secret',
    SYNC_GUARD_MIN_MOVIE: '1',
    SYNC_GUARD_MIN_TV: '1',
    ...over,
  });

const isDetail = (u: string) => /api\.themoviedb\.org\/3\/(movie|tv)\/\d+/.test(u);
const isOmdb = (u: string) => u.includes('omdbapi.com');
const isImage = (u: string) => u.includes('image.tmdb.org');

async function sync(opts: { dryRun: boolean; only: SyncStep | null }, e = env()) {
  const f = fakeDb(dbHandler);
  const steps = buildSteps(e, f.db, { runId: 'run-1', today: '2026-09-27', tmdbRps: 1e6 });
  const result = await runSync(steps, opts);
  return { ...f, result };
}

describe('--dry-run spends no budget and writes nothing (ADR-011 §1)', () => {
  it('full run: discover pages only; 0 detail, 0 OMDb, 0 images, 0 writes; guard printed', async () => {
    const { writes, queries, result } = await sync({ dryRun: true, only: null });
    expect(writes).toEqual([]);
    expect(fetched.filter(isDetail)).toEqual([]);
    expect(fetched.filter(isOmdb)).toEqual([]);
    expect(fetched.filter(isImage)).toEqual([]);
    expect(fetched.some((u) => u.includes('/3/discover/movie'))).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.counts.discover).toMatchObject({
      dry_run: true,
      missing: 3,
      rechecked: 0,
      recheck_skipped: 3,
    });
    expect(result.counts.enrich).toEqual({ due: 1, dry_run: true });
    expect(result.counts.imdb).toEqual({ due: 1, dry_run: true });
    expect(result.counts.palettes).toEqual({ due: 1 });
    // Read-only RPCs only; no sync_runs bookkeeping.
    expect(queries.filter((q) => q.name === 'sync_runs').every((q) => has(q, 'select'))).toBe(true);
    const logs = (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.flat();
    expect(logs).toContain('[sync] GUARD: pass');
  });

  it.each(['discover', 'enrich', 'imdb'] as const)('--only=%s: same rules', async (only) => {
    const { writes } = await sync({ dryRun: true, only });
    expect(writes).toEqual([]);
    expect(fetched.filter((u) => isDetail(u) || isOmdb(u) || isImage(u))).toEqual([]);
    if (only !== 'discover') expect(fetched).toEqual([]);
  });

  it('guard failure in a dry run → aborted (exit 1), still nothing written', async () => {
    const { writes, result } = await sync(
      { dryRun: true, only: 'discover' },
      env({ SYNC_GUARD_MAX: '5' }),
    );
    expect(result.status).toBe('aborted');
    expect(writes).toEqual([]);
  });
});

describe('F2 recheck cap + carry-forward (ADR-011 §10)', () => {
  it('more missing than SYNC_RECHECK_MAX → recheck_capped, no staging/apply/gone', async () => {
    const { writes, result } = await sync(
      { dryRun: false, only: 'discover' },
      env({ SYNC_RECHECK_MAX: '2' }),
    );
    expect(result.status).toBe('aborted');
    expect(result.reasons).toContain('recheck_capped: 3 missing titles exceed SYNC_RECHECK_MAX=2');
    // Membership untouched: no staging, no apply, no gone. (The purge only removes unlisted rows.)
    expect(writes.map((w) => w.name)).toEqual(['sync_runs', 'catalog_purge_stale', 'sync_runs']);
  });

  it('errored re-checks are staged unchanged (listed), none unlisted or marked gone', async () => {
    detailStatus = 400; // non-retryable upstream error → counted as a re-check error
    const { writes, result } = await sync({ dryRun: false, only: 'discover' });
    expect(result.status).toBe('ok');
    const staged = writes
      .filter((w) => w.name === 'catalog_staging')
      .flatMap((w) => w.ops.find(([m]) => m === 'upsert')![1][0] as Record<string, unknown>[]);
    const carried = staged.filter((r) => String(r.title).startsWith('Kept'));
    expect(carried.map((r) => `${r.media_type}:${r.tmdb_id}`).sort()).toEqual(
      [...PREVIOUSLY_LISTED].sort(),
    );
    expect(carried.every((r) => r.is_listed === true && r.run_id === 'run-1')).toBe(true);
    expect(writes.some((w) => w.name === 'catalog_index' && has(w, 'update'))).toBe(false);
    expect(result.counts.discover).toMatchObject({
      recheck_errors: 3,
      carried_forward: 3,
      gone: 0,
    });
  });

  it('404 re-checks are marked gone (hysteresis path unchanged)', async () => {
    const { writes } = await sync({ dryRun: false, only: 'discover' });
    const gone = writes.find((w) => w.name === 'catalog_index' && has(w, 'update'));
    expect(gone?.ops.find(([m]) => m === 'in')?.[1][1]).toEqual(PREVIOUSLY_LISTED);
  });
});
