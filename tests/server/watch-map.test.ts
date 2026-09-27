/**
 * W-02 (ADR-012 §1–2): `mapTmdbWatch` against the recorded-shape TMDB fixture. Pins the
 * `"watch/providers"` append key and shape, and our derived TMDB watch URL against the upstream `link`.
 */
import { describe, expect, it } from 'vitest';
import { enrichmentAppends } from '@/server/jobs/enrich';
import {
  WATCH_TYPE_CAP,
  linkMismatches,
  mapTmdbWatch,
  mapWatchProviders,
  regionsWithNone,
  watchProvidersOf,
} from '@/server/jobs/watch-map';
import fixture from './fixtures/tmdb-watch-providers.json';

const REGIONS = ['US', 'GB', 'IN'];

describe('recorded fixture pins the append key and shape', () => {
  it('the enrich call appends watch/providers and the body carries that literal key', () => {
    expect(enrichmentAppends('movie').split(',')).toContain('watch/providers');
    expect(enrichmentAppends('tv').split(',')).toContain('watch/providers');
    expect(enrichmentAppends('movie').split(',')).toHaveLength(6);
    expect(Object.keys(fixture)).toContain('watch/providers');
    const wp = fixture['watch/providers'];
    expect(wp.id).toBe(550);
    expect(Object.keys(wp.results.US)).toEqual(
      expect.arrayContaining(['link', 'flatrate', 'rent', 'buy']),
    );
    expect(Object.keys(wp.results.US.flatrate[0]!).sort()).toEqual([
      'display_priority',
      'logo_path',
      'provider_id',
      'provider_name',
    ]);
  });

  it('every upstream link equals our derived tmdbWatchHref (0 mismatches)', () => {
    expect(linkMismatches(fixture['watch/providers'], 'movie', 550, ['US', 'GB', 'IN', 'DE'])).toBe(
      0,
    );
    expect(linkMismatches(fixture['watch/providers'], 'movie', 551, REGIONS)).toBe(3);
  });
});

describe('mapTmdbWatch', () => {
  const mapped = mapTmdbWatch(fixture, REGIONS)!;

  it('keeps supported regions only; maps flatrate/free/ads/rent/buy → s/f/a/r/b', () => {
    expect(Object.keys(mapped.watch).sort()).toEqual(['GB', 'US']);
    expect(mapped.watch.GB).toEqual({ s: [8], f: [38] });
  });

  it('dedupes by id (lowest priority wins), sorts by priority then id, drops bad ids + unknown types', () => {
    expect(mapped.watch.US).toEqual({ s: [337, 8], a: [73], r: [2, 3], b: [2, 10, 3] });
  });

  it('a region whose lists are all empty is omitted ("none in IN")', () => {
    expect(mapped.watch.IN).toBeUndefined();
    expect(regionsWithNone(mapped.watch, REGIONS)).toBe(1);
  });

  it('side output: names + logos, a bad logo path becomes null', () => {
    expect(mapped.providers.map((p) => p.provider_id)).toEqual([2, 3, 8, 10, 38, 73, 337]);
    expect(mapped.providers.find((p) => p.provider_id === 73)).toEqual({
      provider_id: 73,
      name: 'Tubi TV',
      logo_path: null,
    });
    expect(mapped.providers.find((p) => p.provider_id === 8)?.logo_path).toBe(
      '/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg',
    );
    expect(mapped.providers.some((p) => p.provider_id === 999)).toBe(false);
  });

  it('missing / malformed append → null (not fetched: stored data untouched), never "no providers"', () => {
    const rest: Record<string, unknown> = { ...fixture };
    delete rest['watch/providers'];
    expect(mapTmdbWatch(rest, REGIONS)).toBeNull();
    expect(mapTmdbWatch({ ...rest, 'watch/providers': 'x' }, REGIONS)).toBeNull();
    expect(mapTmdbWatch({ ...rest, 'watch/providers': { id: 1 } }, REGIONS)).toBeNull();
    expect(mapTmdbWatch(null, REGIONS)).toBeNull();
    expect(mapTmdbWatch([], REGIONS)).toBeNull();
  });

  it('tolerates the nested form body.watch.providers', () => {
    const nested = { watch: { providers: fixture['watch/providers'] } };
    expect(watchProvidersOf(nested)).toBe(fixture['watch/providers']);
    expect(mapTmdbWatch(nested, REGIONS)?.watch).toEqual(mapped.watch);
  });

  it('an empty results object is a successful fetch with no providers anywhere', () => {
    expect(mapWatchProviders({ id: 1, results: {} }, REGIONS)).toEqual({
      watch: {},
      providers: [],
    });
  });

  it('caps each list at 30, trims names to 80 chars, lower-case region keys are accepted', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      provider_id: i + 1,
      provider_name: `${'n'.repeat(90)}${i}`,
      display_priority: 40 - i,
      logo_path: null,
    }));
    const m = mapWatchProviders({ results: { us: { buy: many } } }, REGIONS)!;
    expect(m.watch.US?.b).toHaveLength(WATCH_TYPE_CAP);
    expect(m.watch.US?.b?.[0]).toBe(40);
    expect(m.providers.every((p) => p.name.length <= 80)).toBe(true);
  });

  it('missing display_priority sorts last; non-object items are ignored', () => {
    const m = mapWatchProviders(
      {
        results: {
          US: {
            flatrate: [
              { provider_id: 5, provider_name: 'A' },
              null,
              'x',
              { provider_id: 6, provider_name: 'B', display_priority: 9 },
            ],
          },
        },
      },
      REGIONS,
    )!;
    expect(m.watch.US).toEqual({ s: [6, 5] });
  });
});
