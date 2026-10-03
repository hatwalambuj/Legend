/**
 * RFC 4180 CSV parser (ADR-013 C-11): quoted fields, `""` escapes, newlines inside quotes, CRLF/LF/CR,
 * a leading BOM. Pure and client-safe; no network. OWNER: Backend.
 */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === ',') {
      endField();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Lower-cased, trimmed header key ("Watched Date" → "watched date"). */
export const headerKey = (h: string): string => h.trim().toLowerCase().replace(/\s+/g, ' ');

export interface CsvTable {
  headers: string[];
  records: Record<string, string>[];
}

/** First row = headers (normalised with `headerKey`); every record maps header → cell ('' if missing). */
export function csvTable(text: string): CsvTable {
  const [head = [], ...body] = parseCsv(text);
  const headers = head.map(headerKey);
  const records = body.map((cells) => {
    const r: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (h) r[h] = (cells[i] ?? '').trim();
    });
    return r;
  });
  return { headers, records };
}

/** The first alias present in `headers`, or null. */
export function pickHeader(headers: readonly string[], aliases: readonly string[]): string | null {
  for (const a of aliases) if (headers.includes(a)) return a;
  return null;
}
