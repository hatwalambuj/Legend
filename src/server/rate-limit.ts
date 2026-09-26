/**
 * Rate limiting (PRD E5, SYSTEM_DESIGN §9, API_CONTRACT §2 `rate_limited`).
 *
 * - Stubs (30/min) and reviews (10/min, inserts + edits) are enforced where the write happens: Postgres
 *   triggers in live mode, the memory repositories (atomically, inside the store mutation) in demo mode.
 * - Everything else (export 1 per 10 min per user, auth endpoints per IP) goes through a
 *   `RateLimiter`: `MemoryRateLimiter` (per process; demo mode and best-effort auth throttling) or the
 *   Supabase implementation backed by `public.consume_rate_limit()` (correct across serverless instances).
 * OWNER: Backend.
 */
import { AppError } from '@/lib/errors';

export type RateDecision = { ok: true } | { ok: false; retryAfter: number };

export interface RateLimiter {
  /** Records one hit for `key` if allowed. `max` hits per rolling `windowSec`. */
  consume(key: string, max: number, windowSec: number): Promise<RateDecision>;
}

/** Named limits used by routes. */
export const LIMITS = {
  export: { max: 1, windowSec: 600 },
  signIn: { max: 10, windowSec: 60 },
  signUp: { max: 5, windowSec: 600 },
  magicLink: { max: 5, windowSec: 600 },
} as const;

/**
 * Auth limits are per IP and best-effort. Demo mode (local data, E2E from one IP) gets 10× headroom so
 * test suites never trip them; the export limit is per user and identical in both modes.
 */
export function limitFor(
  name: keyof typeof LIMITS,
  demo: boolean,
): { max: number; windowSec: number } {
  const l = LIMITS[name];
  return demo && name !== 'export' ? { max: l.max * 10, windowSec: l.windowSec } : l;
}

/**
 * Seconds until the oldest of the hits in the window leaves it (>= 1). `hitsMs` are epoch millis of the
 * hits still inside the window, `max` the allowance.
 */
export function retryAfterSeconds(
  hitsMs: readonly number[],
  max: number,
  windowSec: number,
  nowMs: number,
): number {
  const sorted = [...hitsMs].sort((a, b) => a - b);
  // The hit that must expire before a new one is allowed.
  const blocking = sorted[sorted.length - max] ?? sorted[0] ?? nowMs;
  return Math.max(1, Math.ceil((blocking + windowSec * 1000 - nowMs) / 1000));
}

/** Sliding-window limiter in process memory. Bounded: prunes expired keys as it goes. */
export class MemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  async consume(key: string, max: number, windowSec: number): Promise<RateDecision> {
    return this.consumeSync(key, max, windowSec);
  }

  consumeSync(key: string, max: number, windowSec: number): RateDecision {
    const now = this.now();
    const since = now - windowSec * 1000;
    const list = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (list.length >= max) {
      this.hits.set(key, list);
      return { ok: false, retryAfter: retryAfterSeconds(list, max, windowSec, now) };
    }
    list.push(now);
    this.hits.delete(key); // re-insert → Map keeps insertion order ≈ LRU
    this.hits.set(key, list);
    if (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest !== undefined) this.hits.delete(oldest);
    }
    return { ok: true };
  }

  reset(): void {
    this.hits.clear();
  }
}

/** Throw the contract's 429 when a decision is negative. */
export function enforce(decision: RateDecision, message: string): void {
  if (!decision.ok)
    throw new AppError('rate_limited', message, { retryAfter: decision.retryAfter });
}

/** Demo-mode check for repository writes: `recentIsoTimes` = createdAt/updatedAt of the user's rows. */
export function assertUnderLimit(
  recentIsoTimes: readonly string[],
  max: number,
  message: string,
  nowMs: number = Date.now(),
  windowSec = 60,
): void {
  const since = nowMs - windowSec * 1000;
  const inWindow = recentIsoTimes.map((s) => Date.parse(s)).filter((t) => t > since);
  if (inWindow.length >= max)
    throw new AppError('rate_limited', message, {
      retryAfter: retryAfterSeconds(inWindow, max, windowSec, nowMs),
    });
}

/** Client address for per-IP limits (first X-Forwarded-For hop, as set by Vercel), or 'unknown'. */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  const first = xff?.split(',')[0]?.trim();
  return first || headers.get('x-real-ip')?.trim() || 'unknown';
}
