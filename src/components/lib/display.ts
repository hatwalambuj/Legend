/**
 * Small, pure display helpers used by several components (dates, serials, initials, avatars).
 * Deterministic on server and client (UTC formatting) so SSR and hydration always agree.
 */
import { BRAND_NAME } from '@/lib/brand';
import type { MediaType, TitleSummary, WatchedWhere } from '@/lib/types';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function toDate(iso: string): Date {
  // Accept both 'YYYY-MM-DD' and full ISO timestamps.
  return new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
}

/** "Sep 12, 2026" */
export function formatDate(iso: string): string {
  return DATE_FMT.format(toDate(iso));
}

/** "September 2026" */
export function formatMonth(isoMonthOrDate: string): string {
  return MONTH_FMT.format(toDate(`${isoMonthOrDate.slice(0, 7)}-15`));
}

/** "Sat" */
export function formatWeekday(iso: string): string {
  return WEEKDAY_FMT.format(toDate(iso));
}

export function kindLabel(t: MediaType): 'Movie' | 'Show' {
  return t === 'movie' ? 'Movie' : 'Show';
}

/** Decorative ticket serial derived from the title id (DESIGN §3.1): stable, 5 digits. */
export function ticketSerial(tmdbId: number): string {
  return String((tmdbId * 7919 + 1200) % 100000).padStart(5, '0');
}

/** Movie stubs print "ADMIT ONE"; show stubs print the season range "S01–S04" (DESIGN §3.1). */
export function stubPrint(t: Pick<TitleSummary, 'mediaType' | 'seasonCount'>): string {
  if (t.mediaType === 'tv' && t.seasonCount && t.seasonCount > 0) {
    return t.seasonCount === 1 ? 'S01' : `S01–S${String(t.seasonCount).padStart(2, '0')}`;
  }
  return 'ADMIT ONE';
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Two gradient colours hashed from a handle (DESIGN §6 Avatar). Bright enough for ink initials. */
export function avatarColors(handle: string): [string, string] {
  const h = hash(handle);
  const a = h % 360;
  const b = (a + 60 + ((h >> 9) % 120)) % 360;
  return [`hsl(${a} 85% 64%)`, `hsl(${b} 80% 62%)`];
}

export const WHERE_OPTIONS: { value: WatchedWhere; label: string }[] = [
  { value: 'cinema', label: 'Cinema' },
  { value: 'streaming', label: 'Streaming' },
  { value: 'tv', label: 'TV' },
  { value: 'other', label: 'Other' },
];

export function whereLabel(w: WatchedWhere | null): string {
  return WHERE_OPTIONS.find((o) => o.value === w)?.label ?? '';
}

/** "★★★★½" for a 1..10 rating. */
export function starsText(rating10: number): string {
  const full = Math.floor(rating10 / 2);
  return '★'.repeat(full) + (rating10 % 2 ? '½' : '');
}

export function starsLabel(rating10: number): string {
  const v = rating10 / 2;
  return `${v} out of 5 stars`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The story PNG file name "{brand}-stub-{n}.png" (ADR-013 C-08; the route and the share action agree). */
export function storyFileName(n: number): string {
  const brand =
    BRAND_NAME.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'stub';
  return `${brand}-stub-${n}.png`;
}
