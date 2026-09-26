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

/** Only same-origin relative paths are allowed as post-login redirects (open-redirect guard). */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  return next;
}

export const IMDB_TITLE_URL = (imdbId: string) => `https://www.imdb.com/title/${imdbId}/reviews/`;
