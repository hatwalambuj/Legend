/**
 * "Where to watch" region resolution (ADR-012 §5, PRD W3). OWNER: Backend.
 *
 * Order (first source that yields a code wins; it is the `requested` region):
 *   1. query            — `?region=` on public API routes only (already validated by the zod schema)
 *   2. setting          — cookie `stubbed_region` (the profile setting reaches SSR only through it)
 *   3. geo              — WATCH_GEO_HEADER, ONLY when TRUSTED_PROXY ≠ none; else a client-sent header is ignored
 *   4. accept_language  — first tag with a 2-letter region subtag, by q
 *   5. default          — WATCH_REGION_DEFAULT
 * An unsupported requested region → `{ region: default, requested, fallback: true }` (W3-AC4).
 * `resolveWatchRegion` is pure; `requestWatchRegion` is the one wrapper that reads `headers()`/`cookies()`.
 * Never reads the session; never stores or logs IPs or the geo header value.
 */
import { cookies, headers } from 'next/headers';
import { normalizeRegionCode, regionName } from '@/lib/regions';
import type { WatchRegionInfo, WatchRegionSource } from '@/lib/types';
import type { CookieJar } from '@/server/auth/cookies';
import { env, type ServerEnv } from '@/server/env';

export const WATCH_REGION_COOKIE = 'stubbed_region';
/** One year (ADR-012 §7). */
export const WATCH_REGION_COOKIE_MAX_AGE = 31_536_000;

export interface RegionConfig {
  defaultRegion: string;
  regions: readonly string[];
  /** Lower-cased header name, or null when geo is off or untrusted. */
  geoHeader: string | null;
}

export interface RegionInput {
  query?: string | null;
  cookie?: string | null;
  geo?: string | null;
  acceptLanguage?: string | null;
}

/** Placeholder country values some edges send (unknown, Tor, anonymous proxy, satellite, continents). */
const GEO_PLACEHOLDERS = new Set(['XX', 'T1', 'A1', 'A2', 'EU', 'AP', 'ZZ']);

/** Effective config: the geo header only counts behind a trusted edge (ADR-001 §A3, W3-AC2). */
export function watchRegionConfig(e: ServerEnv = env()): RegionConfig {
  return {
    defaultRegion: e.watch.defaultRegion,
    regions: e.watch.regions,
    geoHeader: e.watch.geoHeader && e.trustedProxy !== 'none' ? e.watch.geoHeader : null,
  };
}

/**
 * Region subtag of an Accept-Language header: <= 10 entries, sorted by q (stable), the first tag with a
 * 2-letter region subtag wins (`en-GB`→GB, `hi-IN`→IN, `zh-Hant-TW`→TW; `es-419`, bare `en`, `*` → none).
 */
export function acceptLanguageRegion(header: string | null | undefined): string | null {
  if (!header) return null;
  const entries = header
    .slice(0, 1000)
    .split(',')
    .slice(0, 10)
    .map((part, i) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qp = params.map((p) => p.trim()).find((p) => /^q=/i.test(p));
      const q = qp === undefined ? 1 : Number(qp.slice(2));
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of entries) {
    const sub = tag.split('-').slice(1);
    // Region = a 2-letter subtag after the language (and an optional 4-letter script) subtag.
    const region = sub.find(
      (s, idx) => s.length === 2 && (idx === 0 || sub[idx - 1]!.length === 4),
    );
    const code = normalizeRegionCode(region);
    if (code) return code;
  }
  return null;
}

function geoRegion(value: string | null | undefined): string | null {
  const code = normalizeRegionCode(value);
  return code && !GEO_PLACEHOLDERS.has(code) ? code : null;
}

/** A strict cookie value: exactly `^[A-Z]{2}$` (we only ever write that). */
export function cookieRegion(value: string | null | undefined): string | null {
  return typeof value === 'string' && /^[A-Z]{2}$/.test(value) ? value : null;
}

/** WatchRegionInfo for a requested code (null = nothing requested → the default). */
export function regionInfo(
  requested: string | null,
  source: WatchRegionSource,
  cfg: RegionConfig,
): WatchRegionInfo {
  const supported = requested !== null && cfg.regions.includes(requested);
  const region = supported ? requested : cfg.defaultRegion;
  return {
    region,
    regionName: regionName(region) ?? region,
    requested: source === 'default' ? null : requested,
    fallback: source !== 'default' && !supported,
    source,
  };
}

export function resolveWatchRegion(input: RegionInput, cfg: RegionConfig): WatchRegionInfo {
  const candidates: [WatchRegionSource, string | null][] = [
    ['query', normalizeRegionCode(input.query)],
    ['setting', cookieRegion(input.cookie)],
    ['geo', cfg.geoHeader ? geoRegion(input.geo) : null],
    ['accept_language', acceptLanguageRegion(input.acceptLanguage)],
  ];
  for (const [source, code] of candidates) if (code) return regionInfo(code, source, cfg);
  return regionInfo(null, 'default', cfg);
}

/** Reads the request's region inputs (never the session) and resolves them. For SSR (`dal.getWatchRegion`). */
export async function requestWatchRegion(cfg: RegionConfig = watchRegionConfig()) {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  return resolveWatchRegion(
    {
      cookie: jar.get(WATCH_REGION_COOKIE)?.value ?? null,
      geo: cfg.geoHeader ? h.get(cfg.geoHeader) : null,
      acceptLanguage: h.get('accept-language'),
    },
    cfg,
  );
}

/** Sets (or, for null, clears) the `stubbed_region` cookie: HttpOnly, SameSite=Lax, Path=/, Secure per request. */
export function writeRegionCookie(jar: CookieJar, region: string | null): void {
  if (region && /^[A-Z]{2}$/.test(region))
    jar.set(WATCH_REGION_COOKIE, region, { maxAge: WATCH_REGION_COOKIE_MAX_AGE });
  else jar.delete(WATCH_REGION_COOKIE);
}
