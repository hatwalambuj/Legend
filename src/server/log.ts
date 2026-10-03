/**
 * Structured server logs without a third party (ADR-013 C-13): one JSON line per event on stdout/stderr
 * (`console.*` → the host's log stream). Every field goes through `redact()` first.
 * Not `server-only`: jobs (tsx) use it too. OWNER: Backend.
 */

export type LogLevel = 'info' | 'warn' | 'error';

/** Values at or above this size are dropped (ADR-013: "anything >= 2 KB"). */
export const REDACT_MAX_CHARS = 2048;
const SECRET_KEY = /authorization|cookie|password|passwd|secret|token|api[-_]?key|session|jwt/i;

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const SB_COOKIE = /\b(sb-[A-Za-z0-9_-]+)=([^;\s]+)/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_QUERY = /((?:https?:\/\/[^\s?#"']+)|(?:^|(?<=[\s"'(]))\/[^\s?#"']*)\?[^\s#"']*/g;

/** Redacts one string: emails, JWT-like tokens, `sb-*` cookie values, auth headers, URL query strings. */
export function redactString(s: string): string {
  if (s.length >= REDACT_MAX_CHARS) return '[omitted: too long]';
  return s
    .replace(JWT, '[token]')
    .replace(SB_COOKIE, '$1=[redacted]')
    .replace(BEARER, '$1 [redacted]')
    .replace(EMAIL, '[email]')
    .replace(URL_QUERY, '$1');
}

/** Deep, bounded redaction of a log field (never throws). */
export function redact(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'string') return redactString(v);
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return String(v);
  if (typeof v === 'function' || typeof v === 'symbol') return undefined;
  if (depth >= 4) return '[depth]';
  if (v instanceof Error) {
    const code = (v as { code?: unknown }).code;
    return {
      name: v.name,
      message: redactString(v.message),
      ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
    };
  }
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (n++ >= 30) break;
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(x, depth + 1);
    }
    return out;
  }
  return undefined;
}

export function release(env: Record<string, string | undefined> = process.env): string {
  return (env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev';
}

function write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
  try {
    const safe = (fields ? redact(fields) : {}) as Record<string, unknown>;
    const line = JSON.stringify({
      ...safe,
      ts: new Date().toISOString(),
      level,
      event: redactString(event).slice(0, 80),
      release: release(),
    });
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.info(line);
  } catch {
    /* logging must never throw */
  }
}

export const log = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};

/** `chrome|firefox|safari|edge|other` from a User-Agent (only the family is ever logged). */
export function uaFamily(
  ua: string | null | undefined,
): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' {
  const s = ua ?? '';
  if (/Edg(e|A|iOS)?\//.test(s)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(s)) return 'firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(s)) return 'chrome';
  if (/Safari\//.test(s) && /Version\//.test(s)) return 'safari';
  return 'other';
}

/** A path with any query string or hash removed (client-sent `path`, `routePath`). */
export function stripQuery(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? '';
}
