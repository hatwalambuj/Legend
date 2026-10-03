/**
 * Letterboxd export → import rows (ADR-013 C-11). Movies only. Stars 0.5–5 → rating10 = round(stars×2).
 * - diary.csv (`Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date`): one stub per row.
 * - reviews.csv (+`Review`): the review text of the matching diary row (or a stub of its own).
 * - ratings.csv: a dateless rating for films not in the diary.
 * - our own export (`tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`): round trip.
 * Pure and client-safe; no network. OWNER: Backend.
 */
import type { ImportRow } from '../types';
import { pickHeader, type CsvTable } from './csv';
import {
  capRows,
  cleanTitle,
  compact,
  intOrUndefined,
  isoDateOrNull,
  truthy,
  yearOrUndefined,
  type ParsedImport,
  type SkippedRow,
} from './common';

export function starsToRating10(v: string | undefined): number | null {
  const n = Number((v ?? '').trim());
  if (!v?.trim() || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(10, Math.max(1, Math.round(n * 2)));
}

/** Our own Letterboxd-compatible export (API_CONTRACT §5.16). */
export function isOwnExport(t: CsvTable): boolean {
  return t.headers.includes('tmdbid') && t.headers.includes('rating10');
}

/** A Letterboxd diary/reviews/ratings/watched CSV. */
export function isLetterboxdCsv(t: CsvTable): boolean {
  return (
    t.headers.includes('name') &&
    t.headers.includes('year') &&
    (t.headers.includes('letterboxd uri') ||
      t.headers.includes('watched date') ||
      t.headers.includes('rating'))
  );
}

const filmKey = (name: string, year: number | undefined, date: string | null) =>
  `${name.toLowerCase()}|${year ?? ''}|${date ?? ''}`;

export function parseOwnExport(t: CsvTable): ParsedImport {
  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  t.records.forEach((r, i) => {
    const ref = `export:${i + 1}`;
    const tmdbId = intOrUndefined(r['tmdbid'], 1, 9_999_999_999);
    const imdb = (r['imdbid'] ?? '').trim();
    const title = cleanTitle(r['title']);
    const year = yearOrUndefined(r['year']);
    const rating = intOrUndefined(r['rating10'], 1, 10);
    if (!tmdbId && !/^tt\d{7,10}$/.test(imdb) && !title) {
      skipped.push({ ref, title, year: year ?? null, reason: 'invalid' });
      return;
    }
    rows.push(
      compact({
        ref,
        mediaType: 'movie',
        tmdbId,
        imdbId: /^tt\d{7,10}$/.test(imdb) ? imdb : undefined,
        title: title || undefined,
        year,
        watchedOn: isoDateOrNull(r['watcheddate']),
        rating10: rating ?? null,
        rewatch: truthy(r['rewatch']),
        review: (r['review'] ?? '').slice(0, 5000) || undefined,
      }),
    );
  });
  return { source: 'letterboxd', label: 'Stubbed export', rows: capRows(rows), skipped };
}

/** `files`: basename → table (from a ZIP), or one CSV under its basename. */
export function parseLetterboxd(files: Map<string, CsvTable>): ParsedImport {
  const diary = files.get('diary.csv');
  const reviews = files.get('reviews.csv');
  const ratings = files.get('ratings.csv');
  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  const seenFilms = new Set<string>();
  const byDiaryKey = new Map<string, ImportRow>();
  const parts: string[] = [];
  let n = 0;

  const add = (r: Record<string, string>, kind: string, withDate: boolean, review?: string) => {
    const ref = `${kind}:${++n}`;
    const title = cleanTitle(r['name']);
    const year = yearOrUndefined(r['year']);
    if (!title) {
      skipped.push({ ref, title, year: year ?? null, reason: 'invalid' });
      return null;
    }
    const watchedOn = withDate ? isoDateOrNull(r['watched date'] || r['date']) : null;
    const row = compact({
      ref,
      mediaType: 'movie',
      title,
      year,
      watchedOn,
      rating10: starsToRating10(r['rating']),
      rewatch: truthy(r['rewatch']),
      review: review?.slice(0, 5000) || undefined,
    });
    rows.push(row);
    seenFilms.add(`${title.toLowerCase()}|${year ?? ''}`);
    return row;
  };

  if (diary) {
    parts.push('diary');
    for (const r of diary.records) {
      const row = add(r, 'diary', true);
      if (row) byDiaryKey.set(filmKey(row.title!, row.year, row.watchedOn ?? null), row);
    }
  }
  if (reviews) {
    parts.push('reviews');
    const reviewCol = pickHeader(reviews.headers, ['review']);
    for (const r of reviews.records) {
      const text = reviewCol ? (r[reviewCol] ?? '') : '';
      const key = filmKey(
        cleanTitle(r['name']),
        yearOrUndefined(r['year']),
        isoDateOrNull(r['watched date'] || r['date']),
      );
      const match = byDiaryKey.get(key);
      if (match) {
        if (text) match.review = text.slice(0, 5000);
      } else add(r, 'review', true, text);
    }
  }
  if (ratings) {
    parts.push('ratings');
    for (const r of ratings.records) {
      const film = `${cleanTitle(r['name']).toLowerCase()}|${yearOrUndefined(r['year']) ?? ''}`;
      if (!seenFilms.has(film) && starsToRating10(r['rating']) !== null) add(r, 'rating', false);
    }
  }
  if (!diary && !reviews && !ratings) {
    // A single unknown Letterboxd CSV (e.g. watched.csv): dated by "Watched Date" when present.
    const [only] = [...files.values()];
    if (only) {
      parts.push('list');
      for (const r of only.records) add(r, 'row', Boolean(r['watched date']));
    }
  }
  return {
    source: 'letterboxd',
    label: `Letterboxd ${parts.join(' + ')}`,
    rows: capRows(rows),
    skipped,
  };
}
