/**
 * W-07 (API_CONTRACT §5.21–5.22, ADR-012 §6.2, §7) in demo mode with the real handlers: the public
 * watch route (region from the URL only, public cache, no cookies), the region preference endpoint
 * (cookie + owner-only settings), cookie re-set on sign-in and the magic-link callback, export and
 * account deletion of `user_settings`.
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const jar = new Map<string, string>();
const cookieReads: string[] = [];
let requestHeaders = new Headers();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => {
      cookieReads.push(n);
      return jar.has(n) ? { name: n, value: jar.get(n)! } : undefined;
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (n: string, v: string, o?: { maxAge?: number }) => {
      if (o?.maxAge === 0 || v === '') jar.delete(n);
      else jar.set(n, v);
    },
    delete: (n: string) => jar.delete(n),
  }),
  headers: async () => requestHeaders,
}));
vi.mock('next/cache', () => ({ revalidateTag: () => {} }));

const { resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton, demoStore } = await import('@/server/repositories/memory/store');
const { resetEnvCache } = await import('@/server/env');
const { limitFor } = await import('@/server/rate-limit');
const watchRoute = await import('@/app/api/titles/[type]/[tmdbId]/watch/route');
const regionRoute = await import('@/app/api/me/watch-region/route');
const me = await import('@/app/api/me/route');
const signin = await import('@/app/api/auth/signin/route');
const signup = await import('@/app/api/auth/signup/route');
const signout = await import('@/app/api/auth/signout/route');
const magic = await import('@/app/api/auth/magic-link/route');
const callback = await import('@/app/auth/callback/route');
const exportRoute = await import('@/app/api/me/export/route');

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (text ? JSON.parse(text) : null) as Record<string, any>;
  return { status: res.status, headers: res.headers, data };
}

const ctx = (type: string, tmdbId: string) => ({ params: Promise.resolve({ type, tmdbId }) });
const getWatch = (type: string, id: string, qs: string, headers: Record<string, string> = {}) =>
  call(
    watchRoute.GET as Handler<unknown>,
    req('GET', `/api/titles/${type}/${id}/watch${qs}`, undefined, headers),
    ctx(type, id),
  );
const putRegion = (region: unknown, headers: Record<string, string> = {}) =>
  call(regionRoute.PUT as Handler, req('PUT', '/api/me/watch-region', { region }, headers));
const signIn = (email = 'maya@demo.stubbed.app') =>
  call(
    signin.POST as Handler,
    req('POST', '/api/auth/signin', { email, password: 'stubbed-demo' }),
  );
const meNow = () => call(me.GET as Handler, req('GET', '/api/me'));

beforeEach(() => {
  jar.clear();
  cookieReads.length = 0;
  requestHeaders = new Headers();
  resetEnvCache();
  resetContainer();
  resetDemoStoreSingleton();
});

describe('GET /api/titles/{type}/{id}/watch (§5.21)', () => {
  it('200 TitleWatchResponse, public cache, no cookie read or set, region only from the URL', async () => {
    jar.set('stubbed_region', 'IN');
    requestHeaders = new Headers({ 'accept-language': 'en-GB' });
    const r = await getWatch('movie', '693134', '?region=US', {
      cookie: 'stubbed_region=IN',
      'accept-language': 'en-GB',
    });
    expect(r.status).toBe(200);
    expect(r.data.watch).toMatchObject({ region: 'US', source: 'query', fallback: false });
    expect(r.data.watch.groups[0].providers[0].name).toBe('Max');
    expect(r.headers.get('cache-control')).toBe(
      'public, s-maxage=3600, stale-while-revalidate=86400',
    );
    expect(r.headers.get('set-cookie')).toBeNull();
    expect(r.headers.get('vary')).toBeNull();
    expect(cookieReads).toEqual([]);
    expect([...jar]).toEqual([['stubbed_region', 'IN']]);
  });

  it('uk → GB; unsupported → default with fallback (200)', async () => {
    expect((await getWatch('movie', '693134', '?region=uk')).data.watch.region).toBe('GB');
    const jp = await getWatch('movie', '693134', '?region=JP');
    expect(jp.status).toBe(200);
    expect(jp.data.watch).toMatchObject({ region: 'US', requested: 'JP', fallback: true });
  });

  it.each(['', '?region=', '?region=USA', '?region=1A', '?region=%3Cx%3E'])(
    'missing/malformed region %j → 400 validation_failed',
    async (qs) => {
      const r = await getWatch('movie', '693134', qs);
      expect(r.status).toBe(400);
      expect(r.data.error.code).toBe('validation_failed');
      expect(r.headers.get('cache-control')).toBe('private, no-store');
    },
  );

  it('unknown type or id → 404; a known title without data → { watch: null }', async () => {
    expect((await getWatch('book', '1', '?region=US')).status).toBe(404);
    expect((await getWatch('movie', 'abc', '?region=US')).status).toBe(404);
    expect((await getWatch('movie', '1', '?region=US')).status).toBe(404);
    const none = await getWatch('movie', '278', '?region=US');
    expect(none.status).toBe(200);
    expect(none.data).toEqual({ watch: null });
    expect((await getWatch('movie', '496243', '?region=US')).data.watch).toBeNull(); // stale
  });
});

describe('PUT /api/me/watch-region (§5.22)', () => {
  it('signed out: cookie only; null clears it; private, no-store', async () => {
    const r = await putRegion('gb');
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ region: 'GB' });
    expect(jar.get('stubbed_region')).toBe('GB');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(r.headers.get('vary')).toBe('Cookie');
    expect((await putRegion(null)).data).toEqual({ region: null });
    expect(jar.has('stubbed_region')).toBe(false);
    expect(demoStore().get().settings ?? []).toEqual([]);
  });

  it('validation: unsupported → 400 fields.region; malformed → 400; cross-origin 403; non-JSON 415', async () => {
    const jp = await putRegion('JP');
    expect(jp.status).toBe(400);
    expect(jp.data.error.fields.region).toBeTruthy();
    expect((await putRegion('USA')).status).toBe(400);
    expect((await putRegion(42)).status).toBe(400);
    expect((await putRegion('GB', { origin: 'https://evil.test' })).status).toBe(403);
    const text = new NextRequest(`${BASE}/api/me/watch-region`, {
      method: 'PUT',
      headers: { host: 'localhost:3000', origin: BASE, 'content-type': 'text/plain' },
      body: JSON.stringify({ region: 'GB' }),
    });
    expect((await call(regionRoute.PUT as Handler, text)).status).toBe(415);
    expect(jar.has('stubbed_region')).toBe(false);
  });

  it('30/min per IP in production config', () => {
    expect(limitFor('watchRegion', false, 'vercel')).toEqual({ max: 30, windowSec: 60 });
  });

  it('signed in: saved to settings, exposed as session.user.watchRegion, not on the public profile', async () => {
    await signIn();
    expect((await meNow()).data.session.user.watchRegion).toBeNull();
    expect((await meNow()).data.mode.watchRegions).toContainEqual({ code: 'IN', name: 'India' });
    await putRegion('IN');
    const m = await meNow();
    expect(m.data.session.user.watchRegion).toBe('IN');
    expect(jar.get('stubbed_region')).toBe('IN');
    const { dal } = await import('@/server/dal');
    expect(JSON.stringify(await dal.getProfile('maya'))).not.toContain('watchRegion');
  });

  it('sign-in and the magic-link callback re-set the cookie from the saved setting', async () => {
    await signIn();
    await putRegion('GB');
    await call(signout.POST as Handler, req('POST', '/api/auth/signout', {}));
    jar.clear();
    expect((await signIn()).data.session.user.watchRegion).toBe('GB');
    expect(jar.get('stubbed_region')).toBe('GB');

    jar.clear();
    const link = await call(
      magic.POST as Handler,
      req('POST', '/api/auth/magic-link', { email: 'maya@demo.stubbed.app', next: '/' }),
    );
    const cb = await callback.GET(new NextRequest(new URL(link.data.devLink)), {} as never);
    expect(cb.status).toBe(302);
    expect(jar.get('stubbed_region')).toBe('GB');
  });

  it('no saved setting → sign-in keeps the browser choice', async () => {
    jar.set('stubbed_region', 'IN');
    await signIn('dev@demo.stubbed.app');
    expect(jar.get('stubbed_region')).toBe('IN');
  });
});

describe('user_settings in export and account deletion', () => {
  it('JSON export includes settings; deleting the account removes the row', async () => {
    const r = await call(
      signup.POST as Handler,
      req('POST', '/api/auth/signup', {
        email: 'wtw@example.com',
        password: 'longenough',
        handle: 'wtwuser',
      }),
    );
    expect(r.status).toBe(201);
    const id = r.data.session.user.id as string;
    await putRegion('GB');
    const ex = await call(exportRoute.GET as Handler, req('GET', '/api/me/export?format=json'));
    expect(ex.status).toBe(200);
    expect(ex.data.settings).toEqual({ watchRegion: 'GB' });
    const del = await call(me.DELETE as Handler, req('DELETE', '/api/me', { confirm: 'DELETE' }));
    expect(del.status).toBe(204);
    expect((demoStore().get().settings ?? []).some((s) => s.userId === id)).toBe(false);
  });
});
