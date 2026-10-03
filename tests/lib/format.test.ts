import { describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog } from '@/fixtures/schema';
import {
  formatCount,
  formatScore,
  seasonLabel,
  ticketAccessibleName,
  titleScores,
} from '@/lib/format';
import { imdbTitleHref } from '@/lib/routes';

const catalog = catalogJson as unknown as FixtureCatalog;

describe('format', () => {
  it('formats scores with one decimal', () => {
    expect(formatScore(8)).toBe('8.0');
    expect(formatScore(8.25)).toBe('8.3');
    expect(formatScore(6.5)).toBe('6.5');
  });

  it('formats compact counts', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(950)).toBe('950');
    expect(formatCount(6912)).toBe('6.9k');
    expect(formatCount(10_000)).toBe('10k');
    expect(formatCount(684_400)).toBe('684k');
    expect(formatCount(999_600)).toBe('1M');
    expect(formatCount(1_250_000)).toBe('1.3M');
    expect(formatCount(3_000_000)).toBe('3M');
  });

  it('always shows TMDB; shows IMDb only when the rating is known (ADR-008)', () => {
    const base = { voteAverage: 8.2, voteCount: 6900, imdbRating: null, imdbVotes: null };
    expect(titleScores(base).map((s) => s.source)).toEqual(['tmdb']);
    const both = titleScores({ ...base, imdbRating: 8.5, imdbVotes: 684_000 });
    expect(both.map((s) => `${s.label} ${s.value}`)).toEqual(['TMDB 8.2', 'IMDb 8.5']);
    expect(both[1]!.ariaLabel).toBe('Rated 8.5 on IMDb, 684k votes');
    // Never render 0 as a rating.
    expect(titleScores({ ...base, imdbRating: 0 }).map((s) => s.source)).toEqual(['tmdb']);
  });

  it('links to IMDb title pages only for valid ids', () => {
    expect(imdbTitleHref('tt15239678')).toBe('https://www.imdb.com/title/tt15239678/');
    expect(imdbTitleHref(null)).toBeNull();
    expect(imdbTitleHref('nm0000123')).toBeNull();
  });
});

describe('v1.6 format helpers (ADR-013)', () => {
  it('seasonLabel pads to two digits and hides the whole-show case', () => {
    expect(seasonLabel(3)).toBe('S03');
    expect(seasonLabel(12)).toBe('S12');
    expect(seasonLabel(120)).toBe('S120');
    expect(seasonLabel(null)).toBe('');
    expect(seasonLabel(0)).toBe('');
  });

  it('ticketAccessibleName appends the watch hint only when present', () => {
    const t = { title: 'Dune', mediaType: 'movie' as const, year: 2024, voteAverage: 8.2 };
    expect(ticketAccessibleName({ ...t, imdbRating: null })).toBe(
      'Dune, movie, 2024, rated 8.2 on TMDB',
    );
    expect(
      ticketAccessibleName({
        ...t,
        imdbRating: 8.5,
        watchHint: { providerId: 8, name: 'Netflix', logoPath: null, monogram: 'N', tile: null },
      }),
    ).toBe('Dune, movie, 2024, rated 8.2 on TMDB and 8.5 on IMDb, on Netflix');
    expect(ticketAccessibleName({ ...t, imdbRating: null, watchHint: null })).toBe(
      'Dune, movie, 2024, rated 8.2 on TMDB',
    );
  });
});

describe('fixture IMDb data (ADR-008)', () => {
  it('every title with an imdbId carries a real IMDb rating and vote count', () => {
    for (const t of catalog.titles) {
      if (t.imdbId === null) {
        expect(t.imdbRating, t.key).toBeNull();
        continue;
      }
      expect(t.imdbId, t.key).toMatch(/^tt\d{7,10}$/);
      expect(t.imdbRating, t.key).not.toBeNull();
      expect(t.imdbRating!, t.key).toBeGreaterThanOrEqual(1);
      expect(t.imdbRating!, t.key).toBeLessThanOrEqual(10);
      expect(Math.round(t.imdbRating! * 10) / 10, t.key).toBe(t.imdbRating);
      expect(t.imdbVotes, t.key).toBeGreaterThan(1000);
    }
  });

  it('keeps exactly one title without an IMDb id (hidden-chip edge case)', () => {
    expect(catalog.titles.filter((t) => t.imdbId === null).map((t) => t.key)).toEqual(['tv:82728']);
  });

  it('imdb ids are unique', () => {
    const ids = catalog.titles.flatMap((t) => (t.imdbId ? [t.imdbId] : []));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
