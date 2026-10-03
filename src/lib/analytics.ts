/**
 * First-party, privacy-safe product events (PRD §7, ADR-013 C-09). Client-safe.
 *
 * - Our own `events` table only: anonymous daily counters (no user id, title key, IP, UA or URL), no
 *   cookies. No third-party script, pixel or beacon, ever (ADR-012 §10.6).
 * - `ANALYTICS_EVENTS` is the allowlist. Each event has a `dim` that is validated by a fixed pattern,
 *   never free text. Only the 3 `client` events are accepted by `POST /api/events`; the rest are
 *   recorded by the server inside their routes.
 * - `trackEvent` queues and flushes on `pagehide` / `visibilitychange=hidden` or after 5 s with
 *   `navigator.sendBeacon` (fallback `fetch(…, { keepalive: true })`). It is a no-op when Global
 *   Privacy Control or Do Not Track is on, never throws and never delays navigation (call it from
 *   `onClick` without `preventDefault`, never await it).
 * OWNER: Backend (C-00).
 */
import type { VerdictKey, WatchGroupType, WatchLinkKind } from './types';

const VERDICTS: readonly VerdictKey[] = [
  'widely_loved',
  'well_liked',
  'solid_pick',
  'split_opinions',
  'mixed_reviews',
];

/** name → { client: accepted by POST /api/events, dim: allowed values }. */
export const ANALYTICS_EVENTS = {
  signup_completed: { client: false, dim: /^(share)?$/ },
  stub_created: { client: false, dim: /^$/ },
  stub_again: { client: false, dim: /^$/ },
  review_saved: { client: false, dim: /^(new|edit)$/ },
  watchlist_added: { client: false, dim: /^$/ },
  export_downloaded: { client: false, dim: /^(letterboxd|json)$/ },
  import_completed: { client: false, dim: /^(letterboxd|imdb|tvtime)$/ },
  share_generated: {
    client: true,
    dim: /^(title|wallet|review|stub):(native|copy|fallback|story)$/,
  },
  worth_it_viewed: { client: true, dim: new RegExp(`^(${VERDICTS.join('|')})$`) },
  provider_clicked: {
    client: true,
    dim: /^(stream|free|ads|rent|rent_buy|buy):[A-Z]{2}:[1-9]\d{0,9}:(search|home|tmdb)$/,
  },
} as const satisfies Record<string, { client: boolean; dim: RegExp }>;

/** Every event name (API_CONTRACT §1c). */
export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;

export const CLIENT_EVENT_NAMES = [
  'share_generated',
  'worth_it_viewed',
  'provider_clicked',
] as const;
export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number];

export function isAnalyticsEventName(v: unknown): v is AnalyticsEventName {
  return typeof v === 'string' && Object.hasOwn(ANALYTICS_EVENTS, v);
}

/** True when `dim` is an allowed value for `name` (≤ 80 chars, pattern match). */
export function isValidDim(name: AnalyticsEventName, dim: string): boolean {
  return dim.length <= 80 && ANALYTICS_EVENTS[name].dim.test(dim);
}

export interface ProviderClickedEvent {
  provider_id: number;
  /** Group the tile was in (`rent_buy` for a merged Rent · Buy group). */
  type: WatchGroupType;
  region: string;
  link_kind: WatchLinkKind;
}

export interface ShareGeneratedEvent {
  surface: 'title' | 'wallet' | 'review' | 'stub';
  method: 'native' | 'copy' | 'fallback' | 'story';
}

export interface WorthItViewedEvent {
  verdict: VerdictKey;
}

/** Props of the client events (signature of `trackEvent` unchanged since v1.5). */
export interface AnalyticsEvents {
  provider_clicked: ProviderClickedEvent;
  share_generated: ShareGeneratedEvent;
  worth_it_viewed: WorthItViewedEvent;
}

/** The anonymous `dim` of a client event (validated again by the server). */
export function eventDim<K extends ClientEventName>(name: K, props: AnalyticsEvents[K]): string {
  switch (name) {
    case 'provider_clicked': {
      const p = props as ProviderClickedEvent;
      return `${p.type}:${p.region}:${p.provider_id}:${p.link_kind}`;
    }
    case 'share_generated': {
      const p = props as ShareGeneratedEvent;
      return `${p.surface}:${p.method}`;
    }
    default:
      return (props as WorthItViewedEvent).verdict;
  }
}

/* ---------------- client queue ---------------- */

export const EVENTS_ENDPOINT = '/api/events';
export const FLUSH_DELAY_MS = 5000;
/** Server limit per request (trackEventsSchema). */
export const MAX_BATCH = 20;
const MAX_QUEUE = 60;

type Queued = { name: ClientEventName; dim: string };
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/** Global Privacy Control or Do Not Track → send nothing. */
export function trackingOptedOut(): boolean {
  try {
    if (typeof navigator === 'undefined') return true;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    const win =
      typeof window !== 'undefined' ? (window as unknown as { doNotTrack?: string }) : undefined;
    return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || win?.doNotTrack === '1';
  } catch {
    return true;
  }
}

function send(batch: Queued[]): void {
  const json = JSON.stringify({ events: batch });
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(
        EVENTS_ENDPOINT,
        new Blob([json], { type: 'application/json' }),
      );
      if (ok) return;
    }
  } catch {
    /* fall through to fetch */
  }
  try {
    void fetch(EVENTS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json,
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* never throws */
  }
}

/** Sends everything queued (in batches of 20). Safe to call any time. */
export function flushEvents(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const all = queue;
  queue = [];
  for (let i = 0; i < all.length; i += MAX_BATCH) send(all.slice(i, i + MAX_BATCH));
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('pagehide', flushEvents);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushEvents();
  });
}

/** Records one client event. Never throws, returns immediately. */
export function trackEvent<K extends ClientEventName>(name: K, props: AnalyticsEvents[K]): void {
  try {
    if (typeof window === 'undefined' || trackingOptedOut()) return;
    const dim = eventDim(name, props);
    if (!isValidDim(name, dim)) return;
    if (queue.length >= MAX_QUEUE) return;
    queue.push({ name, dim });
    listen();
    timer ??= setTimeout(flushEvents, FLUSH_DELAY_MS);
  } catch {
    /* analytics must never break the UI */
  }
}

/** Tests only. */
export function resetAnalyticsForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
}
