/**
 * `detectAndParse(file)` (ADR-013 C-11): the file is read and parsed in the browser and never leaves the
 * device; only the normalised rows are sent to `/api/me/imports*`. Detection uses file and header names
 * (case-insensitive). Size is checked before reading; ZIP limits in ./zip.ts; <= 20,000 rows.
 * Pure and client-safe: no network, no server imports (guard test). OWNER: Backend.
 */
import { csvTable, type CsvTable } from './csv';
import { ImportError, MAX_FILE_BYTES, type ParsedImport } from './common';
import { isImdbRatings, parseImdbRatings } from './imdb';
import { isLetterboxdCsv, isOwnExport, parseLetterboxd, parseOwnExport } from './letterboxd';
import { isTvTimeTable, parseTvTime } from './tvtime';
import { baseName, isZip, readZip } from './zip';

export * from './common';
export { csvTable, parseCsv } from './csv';

const LETTERBOXD_FILES = new Set(['diary.csv', 'reviews.csv', 'ratings.csv', 'watched.csv']);

/** Parses one CSV text (any supported source). */
export function parseCsvImport(text: string, name = 'import.csv'): ParsedImport {
  const t = csvTable(text);
  if (isImdbRatings(t)) return parseImdbRatings(t);
  if (isOwnExport(t)) return parseOwnExport(t);
  if (isLetterboxdCsv(t)) return parseLetterboxd(new Map([[baseName(name), t]]));
  if (isTvTimeTable(t)) return parseTvTime([t]);
  throw new ImportError('unknown_format');
}

/** Parses the CSV files of an unzipped archive (basename → text). */
export function parseArchive(files: Map<string, string>): ParsedImport {
  const tables = new Map<string, CsvTable>();
  for (const [name, text] of files) tables.set(baseName(name), csvTable(text));
  const lb = new Map([...tables].filter(([n]) => LETTERBOXD_FILES.has(n)));
  if (lb.has('diary.csv') || lb.has('ratings.csv') || lb.has('reviews.csv'))
    return parseLetterboxd(lb);
  const own = [...tables.values()].find(isOwnExport);
  if (own) return parseOwnExport(own);
  const imdb = [...tables.values()].find(isImdbRatings);
  if (imdb) return parseImdbRatings(imdb);
  const tv = [...tables.values()].filter(isTvTimeTable);
  if (tv.length) return parseTvTime(tv);
  throw new ImportError('unknown_format');
}

/** A File/Blob from `<input type="file">` (`.csv` or `.zip`). */
export async function detectAndParse(file: Blob & { name?: string }): Promise<ParsedImport> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('too_large');
  const data = new Uint8Array(await file.arrayBuffer());
  const decode = (b: Uint8Array) => new TextDecoder('utf-8').decode(b);
  if (isZip(data)) {
    const entries = await readZip(data);
    const files = new Map<string, string>();
    for (const [name, bytes] of entries) files.set(name, decode(bytes));
    return parseArchive(files);
  }
  return parseCsvImport(decode(data), file.name ?? 'import.csv');
}
