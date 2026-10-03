/**
 * Import matching (ADR-013 C-11), catalogue-only: never calls Letterboxd, IMDb, TV Time or TMDB.
 * Order: tmdbId + type → imdbId (+ type when given) → normalised title (`sort_title`) + year ±1 + type,
 * several title matches → the highest vote_count. Unlisted index rows count as matched (they can be
 * stubbed today). Pure; the memory repository uses it directly and the SQL `catalog_match` mirrors it.
 * OWNER: Backend.
 */
import { normalizeSearch } from '@/lib/text';
import type { ImportRow, TitleKey, TitleSummary } from '@/lib/types';
import type { CatalogMatchItem } from '@/server/ports';

export interface MatchIndex {
  byKey: Map<TitleKey, TitleSummary>;
  byImdb: Map<string, TitleSummary[]>;
  byTitle: Map<string, TitleSummary[]>;
}

const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
};

export function buildMatchIndex(titles: Iterable<TitleSummary>): MatchIndex {
  const idx: MatchIndex = { byKey: new Map(), byImdb: new Map(), byTitle: new Map() };
  for (const t of titles) {
    idx.byKey.set(t.key, t);
    if (t.imdbId) push(idx.byImdb, t.imdbId, t);
    // = catalog_index.sort_title (the SQL `catalog_match` compares the same key).
    push(idx.byTitle, normalizeSearch(t.title), t);
  }
  return idx;
}

const mostVoted = (list: TitleSummary[]): TitleSummary | null =>
  list.reduce<TitleSummary | null>(
    (best, t) =>
      !best || t.voteCount > best.voteCount || (t.voteCount === best.voteCount && t.key < best.key)
        ? t
        : best,
    null,
  );

export function matchOne(idx: MatchIndex, item: CatalogMatchItem): TitleSummary | null {
  const typeOk = (t: TitleSummary) => !item.mediaType || t.mediaType === item.mediaType;
  if (item.tmdbId && item.mediaType) {
    const t = idx.byKey.get(`${item.mediaType}:${item.tmdbId}`);
    if (t) return t;
  }
  if (item.imdbId) {
    const t = mostVoted((idx.byImdb.get(item.imdbId) ?? []).filter(typeOk));
    if (t) return t;
  }
  if (item.titleNorm) {
    const list = (idx.byTitle.get(item.titleNorm) ?? []).filter(
      (t) => typeOk(t) && (!item.year || Math.abs(t.year - item.year) <= 1),
    );
    return mostVoted(list);
  }
  return null;
}

/** The match request for one import row (title normalised like `catalog_index.sort_title`). */
export function matchItemOf(row: ImportRow): CatalogMatchItem {
  const titleNorm = row.title ? normalizeSearch(row.title) : '';
  return {
    ref: row.ref,
    ...(row.mediaType ? { mediaType: row.mediaType } : {}),
    ...(row.tmdbId ? { tmdbId: row.tmdbId } : {}),
    ...(row.imdbId ? { imdbId: row.imdbId } : {}),
    ...(titleNorm ? { titleNorm } : {}),
    ...(row.year ? { year: row.year } : {}),
  };
}

/** True when a row carries anything we can match on. */
export function isMatchable(item: CatalogMatchItem): boolean {
  return Boolean((item.tmdbId && item.mediaType) || item.imdbId || item.titleNorm);
}
