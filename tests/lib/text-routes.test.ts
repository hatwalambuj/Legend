import { describe, expect, it } from 'vitest';
import { parseTitleKey, toTitleKey } from '@/lib/keys';
import { browseHref, parseTitleSlug, safeNext, titleHref } from '@/lib/routes';
import { normalizeSearch, slugify } from '@/lib/text';

describe('text + routes', () => {
  it('normalises accents, case and punctuation', () => {
    expect(normalizeSearch('Shōgun')).toBe('shogun');
    expect(normalizeSearch('  AMÉLIE!! ')).toBe('amelie');
    expect(slugify('Dune: Part Two')).toBe('dune-part-two');
    expect(slugify('君の名は。')).toBe('君の名は');
  });
  it('builds and parses title URLs and keys', () => {
    expect(titleHref({ mediaType: 'movie', tmdbId: 693134, slug: 'dune-part-two' })).toBe(
      '/title/movie/693134-dune-part-two',
    );
    expect(parseTitleSlug('693134-dune-part-two')).toEqual({
      tmdbId: 693134,
      slug: 'dune-part-two',
    });
    expect(parseTitleSlug('abc')).toBeNull();
    expect(parseTitleKey(toTitleKey('tv', 1396))).toEqual({ mediaType: 'tv', tmdbId: 1396 });
    expect(parseTitleKey('tv:0')).toBeNull();
  });
  it('normalises browse URLs (defaults dropped) and guards redirects', () => {
    expect(browseHref({ type: 'all', sort: 'release_desc' })).toBe('/browse');
    expect(browseHref({ type: 'tv', sort: 'rating_desc' })).toBe(
      '/browse?type=tv&sort=rating_desc',
    );
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext('/title/movie/1-x?action=stub')).toBe('/title/movie/1-x?action=stub');
  });
});
