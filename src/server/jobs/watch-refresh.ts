/**
 * Nightly "Where to watch" steps (ADR-012 §4). Pure orchestration over injected I/O so budgets, dry
 * runs and failure handling are unit-tested; scripts/sync-catalog.ts wires it to Supabase + TMDB.
 * Not `server-only`: tsx imports it. OWNER: Backend. No AI (D15); nothing is posted anywhere (ADR-008).
 *
 * watch step
 * - `catalog_watch_due` (≤ SYNC_WATCH_MAX) minus the ids the enrich step already refreshed this run →
 *   `GET /3/{type}/{id}/watch/providers` per title (the caller throttles to the job's 10 req/s).
 * - A failed fetch (or a malformed body) leaves stored data and `watch_checked_at` untouched.
 * - Dry run: the due list only (read-only RPC); 0 fetches, 0 writes (ADR-011 §1).
 *
 * provider-list step (weekly)
 * - Runs when the newest `priorities_at` is null or older than 7 days: 2 calls × WATCH_REGIONS.
 * - Logs ids from src/lib/provider-links.ts that TMDB does not return in any region (dead config).
 * - Dry run: reports whether it is due; 0 calls, 0 writes.
 */
import {
  logoPathOf,
  mapWatchProviders,
  providerIdOf,
  providerName,
  regionsWithNone,
  type WatchProviderRow,
} from './watch-map';
import type { MediaType, WatchStore } from '@/lib/types';

export interface WatchDueRow {
  id: number;
  media_type: MediaType;
  tmdb_id: number;
}

/** One row for rpc('catalog_set_watch'). */
export interface WatchSetRow {
  id: number;
  watch: WatchStore;
  providers: WatchProviderRow[];
}

export interface WatchCounts {
  due: number;
  fetched: number;
  failed: number;
  /** (title, supported region) pairs with no provider after a successful fetch. */
  regionsNone: number;
  /** Skipped because the enrich step already refreshed them this run. */
  skippedEnriched: number;
}

export interface WatchDryRunCounts {
  due: number;
  dry_run: true;
}

export interface WatchRefreshDeps {
  due(limit: number): Promise<WatchDueRow[]>;
  /** The standalone `/watch/providers` body. Throws on network/HTTP errors. */
  fetch(row: WatchDueRow): Promise<unknown>;
  save(rows: WatchSetRow[]): Promise<void>;
}

export async function refreshWatch(
  deps: WatchRefreshDeps,
  opts: {
    max: number;
    regions: readonly string[];
    /** catalog ids refreshed by the enrich step in this run. */
    skipIds?: ReadonlySet<number>;
    dryRun?: boolean;
    batchSize?: number;
  },
): Promise<WatchCounts | WatchDryRunCounts> {
  const max = Math.max(0, Math.floor(opts.max));
  if (max === 0) return opts.dryRun ? { due: 0, dry_run: true } : emptyCounts();
  const skip = opts.skipIds ?? new Set<number>();
  // Ask for extra rows so ids enriched this run don't eat the budget.
  const listed = await deps.due(max + Math.min(skip.size, max));
  const rows = listed.filter((r) => !skip.has(r.id)).slice(0, max);
  if (opts.dryRun) return { due: rows.length, dry_run: true };
  const counts: WatchCounts = {
    ...emptyCounts(),
    due: rows.length,
    skippedEnriched: listed.length - listed.filter((r) => !skip.has(r.id)).length,
  };
  const batch: WatchSetRow[] = [];
  const size = Math.max(1, opts.batchSize ?? 200);
  for (const r of rows) {
    let mapped: ReturnType<typeof mapWatchProviders> = null;
    try {
      mapped = mapWatchProviders(await deps.fetch(r), opts.regions);
    } catch {
      mapped = null;
    }
    if (!mapped) {
      counts.failed++; // stays due; retried next night, stored data untouched
      continue;
    }
    counts.fetched++;
    counts.regionsNone += regionsWithNone(mapped.watch, opts.regions);
    batch.push({ id: r.id, watch: mapped.watch, providers: mapped.providers });
    if (batch.length >= size) await deps.save(batch.splice(0));
  }
  if (batch.length) await deps.save(batch.splice(0));
  return counts;
}

