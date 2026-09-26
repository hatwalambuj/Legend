// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WalletStub } from './WalletStub';
import { makeTitle } from './test-utils';

afterEach(cleanup);

describe('WalletStub (GAP-02, ADR-008)', () => {
  it('prints a labelled TMDB score and the IMDb chip, both in the accessible name', () => {
    render(
      <WalletStub item={{ title: makeTitle(), count: 3, lastWatchedOn: '2026-07-19' }} index={0} />,
    );
    const stub = screen.getByTestId('wallet-stub');
    expect(within(stub).getByTestId('tmdb-rating').textContent).toBe('TMDB 8.2');
    expect(within(stub).getByTestId('imdb-rating').textContent).toBe('IMDb8.5');
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, stubbed 3 times, last Jul 19, 2026, rated 8.2 on TMDB and 8.5 on IMDb',
      }),
    ).toBeTruthy();
  });

  it('hides the IMDb chip when the rating is unknown', () => {
    render(
      <WalletStub
        item={{
          title: makeTitle({ imdbRating: null, imdbVotes: null }),
          count: 1,
          lastWatchedOn: '2026-07-19',
        }}
        index={0}
      />,
    );
    expect(screen.queryByTestId('imdb-rating')).toBeNull();
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, stubbed 1 time, last Jul 19, 2026, rated 8.2 on TMDB',
      }),
    ).toBeTruthy();
    expect(screen.queryByText(/IMDb|N\/A/)).toBeNull();
  });
});
