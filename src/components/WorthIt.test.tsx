// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorthIt } from './WorthIt';
import { makeTitle, makeWorthIt, renderWithApp } from './test-utils';

const trackEvent = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

afterEach(cleanup);

describe('"Worth it?" slip (DESIGN §7.4.1, ADR-009)', () => {
  it('renders every line that has data', () => {
    renderWithApp(
      <WorthIt
        data={makeWorthIt({
          likeCandidates: [
            makeTitle({
              key: 'movie:157336',
              tmdbId: 157336,
              title: 'Interstellar',
              slug: 'interstellar',
              year: 2014,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Worth it?' })).toBeTruthy();
    expect(screen.getByTestId('worth-it-hook').textContent).toBe(
      'A desert war epic with sandworms.',
    );
    expect(screen.getByTestId('worth-it-vibes').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('worth-it-time').textContent).toContain('2H 46M · LONG ONE');
    expect(screen.getByTestId('worth-it-cert').textContent).toBe('PG-13');
    expect(screen.getByTestId('worth-it-verdict').textContent).toContain('Widely loved');
    expect(screen.getByTestId('worth-it-like').textContent).toContain('If you liked');
    expect(screen.getByTestId('worth-it-like').textContent).toContain('Interstellar');
  });

  it('hides missing lines and never prints a blended number', () => {
    renderWithApp(
      <WorthIt data={makeWorthIt({ hook: null, vibes: [], time: null, certification: null })} />,
    );
    for (const id of [
      'worth-it-hook',
      'worth-it-vibes',
      'worth-it-time',
      'worth-it-cert',
      'worth-it-like',
    ])
      expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('worth-it-verdict').textContent).not.toMatch(/\d\.\d/);
  });

  it('labels TMDB-sourced hooks and marks split opinions', () => {
    renderWithApp(
      <WorthIt
        data={makeWorthIt({
          hook: { text: 'Fear can hold you prisoner.', source: 'tmdb_tagline' },
          verdict: {
            key: 'split_opinions',
            word: 'Split opinions',
            sourceLine: 'Based on TMDB, IMDb and 5 Stubbed ratings',
            splitNote: 'IMDb rates it higher than Stubbed',
            sources: ['tmdb', 'imdb', 'stubbed'],
          },
        })}
      />,
    );
    expect(screen.getByTestId('worth-it-hook').textContent).toContain('FROM TMDB');
    expect(screen.getByText('SPLIT')).toBeTruthy();
    expect(screen.getByTestId('worth-it-verdict').textContent).toContain('IMDb rates it higher');
  });

  it('prefers a title the viewer has stubbed ("You stubbed")', () => {
    const a = makeTitle({ key: 'movie:1', tmdbId: 1, title: 'Alpha', slug: 'alpha' });
    const b = makeTitle({ key: 'movie:2', tmdbId: 2, title: 'Beta', slug: 'beta' });
    renderWithApp(<WorthIt data={makeWorthIt({ likeCandidates: [a, b] })} />, {
      states: {
        'movie:2': {
          stubCount: 1,
          lastWatchedOn: '2026-01-01',
          hasStubToday: false,
          watchlisted: false,
          myReview: null,
        },
      },
    });
    expect(screen.getByTestId('worth-it-like').textContent).toContain('You stubbed');
    expect(screen.getByTestId('worth-it-like').textContent).toContain('Beta');
  });
});

describe('worth_it_viewed (ADR-013 C-09)', () => {
  it('fires once after 1 s at >= 50 % visible, and not for a short glance', () => {
    vi.useFakeTimers();
    let cb: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(c: IntersectionObserverCallback) {
          cb = c;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const see = (ratio: number) =>
      cb([{ intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver);
    renderWithApp(<WorthIt data={makeWorthIt()} />);
    see(0.6);
    vi.advanceTimersByTime(500);
    see(0.1);
    vi.advanceTimersByTime(1000);
    expect(trackEvent).not.toHaveBeenCalled();
    see(0.8);
    vi.advanceTimersByTime(1000);
    see(0.8);
    vi.advanceTimersByTime(1000);
    expect(trackEvent).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith('worth_it_viewed', { verdict: 'widely_loved' });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
