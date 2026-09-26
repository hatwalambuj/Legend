/**
 * Minimal circuit breaker for runtime TMDB calls (SYSTEM_DESIGN §9): opens after `threshold` failures
 * within `windowMs`, stays open for `openMs`, then lets ONE trial call through (half-open). A success
 * closes it; a failed trial re-opens it. Per process (module scope), which is what we want on serverless.
 * OWNER: Backend.
 */
export class CircuitOpenError extends Error {
  override name = 'CircuitOpenError';
}

export type BreakerState = 'closed' | 'open' | 'half_open';

export class CircuitBreaker {
  private failures: number[] = [];
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly opts: { threshold?: number; windowMs?: number; openMs?: number } = {},
    private readonly now: () => number = Date.now,
  ) {}

  private get threshold() {
    return this.opts.threshold ?? 5;
  }
  private get windowMs() {
    return this.opts.windowMs ?? 30_000;
  }
  private get openMs() {
    return this.opts.openMs ?? 60_000;
  }

  state(): BreakerState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.openMs ? 'half_open' : 'open';
  }

  /**
   * Runs `fn` unless the circuit is open. Only errors for which `isFailure(e)` is true count
   * (e.g. a TMDB 404 is an answer, not an outage).
   */
  async run<T>(fn: () => Promise<T>, isFailure: (e: unknown) => boolean = () => true): Promise<T> {
    const st = this.state();
    if (st === 'open' || (st === 'half_open' && this.trialInFlight))
      throw new CircuitOpenError('TMDB circuit open');
    const trial = st === 'half_open';
    if (trial) this.trialInFlight = true;
    try {
      const out = await fn();
      this.failures = [];
      this.openedAt = null;
      return out;
    } catch (e) {
      if (isFailure(e)) this.recordFailure(trial);
      else if (trial) this.openedAt = null; // a definitive answer proves the upstream is up
      throw e;
    } finally {
      if (trial) this.trialInFlight = false;
    }
  }

  private recordFailure(trial: boolean) {
    const t = this.now();
    if (trial) {
      this.openedAt = t;
      return;
    }
    this.failures = this.failures.filter((x) => t - x < this.windowMs);
    this.failures.push(t);
    if (this.failures.length >= this.threshold) {
      this.openedAt = t;
      this.failures = [];
    }
  }
}
