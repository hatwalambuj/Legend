// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Ticket } from './Ticket';
import { makeTitle, renderWithApp } from './test-utils';

afterEach(cleanup);

describe('Ticket (DESIGN §3, ADR-008)', () => {
  it('prints TMDB score, IMDb chip, time line and an accessible name', () => {
    renderWithApp(<Ticket title={makeTitle()} />);
    const ticket = screen.getByTestId('ticket-movie:693134');
    expect(within(ticket).getByTestId('tmdb-rating').textContent).toBe('8.2TMDB');
    expect(within(ticket).getByTestId('imdb-rating').textContent).toContain('8.5');
    expect(within(ticket).getByTestId('ticket-time').textContent).toBe('2024 · 2H 46M');
    expect(
      screen.getByRole('link', {
        name: 'Dune: Part Two, movie, 2024, rated 8.2 on TMDB and 8.5 on IMDb',
      }),
    ).toHaveProperty('href', expect.stringContaining('/title/movie/693134-dune-part-two'));
    expect(screen.getByText('ADMIT ONE')).toBeTruthy();
  });

  it('hides the IMDb chip when the rating is unknown (never 0)', () => {
    renderWithApp(<Ticket title={makeTitle({ imdbRating: null, imdbVotes: null })} />);
    expect(screen.queryByTestId('imdb-rating')).toBeNull();
    expect(screen.queryByText(/0\.0/)).toBeNull();
  });

  it('prints the season range and TV time line for shows', () => {
    renderWithApp(
      <Ticket
        title={makeTitle({
          key: 'tv:136315',
          mediaType: 'tv',
          tmdbId: 136315,
          title: 'The Bear',
          year: 2022,
          runtimeMinutes: null,
          seasonCount: 4,
          episodeCount: 38,
          episodeRuntimeMinutes: 30,
        })}
      />,
    );
    expect(screen.getByTestId('ticket-time').textContent).toBe('2022 · 4 SEASONS · ≈19H');
    expect(screen.getByText('S01–S04')).toBeTruthy();
  });

  it('renders the generated poster (never a broken image) when images are off', () => {
    const { container } = renderWithApp(<Ticket title={makeTitle()} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-fallback="true"]')).not.toBeNull();
  });

  it('marks hysteresis titles "BELOW 6.5 NOW"', () => {
    renderWithApp(<Ticket title={makeTitle({ isListed: false })} />);
    expect(screen.getByText('BELOW 6.5 NOW')).toBeTruthy();
  });

  it('stub button reflects personal state and calls stub()', () => {
    const { value } = renderWithApp(<Ticket title={makeTitle()} />, {
      states: {
        'movie:693134': {
          stubCount: 2,
          lastWatchedOn: '2026-09-12',
          hasStubToday: false,
          watchlisted: true,
          myReview: null,
        },
      },
    });
    const btn = screen.getByTestId('stub-button');
    expect(btn.getAttribute('aria-label')).toBe('Stub again: Dune: Part Two (2× stubbed)');
    expect(screen.getByTestId('stub-count').textContent).toBe('2×');
    expect(screen.getByText('2× stubbed')).toBeTruthy();
    fireEvent.click(btn);
    expect(value.stub).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'movie:693134', title: 'Dune: Part Two' }),
      expect.objectContaining({ source: btn }),
    );
    expect(value.registerKeys).toHaveBeenCalledWith(['movie:693134']);
  });

  it('hero variant has no link and no quick action (the page CTA owns it)', () => {
    renderWithApp(<Ticket title={makeTitle()} variant="hero" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('stub-button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Poster for Dune: Part Two' })).toBeTruthy();
  });
});
