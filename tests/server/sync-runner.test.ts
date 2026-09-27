/** Nightly job orchestration (ADR-011 §2): abort scope, failures, dry run, revalidation. */
import { describe, expect, it, vi } from 'vitest';
import { runSync, type SyncSteps } from '@/server/jobs/sync-runner';

function fakeSteps(over: Partial<SyncSteps> = {}) {
  const calls: string[] = [];
  const step =
    (name: string, wrote = 1) =>
    async () => {
      calls.push(name);
      return { counts: { name }, wrote };
    };
  const steps: SyncSteps = {
    startRun: vi.fn(async () => void calls.push('startRun')),
    finishRun: vi.fn(async () => void calls.push('finishRun')),
    discover: step('discover'),
    enrich: step('enrich'),
    watch: step('watch'),
    imdb: step('imdb'),
    palettes: step('palettes'),
    disagreements: vi.fn(async () => (calls.push('disagreements'), 0)),
    purge: vi.fn(async () => (calls.push('purge'), { purged: 0 })),
    revalidate: vi.fn(async () => (calls.push('revalidate'), { status: 200 })),
    ...over,
  };
  return { steps, calls };
}

describe('runSync', () => {
  it('guard pass → every step once, in order, status ok', async () => {
    const { steps, calls } = fakeSteps();
    const r = await runSync(steps, { dryRun: false, only: null });
    expect(r.status).toBe('ok');
    expect(calls).toEqual([
      'startRun',
      'discover',
      'enrich',
      'watch',
      'imdb',
      'palettes',
      'disagreements',
      'purge',
      'revalidate',
      'finishRun',
    ]);
    expect(steps.finishRun).toHaveBeenCalledWith('ok', r.counts, undefined);
    expect(steps.revalidate).toHaveBeenCalledWith(['catalog']);
  });

  it('guard fail → apply skipped inside discover, but enrich/imdb/palettes/purge still run once; aborted', async () => {
    const { steps, calls } = fakeSteps({
      discover: async () => {
        calls.push('discover');
        return { counts: { aborted: ['movie: low'] }, wrote: 0, aborted: ['movie: low', 'tv: Δ'] };
      },
    });
    const r = await runSync(steps, { dryRun: false, only: null });
    expect(r.status).toBe('aborted');
    expect(r.reasons).toEqual(['movie: low', 'tv: Δ']);
    for (const s of ['enrich', 'watch', 'imdb', 'palettes', 'purge'])
      expect(calls.filter((c) => c === s)).toHaveLength(1);
    // enrich/imdb/palettes wrote rows → fresh IMDb chips are revalidated even on an aborted night.
    expect(steps.revalidate).toHaveBeenCalledTimes(1);
    expect(steps.finishRun).toHaveBeenCalledWith('aborted', r.counts, 'movie: low; tv: Δ');
    expect(r.counts.discover).toEqual({ aborted: ['movie: low'] });
  });

  it('a throwing step → failed, later steps skipped, error rethrown', async () => {
    const { steps, calls } = fakeSteps({
      enrich: async () => {
        calls.push('enrich');
        throw new Error('rpc catalog_enrich_due: boom');
      },
    });
    await expect(runSync(steps, { dryRun: false, only: null })).rejects.toThrow('boom');
    expect(calls).toEqual(['startRun', 'discover', 'enrich', 'finishRun']);
    expect(steps.finishRun).toHaveBeenCalledWith(
      'failed',
      expect.objectContaining({ discover: { name: 'discover' } }),
      'rpc catalog_enrich_due: boom',
    );
  });

  it('dry run → no bookkeeping, purge or revalidate', async () => {
    const { steps, calls } = fakeSteps();
    const r = await runSync(steps, { dryRun: true, only: null });
    expect(r.status).toBe('ok');
    expect(calls).toEqual(['discover', 'enrich', 'watch', 'imdb', 'palettes', 'disagreements']);
    for (const f of [steps.startRun, steps.finishRun, steps.purge, steps.revalidate])
      expect(f).not.toHaveBeenCalled();
  });

  it('--only runs one step; revalidates only when something was written', async () => {
    const { steps, calls } = fakeSteps({
      imdb: async () => (calls.push('imdb'), { counts: {}, wrote: 0 }),
    });
    await runSync(steps, { dryRun: false, only: 'imdb' });
    expect(calls).toEqual(['startRun', 'imdb', 'finishRun']);
    const enrichOnly = fakeSteps();
    await runSync(enrichOnly.steps, { dryRun: false, only: 'enrich' });
    expect(enrichOnly.calls).toEqual(['startRun', 'enrich', 'revalidate', 'finishRun']);
  });

  it('--only=watch runs the watch step; its extra tags are revalidated with catalog (ADR-012 §6.2)', async () => {
    const { steps, calls } = fakeSteps({
      watch: async () => (
        calls.push('watch'),
        { counts: { due: 1 }, wrote: 1, tags: ['watch-providers'] }
      ),
    });
    const r = await runSync(steps, { dryRun: false, only: 'watch' });
    expect(calls).toEqual(['startRun', 'watch', 'revalidate', 'finishRun']);
    expect(steps.revalidate).toHaveBeenCalledWith(['catalog', 'watch-providers']);
    expect(r.counts.watch).toEqual({ due: 1 });
  });
});
