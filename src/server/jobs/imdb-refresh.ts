/**
 * Nightly IMDb-rating refresh (ADR-008). Pure orchestration over injected I/O so it is unit-testable;
 * scripts/sync-catalog.ts wires it to Supabase RPCs (catalog_imdb_due / catalog_set_imdb) and OMDb.
 * OWNER: Backend (reference implementation by Architect). Not `server-only`: tsx imports it.
 *
 * - Asks the DB for at most `budget` due rows (the DB decides the tiered order).
 * - Looks each one up with small concurrency; unknown ids and "N/A" are saved as null ratings (marked
 *   checked, so they are not retried until their TTL).
 * - Stops cleanly on OmdbLimitError (quota exhausted / bad key): saves what it has, resumes tomorrow.
 * - Transient errors skip the row (left unchecked → retried next night).
 * - `dryRun`: reads the due list only; never calls `lookup` or `save` (ADR-011 §1).
 */
import type { ImdbRating } from '@/server/ports';
import { OmdbLimitError } from '@/server/providers/omdb';

export interface ImdbDueRow {
  id: number;
  imdb_id: string;
}

export interface ImdbSaveRow {
  id: number;
  rating: number | null;
  votes: number | null;
}

export interface ImdbRefreshDeps {
  due(limit: number): Promise<ImdbDueRow[]>;
  lookup(imdbId: string): Promise<ImdbRating | null>;
  save(rows: ImdbSaveRow[]): Promise<void>;
}

export interface ImdbRefreshResult {
  requested: number;
  looked_up: number;
  rated: number;
  no_rating: number;
  errors: number;
  stopped_by_limit: boolean;
}

/** `--dry-run` (ADR-011 §1): the due list only (read-only RPC), zero OMDb calls, nothing saved. */
export interface ImdbDryRunResult {
  due: number;
  dry_run: true;
}

export async function refreshImdbRatings(
  deps: ImdbRefreshDeps,
  budget: number,
  opts: { concurrency?: number; batchSize?: number; dryRun: true },
): Promise<ImdbDryRunResult>;
export async function refreshImdbRatings(
  deps: ImdbRefreshDeps,
  budget: number,
  opts?: { concurrency?: number; batchSize?: number; dryRun?: false },
): Promise<ImdbRefreshResult>;
export async function refreshImdbRatings(
  deps: ImdbRefreshDeps,
  budget: number,
  opts: { concurrency?: number; batchSize?: number; dryRun?: boolean } = {},
): Promise<ImdbRefreshResult | ImdbDryRunResult> {
  if (opts.dryRun) return { due: budget > 0 ? (await deps.due(budget)).length : 0, dry_run: true };
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const batchSize = Math.max(1, opts.batchSize ?? 100);
  const result: ImdbRefreshResult = {
    requested: 0,
    looked_up: 0,
    rated: 0,
    no_rating: 0,
    errors: 0,
    stopped_by_limit: false,
  };
  if (budget <= 0) return result;

  const rows = await deps.due(budget);
  result.requested = rows.length;
  let pending: ImdbSaveRow[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const out = pending;
    pending = [];
    await deps.save(out);
  };

  let next = 0;
  const worker = async () => {
    while (!result.stopped_by_limit) {
      const row = rows[next++];
      if (!row) return;
      try {
        const r = await deps.lookup(row.imdb_id);
        result.looked_up++;
        const rating = r?.rating ?? null;
        if (rating === null) result.no_rating++;
        else result.rated++;
        pending.push({ id: row.id, rating, votes: rating === null ? null : (r?.votes ?? null) });
        if (pending.length >= batchSize) await flush();
      } catch (e) {
        if (e instanceof OmdbLimitError) {
          result.stopped_by_limit = true;
          return;
        }
        result.errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, worker));
  await flush();
  return result;
}
