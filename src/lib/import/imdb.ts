/**
 * IMDb `ratings.csv` → import rows (ADR-013 C-11): `Const,Your Rating,Date Rated,Title,…,Title Type,…,Year`.
 * `Const` → imdbId; `movie` → movie, `tvSeries`/`tvMiniSeries` → tv, other types → skipped (invalid).
 * `Date Rated` dates the optional stub (the server's "Create stubs" option). Pure; no network.
 * OWNER: Backend.
 */
import type { ImportRow, MediaType } from '../types';
import type { CsvTable } from './csv';
import {
  capRows,
  cleanTitle,
  compact,
  intOrUndefined,
  isoDateOrNull,
  yearOrUndefined,
  type ParsedImport,
  type SkippedRow,
} from './common';

export function isImdbRatings(t: CsvTable): boolean {
  return t.headers.includes('const') && t.headers.includes('your rating');
}

const TYPES: Record<string, MediaType> = {
  movie: 'movie',
  tvseries: 'tv',
  tvminiseries: 'tv',
};

export function parseImdbRatings(t: CsvTable): ParsedImport {
  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  t.records.forEach((r, i) => {
    const ref = `imdb:${i + 1}`;
    const imdbId = (r['const'] ?? '').trim();
    const title = cleanTitle(r['title']);
    const year = yearOrUndefined(r['year']);
    const type = TYPES[(r['title type'] ?? '').trim().toLowerCase().replace(/\s+/g, '')];
    if (!/^tt\d{7,10}$/.test(imdbId) || !type) {
      skipped.push({ ref, title, year: year ?? null, reason: 'invalid' });
      return;
    }
    rows.push(
      compact({
        ref,
        mediaType: type,
        imdbId,
        title: title || undefined,
        year,
        watchedOn: isoDateOrNull(r['date rated']),
        rating10: intOrUndefined(r['your rating'], 1, 10) ?? null,
      }),
    );
  });
  return { source: 'imdb', label: 'IMDb ratings', rows: capRows(rows), skipped };
}
