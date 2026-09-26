'use client';
/**
 * App-wide client context: session, personal title states, toasts, auth sheet and the stub flow.
 * The provider lives in src/components/AppProvider.tsx; components read it through these hooks.
 * The default value is inert so leaf components render (and unit-test) without a provider.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { AppMode, MediaType, Session, TitleKey, TitleState, WatchedWhere } from '@/lib/types';

/** The minimum a component needs to know about a title to stub / watchlist it. */
export interface StubTarget {
  key: TitleKey;
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  year: number;
}

export interface StubOptions {
  watchedOn?: string;
  watchedWhere?: WatchedWhere | null;
  note?: string;
  /** Skip the "Stub again today?" confirm (already confirmed). */
  confirmed?: boolean;
  /** Element that triggered the stub (used to find the ticket to tear). */
  source?: HTMLElement | null;
}

export type PendingAction =
  | { kind: 'stub'; target: StubTarget; opts?: Omit<StubOptions, 'source'> }
  | { kind: 'watchlist'; target: StubTarget }
  | { kind: 'review'; titleKey: TitleKey }
  | { kind: 'signin' };

export interface ToastInput {
  message: ReactNode;
  action?: { label: string; onClick: () => void };
  /** ms; default 2600, or 5000 with an action (DESIGN §6). */
  duration?: number;
}

export interface ToastItem extends ToastInput {
  id: number;
  leaving?: boolean;
}

export interface ConfirmInput {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface AppContextValue {
  mode: AppMode;
  /** Server "today" (YYYY-MM-DD; DEMO_TODAY in demo/E2E). */
  today: string;
  session: Session | null;
  sessionReady: boolean;
  /** Stub total for the wallet badge, or null when unknown. */
  walletCount: number | null;
  states: Record<string, TitleState>;
  /** Ask the provider to load personal state for these titles (batched: one request per tick). */
  registerKeys: (keys: TitleKey[]) => void;
  setTitleState: (key: TitleKey, update: (s: TitleState) => TitleState) => void;
  /** Last successful optimistic stub, for the stamp "pop" animation. */
  lastStub: { key: TitleKey; seq: number } | null;
  stub: (target: StubTarget, opts?: StubOptions) => Promise<void>;
  toggleWatchlist: (target: StubTarget) => Promise<void>;
  openStubSheet: (target: StubTarget, opts?: { minDate?: string }) => void;
  toast: (t: ToastInput) => void;
  dismissToast: (id: number) => void;
  toasts: ToastItem[];
  confirm: (c: ConfirmInput) => Promise<boolean>;
  openAuth: (pending?: PendingAction, view?: 'signin' | 'signup') => void;
  /** After sign-in/up: store the session and replay the pending action (B2-AC3). */
  onAuthed: (session: Session, pending?: PendingAction | null) => void;
  signOut: () => Promise<void>;
}

export const EMPTY_STATE: TitleState = {
  stubCount: 0,
  lastWatchedOn: null,
  hasStubToday: false,
  watchlisted: false,
  myReview: null,
};

const noop = () => {};
const noopAsync = async () => {};

export const DEFAULT_MODE: AppMode = {
  catalog: 'fixtures',
  data: 'local',
  isDemo: true,
  images: 'off',
  demoAccounts: [],
};

export const AppContext = createContext<AppContextValue>({
  mode: DEFAULT_MODE,
  today: new Date().toISOString().slice(0, 10),
  session: null,
  sessionReady: false,
  walletCount: null,
  states: {},
  registerKeys: noop,
  setTitleState: noop,
  lastStub: null,
  stub: noopAsync,
  toggleWatchlist: noopAsync,
  openStubSheet: noop,
  toast: noop,
  dismissToast: noop,
  toasts: [],
  confirm: async () => false,
  openAuth: noop,
  onAuthed: noop,
  signOut: noopAsync,
});

export function useApp(): AppContextValue {
  return useContext(AppContext);
}

/** Personal state for one title (registers the key for the page's batched title-states call). */
export function useTitleState(key: TitleKey): TitleState | null {
  const { states, registerKeys } = useApp();
  useEffect(() => {
    registerKeys([key]);
  }, [key, registerKeys]);
  return states[key] ?? null;
}

export function useToast() {
  return useApp().toast;
}

export function useAuthSheet() {
  return useApp().openAuth;
}

export function useMe(): { session: Session | null; ready: boolean } {
  const { session, sessionReady } = useApp();
  return { session, ready: sessionReady };
}
