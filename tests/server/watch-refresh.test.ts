/** W-03 (ADR-012 §4): watch step budgets, skip-enriched, failures, dry run; weekly provider list. */
import { describe, expect, it, vi } from 'vitest';
import {
  mapProviderLists,
  refreshWatch,
  syncProviderLists,
  type WatchDueRow,
  type WatchSetRow,
} from '@/server/jobs/watch-refresh';

const REGIONS = ['US', 'GB'];
const due = (n: number, from = 1): WatchDueRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: from + i, media_type: 'movie', tmdb_id: 100 + i }));
const body = (region = 'US') => ({
  id: 1,
  results: { [region]: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] } },
});

describe('refreshWatch', () => {
  it('fetches every due row within the budget and saves in batches', async () => {
    const save = vi.fn(async (_rows: WatchSetRow[]) => {});
    const fetch = vi.fn(async () => body());
    const r = await refreshWatch(
      { due: async (limit) => due(Math.min(limit, 5)), fetch, save },
      { max: 5, regions: REGIONS, batchSize: 2 },
    );
    expect(r).toEqual({ due: 5, fetched: 5, failed: 0, regionsNone: 5, skippedEnriched: 0 });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[0]![0]).toEqual([
      {
        id: 1,
        watch: { US: { s: [8] } },
        providers: [{ provider_id: 8, name: 'Netflix', logo_path: null }],
      },
      {
        id: 2,
        watch: { US: { s: [8] } },
        providers: [{ provider_id: 8, name: 'Netflix', logo_path: null }],
      },
    ]);
  });

  it('ids enriched this run are skipped and do not eat the budget', async () => {
    const asked: number[] = [];
    const fetch = vi.fn(async (_row: WatchDueRow) => body());
    const r = await refreshWatch(
      {
        due: async (limit) => (asked.push(limit), due(limit)),
        fetch,
        save: async () => {},
      },
      { max: 3, regions: REGIONS, skipIds: new Set([1, 2]) },
    );
    expect(asked).toEqual([5]);
    expect(fetch.mock.calls.map(([row]) => row.id)).toEqual([3, 4, 5]);
    expect(r).toMatchObject({ due: 3, fetched: 3, skippedEnriched: 2 });
  });

  it('a thrown or malformed fetch counts as failed and saves nothing for that row', async () => {
    const save = vi.fn(async () => {});
    let i = 0;
    const r = await refreshWatch(
      {
        due: async () => due(3),
        fetch: async () => {
          i++;
          if (i === 1) throw new Error('503');
          if (i === 2) return { id: 1 }; // no results → not fetched
          return { id: 1, results: {} }; // fetched, nothing anywhere
        },
        save,
      },
      { max: 10, regions: REGIONS },
    );
    expect(r).toEqual({ due: 3, fetched: 1, failed: 2, regionsNone: 2, skippedEnriched: 0 });
    expect(save).toHaveBeenCalledWith([{ id: 3, watch: {}, providers: [] }]);
  });

  it('dry run: the due list only, 0 fetches, 0 saves', async () => {
    const fetch = vi.fn();
    const save = vi.fn();
    const r = await refreshWatch(
      { due: async () => due(4), fetch, save },
      { max: 10, regions: REGIONS, dryRun: true },
    );
    expect(r).toEqual({ due: 4, dry_run: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('SYNC_WATCH_MAX=0 → nothing is even listed', async () => {
    const d = vi.fn(async () => due(1));
    expect(
      await refreshWatch({ due: d, fetch: vi.fn(), save: vi.fn() }, { max: 0, regions: REGIONS }),
    ).toMatchObject({ due: 0, fetched: 0 });
    expect(d).not.toHaveBeenCalled();
  });
});

describe('mapProviderLists', () => {
  it('merges movie + tv lists per region, lowest priority wins, bad rows dropped', () => {
    const rows = mapProviderLists([
      {
        region: 'US',
        body: {
          results: [
            {
              provider_id: 8,
              provider_name: 'Netflix',
              logo_path: '/n.jpg',
              display_priorities: { US: 3 },
            },
            { provider_id: 0, provider_name: 'bad' },
            { provider_id: 9, provider_name: '' },
            null,
          ],
        },
      },
      {
        region: 'US',
        body: {
          results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { US: 1 } }],
        },
      },
      {
        region: 'GB',
        body: { results: [{ provider_id: 8, provider_name: 'Netflix', display_priority: 5 }] },
      },
      { region: 'GB', body: { nope: true } },
    ]);
    expect(rows).toEqual([
      { provider_id: 8, name: 'Netflix', logo_path: '/n.jpg', priorities: { US: 1, GB: 5 } },
    ]);
  });
});

describe('syncProviderLists (weekly)', () => {
  const NOW = new Date('2026-09-27T00:00:00Z');
  const list = async (_t: string, region: string) => ({
    results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { [region]: 1 } }],
  });

  it('not due within 7 days of the last sync: 0 calls', async () => {
    const fetchList = vi.fn(list);
    const r = await syncProviderLists(
      { lastSyncedAt: async () => '2026-09-25T00:00:00Z', fetchList, save: vi.fn() },
      { regions: REGIONS, configIds: [8], now: NOW },
    );
    expect(r).toEqual({ due: false });
    expect(fetchList).not.toHaveBeenCalled();
  });

  it('due (never or > 7 days): 2 calls per region, saves, reports dead config ids', async () => {
    const save = vi.fn(async () => {});
    const fetchList = vi.fn(list);
    const r = await syncProviderLists(
      { lastSyncedAt: async () => null, fetchList, save },
      { regions: REGIONS, configIds: [8, 424242], now: NOW },
    );
    expect(fetchList).toHaveBeenCalledTimes(4);
    expect(r).toEqual({ due: true, calls: 4, failed: 0, providers: 1, unknownConfigIds: [424242] });
    expect(save).toHaveBeenCalledWith([
      { provider_id: 8, name: 'Netflix', logo_path: null, priorities: { US: 1, GB: 1 } },
    ]);
  });

  it('any failed call → nothing saved (stays due, retried tomorrow)', async () => {
    const save = vi.fn();
    let n = 0;
    const r = await syncProviderLists(
      {
        lastSyncedAt: async () => '2026-09-01T00:00:00Z',
        fetchList: async (t, region) => {
          if (++n === 3) throw new Error('429');
          return list(t, region);
        },
        save,
      },
      { regions: REGIONS, configIds: [], now: NOW },
    );
    expect(r).toMatchObject({ due: true, calls: 4, failed: 1, providers: 0 });
    expect(save).not.toHaveBeenCalled();
  });

  it('dry run: reports due, 0 calls, 0 writes', async () => {
    const fetchList = vi.fn();
    const save = vi.fn();
    expect(
      await syncProviderLists(
        { lastSyncedAt: async () => null, fetchList, save },
        { regions: REGIONS, configIds: [], now: NOW, dryRun: true },
      ),
    ).toEqual({ due: true, dry_run: true });
    expect(fetchList).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
