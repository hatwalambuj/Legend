/** Parse page searchParams into typed browse state (unknown values fall back to defaults). */
import { DEFAULT_SORT, DEFAULT_TYPE } from '@/lib/routes';
import type { SortKey, TypeFilter } from '@/lib/types';

export type SearchParams = Record<string, string | string[] | undefined>;

export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const TYPES: TypeFilter[] = ['all', 'movie', 'tv'];
const SORTS: SortKey[] = ['release_desc', 'release_asc', 'rating_desc', 'rating_asc'];

export function parseBrowse(sp: SearchParams): {
  type: TypeFilter;
  sort: SortKey;
  cursor: string | null;
  provider: number | null;
} {
  const t = first(sp.type) as TypeFilter | undefined;
  const s = first(sp.sort) as SortKey | undefined;
  const c = first(sp.cursor);
  const pv = first(sp.provider);
  const provider = pv && /^[1-9]\d{0,8}$/.test(pv) ? Number(pv) : null;
  return {
    type: t && TYPES.includes(t) ? t : DEFAULT_TYPE,
    sort: s && SORTS.includes(s) ? s : DEFAULT_SORT,
    cursor: c && c.length <= 512 ? c : null,
    provider,
  };
}

export const SORT_ASIDE: Record<SortKey, string> = {
  release_desc: 'New & good',
  release_asc: 'Oldies but goodies',
  rating_desc: 'Highest rated',
  rating_asc: 'Still 6.5+',
  popularity_desc: 'Trending',
};

export const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'Shows' },
];

/** `?type=&sort=&provider=` for a list base; the cursor is always dropped (ADR-013 C-02). */
export function listHref(
  base: string,
  o: { type: TypeFilter; sort: SortKey; provider?: number | null },
): string {
  const p = new URLSearchParams();
  if (o.type !== DEFAULT_TYPE) p.set('type', o.type);
  if (o.sort !== DEFAULT_SORT) p.set('sort', o.sort);
  if (o.provider) p.set('provider', String(o.provider));
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}
