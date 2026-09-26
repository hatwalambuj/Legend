import { describe, expect, it } from 'vitest';
import { enrichmentAppends, mapSeriesStatus, mapTmdbEnrichment } from '@/server/jobs/enrich';
import { refreshImdbRatings, type ImdbSaveRow } from '@/server/jobs/imdb-refresh';
import { OmdbLimitError } from '@/server/providers/omdb';

describe('enrich mapping (PRD §4.2)', () => {
  it('maps a TMDB movie detail response', () => {
    const row = mapTmdbEnrichment(7, 'movie', 693134, {
      runtime: 166,
      tagline: 'Long live the fighters.',
      external_ids: { imdb_id: 'tt15239678' },
      keywords: {
        keywords: [
          { id: 1, name: 'Desert Planet' },
          { id: 2, name: 'epic' },
        ],
      },
      release_dates: {
        results: [
          { iso_3166_1: 'GB', release_dates: [{ type: 3, certification: '12A' }] },
          {
            iso_3166_1: 'US',
            release_dates: [
              { type: 1, certification: '' },
              { type: 3, certification: 'PG-13' },
            ],
          },
        ],
      },
      recommendations: { results: [{ id: 438631, media_type: 'movie' }, { id: 693134 }] },
      similar: { results: [{ id: 438631 }, { id: 335984 }] },
    });
    expect(row).toEqual({
      id: 7,
      imdb_id: 'tt15239678',
      runtime_minutes: 166,
      season_count: null,
      episode_count: null,
      episode_runtime: null,
      series_status: null,
      tagline: 'Long live the fighters.',
      certification: 'PG-13',
      keywords: ['desert planet', 'epic'],
      recommendation_keys: ['movie:438631', 'movie:335984'],
    });
    expect(enrichmentAppends('movie')).toContain('release_dates');
  });

  it('maps a TMDB TV detail response, falling back to the last episode runtime', () => {
    const row = mapTmdbEnrichment(8, 'tv', 136315, {
      number_of_seasons: 4,
      number_of_episodes: 38,
      episode_run_time: [],
      last_episode_to_air: { runtime: 31 },
      status: 'Returning Series',
      type: 'Scripted',
      external_ids: { imdb_id: 'tt14452776' },
      keywords: { results: [{ name: 'chef' }] },
      content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
    });
    expect(row).toMatchObject({
      season_count: 4,
      episode_count: 38,
      episode_runtime: 31,
      series_status: 'returning',
      certification: 'TV-MA',
      keywords: ['chef'],
      runtime_minutes: null,
    });
    expect(mapSeriesStatus('Ended', 'Miniseries')).toBe('limited');
    expect(mapTmdbEnrichment(1, 'tv', 1, {}).episode_runtime).toBeNull();
  });
});

describe('IMDb refresh orchestration (ADR-008)', () => {
  const due = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      imdb_id: `tt${String(i + 1).padStart(7, '0')}`,
    }));

  it('looks up at most the budget and saves ratings, N/A and unknown ids as checked', async () => {
    const saved: ImdbSaveRow[] = [];
    let asked = 0;
    const res = await refreshImdbRatings(
      {
        due: async (limit) => {
          asked = limit;
          return due(3);
        },
        lookup: async (id) =>
          id.endsWith('1')
            ? { rating: 8.5, votes: 10 }
            : id.endsWith('2')
              ? { rating: null, votes: null }
              : null,
        save: async (rows) => void saved.push(...rows),
      },
      900,
      { batchSize: 2 },
    );
    expect(asked).toBe(900);
    expect(res).toMatchObject({ requested: 3, looked_up: 3, rated: 1, no_rating: 2, errors: 0 });
    expect(saved.sort((a, b) => a.id - b.id)).toEqual([
      { id: 1, rating: 8.5, votes: 10 },
      { id: 2, rating: null, votes: null },
      { id: 3, rating: null, votes: null },
    ]);
  });

  it('stops on the OMDb daily limit and keeps what it already fetched', async () => {
    const saved: ImdbSaveRow[] = [];
    let calls = 0;
    const res = await refreshImdbRatings(
      {
        due: async () => due(10),
        lookup: async () => {
          if (++calls > 2) throw new OmdbLimitError('Request limit reached!');
          return { rating: 7, votes: 1 };
        },
        save: async (rows) => void saved.push(...rows),
      },
      10,
      { concurrency: 1 },
    );
    expect(res.stopped_by_limit).toBe(true);
    expect(saved).toHaveLength(2);
  });

  it('skips transient errors (row stays due) and does nothing with a zero budget', async () => {
    const res = await refreshImdbRatings(
      {
        due: async () => due(2),
        lookup: async () => {
          throw new Error('ECONNRESET');
        },
        save: async () => undefined,
      },
      5,
    );
    expect(res.errors).toBe(2);
    expect(
      (
        await refreshImdbRatings(
          { due: async () => due(1), lookup: async () => null, save: async () => undefined },
          0,
        )
      ).requested,
    ).toBe(0);
  });
});
