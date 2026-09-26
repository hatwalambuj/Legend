/**
 * Live repositories against a real supabase-js client whose `fetch` is mocked: asserts the exact
 * PostgREST/RPC requests (params, filters, cursors, limit + 1) and the row → domain mapping.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog, FixtureTitle } from '@/fixtures/schema';
import { decodeCursor } from '@/lib/catalog-order';
import { type AppError } from '@/lib/errors';
import { sortTitle } from '@/lib/text';
import { decodeKeyset, encodeKeyset } from '@/server/cursor';
import {
  SupabaseCatalogIndex,
  SupabaseProfiles,
  SupabaseRateLimiter,
  SupabaseReviews,
  SupabaseStubs,
  SupabaseTitleStates,
  SupabaseWatchlist,
  typedTuple,
} from './index';
import { mapPgError, rowToSummary, type CatalogRow } from './rows';

const catalog = catalogJson as unknown as FixtureCatalog;

function toRow(t: FixtureTitle): CatalogRow {
  return {
    title_key: t.key,
    media_type: t.mediaType,
    tmdb_id: t.tmdbId,
    imdb_id: t.imdbId,
    title: t.title,
    original_title: t.originalTitle,
    slug: t.slug,
    overview_short: t.overviewShort,
    release_date: t.releaseDate,
    vote_average: String(t.voteAverage), // numeric may arrive as a string
    vote_count: t.voteCount,
    imdb_rating: t.imdbRating,
    imdb_votes: t.imdbVotes,
    popularity: t.popularity,
    genres: t.genres,
    poster_path: t.posterPath,
    backdrop_path: t.backdropPath,
    palette: t.palette,
    runtime_minutes: t.runtimeMinutes,
    season_count: t.seasonCount,
    episode_count: t.episodeCount,
    episode_runtime: t.episodeRuntimeMinutes,
    is_listed: true,
    tagline: t.tagline,
    pitch_hook: t.pitchHook,
    certification: t.certification,
    series_status: t.seriesStatus,
    keywords: t.keywords,
    recommendation_keys: [...t.recommendationKeys, 'bogus'],
  };
}
const rows = catalog.titles.map(toRow);
const row = (key: string) => rows.find((r) => r.title_key === key)!;

interface Call {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function fake(handler: (c: Call) => Reply) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const raw = init?.body;
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      body: typeof raw === 'string' && raw ? JSON.parse(raw) : undefined,
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return new Response(r.body === undefined || status === 204 ? null : JSON.stringify(r.body), {
      status,
      headers: { 'content-type': 'application/json', ...r.headers },
    });
  };
  const client: SupabaseClient = createClient('https://proj.supabase.co', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchImpl },
  });
  const clients = { user: () => client, public: () => client, catalog: () => client };
  return { calls, clients };
}

const path = (c: Call) => c.url.pathname.replace('/rest/v1', '');

describe('SupabaseCatalogIndex', () => {
  it('pages via GET rpc catalog_page with limit + 1, the frozen cursor and a total', async () => {
    const listed = rows.slice(0, 6);
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/catalog_count' ? { body: 42 } : { body: listed },
    );
    const repo = new SupabaseCatalogIndex(clients);
    const p1 = await repo.list({
      type: 'movie',
      sort: 'rating_desc',
      limit: 5,
      genreIds: [18, 35],
    });
    expect(p1.items).toHaveLength(5);
    expect(p1.total).toBe(42);
    expect(p1.items[0]!.voteAverage).toBe(catalog.titles[0]!.voteAverage);
    const pageCall = calls.find((c) => path(c) === '/rpc/catalog_page')!;
    expect(pageCall.method).toBe('GET');
    expect(Object.fromEntries(pageCall.url.searchParams)).toEqual({
      p_type: 'movie',
      p_sort: 'rating_desc',
      p_limit: '6',
      p_genre_ids: '{18,35}',
    });
    const tuple = decodeCursor(p1.nextCursor, 'rating_desc')!;
    const last = listed[4]!;
    expect(tuple).toEqual([
      Number(last.vote_average),
      last.vote_count,
      sortTitle(last.title),
      last.title_key,
    ]);

    calls.length = 0;
    await repo.list({ type: 'movie', sort: 'rating_desc', limit: 5, cursor: p1.nextCursor });
    const next = calls.find((c) => path(c) === '/rpc/catalog_page')!;
    expect(JSON.parse(next.url.searchParams.get('p_after')!)).toEqual(tuple);
    expect(next.url.searchParams.has('p_genre_ids')).toBe(false);
  });

  it('last page has no cursor; malformed cursors restart at page 1 (no p_after)', async () => {
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/catalog_count' ? { body: 3 } : { body: rows.slice(0, 3) },
    );
    const p = await new SupabaseCatalogIndex(clients).list({
      type: 'all',
      sort: 'release_desc',
      limit: 5,
      cursor: 'junk',
    });
    expect(p.nextCursor).toBeNull();
    expect(calls[0]!.url.searchParams.has('p_after')).toBe(false);
  });

  it('getEntry maps the summary + enrichment (IMDb, episodes, filtered recommendation keys)', async () => {
    const { calls, clients } = fake(() => ({ body: [row('tv:136315')] }));
    const e = (await new SupabaseCatalogIndex(clients).getEntry('tv', 136315))!;
    expect(path(calls[0]!)).toBe('/catalog_index');
    expect(calls[0]!.url.searchParams.get('title_key')).toBe('eq.tv:136315');
    const fx = catalog.titles.find((t) => t.key === 'tv:136315')!;
    expect(e.summary).toMatchObject({
      key: 'tv:136315',
      imdbRating: fx.imdbRating,
      episodeCount: fx.episodeCount,
      year: fx.year,
    });
    expect(e.enrichment.recommendationKeys).toEqual(fx.recommendationKeys);
    expect(e.enrichment.pitchHook).toBe(fx.pitchHook);
  });

  it('search, trending, getMany, count', async () => {
    const { calls, clients } = fake((c) => {
      if (path(c) === '/rpc/catalog_count') return { body: 66 };
      if (path(c) === '/catalog_index') return { body: [row('movie:238')] };
      return { body: [row('movie:238')] };
    });
    const repo = new SupabaseCatalogIndex(clients);
    expect(await repo.search('', 'all', 5)).toEqual([]);
    expect((await repo.search('godfather', 'movie', 5))[0]!.title).toBe('The Godfather');
    expect(calls.at(-1)!.url.searchParams.get('p_q')).toBe('godfather');
    await repo.trending('tv', 10);
    expect(calls.at(-1)!.url.searchParams.get('p_sort')).toBe('popularity_desc');
    const many = await repo.getMany(['movie:238', 'movie:238']);
    expect([...many.keys()]).toEqual(['movie:238']);
    expect(calls.at(-1)!.url.searchParams.get('title_key')).toBe('in.(movie:238)');
    expect(await repo.getMany([])).toEqual(new Map());
    expect(await repo.count()).toBe(66);
  });
});

const B = '0b000000-0000-4000-8000-00000000000b';
const stubRow = {
  id: '5e000000-0000-4000-8000-000000000001',
  user_id: B,
  title_key: 'movie:693134',
  watched_on: '2026-09-26',
  watched_where: null,
  note: '',
  created_at: '2026-09-26T10:00:00.123456+00:00',
  updated_at: '2026-09-26T10:00:00.123456+00:00',
  number: 3,
};

describe('SupabaseStubs', () => {
  it('creates via rpc stub_insert and maps trigger errors (rate limit, dates)', async () => {
    const { calls, clients } = fake(() => ({ body: [stubRow] }));
    const repo = new SupabaseStubs(clients);
    const s = await repo.create({
      userId: B,
      titleKey: 'movie:693134',
      watchedOn: '2026-09-26',
      watchedWhere: null,
      note: '',
    });
    expect(s).toMatchObject({ number: 3, titleKey: 'movie:693134', watchedOn: '2026-09-26' });
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.body).toEqual({
      p_title_key: 'movie:693134',
      p_watched_on: '2026-09-26',
      p_watched_where: null,
      p_note: '',
    });

    const limited = fake(() => ({
      status: 400,
      body: { code: 'P0001', message: 'rate_limited', hint: 'retry_after=60', details: null },
    }));
    const err = await new SupabaseStubs(limited.clients)
      .create({
        userId: B,
        titleKey: 'movie:693134',
        watchedOn: '2026-09-26',
        watchedWhere: null,
        note: '',
      })
      .catch((e: AppError) => e);
    expect(err).toMatchObject({ code: 'rate_limited', status: 429, retryAfter: 60 });
    const future = fake(() => ({
      status: 400,
      body: { code: '22023', message: 'watched_on_in_future' },
    }));
    await expect(
      new SupabaseStubs(future.clients).create({
        userId: B,
        titleKey: 'movie:693134',
        watchedOn: '2099-01-01',
        watchedWhere: null,
        note: '',
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { watchedOn: expect.any(String) },
    });
  });

  it("update/delete of a row RLS hides (someone else's) is not_found", async () => {
    const { clients } = fake(() => ({ body: [] }));
    const repo = new SupabaseStubs(clients);
    await expect(repo.update(B, stubRow.id, { note: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(repo.delete(B, stubRow.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('update filters by id AND user, then re-reads the numbered row', async () => {
    const { calls, clients } = fake((c) =>
      c.method === 'PATCH' ? { body: [{ id: stubRow.id }] } : { body: [{ ...stubRow, note: 'x' }] },
    );
    const s = await new SupabaseStubs(clients).update(B, stubRow.id, { note: 'x' });
    expect(s.note).toBe('x');
    const patch = calls[0]!;
    expect(patch.url.searchParams.get('id')).toBe(`eq.${stubRow.id}`);
    expect(patch.url.searchParams.get('user_id')).toBe(`eq.${B}`);
    expect(patch.body).toEqual({ note: 'x' });
    expect(path(calls[1]!)).toBe('/stub_details');
  });

  it('diary passes the decoded keyset tuple and mints the next cursor from raw timestamps', async () => {
    const diaryRows = [1, 2, 3].map((i) => ({
      ...stubRow,
      id: `5e000000-0000-4000-8000-00000000000${i}`,
      title: row('movie:693134'),
    }));
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/user_diary_count' ? { body: 7 } : { body: diaryRows },
    );
    const after = ['2026-10-01', '2026-10-01T00:00:00+00:00', diaryRows[0]!.id];
    const cursor = encodeKeyset('diary', after);
    const repo = new SupabaseStubs(clients);
    const p = await repo.diary(B, { type: 'movie', cursor, limit: 2 });
    const diaryCall = calls.find((c) => path(c) === '/rpc/user_diary')!;
    expect(diaryCall.body).toEqual({ p_user: B, p_type: 'movie', p_after: after, p_limit: 3 });
    expect(calls.find((c) => path(c) === '/rpc/user_diary_count')!.body).toEqual({
      p_user: B,
      p_type: 'movie',
    });
    expect(p.total).toBe(7);
    expect(p.items).toHaveLength(2);
    expect(p.items[0]!.title.key).toBe('movie:693134');
    expect(decodeKeyset(p.nextCursor, 'diary', 3)).toEqual([
      '2026-09-26',
      stubRow.created_at,
      diaryRows[1]!.id,
    ]);
    // A tampered cursor (values that would fail a SQL cast) restarts at page 1 instead of a 500.
    calls.length = 0;
    const bad = encodeKeyset('diary', ['not-a-date', "x'::uuid", 'x']);
    await repo.diary(B, { type: 'all', cursor: bad, limit: 2 });
    expect(calls.find((c) => path(c) === '/rpc/user_diary')!.body).toMatchObject({ p_after: null });
  });
});

describe('typedTuple', () => {
  it('accepts only values with the SQL type of each keyset position', () => {
    const ts = '2026-09-26T21:00:00.123456+00:00';
    const id = '5e000000-0000-4000-8000-000000000001';
    expect(typedTuple(['2026-09-26', ts, id], ['date', 'ts', 'uuid'])).not.toBeNull();
    expect(typedTuple(['2026-02-30', ts, id], ['date', 'ts', 'uuid'])).toBeNull();
    expect(typedTuple(['2026-09-26', '1', id], ['date', 'ts', 'uuid'])).toBeNull();
    expect(typedTuple([8.1, 1e12, 'a', 'b'], ['num', 'int', 'str', 'str'])).toBeNull();
    expect(typedTuple([8.1, 1200, 'a', 'b'], ['num', 'int', 'str', 'str'])).not.toBeNull();
    expect(typedTuple(null, ['str'])).toBeNull();
  });
});

const reviewRow = {
  id: '7e000000-0000-4000-8000-000000000001',
  user_id: B,
  title_id: 1,
  title_key: 'movie:693134',
  rating_10: 9,
  body: 'b',
  is_spoiler: false,
  stub_id: null,
  stub_number: null,
  created_at: '2026-09-26T10:00:00+00:00',
  updated_at: '2026-09-26T10:00:00+00:00',
  edited_at: null,
  author: {
    id: B,
    handle: 'bob',
    displayName: 'Bob',
    bio: '',
    avatarUrl: null,
    createdAt: '2026-01-01T00:00:00+00:00',
  },
};

describe('SupabaseReviews', () => {
  const setup = (opts: { updated: boolean; insertConflict?: boolean }) => {
    let patches = 0;
    return fake((c) => {
      if (path(c) === '/catalog_index') return { body: [{ id: 1 }] };
      if (path(c) === '/reviews' && c.method === 'PATCH') {
        patches++;
        return {
          body: opts.updated || (opts.insertConflict && patches > 1) ? [{ id: reviewRow.id }] : [],
        };
      }
      if (path(c) === '/reviews' && c.method === 'POST')
        return opts.insertConflict
          ? { status: 409, body: { code: '23505', message: 'duplicate key' } }
          : { status: 201, body: { id: reviewRow.id } };
      if (path(c) === '/review_details') return { body: [reviewRow] };
      return { status: 500, body: {} };
    });
  };
  const input = {
    userId: B,
    titleKey: 'movie:693134' as const,
    rating10: 9,
    body: 'b',
    isSpoiler: false,
    stubId: null,
  };

  it('updates an existing review (created=false)', async () => {
    const { calls, clients } = setup({ updated: true });
    expect(await new SupabaseReviews(clients).upsert(input)).toMatchObject({
      created: false,
      review: { rating10: 9, author: { handle: 'bob' } },
    });
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('inserts when there is none (created=true)', async () => {
    const { calls, clients } = setup({ updated: false });
    expect((await new SupabaseReviews(clients).upsert(input)).created).toBe(true);
    const ins = calls.find((c) => c.method === 'POST')!;
    expect(ins.body).toEqual({
      user_id: B,
      title_id: 1,
      rating_10: 9,
      body: 'b',
      is_spoiler: false,
      stub_id: null,
    });
  });

  it('a concurrent insert (unique violation) falls back to the update', async () => {
    const { clients } = setup({ updated: false, insertConflict: true });
    expect((await new SupabaseReviews(clients).upsert(input)).created).toBe(false);
  });

  it('lists title reviews with the right keyset kind per sort', async () => {
    const { calls, clients } = fake(() => ({ body: [reviewRow, { ...reviewRow, id: 'x' }] }));
    const p = await new SupabaseReviews(clients).listForTitle('movie:693134', {
      sort: 'highest',
      limit: 1,
    });
    expect(calls[0]!.body).toMatchObject({ p_sort: 'highest', p_after: null, p_limit: 2 });
    expect(decodeKeyset(p.nextCursor, 'reviews:highest', 3)).toEqual([
      9,
      reviewRow.created_at,
      reviewRow.id,
    ]);
    expect(decodeKeyset(p.nextCursor, 'reviews:newest', 2)).toBeNull();
  });
});

describe('SupabaseTitleStates / Watchlist / RateLimiter / Profiles', () => {
  it('states: one rpc + one review fetch for all keys', async () => {
    const { calls, clients } = fake((c) =>
      path(c) === '/rpc/user_title_states'
        ? {
            body: [
              {
                title_key: 'movie:693134',
                stub_count: 2,
                last_watched_on: '2026-09-26',
                has_stub_today: true,
                watchlisted: true,
                review_id: reviewRow.id,
              },
            ],
          }
        : { body: [reviewRow] },
    );
    const s = await new SupabaseTitleStates(clients).states(
      B,
      ['movie:693134', 'tv:1'],
      '2026-09-26',
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.body).toEqual({
      p_user: B,
      p_keys: ['movie:693134', 'tv:1'],
      p_today: '2026-09-26',
    });
    expect(calls[1]!.url.searchParams.get('id')).toBe(`in.(${reviewRow.id})`);
    expect(s['movie:693134']).toMatchObject({
      stubCount: 2,
      hasStubToday: true,
      watchlisted: true,
      myReview: { id: reviewRow.id },
    });
    expect(s['tv:1']).toMatchObject({ stubCount: 0, myReview: null });
  });

  it('stats: average only from 5 ratings', async () => {
    const few = fake(() => ({
      body: [{ stub_count: 3, review_count: 4, rating_sum: 36, rating_count: 4 }],
    }));
    expect((await new SupabaseTitleStates(few.clients).stats('movie:1')).ratingAvg10).toBeNull();
    const many = fake(() => ({
      body: [{ stub_count: 3, review_count: 5, rating_sum: 42, rating_count: 5 }],
    }));
    expect(await new SupabaseTitleStates(many.clients).stats('movie:1')).toEqual({
      stubCount: 3,
      reviewCount: 5,
      ratingCount: 5,
      ratingAvg10: 8.4,
    });
  });

  it('watchlist: idempotent upsert, keyset or-filter on (added_at, title_id)', async () => {
    const { calls, clients } = fake((c) => {
      if (path(c) === '/catalog_index') return { body: [{ id: 7 }] };
      if (path(c) === '/watchlist' && c.method === 'GET')
        return {
          body: [{ added_at: '2026-09-01T00:00:00+00:00', title_id: 7, title: row('movie:238') }],
        };
      return { status: 201, body: [] };
    });
    const repo = new SupabaseWatchlist(clients);
    await repo.add(B, 'movie:238');
    const up = calls.find((c) => c.method === 'POST')!;
    expect(up.headers.get('prefer')).toContain('resolution=ignore-duplicates');
    expect(up.url.searchParams.get('on_conflict')).toBe('user_id,title_id');
    const cursor = encodeKeyset('watchlist', ['2026-09-02T00:00:00+00:00', 9]);
    const l = await repo.list(B, { cursor, limit: 10 });
    expect(l.items.map((t) => t.key)).toEqual(['movie:238']);
    const get = calls.filter((c) => path(c) === '/watchlist' && c.method === 'GET').at(-1)!;
    expect(get.url.searchParams.get('or')).toBe(
      '(added_at.lt."2026-09-02T00:00:00+00:00",and(added_at.eq."2026-09-02T00:00:00+00:00",title_id.gt.9))',
    );
    expect(get.url.searchParams.get('limit')).toBe('11');
  });

  it('rate limiter maps the DB answer', async () => {
    const ok = fake(() => ({ body: 0 }));
    expect(await new SupabaseRateLimiter(ok.clients).consume('export_json:u', 1, 600)).toEqual({
      ok: true,
    });
    expect(ok.calls[0]!.body).toEqual({ p_kind: 'export_json', p_max: 1, p_window_secs: 600 });
    const no = fake(() => ({ body: 412 }));
    expect(await new SupabaseRateLimiter(no.clients).consume('export_json:u', 1, 600)).toEqual({
      ok: false,
      retryAfter: 412,
    });
  });

  it('profiles: handle lookup, stats mapping, column-whitelisted update', async () => {
    const { calls, clients } = fake((c) => {
      if (path(c) === '/rpc/profile_stats')
        return {
          body: {
            total_stubs: 12,
            stubs_this_year: 10,
            titles_stubbed: 6,
            review_count: 4,
            most_stubbed: { count: 4, title: row('tv:2316') },
          },
        };
      return {
        body: [
          {
            id: B,
            handle: 'bob',
            display_name: 'Bob',
            bio: null,
            avatar_url: null,
            created_at: '2026-01-01',
          },
        ],
      };
    });
    const repo = new SupabaseProfiles(clients);
    expect(await repo.getByHandle('not a handle!')).toBeNull();
    expect((await repo.getByHandle('BOB'))!.bio).toBe('');
    expect(calls[0]!.url.searchParams.get('handle')).toBe('eq.bob');
    expect(await repo.stats(B, 2026)).toMatchObject({
      totalStubs: 12,
      rewatches: 6,
      mostStubbed: { count: 4 },
    });
    await repo.update(B, { displayName: 'B', avatarUrl: null });
    expect(calls.at(-1)!.body).toEqual({ display_name: 'B', avatar_url: null });
  });
});

describe('rows + errors', () => {
  it('maps numerics, hides IMDb 0/null, keeps unlisted flags', () => {
    const s = rowToSummary({
      ...row('movie:19908'),
      imdb_rating: '0',
      is_listed: false,
      vote_average: '6.4',
    });
    expect(s).toMatchObject({ imdbRating: null, isListed: false, voteAverage: 6.4 });
  });
  it('maps Postgres errors to the contract', () => {
    expect(mapPgError({ code: '23505' }).code).toBe('conflict');
    expect(mapPgError({ code: '42501' }).code).toBe('unauthenticated');
    expect(mapPgError({ code: 'P0001', message: 'rate_limited' }, 'review').message).toMatch(
      /reviews/,
    );
    expect(mapPgError({ code: '22023', message: 'stub_mismatch' }).fields).toEqual({
      stubId: expect.any(String),
    });
    expect(mapPgError({ code: 'XX000', message: 'secret SQL detail' })).toMatchObject({
      code: 'internal',
      message: 'Something went wrong. Try again.',
    });
  });
});
