'use client';
/**
 * The one client provider (root layout): session island (GET /api/me), batched personal title
 * states (one GET /api/me/title-states per tick for every visible ticket — never N+1), toasts,
 * the auth sheet with resume-after-login, the stub flow (DESIGN §5.1) and watchlist toggles.
 */
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { api, ApiError } from '@/lib/api-client';
import { ERROR_COPY } from '@/lib/errors';
import { reportError } from '@/lib/report-error';
import type { AppMode, Session, TitleKey, TitleState } from '@/lib/types';
import {
  AppContext,
  EMPTY_STATE,
  type AppContextValue,
  type ConfirmInput,
  type PendingAction,
  type StubOptions,
  type StubTarget,
  type ToastInput,
  type ToastItem,
} from '@/hooks/useApp';
import { AuthSheet } from './AuthSheet';
import { ConfirmDialog } from './ConfirmDialog';
import { findTicket, haptic, shake, tearToWallet } from './lib/motion';
import { captureShareRef } from './lib/share-ref';
import { StubSheet } from './StubSheet';
import { Toaster } from './Toaster';

const MAX_KEYS_PER_CALL = 60;
const NOT_WIRED = "That isn't switched on yet. Try again in a bit.";

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function AppProvider({
  mode,
  today,
  children,
}: {
  mode: AppMode;
  today: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSessionState] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [walletCount, setWalletCount] = useState<number | null>(null);
  const [states, setStates] = useState<Record<string, TitleState>>({});
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [lastStub, setLastStub] = useState<{ key: TitleKey; seq: number } | null>(null);
  const [authView, setAuthView] = useState<'signin' | 'signup' | null>(null);
  const [sheet, setSheet] = useState<{ target: StubTarget; minDate?: string } | null>(null);
  const [confirmState, setConfirmState] = useState<
    (ConfirmInput & { resolve: (ok: boolean) => void }) | null
  >(null);

  const sessionRef = useRef<Session | null>(null);
  const readyRef = useRef(false);
  const statesRef = useRef(states);
  const pendingRef = useRef<PendingAction | null>(null);
  const known = useRef(new Set<TitleKey>());
  const loaded = useRef(new Set<TitleKey>());
  const queue = useRef(new Set<TitleKey>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastSeq = useRef(0);
  const stubSeq = useRef(0);
  const stubRef = useRef<((t: StubTarget, o?: StubOptions) => Promise<void>) | null>(null);
  // Write counters: a read (batched GET / GET /api/me) that started before a local write must not
  // overwrite it when it resolves late (QA_VERIFICATION §6a, B2-AC3).
  const titleWrites = useRef(new Map<TitleKey, number>());
  const walletWrites = useRef(0);

  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  /* ---------------- share ref (C-07) + client error reports (C-13) ---------------- */
  useEffect(() => {
    captureShareRef(window.location.search);
    const onError = (e: ErrorEvent) =>
      reportError({
        kind: 'unhandled',
        message: e.message || String(e.error ?? 'Error'),
        stack: e.error instanceof Error ? e.error.stack : undefined,
      });
    const onRejection = (e: PromiseRejectionEvent) => {
      const r: unknown = e.reason;
      reportError({
        kind: 'rejection',
        message: r instanceof Error ? r.message : String(r),
        stack: r instanceof Error ? r.stack : undefined,
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  /* ---------------- toasts ---------------- */
  const dismissToast = useCallback((id: number) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 200);
  }, []);

  const toast = useCallback(
    (t: ToastInput) => {
      const id = ++toastSeq.current;
      setToasts((ts) => [...ts, { ...t, id }].slice(-2));
      setTimeout(() => dismissToast(id), t.duration ?? (t.action ? 5000 : 2600));
    },
    [dismissToast],
  );

  /* ---------------- confirm ---------------- */
  const confirm = useCallback(
    (c: ConfirmInput) => new Promise<boolean>((resolve) => setConfirmState({ ...c, resolve })),
    [],
  );

  /* ---------------- title states (batched) ---------------- */
  const setTitleState = useCallback((key: TitleKey, update: (s: TitleState) => TitleState) => {
    titleWrites.current.set(key, (titleWrites.current.get(key) ?? 0) + 1);
    setStates((prev) => {
      const next = { ...prev, [key]: update(prev[key] ?? EMPTY_STATE) };
      statesRef.current = next;
      return next;
    });
  }, []);

  const flush = useCallback(async () => {
    flushTimer.current = null;
    if (!sessionRef.current) {
      queue.current.clear();
      return;
    }
    const keys = [...queue.current].filter((k) => !loaded.current.has(k));
    queue.current.clear();
    if (keys.length === 0) return;
    keys.forEach((k) => loaded.current.add(k));
    await Promise.all(
      chunks(keys, MAX_KEYS_PER_CALL).map(async (chunk) => {
        try {
          const seen = chunk.map((k) => titleWrites.current.get(k));
          const res = await api.titleStates(chunk);
          setStates((prev) => {
            const next = { ...prev };
            chunk.forEach((k, i) => {
              if (titleWrites.current.get(k) !== seen[i]) return; // written since: keep it
              next[k] = res.states[k] ?? prev[k] ?? EMPTY_STATE;
            });
            statesRef.current = next;
            return next;
          });
        } catch {
          chunk.forEach((k) => loaded.current.delete(k));
        }
      }),
    );
  }, []);

  const schedule = useCallback(() => {
    if (flushTimer.current === null && readyRef.current)
      flushTimer.current = setTimeout(() => void flush(), 16);
  }, [flush]);

  const registerKeys = useCallback(
    (keys: TitleKey[]) => {
      for (const k of keys) {
        known.current.add(k);
        if (!loaded.current.has(k)) queue.current.add(k);
      }
      schedule();
    },
    [schedule],
  );

  /* ---------------- session ---------------- */
  /** Wallet badge = MeResponse.stubCount (one indexed count on the server; contract v1.2). */
  const writeWallet = useCallback((v: SetStateAction<number | null>) => {
    walletWrites.current++;
    setWalletCount(v);
  }, []);

  /** A count read while a stub write was in flight is stale: re-read (bounded) instead of applying it. */
  const loadWalletCount = useCallback(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const seen = walletWrites.current;
      try {
        const me = await api.me();
        if (walletWrites.current !== seen) continue;
        setWalletCount(me.session ? me.stubCount : null);
      } catch {
        if (walletWrites.current === seen) setWalletCount(null);
      }
      return;
    }
  }, []);

  const applySession = useCallback(
    (s: Session | null, stubCount?: number) => {
      sessionRef.current = s;
      readyRef.current = true;
      setSessionState(s);
      setSessionReady(true);
      loaded.current.clear();
      if (s) {
        known.current.forEach((k) => queue.current.add(k));
        schedule();
        if (typeof stubCount === 'number') writeWallet(stubCount);
        else void loadWalletCount();
      } else {
        queue.current.clear();
        setStates({});
        statesRef.current = {};
        writeWallet(null);
      }
    },
    [schedule, loadWalletCount, writeWallet],
  );

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((r) => alive && applySession(r.session, r.stubCount))
      .catch(() => alive && applySession(null));
    return () => {
      alive = false;
    };
  }, [applySession]);

  const openAuth = useCallback((pending?: PendingAction, view: 'signin' | 'signup' = 'signin') => {
    pendingRef.current = pending ?? null;
    setAuthView(view);
  }, []);

  /* ---------------- watchlist ---------------- */
  const setWatchlist = useCallback(
    async (target: StubTarget, on: boolean, quiet = false) => {
      const prev = statesRef.current[target.key] ?? EMPTY_STATE;
      setTitleState(target.key, (s) => ({ ...s, watchlisted: on }));
      try {
        const res = on
          ? await api.addToWatchlist(target.mediaType, target.tmdbId)
          : await api.removeFromWatchlist(target.mediaType, target.tmdbId);
        setTitleState(target.key, (s) => ({ ...s, watchlisted: res.watchlisted }));
        if (!quiet)
          toast({
            message: res.watchlisted ? (
              <>
                Added <b>{target.title}</b> to your watchlist
              </>
            ) : (
              'Removed from watchlist'
            ),
          });
      } catch (e) {
        setTitleState(target.key, (s) => ({ ...s, watchlisted: prev.watchlisted }));
        if (e instanceof ApiError && e.code === 'unauthenticated') {
          applySession(null);
          openAuth({ kind: 'watchlist', target });
          return;
        }
        toast({
          message:
            e instanceof ApiError && e.code === 'not_implemented'
              ? NOT_WIRED
              : "Couldn't update your watchlist. Try again.",
        });
      }
    },
    [setTitleState, toast, applySession, openAuth],
  );

  const toggleWatchlist = useCallback(
    async (target: StubTarget) => {
      if (!sessionRef.current) {
        openAuth({ kind: 'watchlist', target });
        return;
      }
      const cur = statesRef.current[target.key] ?? EMPTY_STATE;
      await setWatchlist(target, !cur.watchlisted);
    },
    [openAuth, setWatchlist],
  );

  /* ---------------- stubs ---------------- */
  const undoStub = useCallback(
    async (target: StubTarget, stubId: string) => {
      const prev = statesRef.current[target.key] ?? EMPTY_STATE;
      setTitleState(target.key, (s) => ({ ...s, stubCount: Math.max(0, s.stubCount - 1) }));
      writeWallet((c) => (c === null ? c : Math.max(0, c - 1)));
      try {
        const res = await api.deleteStub(stubId);
        walletWrites.current++;
        setTitleState(target.key, () => res.state);
        toast({ message: 'Stub removed' });
      } catch {
        setTitleState(target.key, () => prev);
        writeWallet((c) => (c === null ? c : c + 1));
        toast({ message: "Couldn't undo that stub. Try again." });
      }
    },
    [setTitleState, toast, writeWallet],
  );

  const stub = useCallback(
    async (target: StubTarget, opts: StubOptions = {}): Promise<void> => {
      const { source, ...replayOpts } = opts;
      if (!sessionRef.current) {
        openAuth({ kind: 'stub', target, opts: replayOpts });
        return;
      }
      const prev = statesRef.current[target.key] ?? EMPTY_STATE;
      const date = opts.watchedOn ?? today;
      const sameDay =
        (date === today && prev.hasStubToday) ||
        (opts.watchedOn !== undefined && opts.watchedOn === prev.lastWatchedOn);
      if (sameDay && !opts.confirmed) {
        const ok = await confirm({
          title: 'Stub again today?',
          body: "You already stubbed this today. Double feature? It'll count as another watch.",
          confirmLabel: 'Stub again',
        });
        if (!ok) return;
      }

      // Optimistic: count, label, stamp, wallet badge, tear animation, haptics (DESIGN §5.1).
      setTitleState(target.key, (s) => ({
        ...s,
        stubCount: s.stubCount + 1,
        hasStubToday: s.hasStubToday || date === today,
        lastWatchedOn: !s.lastWatchedOn || date > s.lastWatchedOn ? date : s.lastWatchedOn,
      }));
      writeWallet((c) => (c === null ? c : c + 1));
      setLastStub({ key: target.key, seq: ++stubSeq.current });
      haptic(prev.stubCount ? [10, 40, 18] : 14);
      const { ticket, stub: stubEl } = findTicket(target.key, source);
      shake(ticket);
      void tearToWallet(stubEl);

      try {
        const res = await api.createStub({
          mediaType: target.mediaType,
          tmdbId: target.tmdbId,
          watchedOn: opts.watchedOn,
          watchedWhere: opts.watchedWhere ?? null,
          note: opts.note ?? '',
          ...(target.mediaType === 'tv' && opts.season ? { season: opts.season } : {}),
        });
        walletWrites.current++; // settled: a count read started before now may predate this write
        setTitleState(target.key, () => res.state);
        if (prev.watchlisted && res.state.watchlisted) {
          toast({
            message: (
              <>
                Stubbed <b>{target.title}</b>. Remove it from your watchlist?
              </>
            ),
            action: { label: 'Remove', onClick: () => void setWatchlist(target, false) },
          });
        } else {
          toast({
            message: (
              <>
                <b>{res.state.stubCount}× stubbed</b> · {target.title}
              </>
            ),
            action: { label: 'Undo', onClick: () => void undoStub(target, res.stub.id) },
          });
        }
      } catch (e) {
        setTitleState(target.key, () => prev);
        writeWallet((c) => (c === null ? c : Math.max(0, c - 1)));
        shake(ticket);
        const err = e instanceof ApiError ? e : null;
        if (err?.code === 'unauthenticated') {
          applySession(null);
          openAuth({ kind: 'stub', target, opts: replayOpts });
        } else if (err?.code === 'rate_limited') {
          toast({ message: ERROR_COPY.rate_limited_stub });
        } else if (err?.code === 'not_implemented') {
          toast({ message: NOT_WIRED });
        } else if (err?.code === 'validation_failed') {
          toast({ message: err.fields?.watchedOn ?? err.message });
        } else {
          toast({
            message: "Couldn't save that stub. Try again.",
            action: {
              label: 'Retry',
              onClick: () => void stubRef.current?.(target, { ...replayOpts, confirmed: true }),
            },
          });
        }
      }
    },
    [
      today,
      openAuth,
      confirm,
      setTitleState,
      toast,
      setWatchlist,
      undoStub,
      applySession,
      writeWallet,
    ],
  );

  useEffect(() => {
    stubRef.current = stub;
  }, [stub]);

  const openStubSheet = useCallback(
    (target: StubTarget, o?: { minDate?: string }) => {
      if (!sessionRef.current) {
        openAuth({ kind: 'signin' });
        return;
      }
      setSheet({ target, minDate: o?.minDate });
    },
    [openAuth],
  );

  /* ---------------- auth ---------------- */
  const replay = useCallback(
    async (p: PendingAction | null) => {
      if (!p) return;
      if (p.kind === 'stub' || p.kind === 'watchlist') {
        try {
          const res = await api.titleStates([p.target.key]);
          const st = res.states[p.target.key];
          if (st) setTitleState(p.target.key, () => st);
          loaded.current.add(p.target.key);
        } catch {
          /* replay anyway */
        }
        if (p.kind === 'stub') await stub(p.target, p.opts ?? {});
        else {
          const cur = statesRef.current[p.target.key] ?? EMPTY_STATE;
          if (!cur.watchlisted) await setWatchlist(p.target, true);
        }
      } else if (p.kind === 'review') {
        setTimeout(() => {
          const el = document.getElementById('review-composer');
          el?.scrollIntoView({ block: 'center' });
          el?.querySelector<HTMLElement>('[role="radio"]')?.focus();
        }, 150);
      }
    },
    [setTitleState, stub, setWatchlist],
  );

  const onAuthed = useCallback(
    (s: Session, pendingOverride?: PendingAction | null) => {
      applySession(s);
      setAuthView(null);
      const p = pendingOverride !== undefined ? pendingOverride : pendingRef.current;
      pendingRef.current = null;
      toast({ message: `Signed in as @${s.user.handle}` });
      void replay(p);
    },
    [applySession, toast, replay],
  );

  const signOut = useCallback<AppContextValue['signOut']>(
    async (opts) => {
      if (opts?.remote !== false) {
        try {
          await api.signOut();
        } catch {
          /* clear locally regardless */
        }
      }
      applySession(null);
      toast({ message: opts?.message ?? 'Signed out' });
      if (pathname.startsWith('/me')) router.push('/');
      router.refresh();
    },
    [applySession, toast, pathname, router],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      mode,
      today,
      session,
      sessionReady,
      walletCount,
      refreshWallet: loadWalletCount,
      states,
      registerKeys,
      setTitleState,
      lastStub,
      stub,
      toggleWatchlist,
      openStubSheet,
      toast,
      dismissToast,
      toasts,
      confirm,
      openAuth,
      onAuthed,
      signOut,
    }),
    [
      mode,
      today,
      session,
      sessionReady,
      walletCount,
      loadWalletCount,
      states,
      registerKeys,
      setTitleState,
      lastStub,
      stub,
      toggleWatchlist,
      openStubSheet,
      toast,
      dismissToast,
      toasts,
      confirm,
      openAuth,
      onAuthed,
      signOut,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      <Toaster />
      <AuthSheet
        view={authView}
        onViewChange={setAuthView}
        onClose={() => {
          pendingRef.current = null;
          setAuthView(null);
        }}
      />
      <StubSheet
        target={sheet?.target ?? null}
        minDate={sheet?.minDate}
        onClose={() => setSheet(null)}
        onSubmit={(target, o) => {
          setSheet(null);
          void stub(target, o);
        }}
      />
      <ConfirmDialog
        state={confirmState}
        onDone={(ok) => {
          confirmState?.resolve(ok);
          setConfirmState(null);
        }}
      />
    </AppContext.Provider>
  );
}
