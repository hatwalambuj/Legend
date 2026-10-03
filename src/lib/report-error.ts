/**
 * Client error reporting without a third party (ADR-013 C-13). Client-safe. Sends one small JSON
 * beacon to our own `POST /api/log` (server logs only). Dedupes by `kind+message` per page load, sends at
 * most 5 per page load, never retries and never throws. Only `location.pathname` is sent (no query,
 * hash, cookies or user data). OWNER: Backend (C-00); wired by the error boundaries and AppProvider.
 */
export type ClientErrorKind = 'boundary' | 'global' | 'unhandled' | 'rejection';

export interface ClientErrorReport {
  kind: ClientErrorKind;
  message: string;
  digest?: string;
  stack?: string;
}

export const LOG_ENDPOINT = '/api/log';
export const MAX_REPORTS_PER_PAGE = 5;

const seen = new Set<string>();
let sent = 0;

const cut = (s: unknown, n: number): string =>
  (typeof s === 'string' ? s : String(s ?? '')).slice(0, n);

export function reportError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
    const message = cut(report.message, 300) || 'Unknown error';
    const key = `${report.kind}|${message}`;
    if (seen.has(key) || sent >= MAX_REPORTS_PER_PAGE) return;
    seen.add(key);
    sent++;
    const body = JSON.stringify({
      kind: report.kind,
      message,
      ...(report.digest ? { digest: cut(report.digest, 64) } : {}),
      ...(report.stack ? { stack: cut(report.stack, 2000) } : {}),
      path: cut(window.location?.pathname ?? '/', 200) || '/',
    });
    const blob = new Blob([body], { type: 'application/json' });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(LOG_ENDPOINT, blob))
      return;
    void fetch(LOG_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* reporting must never throw */
  }
}

/** Tests only. */
export function resetReportErrorForTests(): void {
  seen.clear();
  sent = 0;
}
