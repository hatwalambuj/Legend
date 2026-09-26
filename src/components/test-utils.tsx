/** Test helpers for component tests (jsdom): a TitleSummary factory and an AppContext wrapper. */
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import type { TitleDetail, TitleSummary, WorthIt } from '@/lib/types';
import { AppContext, DEFAULT_MODE, type AppContextValue } from '@/hooks/useApp';

export function makeTitle(over: Partial<TitleSummary> = {}): TitleSummary {
  return {
    key: 'movie:693134',
    mediaType: 'movie',
    tmdbId: 693134,
    imdbId: 'tt15239678',
    title: 'Dune: Part Two',
    originalTitle: 'Dune: Part Two',
    slug: 'dune-part-two',
    releaseDate: '2024-02-27',
    year: 2024,
    voteAverage: 8.15,
    voteCount: 6912,
    imdbRating: 8.5,
    imdbVotes: 684000,
    popularity: 99,
    genres: [{ id: 878, name: 'Science Fiction' }],
    posterPath: '/poster.jpg',
    backdropPath: null,
    palette: {
      vibrant: '#c8671f',
      base: '#4a1d0b',
      tint1: '#6b3710',
      tint2: '#2a1006',
      lqip: null,
      v: 1,
    },
    overviewShort: 'Paul goes to war.',
    runtimeMinutes: 166,
    seasonCount: null,
    episodeCount: null,
    episodeRuntimeMinutes: null,
    isListed: true,
    ...over,
  };
}

export function makeWorthIt(over: Partial<WorthIt> = {}): WorthIt {
  return {
    hook: { text: 'A desert war epic with sandworms.', source: 'stubbed' },
    vibes: [
      { id: 'epic', label: 'Epic' },
      { id: 'stylish', label: 'Stylish' },
    ],
    time: {
      totalMinutes: 166,
      badge: 'long_one',
      label: '2H 46M · LONG ONE',
      ariaLabel: '2 hours 46 minutes, a long one',
    },
    certification: 'PG-13',
    verdict: {
      key: 'widely_loved',
      word: 'Widely loved',
      sourceLine: 'Based on TMDB, IMDb and 5 Stubbed ratings',
      splitNote: null,
      sources: ['tmdb', 'imdb', 'stubbed'],
    },
    likeCandidates: [],
    metaDescription: 'A desert war epic. 2H 46M · Widely loved',
    ...over,
  };
}

export type _Detail = TitleDetail;

export function appValue(over: Partial<AppContextValue> = {}): AppContextValue {
  return {
    mode: DEFAULT_MODE,
    today: '2026-09-26',
    session: null,
    sessionReady: true,
    walletCount: null,
    states: {},
    registerKeys: vi.fn(),
    setTitleState: vi.fn(),
    lastStub: null,
    stub: vi.fn(async () => {}),
    toggleWatchlist: vi.fn(async () => {}),
    openStubSheet: vi.fn(),
    toast: vi.fn(),
    dismissToast: vi.fn(),
    toasts: [],
    confirm: vi.fn(async () => true),
    openAuth: vi.fn(),
    onAuthed: vi.fn(),
    signOut: vi.fn(async () => {}),
    ...over,
  };
}

export function renderWithApp(ui: ReactElement, over: Partial<AppContextValue> = {}) {
  const value = appValue(over);
  return { value, ...render(<AppContext.Provider value={value}>{ui}</AppContext.Provider>) };
}
