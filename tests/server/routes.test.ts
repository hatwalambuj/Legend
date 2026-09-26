/**
 * Route handlers end-to-end in demo mode (zero env, zero network): the real handlers, services, local
 * auth and memory repositories. Only the Next request scope is simulated: `next/headers` cookies are a
 * persistent jar (acting as the browser) and `next/cache` revalidation is a spy.
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
const revalidateTag = vi.fn();
vi.mock('next/cache', () => ({ revalidateTag: (...a: unknown[]) => revalidateTag(...a) }));

const { resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton } = await import('@/server/repositories/memory/store');
const { resetEnvCache } = await import('@/server/env');
const signup = await import('@/app/api/auth/signup/route');
const signin = await import('@/app/api/auth/signin/route');
const signout = await import('@/app/api/auth/signout/route');
const magic = await import('@/app/api/auth/magic-link/route');
const callback = await import('@/app/auth/callback/route');
const handleAvailable = await import('@/app/api/auth/handle-available/route');
const me = await import('@/app/api/me/route');
const stubsRoute = await import('@/app/api/stubs/route');
const stubRoute = await import('@/app/api/stubs/[id]/route');
const reviewsRoute = await import('@/app/api/reviews/route');
const reviewRoute = await import('@/app/api/reviews/[id]/route');
const watchlistRoute = await import('@/app/api/watchlist/[type]/[tmdbId]/route');
const myWatchlist = await import('@/app/api/me/watchlist/route');
const titleStates = await import('@/app/api/me/title-states/route');
const diary = await import('@/app/api/me/stubs/route');
const exportRoute = await import('@/app/api/me/export/route');
const profileRoute = await import('@/app/api/me/profile/route');
const titleReviews = await import('@/app/api/titles/[type]/[tmdbId]/reviews/route');
const catalogRoute = await import('@/app/api/catalog/route');
const healthRoute = await import('@/app/api/health/route');

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
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  // Response bodies are asserted structurally; `any` keeps deep property access terse in tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, data: data as Record<string, any>, text };
}

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

async function signInAs(email = 'maya@demo.stubbed.app') {
  const r = await call(
    signin.POST as Handler,
    req('POST', '/api/auth/signin', { email, password: 'stubbed-demo' }),
  );
  expect(r.status).toBe(200);
  return r.data.session;
}

beforeEach(() => {
  jar.clear();
  resetEnvCache();
  resetContainer();
  resetDemoStoreSingleton();
  revalidateTag.mockClear();
});

describe('auth (local provider)', () => {
  it('signs up, is signed in immediately, and rejects duplicates with 409s', async () => {
    const r = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'New@Example.com',
        password: 'longenough',
        handle: 'NewUser',
      }),
    );
    expect(r.status).toBe(201);
    expect(r.data.session.user).toMatchObject({
      email: 'new@example.com',
      handle: 'newuser',
      displayName: 'newuser',
    });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(jar.has('stubbed_demo_session')).toBe(true);
    const m = await call(me.GET as Handler, req('GET', '/api/me'));
    expect(m.data.session.user.handle).toBe('newuser');
    expect(m.data.mode.isDemo).toBe(true);
    expect(m.data.stubCount).toBe(0);

    const dupEmail = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'new@example.com',
        password: 'longenough',
        handle: 'other1',
      }),
    );
    expect([dupEmail.status, dupEmail.data.error.code]).toEqual([409, 'email_taken']);
    const dupHandle = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'x@example.com',
        password: 'longenough',
        handle: 'maya',
      }),
    );
    expect([dupHandle.status, dupHandle.data.error.code]).toEqual([409, 'handle_taken']);
    const bad = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', { email: 'nope', password: 'short', handle: 'a!' }),
    );
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.data.error.fields).sort()).toEqual(['email', 'handle', 'password']);
    const reserved = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'y@example.com',
        password: 'longenough',
        handle: 'admin',
      }),
    );
    expect(reserved.data.error.fields.handle).toMatch(/reserved/);
  });

  it('signs in with the demo password; any failure is the same generic 401', async () => {
    await signInAs();
    const wrong = await call(
      signin.POST as Handler,
      req('POST', '/api/auth/signin', { email: 'maya@demo.stubbed.app', password: 'nope-nope' }),
    );
    const unknown = await call(
      signin.POST as Handler,
      req('POST', '/api/auth/signin', { email: 'ghost@demo.stubbed.app', password: 'nope-nope' }),
    );
    expect(wrong.status).toBe(401);
    expect(wrong.data).toEqual(unknown.data);
    expect(wrong.data.error).toEqual({
      code: 'invalid_credentials',
      message: "That email and password don't match.",
    });
  });

  it('signs out (204) and clears the cookie', async () => {
    await signInAs();
    const r = await call(signout.POST as Handler, req('POST', '/api/auth/signout', {}));
    expect(r.status).toBe(204);
    expect(jar.size).toBe(0);
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.session).toBeNull();
  });

  it('magic link returns a devLink for any email; the callback signs in or fails safely', async () => {
    const r = await call(
      magic.POST as Handler,
      req('POST', '/api/auth/magic-link', { email: 'dev@demo.stubbed.app', next: '/me/stubs' }),
    );
    expect(r.status).toBe(202);
    expect(r.data.sent).toBe(true);
    const link = new URL(r.data.devLink);
    expect(link.pathname).toBe('/auth/callback');
    expect(link.searchParams.get('next')).toBe('/me/stubs');
    const cb = await callback.GET(new NextRequest(link), {} as never);
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toBe('/me/stubs');
    expect(link.origin).toBe('http://localhost:3000'); // from the Host header the client used
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.session.user.handle).toBe(
      'dev',
    );

    jar.clear();
    const ghost = await call(
      magic.POST as Handler,
      req('POST', '/api/auth/magic-link', { email: 'ghost@x.test', next: '//evil.com' }),
    );
    expect(ghost.status).toBe(202);
    const gl = new URL(ghost.data.devLink);
    expect(gl.searchParams.get('next')).toBe('/'); // open-redirect guard
    const fail = await callback.GET(new NextRequest(gl), {} as never);
    expect(fail.headers.get('location')).toContain('/signin?error=callback');
    const tampered = new URL(r.data.devLink);
    tampered.searchParams.set('demo_token', `${tampered.searchParams.get('demo_token')}x`);
    expect(
      (await callback.GET(new NextRequest(tampered), {} as never)).headers.get('location'),
    ).toContain('error=callback');
    expect(jar.size).toBe(0);
  });

  it('handle availability', async () => {
    const taken = await call(
      handleAvailable.GET as Handler,
      req('GET', '/api/auth/handle-available?handle=Maya'),
    );
    expect(taken.data).toEqual({ available: false, reason: 'That handle is taken.' });
    const free = await call(
      handleAvailable.GET as Handler,
      req('GET', '/api/auth/handle-available?handle=fresh_one'),
    );
    expect(free.data).toEqual({ available: true });
  });
});

describe('stubs', () => {
  const create = (body: unknown, headers?: Record<string, string>) =>
    call(stubsRoute.POST as Handler, req('POST', '/api/stubs', body, headers));

  it('requires a session, same origin and JSON', async () => {
    expect((await create({ mediaType: 'movie', tmdbId: 693134 })).data.error.code).toBe(
      'unauthenticated',
    );
    await signInAs();
    const cross = await create(
      { mediaType: 'movie', tmdbId: 693134 },
      { origin: 'https://evil.test' },
    );
    expect([cross.status, cross.data.error.code]).toEqual([403, 'forbidden']);
    // Errors are never cacheable and vary on the cookie (API_CONTRACT §4).
    expect(cross.headers.get('cache-control')).toBe('private, no-store');
    expect(cross.headers.get('vary')).toBe('Cookie');
    const r = new NextRequest(`${BASE}/api/stubs`, {
      method: 'POST',
      headers: { host: 'localhost:3000', origin: BASE, 'content-type': 'text/plain' },
      body: '{}',
    });
    expect((await call(stubsRoute.POST as Handler, r)).status).toBe(415);
  });

  it('creates stubs (same-day duplicate allowed) and returns the updated state', async () => {
    await signInAs('priya@demo.stubbed.app');
    const a = await create({ mediaType: 'tv', tmdbId: 2316 });
    expect(a.status).toBe(201);
    expect(a.data.stub).toMatchObject({
      titleKey: 'tv:2316',
      number: 1,
      note: '',
      watchedWhere: null,
    });
    expect(a.data.state).toMatchObject({ stubCount: 1, hasStubToday: true });
    const b = await create({
      mediaType: 'tv',
      tmdbId: 2316,
      watchedWhere: 'tv',
      note: 'double feature',
    });
    expect(b.data.stub.number).toBe(2);
    expect(b.data.state.stubCount).toBe(2);
    expect(revalidateTag).toHaveBeenCalledWith('user:priya', { expire: 0 });

    const future = await create({ mediaType: 'tv', tmdbId: 2316, watchedOn: '2099-01-01' });
    expect([future.status, Object.keys(future.data.error.fields)]).toEqual([400, ['watchedOn']]);
    const early = await create({ mediaType: 'movie', tmdbId: 693134, watchedOn: '2020-06-01' });
    expect(early.data.error.fields.watchedOn).toMatch(/before/);
    expect((await create({ mediaType: 'movie', tmdbId: 1 })).status).toBe(404);
    expect((await create({ mediaType: 'book', tmdbId: 1 })).status).toBe(400);
    const tooLong = await create({ mediaType: 'tv', tmdbId: 2316, note: 'x'.repeat(281) });
    expect(tooLong.data.error.fields.note).toBeDefined();
  });

  it('PATCH/DELETE only the owner; DELETE is the undo and returns the state', async () => {
    await signInAs('priya@demo.stubbed.app');
    const a = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'movie', tmdbId: 157336 }),
    );
    const id: string = a.data.stub.id;
    const patched = await call(
      stubRoute.PATCH as Handler,
      req('PATCH', `/api/stubs/${id}`, { note: 'IMAX', watchedWhere: 'cinema' }),
      ctx({ id }),
    );
    expect(patched.status).toBe(200);
    expect(patched.data.stub).toMatchObject({ note: 'IMAX', watchedWhere: 'cinema' });
    expect(
      (await call(stubRoute.PATCH as Handler, req('PATCH', `/api/stubs/${id}`, {}), ctx({ id })))
        .status,
    ).toBe(400);

    jar.clear();
    await signInAs('dev@demo.stubbed.app');
    expect(
      (
        await call(
          stubRoute.PATCH as Handler,
          req('PATCH', `/api/stubs/${id}`, { note: 'mine now' }),
          ctx({ id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await call(stubRoute.DELETE as Handler, req('DELETE', `/api/stubs/${id}`), ctx({ id })))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          stubRoute.DELETE as Handler,
          req('DELETE', '/api/stubs/not-a-uuid'),
          ctx({ id: 'not-a-uuid' }),
        )
      ).status,
    ).toBe(404);

    jar.clear();
    await signInAs('priya@demo.stubbed.app');
    const del = await call(
      stubRoute.DELETE as Handler,
      req('DELETE', `/api/stubs/${id}`),
      ctx({ id }),
    );
    expect(del.status).toBe(200);
    expect(del.data).toEqual({
      state: {
        stubCount: 0,
        lastWatchedOn: null,
        hasStubToday: false,
        watchlisted: false,
        myReview: null,
      },
    });
  });

  it('returns 429 with Retry-After past 30 stubs a minute', async () => {
    await signInAs('dev@demo.stubbed.app');
    for (let i = 0; i < 30; i++)
      expect((await create({ mediaType: 'tv', tmdbId: 1396 })).status).toBe(201);
    const r = await create({ mediaType: 'tv', tmdbId: 1396 });
    expect(r.status).toBe(429);
    expect(r.data.error.code).toBe('rate_limited');
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(r.data.error.retryAfter).toBe(Number(r.headers.get('retry-after')));
  });

  it('lists the diary for the signed-in user only', async () => {
    expect((await call(diary.GET as Handler, req('GET', '/api/me/stubs'))).status).toBe(401);
    await signInAs('dev@demo.stubbed.app');
    const d = await call(diary.GET as Handler, req('GET', '/api/me/stubs?type=movie&limit=3'));
    expect(d.status).toBe(200);
    expect(d.data.items).toHaveLength(3);
    const all = await call(diary.GET as Handler, req('GET', '/api/me/stubs?limit=3'));
    // `total` counts the whole filter; /api/me carries the same number for the wallet badge.
    expect(d.data.total).toBeGreaterThan(3);
    expect(all.data.total).toBeGreaterThan(d.data.total);
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.stubCount).toBe(
      all.data.total,
    );
    expect(
      d.data.items.every((x: { title: { mediaType: string } }) => x.title.mediaType === 'movie'),
    ).toBe(true);
    const next = await call(
      diary.GET as Handler,
      req('GET', `/api/me/stubs?type=movie&limit=3&cursor=${d.data.nextCursor}`),
    );
    expect(next.data.items.length).toBeGreaterThan(0);
    expect((await call(diary.GET as Handler, req('GET', '/api/me/stubs?limit=0'))).status).toBe(
      400,
    );
  });
});

describe('reviews + title states', () => {
  it('upserts one review per title (201 then 200) and suggests a stub when none exists', async () => {
    await signInAs('priya@demo.stubbed.app');
    const put = (body: unknown) =>
      call(reviewsRoute.PUT as Handler, req('PUT', '/api/reviews', body));
    const a = await put({ mediaType: 'tv', tmdbId: 1396, rating10: 9, body: 'Wow' });
    expect(a.status).toBe(201);
    expect(a.data).toMatchObject({ created: true, suggestStub: true });
    const b = await put({
      mediaType: 'tv',
      tmdbId: 1396,
      rating10: 10,
      body: 'Wow!',
      isSpoiler: true,
    });
    expect(b.status).toBe(200);
    expect(b.data.created).toBe(false);
    expect(b.data.review.id).toBe(a.data.review.id);
    expect(b.data.review.editedAt).not.toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith('title:tv:1396:reviews', { expire: 0 });
    // Priya has a Dune stub → no suggestion.
    expect((await put({ mediaType: 'movie', tmdbId: 693134, rating10: 8 })).data.suggestStub).toBe(
      false,
    );
    expect((await put({ mediaType: 'movie', tmdbId: 693134, rating10: 11 })).status).toBe(400);
    const foreign = await put({
      mediaType: 'movie',
      tmdbId: 693134,
      rating10: 8,
      stubId: '10000000-0000-4000-8000-000000000002',
    });
    expect([foreign.status, Object.keys(foreign.data.error.fields)]).toEqual([400, ['stubId']]);

    const states = await call(
      titleStates.GET as Handler,
      req('GET', '/api/me/title-states?keys=tv:1396,movie:693134'),
    );
    expect(states.data.states['tv:1396'].myReview.rating10).toBe(10);
    expect(states.data.states['movie:693134'].stubCount).toBe(1);

    const list = await call(
      titleReviews.GET as Handler<unknown>,
      req('GET', '/api/titles/tv/1396/reviews?sort=highest'),
      ctx({ type: 'tv', tmdbId: '1396' }),
    );
    expect(list.headers.get('cache-control')).toBe(
      'public, s-maxage=60, stale-while-revalidate=300',
    );
    expect(list.data.items[0].author.handle).toBe('priya');

    jar.clear();
    await signInAs('dev@demo.stubbed.app');
    const id: string = a.data.review.id;
    expect(
      (await call(reviewRoute.DELETE as Handler, req('DELETE', `/api/reviews/${id}`), ctx({ id })))
        .status,
    ).toBe(404);
    jar.clear();
    await signInAs('priya@demo.stubbed.app');
    expect(
      (await call(reviewRoute.DELETE as Handler, req('DELETE', `/api/reviews/${id}`), ctx({ id })))
        .status,
    ).toBe(204);
  });

  it('title-states is {} when signed out and validates keys', async () => {
    const r = await call(
      titleStates.GET as Handler,
      req('GET', '/api/me/title-states?keys=movie:693134'),
    );
    expect(r.data).toEqual({ states: {} });
    expect(r.headers.get('vary')).toBe('Cookie');
    expect(
      (await call(titleStates.GET as Handler, req('GET', '/api/me/title-states?keys=film:1')))
        .status,
    ).toBe(400);
  });

  it('reviews for an unknown type are 404', async () => {
    const r = await call(
      titleReviews.GET as Handler<unknown>,
      req('GET', '/api/titles/book/1/reviews'),
      ctx({ type: 'book', tmdbId: '1' }),
    );
    expect(r.status).toBe(404);
  });
});

describe('watchlist, profile, export', () => {
  it('adds/removes idempotently and lists newest first', async () => {
    await signInAs('priya@demo.stubbed.app');
    const put = () =>
      call(
        watchlistRoute.PUT as Handler<unknown>,
        req('PUT', '/api/watchlist/movie/238', {}),
        ctx({ type: 'movie', tmdbId: '238' }),
      );
    expect((await put()).data).toEqual({ watchlisted: true });
    expect((await put()).data).toEqual({ watchlisted: true });
    const l = await call(myWatchlist.GET as Handler, req('GET', '/api/me/watchlist'));
    expect(l.data.items.map((t: { key: string }) => t.key)).toEqual(['movie:238']);
    const del = await call(
      watchlistRoute.DELETE as Handler<unknown>,
      req('DELETE', '/api/watchlist/movie/238'),
      ctx({ type: 'movie', tmdbId: '238' }),
    );
    expect(del.data).toEqual({ watchlisted: false });
    expect(
      (
        await call(
          watchlistRoute.PUT as Handler<unknown>,
          req('PUT', '/api/watchlist/movie/1', {}),
          ctx({ type: 'movie', tmdbId: '1' }),
        )
      ).status,
    ).toBe(404);
  });

  it('updates the own profile; the handle cannot change; avatars must be https', async () => {
    await signInAs('priya@demo.stubbed.app');
    const r = await call(
      profileRoute.PATCH as Handler,
      req('PATCH', '/api/me/profile', { displayName: 'Priya K', bio: 'Docs', handle: 'hacker' }),
    );
    expect(r.status).toBe(200);
    expect(r.data.profile).toMatchObject({ handle: 'priya', displayName: 'Priya K', bio: 'Docs' });
    const bad = await call(
      profileRoute.PATCH as Handler,
      req('PATCH', '/api/me/profile', { avatarUrl: 'javascript:alert(1)' }),
    );
    expect(bad.status).toBe(400);
    expect(
      (await call(me.GET as Handler, req('GET', '/api/me'))).data.session.user.displayName,
    ).toBe('Priya K');
  });

  it('exports Letterboxd CSV and JSON as private attachments, rate limited per format', async () => {
    expect(
      (await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=json'))).status,
    ).toBe(401);
    await signInAs('dev@demo.stubbed.app');
    const csv = await call(
      exportRoute.GET as Handler,
      req('GET', '/api/me/export?format=letterboxd'),
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(csv.headers.get('content-disposition')).toMatch(
      /^attachment; filename="stubbed-letterboxd-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(csv.headers.get('cache-control')).toBe('private, no-store');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review');
    const interstellar = lines.filter((l) => l.startsWith('157336,'));
    expect(interstellar.map((l) => l.split(',')[6])).toEqual(['false', 'true', 'true']);
    const again = await call(
      exportRoute.GET as Handler,
      req('GET', '/api/me/export?format=letterboxd'),
    );
    expect(again.status).toBe(429);
    const json = await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=json'));
    expect(json.status).toBe(200);
    expect(json.data.profile.handle).toBe('dev');
    expect(json.data.stubs).toHaveLength(12);
    expect(json.data.watchlist.map((t: { key: string }) => t.key)).toEqual(['tv:1438']);
    expect(
      (await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=xml'))).status,
    ).toBe(400);
  });
});

describe('public reads', () => {
  it('catalog + health', async () => {
    const c = await call(
      catalogRoute.GET as Handler,
      req('GET', '/api/catalog?type=movie&sort=rating_desc&limit=5'),
    );
    expect(c.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    expect(c.data.items).toHaveLength(5);
    expect(c.data.items.every((t: { voteAverage: number }) => t.voteAverage >= 6.5)).toBe(true);
    const h = await call(healthRoute.GET as Handler, req('GET', '/api/health'));
    expect(h.data).toMatchObject({
      ok: true,
      mode: { catalog: 'fixtures', data: 'local', isDemo: true },
    });
    expect(h.data.catalogCount).toBeGreaterThanOrEqual(60);
  });
});

describe('DELETE /api/me (GAP-06: delete account)', () => {
  const del = (body: unknown = { confirm: 'DELETE' }, headers: Record<string, string> = {}) =>
    call(me.DELETE as Handler, req('DELETE', '/api/me', body, headers));

  async function newUserWithData() {
    const r = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'leaving@example.com',
        password: 'longenough',
        handle: 'leaving',
      }),
    );
    expect(r.status).toBe(201);
    const stub = await call(
      stubsRoute.POST as Handler,
      req('POST', '/api/stubs', { mediaType: 'tv', tmdbId: 1396 }),
    );
    expect(stub.status).toBe(201);
    const review = await call(
      reviewsRoute.PUT as Handler,
      req('PUT', '/api/reviews', {
        mediaType: 'tv',
        tmdbId: 1396,
        rating10: 8,
        body: 'Bye',
        stubId: stub.data.stub.id,
      }),
    );
    expect(review.status).toBe(201);
    const wl = await call(
      watchlistRoute.PUT as Handler<unknown>,
      req('PUT', '/api/watchlist/movie/238', {}),
      ctx({ type: 'movie', tmdbId: '238' }),
    );
    expect(wl.status).toBe(200);
    return { user: r.data.session.user as { id: string; handle: string } };
  }

  it('requires a session, same origin, JSON and the explicit confirm body', async () => {
    expect((await del()).status).toBe(401);
    await newUserWithData();
    expect((await del({})).data.error.code).toBe('validation_failed');
    expect((await del({ confirm: 'delete' })).status).toBe(400);
    expect((await del({ confirm: 'DELETE' }, { origin: 'https://evil.test' })).status).toBe(403);
    const noJson = new NextRequest(`${BASE}/api/me`, {
      method: 'DELETE',
      headers: { host: 'localhost:3000', origin: BASE, 'content-type': 'text/plain' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    expect((await call(me.DELETE as Handler, noJson)).status).toBe(415);
    // Nothing was deleted by the rejected attempts.
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.session.user.handle).toBe(
      'leaving',
    );
  });

  it('cascades profile, stubs, reviews, watchlist; signs out; frees the email and handle', async () => {
    const { user } = await newUserWithData();
    const { container } = await import('@/server/container');
    const { demoStore } = await import('@/server/repositories/memory/store');
    const before = await container().titleStates.stats('tv:1396');
    const others = demoStore()
      .get()
      .stubs.filter((s) => s.userId !== user.id).length;

    const r = await del();
    expect(r.status).toBe(204);
    expect(jar.size).toBe(0); // session cookie cleared
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.session).toBeNull();
    expect(revalidateTag).toHaveBeenCalledWith('user:leaving', { expire: 0 });

    const d = demoStore().get();
    expect(d.users.some((u) => u.id === user.id)).toBe(false);
    expect(d.stubs.some((s) => s.userId === user.id)).toBe(false);
    expect(d.reviews.some((x) => x.userId === user.id)).toBe(false);
    expect(d.watchlist.some((w) => w.userId === user.id)).toBe(false);
    expect(d.stubs).toHaveLength(others); // other users untouched
    expect(await container().profiles.getByHandle('leaving')).toBeNull();
    const after = await container().titleStates.stats('tv:1396');
    expect(after.stubCount).toBe(before.stubCount - 1);
    expect(after.ratingCount).toBe(before.ratingCount - 1);

    // A second call has no session any more.
    expect((await del()).status).toBe(401);
    // Email + handle can be reused.
    const again = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'leaving@example.com',
        password: 'longenough',
        handle: 'leaving',
      }),
    );
    expect(again.status).toBe(201);
    expect(again.data.session.user.id).not.toBe(user.id);
  });

  it('refuses to delete the shared seeded demo accounts', async () => {
    await signInAs('dev@demo.stubbed.app');
    const r = await del();
    expect(r.status).toBe(403);
    expect(r.data.error.code).toBe('forbidden');
    expect((await call(me.GET as Handler, req('GET', '/api/me'))).data.session.user.handle).toBe(
      'dev',
    );
  });
});

describe('magic link in a public demo (GAP-04)', () => {
  it('DEMO_DEV_LINKS=seeded: devLink only for the seeded demo accounts', async () => {
    vi.stubEnv('DEMO_DEV_LINKS', 'seeded');
    resetEnvCache();
    try {
      const send = (email: string) =>
        call(magic.POST as Handler, req('POST', '/api/auth/magic-link', { email }));
      const seeded = await send('Maya@demo.stubbed.app');
      expect(seeded.status).toBe(202);
      expect(new URL(seeded.data.devLink).searchParams.get('demo_token')).toBeTruthy();
      await call(
        signup.POST as Handler,
        req('POST', '/api/auth/signup', {
          email: 'victim@example.com',
          password: 'longenough',
          handle: 'victim',
        }),
      );
      jar.clear();
      // Same response shape for a real account and an unknown email: nothing to sign in with.
      for (const email of ['victim@example.com', 'ghost@example.com']) {
        const r = await send(email);
        expect(r.status).toBe(202);
        expect(r.data).toEqual({ sent: true });
      }
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });
});
