// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StubTarget } from '@/hooks/useApp';
import { DEGRADED_COPY, DEGRADED_DESC_ID, DegradedBanner } from './DegradedBanner';
import { Reviews } from './Reviews';
import { renderWithApp } from './test-utils';
import { TitleActions } from './TitleActions';

afterEach(cleanup);

const target: StubTarget = {
  key: 'movie:693134',
  mediaType: 'movie',
  tmdbId: 693134,
  title: 'Dune: Part Two',
  year: 2024,
};

describe('DegradedBanner (M1-06, ADR-011 §4)', () => {
  it('renders nothing when the page is not degraded', () => {
    const { container } = render(<DegradedBanner degraded={null} />);
    expect(container.innerHTML).toBe('');
    render(<DegradedBanner degraded={undefined} />);
    expect(screen.queryByTestId('degraded-banner')).toBeNull();
  });

  it('shows the catalog copy with the shared description id', () => {
    render(<DegradedBanner degraded="catalog" />);
    const banner = screen.getByTestId('degraded-banner');
    expect(banner.textContent).toBe(DEGRADED_COPY.catalog);
    expect(document.getElementById(DEGRADED_DESC_ID)?.textContent).toBe(DEGRADED_COPY.catalog);
  });

  it('shows the community copy without pausing anything', () => {
    render(<DegradedBanner degraded="community" />);
    expect(screen.getByTestId('degraded-banner').textContent).toBe(
      'Community stats are taking a break.',
    );
    expect(document.getElementById(DEGRADED_DESC_ID)).toBeNull();
  });
});

describe('paused CTAs when degraded === "catalog"', () => {
  it('marks Stub, details and Watchlist aria-disabled and ignores clicks', () => {
    const { value } = renderWithApp(
      <>
        <DegradedBanner degraded="catalog" />
        <TitleActions target={target} paused />
      </>,
    );
    const buttons = [
      screen.getByTestId('stub-button'),
      screen.getByTestId('stub-details'),
      screen.getByTestId('watchlist-button'),
    ];
    for (const b of buttons) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
      expect(b.getAttribute('aria-describedby')).toBe(DEGRADED_DESC_ID);
      fireEvent.click(b);
    }
    expect(value.stub).not.toHaveBeenCalled();
    expect(value.openStubSheet).not.toHaveBeenCalled();
    expect(value.toggleWatchlist).not.toHaveBeenCalled();
  });

  it('keeps CTAs live when not paused', () => {
    const { value } = renderWithApp(<TitleActions target={target} />);
    const stub = screen.getByTestId('stub-button');
    expect(stub.getAttribute('aria-disabled')).toBeNull();
    fireEvent.click(stub);
    expect(value.stub).toHaveBeenCalledTimes(1);
  });

  it('replaces the review composer with a paused, aria-disabled Review button', () => {
    const { value } = renderWithApp(
      <Reviews
        target={target}
        initial={{ items: [], nextCursor: null }}
        tmdbReviews={[]}
        reviewCount={0}
        paused
      />,
      { session: { user: { handle: 'maya' } } as never },
    );
    expect(screen.getByText('Reviews are paused')).toBeTruthy();
    const write = screen.getByRole('button', { name: 'Write a review' });
    expect(write.getAttribute('aria-disabled')).toBe('true');
    expect(write.getAttribute('aria-describedby')).toBe(DEGRADED_DESC_ID);
    const first = screen.getByRole('button', { name: /Be the first to review/ });
    expect(first.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(first);
    expect(value.openAuth).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
