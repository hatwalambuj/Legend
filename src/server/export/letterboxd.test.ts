import { describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog } from '@/fixtures/schema';
import type { DiaryEntry, PublicProfile, ReviewWithTitle, TitleKey } from '@/lib/types';
import { toSummary } from '@/server/repositories/memory/catalog';
import { buildJsonExport, buildLetterboxdCsv, csvCell, drain } from './letterboxd';

const catalog = catalogJson as unknown as FixtureCatalog;
const title = (key: string) =>
  toSummary(
    catalog.titles.find((t) => t.key === key)!,
    true,
  );
const author: PublicProfile = {
  id: 'u',
  handle: 'maya',
  displayName: 'Maya',
  bio: '',
  avatarUrl: null,
  createdAt: '2020-01-01T00:00:00Z',
};

let n = 0;
const stub = (key: string, watchedOn: string): DiaryEntry => ({
  id: `s${++n}`,
  userId: 'u',
  titleKey: key as TitleKey,
  watchedOn,
  watchedWhere: null,
  note: '',
  number: 1,
  createdAt: `${watchedOn}T20:00:00Z`,
  updatedAt: `${watchedOn}T20:00:00Z`,
  title: title(key),
});
const review = (key: string, rating10: number, body: string): ReviewWithTitle => ({
  id: `r-${key}`,
  titleKey: key as TitleKey,
  author,
  rating10,
  body,
  isSpoiler: false,
  stubId: null,
  stubNumber: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  editedAt: null,
  title: title(key),
});

describe('Letterboxd CSV (ADR-004 §5)', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
  });

  it('one row per stub, oldest first; Rewatch after the first; review on the latest stub', () => {
    const csv = buildLetterboxdCsv(
      [
        stub('movie:693134', '2026-09-12'),
        stub('movie:693134', '2026-03-02'),
        stub('tv:2316', '2026-01-01'),
        stub('movie:238', '2025-05-05'),
      ],
      [
        review('movie:693134', 9, 'Sand, "spice"\nand more'),
        review('tv:2316', 10, 'tv'),
        review('movie:129', 8, 'no stub'),
      ],
    );
    const rows = csv.split('\r\n');
    expect(rows[0]).toBe('tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review');
    expect(rows[1]).toBe('238,tt0068646,The Godfather,1972,,2025-05-05,false,');
    expect(rows[2]).toBe('693134,tt15239678,Dune: Part Two,2024,,2026-03-02,false,');
    expect(rows[3]).toBe(
      '693134,tt15239678,Dune: Part Two,2024,9,2026-09-12,true,"Sand, ""spice""\nand more"',
    );
    expect(csv).not.toContain(',tv\r\n'); // TV is not a Letterboxd film (ids overlap)
    expect(csv).toMatch(/129,tt\d+,Spirited Away,2001,8,,false,no stub\r\n$/);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('JSON export carries everything, chronological stubs', () => {
    const j = buildJsonExport({
      exportedAt: 'now',
      profile: author,
      stubs: [stub('tv:2316', '2026-02-01'), stub('tv:2316', '2026-01-01')],
      reviews: [review('tv:2316', 10, 'x')],
      watchlist: [title('movie:238')],
    });
    expect(j.stubs.map((s) => s.watchedOn)).toEqual(['2026-01-01', '2026-02-01']);
    expect(j.stubs[0]!.title.key).toBe('tv:2316');
    expect(j.reviews[0]).toMatchObject({ rating10: 10, title: { key: 'tv:2316' } });
    expect(j.watchlist[0]!.key).toBe('movie:238');
    expect(JSON.stringify(j)).not.toContain('userId');
  });

  it('drain follows cursors and stops on repeats', async () => {
    const pages: Record<string, { items: number[]; nextCursor: string | null }> = {
      start: { items: [1, 2], nextCursor: 'a' },
      a: { items: [3], nextCursor: 'a' },
    };
    expect(await drain(async (c) => pages[c ?? 'start']!)).toEqual([1, 2, 3]);
  });
});
