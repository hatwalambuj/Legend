/**
 * TV Time GDPR export → import rows (ADR-013 C-11, beta). **Unverified format** (founder input F11):
 * columns are found through the alias table below. One stub per (show, season), dated at the last
 * episode watched in that season; one stub per movie watch. Pure; no network. OWNER: Backend.
 */
import type { ImportRow } from '../types';
import { pickHeader, type CsvTable } from './csv';
import {
  capRows,
  cleanTitle,
  compact,
  intOrUndefined,
  isoDateOrNull,
  type ParsedImport,
  type SkippedRow,
} from './common';

export const TVTIME_ALIASES = {
  show: ['tv_show_name', 'series_name', 'show_name', 'tvshow_name', 'show'],
  movie: ['movie_name', 'film_name', 'movie_title'],
  season: ['episode_season_number', 'season_number', 'season'],
  episode: ['episode_number', 'episode'],
  watchedAt: ['watched_at', 'seen_at', 'created_at', 'updated_at', 'date'],
  imdb: ['imdb_id', 'imdb'],
  type: ['entity_type', 'type'],
} as const;

export function isTvTimeTable(t: CsvTable): boolean {
  const h = t.headers;
  const show = pickHeader(h, TVTIME_ALIASES.show) && pickHeader(h, TVTIME_ALIASES.season);
  const movie = pickHeader(h, TVTIME_ALIASES.movie) && pickHeader(h, TVTIME_ALIASES.watchedAt);
  return Boolean(show || movie);
}

export function parseTvTime(tables: CsvTable[]): ParsedImport {
  const seasons = new Map<
    string,
    { title: string; season: number; last: string | null; imdb?: string }
  >();
  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  let n = 0;
  for (const t of tables) {
    const h = t.headers;
    const col = {
      show: pickHeader(h, TVTIME_ALIASES.show),
      movie: pickHeader(h, TVTIME_ALIASES.movie),
      season: pickHeader(h, TVTIME_ALIASES.season),
      at: pickHeader(h, TVTIME_ALIASES.watchedAt),
      imdb: pickHeader(h, TVTIME_ALIASES.imdb),
      type: pickHeader(h, TVTIME_ALIASES.type),
    };
    for (const r of t.records) {
      const type = col.type ? (r[col.type] ?? '').toLowerCase() : '';
      const date = col.at ? isoDateOrNull(r[col.at]) : null;
      const imdbRaw = col.imdb ? (r[col.imdb] ?? '').trim() : '';
      const imdbId = /^tt\d{7,10}$/.test(imdbRaw) ? imdbRaw : undefined;
      const movieName = col.movie ? cleanTitle(r[col.movie]) : '';
      if (movieName && (type === '' || type === 'movie' || !col.show || !r[col.show!])) {
        rows.push(
          compact({
            ref: `tvtime:m${++n}`,
            mediaType: 'movie',
            title: movieName,
            imdbId,
            watchedOn: date,
          }),
        );
        continue;
      }
      const show = col.show ? cleanTitle(r[col.show]) : '';
      const season = col.season ? intOrUndefined(r[col.season], 1, 200) : undefined;
      if (!show) {
        skipped.push({ ref: `tvtime:x${++n}`, title: movieName, year: null, reason: 'invalid' });
        continue;
      }
      const key = `${show.toLowerCase()}|${season ?? ''}`;
      const cur = seasons.get(key);
      if (!cur) seasons.set(key, { title: show, season: season ?? 0, last: date, imdb: imdbId });
      else if (date && (!cur.last || date > cur.last)) cur.last = date;
    }
  }
  for (const s of seasons.values())
    rows.push(
      compact({
        ref: `tvtime:s${++n}`,
        mediaType: 'tv',
        title: s.title,
        imdbId: s.imdb,
        watchedOn: s.last,
        season: s.season > 0 ? s.season : null,
      }),
    );
  return { source: 'tvtime', label: 'TV Time (beta)', rows: capRows(rows), skipped };
}
