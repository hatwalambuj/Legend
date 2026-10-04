/**
 * Canonical cache keys for the anonymous share/OG image routes (arch review R1: render cost).
 * satori + resvg renders are CPU-heavy and the CDN keys on the full query string, so `?x=random` used
 * to force a fresh render per request. Now every image URL has exactly one canonical form:
 *   `<path>?v=<content version>` (+ `&download=1` on the story route)
 * and `src/proxy.ts` 308-redirects anything else (Next's own `?<hash>` meta URL, junk params, reorders,
 * a stale `v`) to it. A redirect costs no data read and no render, so cache-busting can't force renders:
 * at most one render per image per content version. Pure and runtime-agnostic (proxy + routes).
 * OWNER: Backend.
 *
 * Content version = `<release>-<time bucket>`: a deploy (new card design) or the bucket rolling over
 * (titles: nightly catalog sync, 1 day; stubs: 10 min, ADR-013 §18 R3 deleted-stub ceiling) mints a new
 * key. Title images are public catalog data → long-lived `immutable`. Stub images keep the 10 min
 * ceiling (a deleted stub must stop being served), so they are not `immutable`.
 */
import { release } from './log';

export type ShareImageKind = 'title_og' | 'stub_og' | 'story';

/** Seconds per content-version bucket. */
export const SHARE_BUCKET_SEC: Record<ShareImageKind, number> = {
  title_og: 86_400,
  stub_og: 600,
  story: 600,
};

export const SHARE_CACHE_CONTROL: Record<ShareImageKind, string> = {
  title_og: 'public, max-age=31536000, s-maxage=31536000, immutable',
  stub_og: 'public, max-age=600, s-maxage=600',
  story: 'public, max-age=600, s-maxage=600',
};

const TITLE_OG = /^\/title\/[^/]+\/[^/]+\/opengraph-image$/;
const STUB_OG = /^\/share\/stub\/[^/]+\/opengraph-image$/;
const STORY = /^\/share\/stub\/[^/]+\/story$/;

export function shareImageKind(pathname: string): ShareImageKind | null {
  if (TITLE_OG.test(pathname)) return 'title_og';
  if (STUB_OG.test(pathname)) return 'stub_og';
  if (STORY.test(pathname)) return 'story';
  return null;
}

/** The current content version of `kind` (`<release>-<bucket index>`). */
export function shareVersion(
  kind: ShareImageKind,
  nowMs = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string {
  return `${release(env)}-${Math.floor(nowMs / 1000 / SHARE_BUCKET_SEC[kind])}`;
}

/** The canonical `search` (with leading `?`) for a share image request. */
export function canonicalShareSearch(
  kind: ShareImageKind,
  params: URLSearchParams,
  nowMs = Date.now(),
  env: Record<string, string | undefined> = process.env,
): string {
  const download = kind === 'story' && params.get('download') === '1';
  return `?v=${shareVersion(kind, nowMs, env)}${download ? '&download=1' : ''}`;
}

/**
 * `null` when `url` is a share image URL already in canonical form (or not a share image at all);
 * otherwise the canonical URL to redirect to.
 */
export function shareImageRedirect(
  url: URL,
  nowMs = Date.now(),
  env: Record<string, string | undefined> = process.env,
): URL | null {
  const kind = shareImageKind(url.pathname);
  if (!kind) return null;
  const search = canonicalShareSearch(kind, url.searchParams, nowMs, env);
  if (url.search === search) return null;
  const to = new URL(url.pathname + search, url);
  return to;
}
