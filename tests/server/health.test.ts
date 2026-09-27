/** GET/HEAD /api/health (ADR-011 §3, API_CONTRACT §5.1 v1.4): behaviour table + route wiring. */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkHealth, HEALTH_PROBE_TIMEOUT_MS } from '@/server/health';

const LIVE = { catalog: 'tmdb', data: 'supabase', isDemo: false } as const;
const DEMO = { catalog: 'fixtures', data: 'local', isDemo: true } as const;
const NOW = Date.parse('2026-09-27T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const run = (
  probe: () => Promise<{ catalogCount: number; lastFullSyncAt: string | null }>,
  over: Partial<Parameters<typeof checkHealth>[0]> = {},
) =>
  checkHealth({ mode: LIVE, probe, maxSyncAgeHours: 36, strict: false, now: () => NOW, ...over });

describe('checkHealth', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    log = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    log.mockRestore();
    vi.useRealTimers();
  });

  it('live, all good → 200 ok', async () => {
    const r = await run(async () => ({ catalogCount: 9000, lastFullSyncAt: hoursAgo(5.04) }));
    expect(r.httpStatus).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      status: 'ok',
      mode: LIVE,
      catalogCount: 9000,
      lastSyncAt: hoursAgo(5.04),
      syncAgeHours: 5,
      checks: { db: 'ok', sync: 'ok' },
      reasons: [],
    });
  });

  it('probe throws → 503 down; body has no error detail; logs the code only', async () => {
    const err = Object.assign(new Error('connect ECONNREFUSED db.secret-host:5432'), {
      code: 'ECONNREFUSED',
    });
    const r = await run(async () => {
      throw err;
    });
    expect(r.httpStatus).toBe(503);
    expect(r.body).toMatchObject({
      ok: false,
      status: 'down',
      catalogCount: null,
      lastSyncAt: null,
      syncAgeHours: null,
      checks: { db: 'fail', sync: 'unknown' },
      reasons: ['db_unreachable'],
    });
    expect(JSON.stringify(r.body)).not.toMatch(/secret-host|ECONNREFUSED/);
    expect(log).toHaveBeenCalledWith('[health] probe failed', { code: 'ECONNREFUSED' });
  });

  it('probe hangs → 503 within 3.5 s, and the probe gets the 3 s timeout', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise<never>(() => {}));
    const p = run(probe);
    await vi.advanceTimersByTimeAsync(3500);
    const r = await p;
    expect(r.httpStatus).toBe(503);
    expect(r.body.status).toBe('down');
    expect(probe).toHaveBeenCalledWith({ timeoutMs: HEALTH_PROBE_TIMEOUT_MS });
    expect(HEALTH_PROBE_TIMEOUT_MS).toBe(3000);
  });

  it('stale / never / empty → 200 degraded; strict=1 → 503', async () => {
    const stale = async () => ({ catalogCount: 9000, lastFullSyncAt: hoursAgo(37) });
    let r = await run(stale);
    expect([r.httpStatus, r.body.status, r.body.ok]).toEqual([200, 'degraded', false]);
    expect(r.body.checks).toEqual({ db: 'ok', sync: 'stale' });
    expect(r.body.reasons).toEqual(['sync_stale']);
    expect(r.body.syncAgeHours).toBe(37);
    expect((await run(stale, { strict: true })).httpStatus).toBe(503);
    // Exactly at the limit is still fresh.
    expect(
      (await run(async () => ({ catalogCount: 1, lastFullSyncAt: hoursAgo(36) }))).body.status,
    ).toBe('ok');

    r = await run(async () => ({ catalogCount: 0, lastFullSyncAt: null }));
    expect(r.body.checks.sync).toBe('never');
    expect(r.body.reasons).toEqual(['sync_never', 'catalog_empty']);
    expect(r.httpStatus).toBe(200);
  });

  it('demo → 200 ok, checks skipped, even with strict', async () => {
    const r = await run(async () => ({ catalogCount: 64, lastFullSyncAt: null }), {
      mode: DEMO,
      strict: true,
    });
    expect(r.httpStatus).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      status: 'ok',
      mode: DEMO,
      catalogCount: 64,
      lastSyncAt: null,
      syncAgeHours: null,
      checks: { db: 'skipped', sync: 'skipped' },
      reasons: [],
    });
  });
});

describe('/api/health route (demo mode)', () => {
  const req = (method: 'GET' | 'HEAD', q = '') =>
    new NextRequest(`http://localhost:3000/api/health${q}`, {
      method,
      headers: { host: 'localhost:3000' },
    });

  beforeEach(async () => {
    (await import('@/server/container')).resetContainer();
  });

  it('GET: 200, no-store, no cookies; HEAD: same status, no body', async () => {
    const { GET, HEAD } = await import('@/app/api/health/route');
    const res = await GET(req('GET', '?strict=1'), undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('set-cookie')).toBeNull();
    const body = (await res.json()) as { status: string; catalogCount: number };
    expect(body.status).toBe('ok');
    expect(body.catalogCount).toBeGreaterThanOrEqual(60);
    const head = await HEAD(req('HEAD'), undefined);
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect(await head.text()).toBe('');
  });

  it('rate-limits per IP key → 429 with Retry-After', async () => {
    const { GET } = await import('@/app/api/health/route');
    const { limitFor } = await import('@/server/rate-limit');
    const { max } = limitFor('health', true, 'none');
    for (let i = 0; i < max; i++) expect((await GET(req('GET'), undefined)).status).toBe(200);
    const res = await GET(req('GET'), undefined);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
