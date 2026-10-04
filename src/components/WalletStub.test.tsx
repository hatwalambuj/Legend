// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Session, WalletItem } from '@/lib/types';
import { WalletStub } from './WalletStub';
import { makeTitle, renderWithApp } from './test-utils';

vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

const item = (over: Partial<WalletItem> = {}): WalletItem => ({
  title: makeTitle(),
  count: 3,
  lastWatchedOn: '2026-07-19',
  latestStubId: 'stub-9',
  latestSeason: null,
  ...over,
});

const ownerSession = { user: { handle: 'dev' } } as unknown as Session;

describe('WalletStub (GAP-02, ADR-008)', () => {
  it('prints a labelled TMDB score and the IMDb chip, both in the accessible name', () => {
    renderWithApp(<WalletStub item={item()} index={0} />);
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
    renderWithApp(
      <WalletStub
        item={item({ title: makeTitle({ imdbRating: null, imdbVotes: null }), count: 1 })}
        index={0}
      />,
    );
    expect(screen.queryByTestId('imdb-rating')).toBeNull();
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, stubbed 1 time, last Jul 19, 2026, rated 8.2 on TMDB',
      }),
    ).toBeTruthy();
    expect(within(screen.getByTestId('wallet-stub')).queryByText(/IMDb|N\/A/)).toBeNull();
  });
});

describe('WalletStub latest stub (API_CONTRACT v1.6.1, ADR-013 C-07/C-08/C-10)', () => {
  it('prints the season label for a TV season stub, in the accessible name too', () => {
    renderWithApp(
      <WalletStub
        item={item({ title: makeTitle({ mediaType: 'tv', title: 'The Bear' }), latestSeason: 3 })}
        index={0}
      />,
    );
    expect(screen.getByTestId('wallet-season').textContent).toBe('S03');
    expect(screen.getByRole('link', { name: /^The Bear, season 3, stubbed 3 times/ })).toBeTruthy();
  });

  it('hides the season label for the whole show and for a movie', () => {
    renderWithApp(
      <WalletStub
        item={item({ title: makeTitle({ mediaType: 'tv' }), latestSeason: null })}
        index={0}
      />,
    );
    expect(screen.queryByTestId('wallet-season')).toBeNull();
    cleanup();
    renderWithApp(<WalletStub item={item({ latestSeason: 2 })} index={0} />);
    expect(screen.queryByTestId('wallet-season')).toBeNull();
  });

  it('Share stub shares the latest stub link', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithApp(<WalletStub item={item()} index={0} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share stub for Dune: Part Two' }));
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toContain('/share/stub/stub-9');
  });

  it('shows Story image to the owner only', () => {
    renderWithApp(<WalletStub item={item()} index={0} handle="dev" />, { session: null });
    expect(screen.queryByTestId('share-story')).toBeNull();
    cleanup();
    renderWithApp(<WalletStub item={item()} index={0} handle="dev" />, { session: ownerSession });
    expect(screen.getByRole('button', { name: 'Story image for Dune: Part Two' })).toBeTruthy();
    cleanup();
    renderWithApp(<WalletStub item={item()} index={0} />, { session: ownerSession });
    expect(screen.queryByTestId('share-story')).toBeNull();
  });
});
