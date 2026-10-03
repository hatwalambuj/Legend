/**
 * Nightly job orchestration (ADR-011 §2), pure over injected steps so the order and the abort/dry-run
 * rules are unit-tested; scripts/sync-catalog.ts keeps the Supabase/TMDB/OMDb wiring.
 *
 * - A guardrail failure blocks only discover's apply (index membership). Enrich, IMDb, palettes, the
 *   disagreement report and the purge still run on the existing index; the run ends `aborted` (exit 1).
 * - A thrown error ends the run `failed` and skips the remaining steps (rethrown → exit 1).
 * - Revalidation runs only when a step wrote at least one row.
 * - Dry run: no bookkeeping, no purge, no revalidation (and every step spends no budget, ADR-011 §1).
 * Not `server-only`: tsx imports it. OWNER: Backend.
 */

export type SyncStep = 'discover' | 'enrich' | 'watch' | 'imdb';
export type RunStatus = 'ok' | 'aborted' | 'failed';

export interface StepResult {
  /** Recorded in sync_runs.counts under the step name. */
  counts: unknown;
  /** Rows written (0 in a dry run). Any > 0 triggers revalidation. */
  wrote: number;
  /** Extra cache tags to revalidate with `catalog` (e.g. `watch-providers`, ADR-012 §6.2). */
  tags?: string[];
}

export interface DiscoverResult extends StepResult {
  /** Guardrail reasons: non-empty = the apply was skipped and the run ends `aborted`. */
  aborted?: string[];
}

export interface SyncSteps {
  startRun(): Promise<void>;
  finishRun(status: RunStatus, counts: Record<string, unknown>, error?: string): Promise<void>;
  discover(opts: { dryRun: boolean }): Promise<DiscoverResult>;
  enrich(opts: { dryRun: boolean }): Promise<StepResult>;
  /** ADR-012 §4: availability refresh + weekly provider list (after enrich, before imdb). */
  watch(opts: { dryRun: boolean }): Promise<StepResult>;
  imdb(opts: { dryRun: boolean }): Promise<StepResult>;
  palettes(opts: { dryRun: boolean }): Promise<StepResult>;
  disagreements(): Promise<unknown>;
  purge(): Promise<unknown>;
  /** v1.6 (ADR-013 C-09): `events_purge` retention; full non-dry runs only. Optional for older wiring. */
  eventsPurge?(): Promise<unknown>;
  revalidate(tags: string[]): Promise<unknown>;
}

export async function runSync(
  steps: SyncSteps,
  args: { dryRun: boolean; only: SyncStep | null },
): Promise<{ status: 'ok' | 'aborted'; counts: Record<string, unknown>; reasons: string[] }> {
  const { dryRun } = args;
  const run = (s: SyncStep) => args.only === null || args.only === s;
  const counts: Record<string, unknown> = {};
  let reasons: string[] = [];
  let wrote = 0;
  const tags = new Set<string>(['catalog']);
  const record = (name: string, r: StepResult) => {
    counts[name] = r.counts;
    wrote += r.wrote;
    for (const t of r.tags ?? []) tags.add(t);
  };

  if (!dryRun) await steps.startRun();
  try {
    if (run('discover')) {
      const d = await steps.discover({ dryRun });
      record('discover', d);
      reasons = d.aborted ?? [];
    }
    if (run('enrich')) record('enrich', await steps.enrich({ dryRun }));
    if (run('watch')) record('watch', await steps.watch({ dryRun }));
    if (run('imdb')) record('imdb', await steps.imdb({ dryRun }));
    // Palettes, the report and the purge belong to full runs (not --only=enrich|watch|imdb).
    if (run('discover')) {
      record('palettes', await steps.palettes({ dryRun }));
      counts.disagreements = await steps.disagreements();
      if (!dryRun) counts.purge = await steps.purge();
      if (!dryRun && steps.eventsPurge) counts.events_purge = await steps.eventsPurge();
    }
    if (!dryRun && wrote > 0) counts.revalidate = await steps.revalidate([...tags]);
    const status = reasons.length ? 'aborted' : 'ok';
    if (!dryRun)
      await steps.finishRun(status, counts, reasons.length ? reasons.join('; ') : undefined);
    return { status, counts, reasons };
  } catch (e) {
    if (!dryRun)
      await steps.finishRun('failed', counts, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
