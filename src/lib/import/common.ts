/**
 * Shared helpers and limits of the client-side import parsers (ADR-013 C-11). Pure; no network.
 * OWNER: Backend.
 */
import type { ImportRow, ImportSource } from '../types';

/** File cap, checked before reading. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 50;
export const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_INFLATED_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

export type ImportErrorCode =
  | 'too_large'
  | 'too_many_rows'
  | 'unknown_format'
  | 'zip_invalid'
  | 'zip_encrypted'
  | 'zip64'
  | 'zip_too_many_entries'
  | 'zip_entry_too_large'
  | 'zip_too_large'
  | 'zip_method';

/** User-facing copy per error (the UI shows `message`). */
export const IMPORT_ERROR_COPY: Record<ImportErrorCode, string> = {
  too_large: 'That file is over 10 MB. Export a smaller range and try again.',
  too_many_rows: 'That file has more than 20,000 rows. Split it and import the parts.',
  unknown_format: "We couldn't recognise that file. Use a Letterboxd, IMDb or TV Time export.",
  zip_invalid: 'That ZIP file looks damaged. Download the export again.',
  zip_encrypted: 'That ZIP is password-protected. Export it again without a password.',
  zip64: 'That ZIP is too large for us to read. Export a smaller range.',
  zip_too_many_entries: 'That ZIP has too many files in it.',
  zip_entry_too_large: 'A file inside that ZIP is too large.',
  zip_too_large: 'That ZIP expands to more than 50 MB.',
  zip_method: 'That ZIP uses a compression method we can’t read.',
};

export class ImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(IMPORT_ERROR_COPY[code]);
    this.name = 'ImportError';
  }
}

/** A row the parser could not use (shown in the "not imported" list, never uploaded). */
export interface SkippedRow {
  ref: string;
  title: string;
  year: number | null;
  reason: 'invalid';
}

export interface ParsedImport {
  source: ImportSource;
  /** What the parser recognised (e.g. "Letterboxd diary + ratings"), for the UI. */
  label: string;
  rows: ImportRow[];
  skipped: SkippedRow[];
}

export function isoDateOrNull(v: string | undefined | null): string | null {
  const s = (v ?? '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

export function yearOrUndefined(v: string | undefined | null): number | undefined {
  const n = Number((v ?? '').trim());
  return Number.isInteger(n) && n >= 1870 && n <= 2100 ? n : undefined;
}

export function intOrUndefined(v: string | undefined | null, min: number, max: number) {
  const s = (v ?? '').trim();
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= min && n <= max ? n : undefined;
}

export const cleanTitle = (v: string | undefined | null) => (v ?? '').trim().slice(0, 200);

export function truthy(v: string | undefined | null): boolean {
  return /^(yes|true|1|y)$/i.test((v ?? '').trim());
}

/** Drops empty optional fields so rows stay small on the wire. */
export function compact(row: ImportRow): ImportRow {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row))
    if (v !== undefined && v !== '' && !(k === 'rewatch' && v === false)) out[k] = v;
  return out as unknown as ImportRow;
}

export function capRows(rows: ImportRow[]): ImportRow[] {
  if (rows.length > MAX_IMPORT_ROWS) throw new ImportError('too_many_rows');
  return rows;
}
