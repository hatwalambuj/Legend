/**
 * M1 auth routes in demo mode (ADR-010 ID-1, ID-2, ID-5): confirm-email-safe sign-up, PUT
 * /api/auth/password, per-inbox magic-link limit. Real handlers + local auth; cookies simulated.
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

const { container, resetContainer } = await import('@/server/container');
const { resetDemoStoreSingleton } = await import('@/server/repositories/memory/store');
const { resetEnvCache } = await import('@/server/env');
const { signSession, DEMO_SESSION_COOKIE } = await import('@/server/auth/demo-session');
const { demoSessionSecret } = await import('@/server/auth/local');
const signup = await import('@/app/api/auth/signup/route');
const signin = await import('@/app/api/auth/signin/route');
const password = await import('@/app/api/auth/password/route');
const magic = await import('@/app/api/auth/magic-link/route');

const BASE = 'http://localhost:3000';
function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${BASE}${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      origin: BASE,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
type H = (r: NextRequest, c: unknown) => Promise<Response>;
async function call(h: unknown, r: NextRequest) {
  const res = await (h as H)(r, {});
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    // Asserted structurally; `any` keeps deep property access terse in tests.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: (text ? JSON.parse(text) : null) as any,
  };
}

const ACC = { email: 'pw@example.com', password: 'first-password', handle: 'pwuser' };

beforeEach(() => {
  jar.clear();
  resetEnvCache();
  resetContainer();
  resetDemoStoreSingleton();
});

describe('POST /api/auth/signup (ID-1)', () => {
  it('demo: 201 with a session, never confirmEmail', async () => {
    const r = await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    expect(r.status).toBe(201);
    expect(r.data.session.user.handle).toBe('pwuser');
    expect(r.data.confirmEmail).toBeUndefined();
  });
  it('provider without a session (confirm email ON) → 202 { session: null, confirmEmail: true }, no cookie', async () => {
    vi.spyOn(container().auth, 'signUp').mockResolvedValueOnce(null);
    const r = await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    expect(r.status).toBe(202);
    expect(r.data).toEqual({ session: null, confirmEmail: true });
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(jar.size).toBe(0);
  });
});

describe('PUT /api/auth/password (ID-2)', () => {
  const put = (body: unknown, headers?: Record<string, string>) =>
    call(password.PUT, req('PUT', '/api/auth/password', body, headers));

  it('fresh session → 204; the new password signs in, the old one does not', async () => {
    await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    const r = await put({ password: 'second-password' });
    expect(r.status).toBe(204);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    jar.clear();
    const old = await call(signin.POST, req('POST', '/api/auth/signin', ACC));
    expect([old.status, old.data.error.code]).toEqual([401, 'invalid_credentials']);
    const fresh = await call(
      signin.POST,
      req('POST', '/api/auth/signin', { email: ACC.email, password: 'second-password' }),
    );
    expect(fresh.status).toBe(200);
  });

  it('session older than 10 min → 401 reauth_required with the copy', async () => {
    const s = await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    jar.set(
      DEMO_SESSION_COOKIE,
      signSession(s.data.session.user.id, demoSessionSecret(), Date.now() - 11 * 60_000),
    );
    const r = await put({ password: 'second-password' });
    expect([r.status, r.data.error.code, r.data.error.message]).toEqual([
      401,
      'reauth_required',
      'Sign in again to change your password.',
    ]);
  });

  it('signed out → 401; bad body → 400 fields; non-JSON → 415; cross-origin → 403', async () => {
    expect((await put({ password: 'second-password' })).data.error.code).toBe('unauthenticated');
    await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    const short = await put({ password: 'short' });
    expect([short.status, Object.keys(short.data.error.fields)]).toEqual([400, ['password']]);
    expect((await put({ password: 'x'.repeat(73) })).status).toBe(400);
    const text = await call(
      password.PUT,
      new NextRequest(`${BASE}/api/auth/password`, {
        method: 'PUT',
        headers: { host: 'localhost:3000', origin: BASE, 'content-type': 'text/plain' },
        body: 'x',
      }),
    );
    expect(text.status).toBe(415);
    expect(
      (await put({ password: 'second-password' }, { origin: 'http://evil.test' })).status,
    ).toBe(403);
  });

  it('shared seeded demo accounts → 403; 5 changes per 10 min per user → 429', async () => {
    await call(
      signin.POST,
      req('POST', '/api/auth/signin', { email: 'maya@demo.stubbed.app', password: 'stubbed-demo' }),
    );
    expect((await put({ password: 'second-password' })).status).toBe(403);
    jar.clear();
    await call(signup.POST, req('POST', '/api/auth/signup', ACC));
    for (let i = 0; i < 5; i++)
      expect((await put({ password: `password-${i}xx` })).status).toBe(204);
    const limited = await put({ password: 'password-6xx' });
    expect([limited.status, limited.data.error.code]).toEqual([429, 'rate_limited']);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('POST /api/auth/magic-link per inbox (ID-5)', () => {
  it('limits one email across many IPs, independent of other emails', async () => {
    const send = (email: string, ip: string) =>
      call(magic.POST, req('POST', '/api/auth/magic-link', { email }, { 'x-forwarded-for': ip }));
    // Demo headroom: 5/h × 10.
    for (let i = 0; i < 50; i++)
      expect((await send('Flood@Example.com', `10.0.0.${i}`)).status).toBe(202);
    const r = await send('flood@example.com', '10.9.9.9');
    expect([r.status, r.data.error.code]).toEqual([429, 'rate_limited']);
    expect((await send('other@example.com', '10.9.9.9')).status).toBe(202);
  });
});
