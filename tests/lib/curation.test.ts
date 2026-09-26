import { describe, expect, it } from 'vitest';
import { DEFAULT_CURATION_RULE as R, isListed } from '@/lib/curation';

const base = {
  mediaType: 'movie' as const,
  voteAverage: 7,
  voteCount: 1000,
  genreIds: [18],
  releaseDate: '2020-01-01',
};
const today = '2026-09-26';

describe('curation rule (ADR-003)', () => {
  it('includes the inclusive boundaries 6.5 / 200 (movie) and 6.5 / 100 (tv)', () => {
    expect(isListed({ ...base, voteAverage: 6.5, voteCount: 200 }, R, today)).toBe(true);
    expect(isListed({ ...base, mediaType: 'tv', voteAverage: 6.5, voteCount: 100 }, R, today)).toBe(
      true,
    );
  });
  it('excludes 6.4 with many votes and 8.0 with too few', () => {
    expect(isListed({ ...base, voteAverage: 6.4, voteCount: 50_000 }, R, today)).toBe(false);
    expect(isListed({ ...base, voteAverage: 8.0, voteCount: 199 }, R, today)).toBe(false);
    expect(isListed({ ...base, mediaType: 'tv', voteAverage: 8.0, voteCount: 99 }, R, today)).toBe(
      false,
    );
  });
  it('compares at one decimal like numeric(3,1): 6.449 → 6.4 (out), 6.45 → 6.5 (in)', () => {
    expect(isListed({ ...base, voteAverage: 6.449 }, R, today)).toBe(false);
    expect(isListed({ ...base, voteAverage: 6.45 }, R, today)).toBe(true);
  });
  it('excludes talk/news/reality TV, adult, unreleased and undated titles', () => {
    expect(isListed({ ...base, mediaType: 'tv', genreIds: [10764] }, R, today)).toBe(false);
    expect(isListed({ ...base, adult: true }, R, today)).toBe(false);
    expect(isListed({ ...base, releaseDate: '2027-01-01' }, R, today)).toBe(false);
    expect(isListed({ ...base, releaseDate: null }, R, today)).toBe(false);
  });
  it('supports hysteresis via keepRating for previously listed titles', () => {
    const rule = { ...R, keepRating: 6.3 };
    expect(isListed({ ...base, voteAverage: 6.4, wasListed: true }, rule, today)).toBe(true);
    expect(isListed({ ...base, voteAverage: 6.4, wasListed: false }, rule, today)).toBe(false);
  });
});
