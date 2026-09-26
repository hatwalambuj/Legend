/** Canonical URL builders. Use these instead of hand-writing paths. OWNER: Architect. FROZEN. */
import type { MediaType, SortKey, TitleSummary, TypeFilter } from './types';

export function titleHref(t: Pick<TitleSummary, 'mediaType' | 'tmdbId' | 'slug'>): string {
  return `/title/${t.mediaType}/${t.tmdbId}-${t.slug}`;
}

/** Parse the `[slug]` segment of /title/[type]/[slug] → tmdbId. "693134-dune-part-two" → 693134. */
export function parseTitleSlug(segment: string): { tmdbId: number; slug: string } | null {
  const m = /^([1-9]\d{0,9})(?:-(.*))?$/.exec(segment);
  if (!m) return null;
  return { tmdbId: Number(m[1]), slug: m[2] ?? '' };
}

export function isMediaType(v: string): v is MediaType {
  return v === 'movie' || v === 'tv';
}

export function profileHref(handle: string): string {
  return `/u/${handle}`;
}

export const DEFAULT_SORT: SortKey = 'release_desc';
export const DEFAULT_TYPE: TypeFilter = 'all';

/** Browse URL with defaults dropped, params in a stable order (cache-key normalisation). */
export function browseHref(
  opts: { type?: TypeFilter; sort?: SortKey; cursor?: string | null } = {},
): string {
  const p = new URLSearchParams();
  if (opts.type && opts.type !== DEFAULT_TYPE) p.set('type', opts.type);
  if (opts.sort && opts.sort !== DEFAULT_SORT) p.set('sort', opts.sort);
  if (opts.cursor) p.set('cursor', opts.cursor);
  const qs = p.toString();
  return qs ? `/browse?${qs}` : '/browse';
}

/**
 * Only same-origin relative paths are allowed as post-login redirects (open-redirect guard).
 * Browsers strip ASCII tab/CR/LF from URLs and treat `\\` like `/`, so "/\t/evil.com" or "/\\evil.com"
 * would become the protocol-relative "//evil.com": reject control characters and backslashes outright,
 * then confirm that the path resolves to our own origin.
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (next.startsWith('//')) return fallback;
  try {
    const base = 'http://stubbed.invalid';
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}

/**
 * Read-only link to the IMDb title page (the IMDb chip may link out). We never post to IMDb (ADR-008).
 * Returns null for a missing or malformed id so callers can hide the link.
 */
export function imdbTitleHref(imdbId: string | null | undefined): string | null {
  return imdbId && /^tt\d{7,10}$/.test(imdbId) ? `https://www.imdb.com/title/${imdbId}/` : null;
}
