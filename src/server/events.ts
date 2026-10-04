/**
 * First-party analytics writes (ADR-013 C-09): anonymous daily counters only — no user id, title key,
 * IP, UA, URL or cookie is ever stored. `recordEvent` schedules the write with `after()` so it never
 * delays the response, and never throws. `ANALYTICS_ENABLED=false` turns every write into a no-op.
 * OWNER: Backend.
 */
import 'server-only';
import { after } from 'next/server';
import { isAnalyticsEventName, isValidDim, type AnalyticsEventName } from '@/lib/analytics';
import { container } from './container';
import { log } from './log';
import type { EventCount } from './ports';

/** `ANALYTICS_ENABLED` (default true; `false`/`0`/`off`/`no` disables). */
export function analyticsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.ANALYTICS_ENABLED?.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
}

/** Sums duplicates; drops unknown names and invalid dims. */
export function aggregate(events: { name: string; dim: string }[]): EventCount[] {
  const m = new Map<string, EventCount>();
  for (const e of events) {
    if (!isAnalyticsEventName(e.name) || !isValidDim(e.name, e.dim)) continue;
    const k = `${e.name}|${e.dim}`;
    const cur = m.get(k);
    if (cur) cur.n++;
    else m.set(k, { name: e.name, dim: e.dim, n: 1 });
  }
  return [...m.values()];
}

/** Runs `fn` after the response; outside a request scope (scripts, tests) it runs right away. */
function later(fn: () => Promise<void>): void {
  const run = () => fn().catch((e: unknown) => log.warn('events_write_failed', { error: e }));
  try {
    after(run);
  } catch {
    void run();
  }
}

/** Counts events (server-emitted or validated client batches). Never throws. */
export function recordEvents(events: { name: string; dim: string }[]): void {
  if (!analyticsEnabled()) return;
  const rows = aggregate(events);
  if (rows.length === 0) return;
  later(() => container().events.track(rows));
}

export function recordEvent(name: AnalyticsEventName, dim = ''): void {
  recordEvents([{ name, dim }]);
}

/* ---------------- error counters (arch review AR-C2) ---------------- */

/** Where a server error happened: Next `routeType`s plus `api` for errors caught by `route()`. */
export type ServerErrorKind = 'render' | 'route' | 'action' | 'proxy' | 'api';

/**
 * The coarse, PII-free route area of a path: its first static segment (`/api/` is skipped), e.g.
 * `/api/titles/movie/x` → `titles`, `/title/[type]/[slug]` → `title`, `/` → `home`. Query, hash,
 * route groups and anything that is not a short lowercase word collapse to `other`.
 */
export function errorArea(path: string | undefined): string {
  const segs = (path ?? '')
    .split(/[?#]/, 1)[0]!
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s));
  const first = segs[0] === 'api' ? segs[1] : segs[0];
  if (first === undefined) return segs[0] === 'api' ? 'other' : 'home';
  return /^[a-z][a-z0-9-]{0,23}$/.test(first) ? first : 'other';
}

/** `server_error` dim; unknown kinds (e.g. a future Next `routeType`) count as `route`. */
export function serverErrorDim(kind: string, path: string | undefined): string {
  const k = (['render', 'route', 'action', 'proxy', 'api'] as const).includes(
    kind as ServerErrorKind,
  )
    ? kind
    : kind === 'middleware'
      ? 'proxy'
      : 'route';
  return `${k}:${errorArea(path)}`;
}

/** Counts one caught server error in `events` (Hobby keeps logs ~1 h). Never throws. */
export function recordServerError(kind: string, path: string | undefined): void {
  try {
    recordEvent('server_error', serverErrorDim(kind, path));
  } catch {
    /* counters are best-effort */
  }
}
