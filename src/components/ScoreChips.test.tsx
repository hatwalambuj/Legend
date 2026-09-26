// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScoreChips } from './ScoreChips';
import { makeTitle } from './test-utils';

afterEach(cleanup);

describe('ScoreChips (ADR-008)', () => {
  it('shows TMDB and IMDb with votes, source label and a read-only IMDb link', () => {
    render(
      <ScoreChips
        title={makeTitle()}
        stats={{ stubCount: 9, reviewCount: 3, ratingAvg10: null, ratingCount: 3 }}
      />,
    );
    expect(screen.getByTestId('tmdb-rating').textContent).toContain('6.9k votes');
    const imdb = screen.getByTestId('imdb-rating');
    expect(imdb.textContent).toContain('8.5');
    expect(imdb.textContent).toContain('IMDb rating · via OMDb');
    expect(imdb.textContent).toContain('684k votes');
    expect(screen.getByRole('link', { name: /Open on IMDb/ }).getAttribute('href')).toBe(
      'https://www.imdb.com/title/tt15239678/',
    );
    expect(screen.getByTestId('stubbed-rating').textContent).toContain(
      'ratings · average unlocks at 5',
    );
  });

  it('hides the IMDb chip when unknown and shows the Stubbed average once unlocked', () => {
    render(
      <ScoreChips
        title={makeTitle({ imdbRating: null, imdbVotes: null, imdbId: null })}
        stats={{ stubCount: 9, reviewCount: 5, ratingAvg10: 8.4, ratingCount: 5 }}
      />,
    );
    expect(screen.queryByTestId('imdb-rating')).toBeNull();
    expect(screen.getByTestId('stubbed-rating').textContent).toContain('8.4');
    expect(screen.getByTestId('stubbed-rating').textContent).toContain('5 ratings');
  });

  it('hides the Stubbed chip when nobody has rated yet (PRD A8-AC1)', () => {
    render(
      <ScoreChips
        title={makeTitle()}
        stats={{ stubCount: 2, reviewCount: 0, ratingAvg10: null, ratingCount: 0 }}
      />,
    );
    expect(screen.queryByTestId('stubbed-rating')).toBeNull();
  });
});
