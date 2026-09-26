/**
 * Canonical sort semantics + keyset cursor format (ADR-003). OWNER: Architect. FROZEN.
 *
 * Every sort is a TOTAL order ending in the unique `tmdbKey` so pages never overlap or skip.
 * Postgres implements the same order in `public.catalog_page()` (supabase/migrations); the demo store
 * uses `compareTitles`. Both MUST agree — tests/lib/catalog-order.test.ts pins the semantics.
 *
 *   release_desc    : releaseDate DESC, sortTitle ASC, key ASC
 *   release_asc     : releaseDate ASC,  sortTitle ASC, key ASC
 *   rating_desc     : voteAverage DESC, voteCount DESC, sortTitle ASC, key ASC   (PRD A2-AC4)
 *   rating_asc      : voteAverage ASC,  voteCount DESC, sortTitle ASC, key ASC
 *   popularity_desc : popularity DESC,  key ASC
 *
 * `key` for ordering is the TitleKey string ("movie:603"); in SQL it is (media_type, tmdb_id) as text.
 */
import { sortTitle } from './text';
import type { SortKey, TitleSummary } from './types';

export const SORT_KEYS: readonly SortKey[] = [
  'release_desc',
  'release_asc',
  'rating_desc',
  'rating_asc',
  'popularity_desc',
] as const;

/** Browse UI options (A2-AC1). popularity_desc is home-rail only. */
export const BROWSE_SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'release_desc', label: 'Release date · newest' },
  { value: 'release_asc', label: 'Release date · oldest' },
  { value: 'rating_desc', label: 'Rating · highest' },
  { value: 'rating_asc', label: 'Rating · lowest' },
];

type Sortable = Pick<
  TitleSummary,
  'key' | 'title' | 'releaseDate' | 'voteAverage' | 'voteCount' | 'popularity'
>;

/** Tuple of sort values for a row, in comparison order. Stored in the cursor. */
export type SortTuple = (string | number)[];

export function sortTuple(t: Sortable, sort: SortKey): SortTuple {
  const st = sortTitle(t.title);
  switch (sort) {
    case 'release_desc':
    case 'release_asc':
      return [t.releaseDate, st, t.key];
    case 'rating_desc':
    case 'rating_asc':
      return [round1(t.voteAverage), t.voteCount, st, t.key];
    case 'popularity_desc':
      return [t.popularity, t.key];
  }
}

/** +1 = ascending, -1 = descending, per tuple position. */
const DIRECTIONS: Record<SortKey, (1 | -1)[]> = {
  release_desc: [-1, 1, 1],
  release_asc: [1, 1, 1],
  rating_desc: [-1, -1, 1, 1],
  rating_asc: [1, -1, 1, 1],
  popularity_desc: [-1, 1],
};

export function compareTuples(a: SortTuple, b: SortTuple, sort: SortKey): number {
  const dirs = DIRECTIONS[sort];
  for (let i = 0; i < dirs.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x < y) return -1 * dirs[i]!;
    if (x > y) return 1 * dirs[i]!;
  }
  return 0;
}

export function compareTitles(a: Sortable, b: Sortable, sort: SortKey): number {
  return compareTuples(sortTuple(a, sort), sortTuple(b, sort), sort);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ---------- Cursor: base64url(JSON {s: sort, t: tuple}) ---------- */

interface CursorPayload {
  s: SortKey;
  t: SortTuple;
}

export function encodeCursor(sort: SortKey, tuple: SortTuple): string {
  const json = JSON.stringify({ s: sort, t: tuple } satisfies CursorPayload);
  return base64url(json);
}

/** Returns null for malformed cursors or cursors minted for a different sort (→ start from page 1). */
export function decodeCursor(cursor: string | null | undefined, sort: SortKey): SortTuple | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(fromBase64url(cursor)) as Partial<CursorPayload>;
    if (parsed.s !== sort || !Array.isArray(parsed.t)) return null;
    if (parsed.t.length !== DIRECTIONS[sort].length) return null;
    if (!parsed.t.every((v) => typeof v === 'string' || typeof v === 'number')) return null;
    return parsed.t;
  } catch {
    return null;
  }
}

function base64url(s: string): string {
  const b64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(s, 'utf8').toString('base64')
      : btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64').toString('utf8');
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/**
 * Reference keyset pagination over an in-memory array (used by the demo store and tests).
 * `rows` need not be pre-sorted.
 */
export function paginate<T extends Sortable>(
  rows: readonly T[],
  sort: SortKey,
  cursor: string | null | undefined,
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const after = decodeCursor(cursor, sort);
  const sorted = [...rows].sort((a, b) => compareTitles(a, b, sort));
  const start = after
    ? sorted.findIndex((r) => compareTuples(sortTuple(r, sort), after, sort) > 0)
    : 0;
  if (start < 0) return { items: [], nextCursor: null };
  const items = sorted.slice(start, start + limit);
  const last = items[items.length - 1];
  const hasMore = start + limit < sorted.length;
  return { items, nextCursor: hasMore && last ? encodeCursor(sort, sortTuple(last, sort)) : null };
}
