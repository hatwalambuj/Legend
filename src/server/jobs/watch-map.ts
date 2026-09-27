/**
 * "Where to watch" mapping (ADR-012 §1–2): TMDB watch/providers → our compact `WatchStore`.
 * Pure and deterministic (no AI, D15). Used by the nightly enrich step (appended `watch/providers`) and
 * the standalone watch step (`GET /3/{type}/{id}/watch/providers`). OWNER: Backend.
 *
 * Upstream shape (Observed in docs extracts; the exact append key is Unverified, pinned by
 * tests/server/fixtures/tmdb-watch-providers.json):
 *   { id, results: { [ISO-3166-1]: { link, flatrate?, free?, ads?, rent?, buy? } } }
 *   item = { provider_id, provider_name, logo_path, display_priority }
 *
 * Tolerance rules
 * - The appended object is read from `body["watch/providers"]` (also accepted: `body.watch.providers`).
 *   Missing or malformed → `null` = "not fetched": the caller must NOT touch stored data (a wrong key
 *   never wipes availability). It is counted (`watchMissing`) so a renamed key is visible in sync_runs.
 * - Items with a non-integer or <= 0 `provider_id` are dropped; a missing `display_priority` sorts last.
 * - The upstream `link` is never stored or rendered (§6.3); `linkMismatches` only compares it with ours.
 */
import { PROVIDER_LOGO_PATH_RE } from '@/lib/images';
import { tmdbWatchHref } from '@/lib/provider-links';
import type { MediaType, WatchRegionStore, WatchStore } from '@/lib/types';

/** TMDB list key → our storage key. Unknown keys are dropped. */
export const WATCH_TYPE_KEYS = {
  flatrate: 's',
  free: 'f',
  ads: 'a',
  rent: 'r',
  buy: 'b',
} as const satisfies Record<string, keyof WatchRegionStore>;

/** Max providers stored per type and region. */
export const WATCH_TYPE_CAP = 30;

/** One `watch_provider` upsert (names/logos only; priorities come from the weekly list sync). */
export interface WatchProviderRow {
  provider_id: number;
  name: string;
  logo_path: string | null;
}

export interface MappedWatch {
  /** Regions with at least one provider. A supported region absent here = "none in R". */
  watch: WatchStore;
  providers: WatchProviderRow[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export const providerIdOf = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 2_147_483_647 ? v : null;

export function providerName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? [...s].slice(0, 80).join('') : null;
}

export function logoPathOf(v: unknown): string | null {
  return typeof v === 'string' && PROVIDER_LOGO_PATH_RE.test(v) ? v : null;
}

const priorityOf = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;

/** The `{ id, results }` object of a detail body with the append, or null when it isn't there. */
export function watchProvidersOf(detailBody: unknown): Obj | null {
  if (!isObj(detailBody)) return null;
  const direct = detailBody['watch/providers'];
  if (isObj(direct)) return direct;
  const nested = isObj(detailBody.watch) ? detailBody.watch.providers : undefined;
  return isObj(nested) ? nested : null;
}

/**
 * Maps a standalone `/watch/providers` body (`{ id, results }`). null when `results` is not an object
 * (malformed = not fetched). Regions are matched upper-case against `regions`.
 */
export function mapWatchProviders(body: unknown, regions: readonly string[]): MappedWatch | null {
  if (!isObj(body) || !isObj(body.results)) return null;
  const wanted = new Set(regions);
  const watch: WatchStore = {};
  const providers = new Map<number, WatchProviderRow>();
  for (const [rawRegion, entry] of Object.entries(body.results)) {
    const region = rawRegion.toUpperCase();
    if (!/^[A-Z]{2}$/.test(region) || !wanted.has(region) || !isObj(entry)) continue;
    const store: WatchRegionStore = {};
    for (const [tmdbKey, key] of Object.entries(WATCH_TYPE_KEYS)) {
      const list = entry[tmdbKey];
      if (!Array.isArray(list)) continue;
      const best = new Map<number, number>(); // id → lowest priority
      for (const item of list) {
        if (!isObj(item)) continue;
        const id = providerIdOf(item.provider_id);
        if (id === null) continue;
        const p = priorityOf(item.display_priority);
        if (!best.has(id) || p < best.get(id)!) best.set(id, p);
        const name = providerName(item.provider_name);
        if (name && !providers.has(id))
          providers.set(id, { provider_id: id, name, logo_path: logoPathOf(item.logo_path) });
      }
      const ids = [...best]
        .sort((a, b) => a[1] - b[1] || a[0] - b[0])
        .slice(0, WATCH_TYPE_CAP)
        .map(([id]) => id);
      if (ids.length) store[key] = ids;
    }
    if (Object.keys(store).length) watch[region] = store;
  }
  return {
    watch,
    providers: [...providers.values()].sort((a, b) => a.provider_id - b.provider_id),
  };
}

/** `mapTmdbWatch(raw, regions)` (ADR-012 §2): the appended part of an enrich detail body. */
export function mapTmdbWatch(detailBody: unknown, regions: readonly string[]): MappedWatch | null {
  const wp = watchProvidersOf(detailBody);
  return wp ? mapWatchProviders(wp, regions) : null;
}

/**
 * How many supported regions carry an upstream `link` that differs from our derived TMDB watch URL
 * (logged per run; ADR-012 §1: we never render the upstream link, this only checks our assumption).
 */
export function linkMismatches(
  body: unknown,
  mediaType: MediaType,
  tmdbId: number,
  regions: readonly string[],
): number {
  if (!isObj(body) || !isObj(body.results)) return 0;
  let n = 0;
  for (const region of regions) {
    const entry = body.results[region];
    if (!isObj(entry) || typeof entry.link !== 'string') continue;
    if (entry.link !== tmdbWatchHref(mediaType, tmdbId, region)) n++;
  }
  return n;
}

/** Supported regions with no provider after a successful fetch (sync_runs `regionsNone`). */
export function regionsWithNone(watch: WatchStore, regions: readonly string[]): number {
  return regions.filter((r) => !watch[r]).length;
}
