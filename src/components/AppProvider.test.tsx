// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, TitleState } from '@/lib/types';
import { DEFAULT_MODE } from '@/hooks/useApp';
import { AppProvider } from './AppProvider';
import { Ticket } from './Ticket';
import { makeTitle } from './test-utils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

const SESSION: Session = {
  user: {
    id: 'u1',
    email: 'maya@demo.stubbed.app',
    handle: 'maya',
    displayName: 'Maya',
    avatarUrl: null,
  },
};
const EMPTY: TitleState = {
  stubCount: 0,
  lastWatchedOn: null,
  hasStubToday: false,
  watchlisted: false,
  myReview: null,
};

type Handler = (
  url: string,
  init?: RequestInit,
) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;
let calls: { url: string; method: string }[] = [];

function mockFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      const r = await handler(url, init);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status: r.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

const dune = makeTitle();
const bear = makeTitle({
  key: 'tv:136315',
  mediaType: 'tv',
  tmdbId: 136315,
  title: 'The Bear',
  slug: 'the-bear',
});

function renderApp() {
  return render(
    <AppProvider mode={DEFAULT_MODE} today="2026-09-26">
      <Ticket title={dune} />
      <Ticket title={bear} />
    </AppProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppProvider stub flow (DESIGN §5.1)', () => {
  it('signed out: tapping Stub it opens the auth sheet instead of posting', async () => {
    mockFetch((url) =>
      url === '/api/me'
        ? { status: 200, body: { session: null, mode: DEFAULT_MODE } }
        : { status: 500 },
    );
    renderApp();
    await waitFor(() => expect(calls.some((c) => c.url === '/api/me')).toBe(true));
    await act(async () => {});
    fireEvent.click(screen.getAllByTestId('stub-button')[0]!);
    await waitFor(() => expect(screen.getByTestId('auth-sheet').hasAttribute('open')).toBe(true));
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/stubs')).toBe(false);
    expect(calls.some((c) => c.url.startsWith('/api/me/title-states'))).toBe(false);
  });

  it('signed in: one batched title-states call, optimistic count, toast with Undo', async () => {
    let resolvePost: (v: { status: number; body: unknown }) => void = () => {};
    mockFetch((url, init) => {
      if (url === '/api/me') return { status: 200, body: { session: SESSION, mode: DEFAULT_MODE } };
      if (url.startsWith('/api/me/title-states'))
        return {
          status: 200,
          body: { states: { 'movie:693134': EMPTY, 'tv:136315': { ...EMPTY, stubCount: 3 } } },
        };
      if (url.startsWith('/api/me/stubs'))
        return { status: 200, body: { items: [], nextCursor: null } };
      if (url === '/api/stubs' && init?.method === 'POST')
        return new Promise((r) => {
          resolvePost = r;
        });
      if (url.startsWith('/api/stubs/') && init?.method === 'DELETE')
        return { status: 200, body: { state: EMPTY } };
      return { status: 404, body: { error: { code: 'not_found', message: 'x' } } };
    });
    renderApp();
    await waitFor(() =>
      expect(screen.getAllByTestId('stub-button')[1]!.getAttribute('data-count')).toBe('3'),
    );
    const stateCalls = calls.filter((c) => c.url.startsWith('/api/me/title-states'));
    expect(stateCalls).toHaveLength(1);
    expect(decodeURIComponent(stateCalls[0]!.url)).toContain('movie:693134,tv:136315');

    const btn = screen.getAllByTestId('stub-button')[0]!;
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute('data-count')).toBe('1'));
    await act(async () => {
      resolvePost({
        status: 201,
        body: {
          stub: { id: 'stub-1', number: 1 },
          state: { ...EMPTY, stubCount: 1, hasStubToday: true, lastWatchedOn: '2026-09-26' },
        },
      });
    });
    await waitFor(() => expect(screen.getByTestId('toast').textContent).toContain('1× stubbed'));
    expect(screen.getByTestId('toast').textContent).toContain('Dune: Part Two');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(btn.getAttribute('data-count')).toBe('0'));
    expect(calls.some((c) => c.url === '/api/stubs/stub-1' && c.method === 'DELETE')).toBe(true);
  });

  it('rolls back and offers Retry when the write fails', async () => {
    mockFetch((url) => {
      if (url === '/api/me') return { status: 200, body: { session: SESSION, mode: DEFAULT_MODE } };
      if (url.startsWith('/api/me/title-states')) return { status: 200, body: { states: {} } };
      if (url.startsWith('/api/me/stubs'))
        return { status: 200, body: { items: [], nextCursor: null } };
      return { status: 500, body: { error: { code: 'internal', message: 'boom' } } };
    });
    renderApp();
    await waitFor(() =>
      expect(calls.some((c) => c.url.startsWith('/api/me/title-states'))).toBe(true),
    );
    const btn = screen.getAllByTestId('stub-button')[0]!;
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByTestId('toast').textContent).toContain("Couldn't save that stub"),
    );
    expect(btn.getAttribute('data-count')).toBe('0');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('asks "Stub again today?" before a same-day duplicate', async () => {
    mockFetch((url) => {
      if (url === '/api/me') return { status: 200, body: { session: SESSION, mode: DEFAULT_MODE } };
      if (url.startsWith('/api/me/title-states'))
        return {
          status: 200,
          body: {
            states: {
              'movie:693134': {
                ...EMPTY,
                stubCount: 1,
                hasStubToday: true,
                lastWatchedOn: '2026-09-26',
              },
            },
          },
        };
      if (url.startsWith('/api/me/stubs'))
        return { status: 200, body: { items: [], nextCursor: null } };
      return { status: 500 };
    });
    renderApp();
    const btn = screen.getAllByTestId('stub-button')[0]!;
    await waitFor(() => expect(btn.getAttribute('data-count')).toBe('1'));
    fireEvent.click(btn);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Stub again today?' })).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(calls.some((c) => c.url === '/api/stubs')).toBe(false);
    expect(btn.getAttribute('data-count')).toBe('1');
  });
});
