/** Pure parts of M1-01/M1-09: recheck dry run + cap + errored keys, carry-forward, IMDb dry run. */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CURATION_RULE } from '@/lib/curation';
import type { TitleKey } from '@/lib/types';
import {
  carryForwardRows,
  recheckCapReason,
  recheckMissing,
  STAGING_COLUMNS,
  type MapContext,
  type StagingRow,
} from '@/server/jobs/discover';
import { refreshImdbRatings } from '@/server/jobs/imdb-refresh';

const ctx: MapContext = {
  runId: 'run',
  rule: DEFAULT_CURATION_RULE,
  today: '2026-09-27',
  previouslyListed: new Set(),
  genreNames: new Map(),
};
const keys = (n: number) => Array.from({ length: n }, (_, i) => `movie:${i + 1}` as TitleKey);

describe('recheckMissing', () => {
  it('dry run: no detail call, every missing title counts as skipped', async () => {
    const detail = vi.fn();
    expect(await recheckMissing({ detail }, keys(4), ctx, 500, { dryRun: true })).toEqual({
      rows: [],
      gone: [],
      skipped: 4,
      errors: 0,
      erroredKeys: [],
      dryRun: true,
    });
    expect(detail).not.toHaveBeenCalled();
  });

  it('501 missing with cap 500 → 500 calls, skipped 1, cap reason', async () => {
    const detail = vi.fn(async () => null);
    const r = await recheckMissing({ detail }, keys(501), ctx, 500);
    expect(detail).toHaveBeenCalledTimes(500);
    expect(r.skipped).toBe(1);
    expect(recheckCapReason(501, 500)).toBe(
      'recheck_capped: 501 missing titles exceed SYNC_RECHECK_MAX=500',
    );
    expect(recheckCapReason(500, 500)).toBeNull();
  });

  it('returns errored keys for carry-forward', async () => {
    const detail = vi.fn(async (_t: string, id: number) => {
      if (id !== 2) throw new Error('TMDB 502');
      return null;
    });
    const r = await recheckMissing({ detail }, keys(4), ctx);
    expect(r.errors).toBe(3);
    expect(r.erroredKeys).toEqual(['movie:1', 'movie:3', 'movie:4']);
    expect(r.gone).toEqual(['movie:2']);
  });
});

describe('carryForwardRows', () => {
  it('stages the current row unchanged under the new run id (listed stays listed)', () => {
    const current = Object.fromEntries(STAGING_COLUMNS.map((c) => [c, `v-${c}`])) as Record<
      string,
      unknown
    >;
    current.is_listed = true;
    const [row] = carryForwardRows(
      [{ ...current, extra: 'dropped' } as unknown as Omit<StagingRow, 'run_id'>],
      'run-2',
    );
    expect(Object.keys(row!).sort()).toEqual(['run_id', ...STAGING_COLUMNS].sort());
    expect(row).toMatchObject({ run_id: 'run-2', is_listed: true, title: 'v-title' });
  });
});

describe('refreshImdbRatings dry run', () => {
  it('reads the due list and never calls lookup or save', async () => {
    const due = vi.fn(async () => [
      { id: 1, imdb_id: 'tt0000001' },
      { id: 2, imdb_id: 'tt0000002' },
    ]);
    const lookup = vi.fn();
    const save = vi.fn();
    expect(await refreshImdbRatings({ due, lookup, save }, 900, { dryRun: true })).toEqual({
      due: 2,
      dry_run: true,
    });
    expect(due).toHaveBeenCalledWith(900);
    expect(lookup).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
