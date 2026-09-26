/**
 * The user's own data export (ADR-004 §5, API_CONTRACT §5.16). Pure functions, unit-tested.
 * This is a download for the user, never a post to a third party (ADR-008).
 *
 * Letterboxd CSV: `tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`, RFC 4180 quoting, CRLF.
 * - One row per stub, oldest first. Rewatch=true for every stub after the first of its title.
 * - The rating + review go on the most recent stub of the title.
 * - A reviewed title without any stub gets one row with an empty WatchedDate (Letterboxd imports it as
 *   a rating/review), so no user data is silently dropped.
 * - Movies only: Letterboxd is a film service and matches rows by TMDB *movie* id, and TMDB movie and
 *   TV ids overlap (tv:1396 is not movie:1396). TV stubs are in the JSON export.
 */
import type { DiaryEntry, PublicProfile, ReviewWithTitle, Stub, TitleSummary } from '@/lib/types';

export const LETTERBOXD_COLUMNS = [
  'tmdbID',
  'imdbID',
  'Title',
  'Year',
  'Rating10',
  'WatchedDate',
  'Rewatch',
  'Review',
] as const;

/** RFC 4180: quote when the value contains a comma, quote, CR or LF; double embedded quotes. */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: (string | number | boolean | null | undefined)[]): string {
  return values.map(csvCell).join(',');
}

const chrono = (a: Stub, b: Stub) =>
  a.watchedOn !== b.watchedOn
    ? a.watchedOn < b.watchedOn
      ? -1
      : 1
    : a.createdAt !== b.createdAt
      ? a.createdAt < b.createdAt
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : 1;

export function buildLetterboxdCsv(stubs: DiaryEntry[], reviews: ReviewWithTitle[]): string {
  const movieStubs = stubs.filter((s) => s.title.mediaType === 'movie').sort(chrono);
  const reviewByKey = new Map(
    reviews.filter((r) => r.title.mediaType === 'movie').map((r) => [r.titleKey, r]),
  );
  const lastStubId = new Map<string, string>();
  for (const s of movieStubs) lastStubId.set(s.titleKey, s.id); // sorted ascending → last wins
  const seen = new Set<string>();
  const lines: string[] = [csvRow([...LETTERBOXD_COLUMNS])];

  const row = (
    t: TitleSummary,
    watchedOn: string,
    rewatch: boolean,
    review: ReviewWithTitle | undefined,
  ) =>
    csvRow([
      t.tmdbId,
      t.imdbId ?? '',
      t.title,
      t.year || '',
      review?.rating10 ?? '',
      watchedOn,
      rewatch ? 'true' : 'false',
      review?.body ?? '',
    ]);

  for (const s of movieStubs) {
    const review = lastStubId.get(s.titleKey) === s.id ? reviewByKey.get(s.titleKey) : undefined;
    lines.push(row(s.title, s.watchedOn, seen.has(s.titleKey), review));
    seen.add(s.titleKey);
  }
  for (const r of [...reviewByKey.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)))
    if (!seen.has(r.titleKey)) lines.push(row(r.title, '', false, r));

  return `${lines.join('\r\n')}\r\n`;
}

const titleRef = (t: TitleSummary) => ({
  key: t.key,
  mediaType: t.mediaType,
  tmdbId: t.tmdbId,
  imdbId: t.imdbId,
  title: t.title,
  year: t.year,
});

export interface JsonExport {
  exportedAt: string;
  profile: PublicProfile;
  stubs: (Omit<Stub, 'userId'> & { title: ReturnType<typeof titleRef> })[];
  reviews: {
    id: string;
    title: ReturnType<typeof titleRef>;
    rating10: number;
    body: string;
    isSpoiler: boolean;
    stubId: string | null;
    createdAt: string;
    updatedAt: string;
    editedAt: string | null;
  }[];
  watchlist: ReturnType<typeof titleRef>[];
}

export function buildJsonExport(input: {
  exportedAt: string;
  profile: PublicProfile;
  stubs: DiaryEntry[];
  reviews: ReviewWithTitle[];
  watchlist: TitleSummary[];
}): JsonExport {
  return {
    exportedAt: input.exportedAt,
    profile: input.profile,
    stubs: [...input.stubs].sort(chrono).map((s) => ({
      id: s.id,
      titleKey: s.titleKey,
      watchedOn: s.watchedOn,
      watchedWhere: s.watchedWhere,
      note: s.note,
      number: s.number,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      title: titleRef(s.title),
    })),
    reviews: input.reviews.map((r) => ({
      id: r.id,
      title: titleRef(r.title),
      rating10: r.rating10,
      body: r.body,
      isSpoiler: r.isSpoiler,
      stubId: r.stubId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      editedAt: r.editedAt,
    })),
    watchlist: input.watchlist.map(titleRef),
  };
}

/** Drain a keyset-paginated source (bounded, so a bug can never loop forever). */
export async function drain<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  maxPages = 2000,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.items);
    if (!page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  return out;
}
