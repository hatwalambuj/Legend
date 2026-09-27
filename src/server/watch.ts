/**
 * "Where to watch" read path (ADR-012 §6.1, PRD W1/W4). `buildTitleWatch` runs per request, uncached and
 * pure, over the region-agnostic stored data (cached layers hold only `watch` + `watch_checked_at`).
 * OWNER: Backend. No network, no AI (D15).
 *
 * - `checkedAt` null or older than 30 days, `degraded === 'catalog'`, or no stored data → null (hide).
 * - Region absent from the store → `status: 'none'` ("Not streaming in {Region} right now", W4-AC1).
 * - Groups in fixed order stream, free, ads, rent, buy; empty ones dropped. A provider in rent AND buy
 *   stays in rent with `alsoBuy` and leaves buy; if every rent provider also sells, the group becomes
 *   `rent_buy` and the flags are cleared. Full lists; the UI caps at 6 + "+N".
 * - Names/logos from the provider directory; an unknown id is skipped. A region whose ids are ALL unknown
 *   → null (we can't name anything, and "not streaming" would be wrong).
 * - Every href comes from src/lib/provider-links.ts (never from upstream data).
 */
import { providerHref, providerMonogram, tmdbWatchHref } from '@/lib/provider-links';
import type {
  MediaType,
  TitleDegraded,
  TitleWatch,
  WatchGroup,
  WatchGroupType,
  WatchProviderItem,
  WatchRegionInfo,
  WatchRegionStore,
  WatchStore,
} from '@/lib/types';

export const WATCH_STALE_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ProviderInfo {
  name: string;
  logoPath: string | null;
  /** Demo fixtures carry their own monogram/tile; otherwise the config's (or the first letter). */
  monogram?: string;
  tile?: string | null;
}

export type ProviderDirectory = ReadonlyMap<number, ProviderInfo>;

/** Stored availability as the repositories return it (`catalog_index.watch` + `watch_checked_at`). */
export interface StoredWatch {
  store: WatchStore | null;
  checkedAt: string | null;
}

const ORDER: [keyof WatchRegionStore, Exclude<WatchGroupType, 'rent_buy'>][] = [
  ['s', 'stream'],
  ['f', 'free'],
  ['a', 'ads'],
  ['r', 'rent'],
  ['b', 'buy'],
];

/** Tolerant read of one stored list: positive integer ids, first occurrence wins. */
function ids(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v)
    if (typeof x === 'number' && Number.isInteger(x) && x > 0 && !out.includes(x)) out.push(x);
  return out;
}

/** True when `checkedAt` is a valid time no more than 30 days before `now`. */
export function isWatchFresh(checkedAt: string | null, now: Date): boolean {
  if (!checkedAt) return false;
  const t = Date.parse(checkedAt);
  return Number.isFinite(t) && now.getTime() - t <= WATCH_STALE_DAYS * DAY_MS;
}

export function buildTitleWatch(
  stored: StoredWatch | null | undefined,
  region: WatchRegionInfo,
  title: { mediaType: MediaType; tmdbId: number; title: string },
  now: Date,
  providers: ProviderDirectory,
  opts: { degraded?: TitleDegraded } = {},
): TitleWatch | null {
  if (opts.degraded === 'catalog' || !stored) return null;
  const { store, checkedAt } = stored;
  if (!store || typeof store !== 'object' || Array.isArray(store)) return null;
  if (!isWatchFresh(checkedAt, now)) return null;

  const base = {
    ...region,
    allOptionsHref: tmdbWatchHref(title.mediaType, title.tmdbId, region.region),
    checkedAt: new Date(Date.parse(checkedAt!)).toISOString(),
  };
  const r = store[region.region];
  if (!r || typeof r !== 'object') return { ...base, status: 'none', groups: [] };

  const item = (id: number): WatchProviderItem | null => {
    const p = providers.get(id);
    if (!p) return null;
    const { href, kind } = providerHref(
      id,
      title.title,
      region.region,
      title.mediaType,
      title.tmdbId,
    );
    const fallback = providerMonogram(id, p.name);
    return {
      providerId: id,
      name: p.name,
      logoPath: p.logoPath,
      monogram: (p.monogram || fallback.monogram).slice(0, 2),
      tile: p.tile ?? fallback.tile,
      href,
      linkKind: kind,
    };
  };

  let storedCount = 0;
  const lists = new Map<string, WatchProviderItem[]>();
  for (const [key, type] of ORDER) {
    const list = ids((r as Record<string, unknown>)[key]);
    storedCount += list.length;
    lists.set(
      type,
      list.map(item).filter((x): x is WatchProviderItem => x !== null),
    );
  }

  const rent = lists.get('rent')!;
  const buyIds = new Set(lists.get('buy')!.map((p) => p.providerId));
  const rentIds = new Set(rent.map((p) => p.providerId));
  const allAlsoBuy = rent.length > 0 && rent.every((p) => buyIds.has(p.providerId));
  const rentGroup: WatchProviderItem[] = rent.map((p) =>
    !allAlsoBuy && buyIds.has(p.providerId) ? { ...p, alsoBuy: true } : p,
  );
  lists.set('rent', rentGroup);
  lists.set(
    'buy',
    lists.get('buy')!.filter((p) => !rentIds.has(p.providerId)),
  );

  const groups: WatchGroup[] = [];
  for (const [, type] of ORDER) {
    const list = lists.get(type)!;
    if (list.length === 0) continue;
    groups.push({ type: type === 'rent' && allAlsoBuy ? 'rent_buy' : type, providers: list });
  }
  if (groups.length === 0) return storedCount > 0 ? null : { ...base, status: 'none', groups: [] };
  return { ...base, status: 'available', groups };
}
