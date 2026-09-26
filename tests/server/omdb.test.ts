import { describe, expect, it } from 'vitest';
import { OmdbLimitError, OmdbRatingProvider, parseOmdbRating } from '@/server/providers/omdb';

describe('OMDb parsing (ADR-008)', () => {
  it('parses rating and comma-grouped votes', () => {
    expect(
      parseOmdbRating({ Response: 'True', imdbRating: '8.5', imdbVotes: '684,123' }),
    ).toEqual({ rating: 8.5, votes: 684123 });
  });
  it('maps N/A to a null rating (chip hidden)', () => {
    expect(parseOmdbRating({ Response: 'True', imdbRating: 'N/A', imdbVotes: 'N/A' })).toEqual({
      rating: null,
      votes: null,
    });
  });
  it('unknown ids → null; quota/key errors → OmdbLimitError', () => {
    expect(parseOmdbRating({ Response: 'False', Error: 'Incorrect IMDb ID.' })).toBeNull();
    expect(() => parseOmdbRating({ Response: 'False', Error: 'Request limit reached!' })).toThrow(
      OmdbLimitError,
    );
    expect(() => parseOmdbRating({ Response: 'False', Error: 'Invalid API key!' })).toThrow(
      OmdbLimitError,
    );
  });
  it('calls the API with the id and key, and stops on 401', async () => {
    const calls: string[] = [];
    const ok = new OmdbRatingProvider('KEY', async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ Response: 'True', imdbRating: '9.0', imdbVotes: '1' }));
    });
    expect(await ok.getImdbRating('tt0468569')).toEqual({ rating: 9, votes: 1 });
    expect(calls[0]).toContain('i=tt0468569');
    expect(calls[0]).toContain('apikey=KEY');
    expect(await ok.getImdbRating('not-an-id')).toBeNull();
    expect(calls).toHaveLength(1);

    const limited = new OmdbRatingProvider(
      'KEY',
      async () =>
        new Response(JSON.stringify({ Response: 'False', Error: 'Request limit reached!' }), {
          status: 401,
        }),
    );
    await expect(limited.getImdbRating('tt0468569')).rejects.toThrow(OmdbLimitError);
  });
});
