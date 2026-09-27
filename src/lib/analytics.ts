/**
 * First-party product events (PRD §7, W2-AC4). Client-safe. A NO-OP until E-M1 adds a first-party
 * endpoint: no third-party script, pixel or beacon, ever (ADR-012 §10.6).
 *
 * Rules: events carry no user id and no URL; `trackEvent` is fire-and-forget and must never delay
 * navigation (call it from `onClick` without `preventDefault`, never await it).
 */
import type { WatchGroupType, WatchLinkKind } from './types';

export interface ProviderClickedEvent {
  provider_id: number;
  /** Group the tile was in (`rent_buy` for a merged Rent · Buy group). */
  type: WatchGroupType;
  region: string;
  link_kind: WatchLinkKind;
}

export interface AnalyticsEvents {
  provider_clicked: ProviderClickedEvent;
}

export type AnalyticsEventName = keyof AnalyticsEvents;

/** Records one event. Today: nothing (no endpoint yet). Never throws, returns immediately. */
export function trackEvent<K extends AnalyticsEventName>(name: K, props: AnalyticsEvents[K]): void {
  void name;
  void props;
}
