// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TitleWatch, WatchProviderItem } from '@/lib/types';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { WhereToWatch, WTW_TIMEOUT_MS } from './WhereToWatch';
import { renderWithApp } from './test-utils';

const titleWatch = vi.fn();
const setWatchRegion = vi.fn();
vi.mock('@/lib/api-client', () => ({
  api: {
    titleWatch: (...a: unknown[]) => titleWatch(...a),
    setWatchRegion: (...a: unknown[]) => setWatchRegion(...a),
  },
}));
const trackEvent = vi.fn();
vi.mock('@/lib/analytics', () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

const target = {
  key: 'movie:693134' as const,
  mediaType: 'movie' as const,
  tmdbId: 693134,
  title: 'Dune: Part Two',
  year: 2024,
};
const mode = {
  ...DEFAULT_MODE,
  watchRegions: [
    { code: 'US', name: 'United States' },
    { code: 'GB', name: 'United Kingdom' },
    { code: 'IN', name: 'India' },
  ],
};

function prov(id: number, name: string, over: Partial<WatchProviderItem> = {}): WatchProviderItem {
  return {
    providerId: id,
    name,
    logoPath: null,
    monogram: name[0]!,
    tile: '#b20710',
    href: `https://example.com/${id}?q=Dune`,
    linkKind: 'search',
    ...over,
  };
}

function makeWatch(over: Partial<TitleWatch> = {}): TitleWatch {
  return {
    region: 'US',
    regionName: 'United States',
    requested: 'US',
    fallback: false,
    source: 'accept_language',
    status: 'available',
    groups: [
      { type: 'stream', providers: [prov(8, 'Netflix'), prov(1899, 'Max')] },
      { type: 'rent', providers: [prov(2, 'Apple TV', { alsoBuy: true }), prov(3, 'Google Play')] },
      { type: 'buy', providers: [prov(10, 'Amazon Video', { linkKind: 'home' })] },
    ],
    allOptionsHref: 'https://www.themoviedb.org/movie/693134/watch?locale=US',
    checkedAt: '2026-09-27T03:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  titleWatch.mockReset();
  setWatchRegion.mockReset().mockResolvedValue({ region: 'GB' });
  trackEvent.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('WhereToWatch (DESIGN §7.4.2, PRD W1–W5)', () => {
  it('renders groups in order with text headings, external tiles and accessible names', () => {
    renderWithApp(<WhereToWatch initial={makeWatch()} target={target} />, { mode });
    const block = screen.getByTestId('where-to-watch');
    expect(screen.getByRole('heading', { name: 'Where to watch' })).toBeTruthy();
    const groups = block.querySelectorAll('[data-testid^="wtw-group-"]');
    expect([...groups].map((g) => g.getAttribute('data-testid'))).toEqual([
      'wtw-group-stream',
      'wtw-group-rent',
      'wtw-group-buy',
    ]);
    expect(screen.getByRole('list', { name: 'Stream' })).toBeTruthy();

    const netflix = screen.getByRole('link', {
      name: 'Open Netflix (stream) — opens in a new tab',
    });
    expect(netflix.getAttribute('href')).toBe('https://example.com/8?q=Dune');
    expect(netflix.getAttribute('target')).toBe('_blank');
    expect(netflix.getAttribute('rel')).toBe('noopener noreferrer');
    expect(netflix.getAttribute('title')).toBe('Open in Netflix');
    // Rent + buy on the same provider → one tile under Rent with a RENT · BUY sub-caption.
    expect(
      screen.getByRole('link', { name: 'Open Apple TV (rent · buy) — opens in a new tab' }),
    ).toBeTruthy();
    expect(within(screen.getByTestId('wtw-provider-2')).getByText('Rent · Buy')).toBeTruthy();
    // Monogram tile when there is no logo (demo): never an <img>.
    expect(block.querySelector('img')).toBeNull();
  });

  it('prints the checked line, All options and the JustWatch credit', () => {
    renderWithApp(<WhereToWatch initial={makeWatch()} target={target} />, { mode });
    expect(screen.getByTestId('wtw-checked').textContent).toBe(
      'Checked Sep 27, 2026 · Availability can change',
    );
    const all = screen.getByTestId('wtw-all-options');
    expect(all.getAttribute('href')).toBe(
      'https://www.themoviedb.org/movie/693134/watch?locale=US',
    );
    expect(all.getAttribute('rel')).toBe('noopener noreferrer');
    const jw = within(screen.getByTestId('wtw-attribution')).getByRole('link');
    expect(screen.getByTestId('wtw-attribution').textContent).toContain('Data by JustWatch');
    expect(jw.getAttribute('href')).toBe('https://www.justwatch.com/');
  });

  it('caps a group at 6 with "+N" that expands in place and focuses the next tile', () => {
    const many = Array.from({ length: 9 }, (_, i) => prov(100 + i, `Service ${i + 1}`));
    renderWithApp(
      <WhereToWatch
        initial={makeWatch({ groups: [{ type: 'stream', providers: many }] })}
        target={target}
      />,
      { mode },
    );
    const group = screen.getByTestId('wtw-group-stream');
    expect(within(group).getAllByRole('link')).toHaveLength(6);
    const more = screen.getByTestId('wtw-more');
    expect(more.getAttribute('aria-label')).toBe('Show 3 more Stream options');
    expect(more.textContent).toContain('+3');
    fireEvent.click(more);
    expect(within(group).getAllByRole('link')).toHaveLength(9);
    expect(screen.queryByTestId('wtw-more')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('wtw-provider-106'));
  });

  it('uses the "Rent · Buy" heading for a merged group and names tiles accordingly', () => {
    renderWithApp(
      <WhereToWatch
        initial={makeWatch({ groups: [{ type: 'rent_buy', providers: [prov(2, 'Apple TV')] }] })}
        target={target}
      />,
      { mode },
    );
    expect(screen.getByRole('list', { name: 'Rent · Buy' })).toBeTruthy();
    expect(screen.getByTestId('wtw-group-rent')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open Apple TV (rent · buy) — opens in a new tab' }),
    ).toBeTruthy();
  });

  it('fires provider_clicked without preventing navigation', () => {
    renderWithApp(<WhereToWatch initial={makeWatch()} target={target} />, { mode });
    const tile = screen.getByTestId('wtw-provider-10');
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    tile.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(trackEvent).toHaveBeenCalledWith('provider_clicked', {
      provider_id: 10,
      type: 'buy',
      region: 'US',
      link_kind: 'home',
    });
  });

  it('shows the empty state with Change region and Add to Watchlist', () => {
    const { value } = renderWithApp(
      <WhereToWatch initial={makeWatch({ status: 'none', groups: [] })} target={target} />,
      { mode },
    );
    const empty = screen.getByTestId('wtw-empty');
    expect(empty.textContent).toContain('Not streaming in the US right now.');
    fireEvent.click(within(empty).getByRole('button', { name: 'Change region' }));
    expect(document.activeElement).toBe(
      screen.getByRole('combobox', { name: 'Region: United States. Change region' }),
    );
    fireEvent.click(within(empty).getByRole('button', { name: 'Add to Watchlist' }));
    expect(value.toggleWatchlist).toHaveBeenCalledWith(target);
    // Footer stays: All options is the honest route.
    expect(screen.getByTestId('wtw-all-options')).toBeTruthy();
  });

  it('shows "Showing: … · Change" for an unsupported requested region', () => {
    renderWithApp(
      <WhereToWatch
        initial={makeWatch({ requested: 'JP', fallback: true, source: 'accept_language' })}
        target={target}
      />,
      { mode },
    );
    expect(screen.getByTestId('wtw-fallback').textContent).toBe('Showing: United States · Change');
  });

  it('switches region in place: skeleton, refetch, persist, URL param', async () => {
    let resolve!: (v: { watch: TitleWatch }) => void;
    titleWatch.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithApp(<WhereToWatch initial={makeWatch()} target={target} />, { mode });
    const select = screen.getByRole('combobox', { name: 'Region: United States. Change region' });
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      'United States · US',
      'United Kingdom · GB',
      'India · IN',
    ]);
    fireEvent.change(select, { target: { value: 'GB' } });
    expect(screen.getByTestId('wtw-skeleton')).toBeTruthy();
    expect(titleWatch).toHaveBeenCalledWith('movie:693134', 'GB', {
      signal: expect.any(AbortSignal),
    });
    expect(setWatchRegion).toHaveBeenCalledWith('GB');
    expect(new URL(window.location.href).searchParams.get('region')).toBe('GB');
    await act(async () =>
      resolve({
        watch: makeWatch({
          region: 'GB',
          regionName: 'United Kingdom',
          groups: [{ type: 'free', providers: [prov(38, 'BBC iPlayer')] }],
        }),
      }),
    );
    expect(screen.queryByTestId('wtw-skeleton')).toBeNull();
    expect(screen.getByTestId('wtw-group-free')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Region: United Kingdom. Change region' }));
  });

  it('collapses to a quiet error line with Retry after the 1.5 s budget', async () => {
    vi.useFakeTimers();
    titleWatch.mockImplementation(
      (_k: string, _r: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError'))),
        ),
    );
    renderWithApp(<WhereToWatch initial={makeWatch()} target={target} />, { mode });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'IN' } });
    await act(async () => {
      vi.advanceTimersByTime(WTW_TIMEOUT_MS + 10);
    });
    const err = screen.getByTestId('wtw-error');
    expect(err.textContent).toContain("Couldn't load where to watch.");
    titleWatch.mockResolvedValue({ watch: makeWatch({ region: 'IN', regionName: 'India' }) });
    await act(async () => {
      fireEvent.click(within(err).getByRole('button', { name: 'Retry' }));
    });
    expect(titleWatch).toHaveBeenLastCalledWith('movie:693134', 'IN', expect.anything());
    expect(screen.queryByTestId('wtw-error')).toBeNull();
  });

  it('heals the cookie from the saved profile region when SSR guessed', async () => {
    titleWatch.mockResolvedValue({ watch: makeWatch({ region: 'IN', regionName: 'India' }) });
    setWatchRegion.mockResolvedValue({ region: 'IN' });
    renderWithApp(
      <WhereToWatch initial={makeWatch({ source: 'accept_language' })} target={target} />,
      {
        mode,
        session: {
          user: {
            id: 'u1',
            email: 'a@b.c',
            handle: 'a',
            displayName: 'A',
            avatarUrl: null,
            watchRegion: 'IN',
          },
        },
      },
    );
    await waitFor(() =>
      expect(titleWatch).toHaveBeenCalledWith('movie:693134', 'IN', expect.anything()),
    );
    expect(setWatchRegion).toHaveBeenCalledTimes(1);
    expect(setWatchRegion).toHaveBeenCalledWith('IN');
  });

  it('never overrides an explicit cookie or query region', () => {
    renderWithApp(<WhereToWatch initial={makeWatch({ source: 'setting' })} target={target} />, {
      mode,
      session: {
        user: {
          id: 'u1',
          email: 'a@b.c',
          handle: 'a',
          displayName: 'A',
          avatarUrl: null,
          watchRegion: 'IN',
        },
      },
    });
    expect(setWatchRegion).not.toHaveBeenCalled();
    expect(titleWatch).not.toHaveBeenCalled();
  });
});
