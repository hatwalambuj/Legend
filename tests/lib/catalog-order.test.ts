import { describe, expect, it } from 'vitest';
import {
  compareTitles,
  decodeCursor,
  encodeCursor,
  paginate,
  SORT_KEYS,
  sortTuple,
} from '@/lib/catalog-order';
import type { TitleSummary } from '@/lib/types';

type S = Pick<
  TitleSummary,
  'key' | 'title' | 'releaseDate' | 'voteAverage' | 'voteCount' | 'popularity'
>;
const t = (
  key: string,
  title: string,
  releaseDate: string,
  voteAverage: number,
  voteCount: number,
  popularity = 1,
): S => ({
  key: key as S['key'],
  title,
  releaseDate,
  voteAverage,
  voteCount,
  popularity,
});

const rows: S[] = [
  t('movie:1', 'Bravo', '2020-01-01', 8.0, 500),
  t('movie:2', 'Alpha', '2020-01-01', 8.0, 900),
  t('tv:3', 'Charlie', '2021-05-05', 7.0, 100, 50),
  t('movie:4', 'Alpha', '2019-01-01', 8.0, 900, 50),
  t('tv:5', 'Échelon', '2018-01-01', 6.5, 100, 9),
];

describe('catalog order', () => {
  it('rating_desc breaks ties by vote count desc, then title, then key (PRD A2-AC4)', () => {
    const sorted = [...rows].sort((a, b) => compareTitles(a, b, 'rating_desc')).map((r) => r.key);
    expect(sorted).toEqual(['movie:2', 'movie:4', 'movie:1', 'tv:3', 'tv:5']);
  });

  it('release_desc / release_asc are exact mirrors on date with stable title tie-break', () => {
    const desc = [...rows].sort((a, b) => compareTitles(a, b, 'release_desc')).map((r) => r.key);
    expect(desc).toEqual(['tv:3', 'movie:2', 'movie:1', 'movie:4', 'tv:5']);
    const asc = [...rows].sort((a, b) => compareTitles(a, b, 'release_asc')).map((r) => r.key);
    expect(asc).toEqual(['tv:5', 'movie:4', 'movie:2', 'movie:1', 'tv:3']);
  });

  it('keyset pagination never skips or duplicates across page boundaries (A2-AC2)', () => {
    for (const sort of SORT_KEYS) {
      const full = paginate(rows, sort, null, 100).items.map((r) => r.key);
      const walked: string[] = [];
      let cursor: string | null = null;
      do {
        const p: { items: S[]; nextCursor: string | null } = paginate(rows, sort, cursor, 2);
        walked.push(...p.items.map((r) => r.key));
        cursor = p.nextCursor;
      } while (cursor);
      expect(walked).toEqual(full);
      expect(new Set(walked).size).toBe(rows.length);
    }
  });

  it('rejects cursors from another sort or garbage', () => {
    const c = encodeCursor('rating_desc', sortTuple(rows[0]!, 'rating_desc'));
    expect(decodeCursor(c, 'rating_desc')).not.toBeNull();
    expect(decodeCursor(c, 'release_desc')).toBeNull();
    expect(decodeCursor('not-base64!!', 'rating_desc')).toBeNull();
    expect(decodeCursor(null, 'rating_desc')).toBeNull();
  });
});
