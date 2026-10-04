/**
 * ADR-013 close-out routes end to end in demo mode (zero env, zero network): watchHint + region echo
 * (C-01), provider filter + chips (C-02), resolveTitle (C-03), season (C-10), avatarColor (C-12),
 * events (C-09), client logs (C-13), imports (C-11), stub share data (C-08).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (n: string, v: string, o?: { maxAge?: number }) => {
      if (o?.maxAge === 0 || v === '') jar.delete(n);
      else jar.set(n, v);
    },
    delete: (n: string) => jar.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/cache', () => ({ revalidateTag: () => undefined }));

const { authRateLimiter, resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton } = await import('@/server/repositories/memory/store');
const { demoEventCounts, EVENTS_MAX_ROWS_PER_DAY, MemoryEvents } =
  await import('@/server/repositories/memory/user-data');
const { resetEnvCache } = await import('@/server/env');
const { ipKey, limitFor, LIMITS } = await import('@/server/rate-limit');
const { dal } = await import('@/server/dal');
const signin = await import('@/app/api/auth/signin/route');
const signup = await import('@/app/api/auth/signup/route');
const me = await import('@/app/api/me/route');
const catalogRoute = await import('@/app/api/catalog/route');
const searchRoute = await import('@/app/api/search/route');
const providersRoute = await import('@/app/api/watch/providers/route');
const myWatchlist = await import('@/app/api/me/watchlist/route');
const watchlistRoute = await import('@/app/api/watchlist/[type]/[tmdbId]/route');
const stubsRoute = await import('@/app/api/stubs/route');
const stubRoute = await import('@/app/api/stubs/[id]/route');
const reviewsRoute = await import('@/app/api/reviews/route');
const profileRoute = await import('@/app/api/me/profile/route');
const exportRoute = await import('@/app/api/me/export/route');
const eventsRoute = await import('@/app/api/events/route');
const logRoute = await import('@/app/api/log/route');
const previewRoute = await import('@/app/api/me/imports/preview/route');
const importRoute = await import('@/app/api/me/imports/route');

const BASE = 'http://localhost:3000';
type Handler<C = unknown> = (req: NextRequest, ctx: C) => Promise<Response>;

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      ...(method !== 'GET' ? { origin: BASE } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function call<C>(h: Handler<C>, r: NextRequest, params?: C) {
  const res = await h(r, (params ?? {}) as C);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, data: data as Record<string, any>, text };
}

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const today = () => new Date().toISOString().slice(0, 10);

async function signInAs(email = 'maya@demo.stubbed.app') {
  const r = await call(
    signin.POST as Handler,
    req('POST', '/api/auth/signin', { email, password: 'stubbed-demo' }),
  );
  expect(r.status).toBe(200);
  return r.data.session;
}

async function freshUser(handle: string) {
  const r = await call(
    signup.POST as Handler,
    req('POST', '/api/auth/signup', {
      email: `${handle}@x.test`,
      password: 'password123',
      handle,
      ref: 'share',
    }),
  );
  expect(r.status).toBe(201);
  return r.data.session;
}

beforeEach(() => {
  jar.clear();
  resetEnvCache();
  resetContainer();
  resetDemoStoreSingleton();
});

describe('C-01 watchHint + region echo', () => {
  it('catalog: no region → no watchHint; region → hint or null on every item, region echoed', async () => {
    const plain = await call(catalogRoute.GET as Handler, req('GET', '/api/catalog?limit=50'));
    expect(plain.status).toBe(200);
    expect(plain.data.region).toBeUndefined();
    expect(plain.data.items.every((t: object) => !('watchHint' in t))).toBe(true);

    const us = await call(
      catalogRoute.GET as Handler,
      req('GET', '/api/catalog?limit=50&region=us'),
    );
    expect(us.data.region).toBe('US');
    expect(us.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    expect(us.data.items.every((t: object) => 'watchHint' in t)).toBe(true);
    const bb = us.data.items.find((t: { key: string }) => t.key === 'tv:1396');
    expect(bb.watchHint).toMatchObject({
      providerId: 8,
      name: 'Netflix',
      logoPath: null,
      monogram: 'N',
    });

    const unsupported = await call(
      catalogRoute.GET as Handler,
      req('GET', '/api/catalog?region=ZZ'),
    );
    expect(unsupported.status).toBe(200);
    expect(unsupported.data.region).toBe('US');
    const bad = await call(catalogRoute.GET as Handler, req('GET', '/api/catalog?region=USA'));
    expect(bad.status).toBe(400);
  });

  it('stale watch data gives a null hint', async () => {
    const watch = (await import('@/fixtures/watch.json')).default as {
      titles: { key: string; ageDays: number }[];
    };
    const stale = watch.titles.find((t) => t.ageDays > 30)!;
    const page = await dal.listCatalog({
      type: 'all',
      sort: 'release_desc',
      limit: 50,
      region: 'US',
    });
    const all = [...page.items];
    let cursor = page.nextCursor;
    while (cursor) {
      const p = await dal.listCatalog({
        type: 'all',
        sort: 'release_desc',
        limit: 50,
        cursor,
        region: 'US',
      });
      all.push(...p.items);
      cursor = p.nextCursor;
    }
    const t = all.find((x) => x.key === stale.key);
    if (t) expect(t.watchHint).toBeNull();
  });

  it('search and watchlist echo the region', async () => {
    const s = await call(
      searchRoute.GET as Handler,
      req('GET', '/api/search?q=breaking&region=GB'),
    );
    expect(s.data.region).toBe('GB');
    expect(s.data.items[0]).toHaveProperty('watchHint');
    await signInAs();
    await call(
      watchlistRoute.PUT as Handler<unknown>,
      req('PUT', '/api/watchlist/tv/1396', {}),
      ctx({ type: 'tv', tmdbId: '1396' }),
    );
    const w = await call(myWatchlist.GET as Handler, req('GET', '/api/me/watchlist?region=US'));
    expect(w.status).toBe(200);
    expect(w.data.region).toBe('US');
    expect(w.data.items.find((t: { key: string }) => t.key === 'tv:1396').watchHint.name).toBe(
      'Netflix',
    );
  });
});

describe('C-02 provider filter + chips', () => {
  it('provider needs a region; filters keep the curation rule; unknown provider → empty page', async () => {
    const noRegion = await call(catalogRoute.GET as Handler, req('GET', '/api/catalog?provider=8'));
    expect(noRegion.status).toBe(400);
    expect(noRegion.data.error.fields.provider).toBeTruthy();
    const f = await call(
      catalogRoute.GET as Handler,
      req('GET', '/api/catalog?region=US&provider=8&limit=50'),
    );
    expect(f.status).toBe(200);
    expect(f.data.total).toBe(f.data.items.length);
    expect(f.data.items.length).toBeGreaterThan(0);
    for (const t of f.data.items) {
      expect(t.isListed).toBe(true);
      expect(t.voteAverage).toBeGreaterThanOrEqual(6.5);
    }
    const none = await call(
      catalogRoute.GET as Handler,
      req('GET', '/api/catalog?region=US&provider=999999'),
    );
    expect(none.status).toBe(200);
    expect(none.data.items).toEqual([]);
    expect(none.data.total).toBe(0);
  });

  it('GET /api/watch/providers: <= 6 chips, count >= 1, public cache', async () => {
    const r = await call(
      providersRoute.GET as Handler,
      req('GET', '/api/watch/providers?region=US'),
    );
    expect(r.status).toBe(200);
    expect(r.data.region).toBe('US');
    expect(r.data.providers.length).toBeGreaterThan(0);
    expect(r.data.providers.length).toBeLessThanOrEqual(6);
    for (const p of r.data.providers) expect(p.count).toBeGreaterThanOrEqual(1);
    expect(r.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    expect(r.headers.get('set-cookie')).toBeNull();
    const missing = await call(providersRoute.GET as Handler, req('GET', '/api/watch/providers'));
    expect(missing.status).toBe(400);
  });
});

describe('C-03 resolveTitle', () => {
  it('returns the canonical slug, or null for an unknown title', async () => {
    expect(await dal.resolveTitle('movie', 278)).toEqual({ slug: 'the-shawshank-redemption' });
    expect(await dal.resolveTitle('movie', 999_999_999)).toBeNull();
  });
});

describe('C-10 season on stubs', () => {
  it('TV stubs take a season; movies and seasons above seasonCount are 400; PATCH null clears', async () => {
    await signInAs();
    const ok = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'tv', tmdbId: 1396, season: 2 }),
    );
    expect(ok.status).toBe(201);
    expect(ok.data.stub.season).toBe(2);
    const movie = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'movie', tmdbId: 278, season: 1 }),
    );
    expect(movie.status).toBe(400);
    expect(movie.data.error.fields.season).toBeTruthy();
    const high = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'tv', tmdbId: 1396, season: 6 }),
    );
    expect(high.status).toBe(400);
    expect(high.data.error.fields.season).toBeTruthy();
    const cleared = await call(
      stubRoute.PATCH as Handler<unknown>,
      req('PATCH', `/api/stubs/${ok.data.stub.id}`, { season: null }),
      ctx({ id: ok.data.stub.id }),
    );
    expect(cleared.status).toBe(200);
    expect(cleared.data.stub.season).toBeNull();
    const set = await call(
      stubRoute.PATCH as Handler<unknown>,
      req('PATCH', `/api/stubs/${ok.data.stub.id}`, { season: 5 }),
      ctx({ id: ok.data.stub.id }),
    );
    expect(set.data.stub.season).toBe(5);
    const json = await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=json'));
    const exported = JSON.parse(json.text) as { stubs: { id: string; season: number | null }[] };
    expect(exported.stubs.find((s) => s.id === ok.data.stub.id)!.season).toBe(5);
    expect(exported.stubs.every((s) => 'season' in s)).toBe(true);
  });
});

describe('C-12 avatar colour', () => {
  it('PATCH /api/me/profile sets and clears avatarColor; me and review authors carry it', async () => {
    await signInAs();
    const bad = await call(
      profileRoute.PATCH as Handler,
      req('PATCH', '/api/me/profile', { avatarColor: 'pink' }),
    );
    expect(bad.status).toBe(400);
    const ok = await call(
      profileRoute.PATCH as Handler,
      req('PATCH', '/api/me/profile', { avatarColor: 'ocean' }),
    );
    expect(ok.data.profile.avatarColor).toBe('ocean');
    const m = await call(me.GET as Handler, req('GET', '/api/me'));
    expect(m.data.session.user.avatarColor).toBe('ocean');
    const rv = await call(
      reviewsRoute.PUT as Handler,
      req('PUT', '/api/reviews', { mediaType: 'movie', tmdbId: 278, rating10: 8 }),
    );
    expect(rv.data.review.author.avatarColor).toBe('ocean');
    const cleared = await call(
      profileRoute.PATCH as Handler,
      req('PATCH', '/api/me/profile', { avatarColor: null }),
    );
    expect(cleared.data.profile.avatarColor).toBeNull();
  });
});

describe('C-09 events', () => {
  const day = () => new Date().toISOString().slice(0, 10);

  it('server routes count signup (ref dim), stubs, rewatches, reviews, watchlist adds, exports', async () => {
    await freshUser('evt_user');
    await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'movie', tmdbId: 278 }),
    );
    await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'movie', tmdbId: 278 }),
    );
    const put = (body: object) =>
      call(reviewsRoute.PUT as Handler, req('PUT', '/api/reviews', body));
    await put({ mediaType: 'movie', tmdbId: 278, rating10: 8 });
    await put({ mediaType: 'movie', tmdbId: 278, rating10: 8 }); // re-save: not counted
    await put({ mediaType: 'movie', tmdbId: 278, rating10: 9 }); // content change: edit
    for (let i = 0; i < 2; i++)
      await call(
        watchlistRoute.PUT as Handler<unknown>,
        req('PUT', '/api/watchlist/movie/238', {}),
        ctx({ type: 'movie', tmdbId: '238' }),
      );
    await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=json'));
    expect(demoEventCounts(day())).toEqual({
      'signup_completed:share': 1,
      stub_created: 2,
      stub_again: 1,
      'review_saved:new': 1,
      'review_saved:edit': 1,
      watchlist_added: 1,
      'export_downloaded:json': 1,
    });
  });

  it('POST /api/events: 204 for client events; 400 for server-only names; GPC → nothing recorded', async () => {
    const ok = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', {
        events: [
          { name: 'share_generated', dim: 'title:copy' },
          { name: 'share_generated', dim: 'title:copy' },
          { name: 'worth_it_viewed', dim: 'widely_loved' },
        ],
      }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('set-cookie')).toBeNull();
    expect(demoEventCounts(day())).toEqual({
      'share_generated:title:copy': 2,
      'worth_it_viewed:widely_loved': 1,
    });
    const server = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', { events: [{ name: 'stub_created', dim: '' }] }),
    );
    expect(server.status).toBe(400);
    const gpc = await call(
      eventsRoute.POST as Handler,
      req(
        'POST',
        '/api/events',
        { events: [{ name: 'share_generated', dim: 'stub:native' }] },
        { 'sec-gpc': '1' },
      ),
    );
    expect(gpc.status).toBe(204);
    expect(demoEventCounts(day())['share_generated:stub:native']).toBeUndefined();
    const cross = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', { events: [] }, { origin: 'https://evil.test' }),
    );
    expect(cross.status).toBe(403);
    const big = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', JSON.stringify({ events: [], pad: 'x'.repeat(9000) })),
    );
    expect(big.status).toBe(413);
    const text = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', 'x', { 'content-type': 'text/plain' }),
    );
    expect(text.status).toBe(415);
  });

  it('ANALYTICS_ENABLED=false → 204 no-op', async () => {
    vi.stubEnv('ANALYTICS_ENABLED', 'false');
    const r = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', { events: [{ name: 'share_generated', dim: 'wallet:copy' }] }),
    );
    vi.unstubAllEnvs();
    expect(r.status).toBe(204);
    expect(demoEventCounts(day())['share_generated:wallet:copy']).toBeUndefined();
  });

  it('429 over the per-IP limit (salted in-memory key)', async () => {
    const l = limitFor('events', true, 'none');
    const key = `events:${ipKey('shared')}`;
    for (let i = 0; i < l.max; i++) authRateLimiter().consumeSync(key, l.max, l.windowSec);
    const r = await call(
      eventsRoute.POST as Handler,
      req('POST', '/api/events', { events: [{ name: 'share_generated', dim: 'title:copy' }] }),
    );
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBeTruthy();
  });
  it('the demo counters create at most EVENTS_MAX_ROWS_PER_DAY keys a day; known keys still count (SR-1)', async () => {
    const repo = new MemoryEvents();
    const dims = (from: number) =>
      Array.from({ length: 50 }, (_, i) => ({
        name: 'provider_clicked' as const,
        dim: `stream:US:${from + i}:home`,
        n: 1,
      }));
    for (let b = 0; b * 50 < EVENTS_MAX_ROWS_PER_DAY + 50; b++) await repo.track(dims(1 + b * 50));
    await repo.track([{ name: 'provider_clicked', dim: 'stream:US:1:home', n: 1 }]);
    const counts = demoEventCounts(day());
    expect(Object.keys(counts)).toHaveLength(EVENTS_MAX_ROWS_PER_DAY);
    expect(counts['provider_clicked:stream:US:1:home']).toBe(2);
  });
});

describe('C-13 POST /api/log', () => {
  it('logs one redacted client_error line without query, IP or raw UA', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await call(
      logRoute.POST as Handler,
      req(
        'POST',
        '/api/log',
        {
          kind: 'unhandled',
          message: 'boom for a@b.co',
          path: '/title/movie/1-x?token=secret#frag',
        },
        {
          'user-agent': 'Mozilla/5.0 Chrome/120.0 Safari/537.36',
          'x-forwarded-for': '203.0.113.9',
        },
      ),
    );
    expect(r.status).toBe(204);
    const line = JSON.parse(String(spy.mock.calls.at(-1)![0])) as Record<string, unknown>;
    spy.mockRestore();
    expect(line).toMatchObject({
      event: 'client_error',
      level: 'error',
      kind: 'unhandled',
      message: 'boom for [email]',
      path: '/title/movie/1-x',
      uaFamily: 'chrome',
    });
    expect(JSON.stringify(line)).not.toContain('203.0.113.9');
    expect(JSON.stringify(line)).not.toContain('secret');
    const big = await call(
      logRoute.POST as Handler,
      req(
        'POST',
        '/api/log',
        JSON.stringify({ kind: 'global', message: 'x', path: '/', pad: 'y'.repeat(5000) }),
      ),
    );
    expect(big.status).toBe(413);
    const bad = await call(logRoute.POST as Handler, req('POST', '/api/log', { kind: 'nope' }));
    expect(bad.status).toBe(400);
  });

  it('429 per process ceiling', async () => {
    for (let i = 0; i < LIMITS.clientLogProcess.max; i++)
      authRateLimiter().consumeSync('log:process', LIMITS.clientLogProcess.max, 60);
    const r = await call(
      logRoute.POST as Handler,
      req('POST', '/api/log', { kind: 'global', message: 'x', path: '/' }),
    );
    expect(r.status).toBe(429);
  });
});

describe('C-11 imports', () => {
  const rows = [
    {
      ref: 'diary:1',
      mediaType: 'movie',
      title: 'The Shawshank Redemption',
      year: 1994,
      watchedOn: '2024-01-01',
      rating10: 9,
    },
    {
      ref: 'diary:2',
      mediaType: 'movie',
      title: 'The Shawshank Redemption',
      year: 1994,
      watchedOn: '2024-02-01',
      rating10: 10,
      review: 'Hope.',
    },
    { ref: 'diary:3', mediaType: 'movie', imdbId: 'tt0068646', watchedOn: '2024-03-01' },
    {
      ref: 'diary:4',
      mediaType: 'movie',
      title: 'A Film We Do Not Have',
      year: 2001,
      watchedOn: '2024-03-02',
    },
    {
      ref: 'diary:5',
      mediaType: 'movie',
      title: 'The Godfather',
      year: 1972,
      watchedOn: '1900-01-01',
    },
    {
      ref: 'tv:1',
      mediaType: 'tv',
      title: 'Breaking Bad',
      year: 2008,
      watchedOn: '2024-04-01',
      season: 2,
    },
  ];
  const commit = (over: object = {}) =>
    call(
      importRoute.POST as Handler,
      req('POST', '/api/me/imports', {
        source: 'letterboxd',
        importId: '0a000000-0000-4000-8000-0000000000a1',
        final: true,
        options: { createStubs: true, ratings: true, reviews: true },
        rows,
        ...over,
      }),
    );

  it('requires a session', async () => {
    const r = await call(
      previewRoute.POST as Handler,
      req('POST', '/api/me/imports/preview', { source: 'letterboxd', rows: [] }),
    );
    expect(r.status).toBe(401);
  });

  it('preview counts (writes nothing) → commit → re-upload is all duplicate', async () => {
    await freshUser('importer');
    const preview = await call(
      previewRoute.POST as Handler,
      req('POST', '/api/me/imports/preview', {
        source: 'letterboxd',
        rows: rows.map(({ review: _r, ...x }) => ({ ...x, hasReview: Boolean(_r) })),
      }),
    );
    expect(preview.status).toBe(200);
    expect(preview.data.counts).toEqual({
      total: 6,
      matched: 4,
      duplicate: 0,
      notInStubbed: 1,
      invalid: 1,
    });
    expect(preview.data.sample.map((s: { title: { key: string } }) => s.title.key)).toEqual([
      'movie:278',
      'movie:278',
      'movie:238',
      'tv:1396',
    ]);
    expect(preview.data.unmatched).toEqual([
      { ref: 'diary:4', title: 'A Film We Do Not Have', year: 2001, reason: 'not_in_stubbed' },
      { ref: 'diary:5', title: 'The Godfather', year: 1972, reason: 'invalid' },
    ]);
    const before = await call(me.GET as Handler, req('GET', '/api/me'));
    expect(before.data.stubCount).toBe(0);

    const first = await commit();
    expect(first.status).toBe(200);
    expect(first.data).toEqual({
      created: { stubs: 4, reviews: 1 },
      skipped: { duplicate: 0, notInStubbed: 1, invalid: 1, existingReview: 0 },
    });
    expect(
      demoEventCounts(new Date().toISOString().slice(0, 10))['import_completed:letterboxd'],
    ).toBe(1);
    const state = await dal.myTitleStates(['movie:278']);
    expect(state['movie:278']!.myReview).toMatchObject({ rating10: 10, body: 'Hope.' });
    const diary = await dal.listDiary('importer', { type: 'tv' });
    expect(diary.items[0]!.season).toBe(2);

    const again = await commit();
    expect(again.data.created).toEqual({ stubs: 0, reviews: 0 });
    expect(again.data.skipped.duplicate).toBe(4);
    expect(again.data.skipped.existingReview).toBe(1);
    const rePreview = await call(
      previewRoute.POST as Handler,
      req('POST', '/api/me/imports/preview', { source: 'letterboxd', rows: rows.slice(0, 3) }),
    );
    expect(rePreview.data.counts).toMatchObject({ matched: 0, duplicate: 3 });
  });

  it('imported stubs never trip the per-minute stub limit; 413 over 1000 rows', async () => {
    await freshUser('bulk_user');
    const many = Array.from({ length: 40 }, (_, i) => ({
      ref: `r${i}`,
      mediaType: 'movie',
      tmdbId: 278,
      watchedOn: `2020-01-${String((i % 28) + 1).padStart(2, '0')}`,
    }));
    const r = await commit({
      rows: many,
      options: { createStubs: true, ratings: false, reviews: false },
    });
    expect(r.status).toBe(200);
    expect(r.data.created.stubs).toBe(40);
    const app = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'movie', tmdbId: 278 }),
    );
    expect(app.status).toBe(201);
    const tooMany = await commit({
      rows: Array.from({ length: 1001 }, (_, i) => ({
        ref: `x${i}`,
        tmdbId: 278,
        mediaType: 'movie',
      })),
    });
    expect(tooMany.status).toBe(413);
  });

  it('429 past the daily row budget', async () => {
    vi.stubEnv('IMPORT_MAX_ROWS_PER_DAY', '2');
    await freshUser('budget_user');
    const r = await commit();
    vi.unstubAllEnvs();
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('3600');
  });
});

describe('C-08 stub share data', () => {
  it('never carries the note; unknown/invalid ids are null', async () => {
    await signInAs();
    const s = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'tv', tmdbId: 1396, note: 'SECRET NOTE', season: 3 }),
    );
    const card = await dal.getStubShare(s.data.stub.id);
    expect(card).toMatchObject({
      stubId: s.data.stub.id,
      season: 3,
      watchedOn: today(),
      handle: 'maya',
      title: { key: 'tv:1396', title: 'Breaking Bad' },
    });
    expect(card!.profileUrl).toMatch(/\/u\/maya$/);
    expect(JSON.stringify(card)).not.toContain('SECRET');
    expect(Object.keys(card!.title).sort()).toEqual(
      [
        'imdbRating',
        'key',
        'mediaType',
        'palette',
        'posterPath',
        'title',
        'voteAverage',
        'year',
      ].sort(),
    );
    expect(await dal.getStubShare('not-a-uuid')).toBeNull();
    expect(await dal.getStubShare('0a000000-0000-4000-8000-000000000000')).toBeNull();
    await call(
      stubRoute.DELETE as Handler<unknown>,
      req('DELETE', `/api/stubs/${s.data.stub.id}`),
      ctx({ id: s.data.stub.id }),
    );
    expect(await dal.getStubShare(s.data.stub.id)).toBeNull();
  });

  it('listWatchProviders: chips for a region; [] for none', async () => {
    expect((await dal.listWatchProviders('US')).length).toBeGreaterThan(0);
    expect(await dal.listWatchProviders('')).toEqual([]);
  });
});