function emptyCounts(): WatchCounts {
  return { due: 0, fetched: 0, failed: 0, regionsNone: 0, skippedEnriched: 0 };
}

/* ------------------------------------------------------------------ */
/* Weekly provider list                                                */
/* ------------------------------------------------------------------ */

export const PROVIDER_LIST_MAX_AGE_DAYS = 7;

export interface ProviderPriorityRow extends WatchProviderRow {
  priorities: Record<string, number>;
}

/**
 * Merges `GET /3/watch/providers/{movie|tv}?watch_region=R` bodies into one row per provider with its
 * priority per region (lowest of movie/tv). Uses `display_priorities[R]`, else `display_priority`.
 */
export function mapProviderLists(
  lists: { region: string; body: unknown }[],
): ProviderPriorityRow[] {
  const out = new Map<number, ProviderPriorityRow>();
  for (const { region, body } of lists) {
    const results =
      body && typeof body === 'object' ? (body as { results?: unknown }).results : undefined;
    if (!Array.isArray(results)) continue;
    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = providerIdOf(o.provider_id);
      const name = providerName(o.provider_name);
      if (id === null || !name) continue;
      const byRegion = o.display_priorities as Record<string, unknown> | undefined;
      const raw = byRegion && typeof byRegion === 'object' ? byRegion[region] : undefined;
      const p =
        typeof raw === 'number' && Number.isFinite(raw)
          ? raw
          : typeof o.display_priority === 'number' && Number.isFinite(o.display_priority)
            ? o.display_priority
            : null;
      const row = out.get(id) ?? {
        provider_id: id,
        name,
        logo_path: logoPathOf(o.logo_path),
        priorities: {},
      };
      if (p !== null && (row.priorities[region] === undefined || p < row.priorities[region]!))
        row.priorities[region] = Math.round(p);
      out.set(id, row);
    }
  }
  return [...out.values()].sort((a, b) => a.provider_id - b.provider_id);
}

export interface ProviderListDeps {
  /** Newest `watch_provider.priorities_at`, or null when never synced. */
  lastSyncedAt(): Promise<string | null>;
  fetchList(mediaType: MediaType, region: string): Promise<unknown>;
  save(rows: ProviderPriorityRow[]): Promise<void>;
}

export interface ProviderListCounts {
  due: boolean;
  calls?: number;
  failed?: number;
  providers?: number;
  /** provider-links config ids TMDB returned in no region (candidates for removal). */
  unknownConfigIds?: number[];
  dry_run?: true;
}

export async function syncProviderLists(
  deps: ProviderListDeps,
  opts: {
    regions: readonly string[];
    configIds: readonly number[];
    now?: Date;
    dryRun?: boolean;
    maxAgeDays?: number;
  },
): Promise<ProviderListCounts> {
  const now = opts.now ?? new Date();
  const last = await deps.lastSyncedAt();
  const ageMs = last ? now.getTime() - Date.parse(last) : Number.POSITIVE_INFINITY;
  const due =
    !Number.isFinite(ageMs) || ageMs > (opts.maxAgeDays ?? PROVIDER_LIST_MAX_AGE_DAYS) * 86_400_000;
  if (opts.dryRun) return { due, dry_run: true };
  if (!due) return { due };
  const lists: { region: string; body: unknown }[] = [];
  let calls = 0;
  let failed = 0;
  for (const region of opts.regions)
    for (const type of ['movie', 'tv'] as const) {
      calls++;
      try {
        lists.push({ region, body: await deps.fetchList(type, region) });
      } catch {
        failed++;
      }
    }
  // Any call failed: keep the old priorities (a partial save would drop regions) and stay due; retried
  // tomorrow. Names/logos still arrive through every catalog_set_watch.
  if (failed > 0) return { due, calls, failed, providers: 0 };
  const rows = mapProviderLists(lists);
  if (rows.length) await deps.save(rows);
  const seen = new Set(rows.map((r) => r.provider_id));
  return {
    due,
    calls,
    failed,
    providers: rows.length,
    unknownConfigIds: opts.configIds.filter((id) => !seen.has(id)),
  };
}
