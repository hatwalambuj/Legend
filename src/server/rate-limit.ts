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
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '@/lib/errors';
import type { TrustedProxy } from '@/server/env';

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
  /** ID-5: per inbox (hashed email), on top of the per-IP limit, so one inbox can't be flooded. */
  magicLinkEmail: { max: 5, windowSec: 3600 },
  /** ADR-011 §3: GET/HEAD /api/health per IP. */
  health: { max: 60, windowSec: 60 },
  /** ADR-010 ID-2: PUT /api/auth/password per user. */
  setPassword: { max: 5, windowSec: 600 },
  /** ADR-012 §7: PUT /api/me/watch-region per IP. */
  watchRegion: { max: 30, windowSec: 60 },
  /** v1.6 (ADR-013 C-09): POST /api/events per IP (in memory, salted key). */
  events: { max: 60, windowSec: 60 },
  /** v1.6 (ADR-013 C-13): POST /api/log per IP, plus a per-process ceiling. */
  clientLog: { max: 10, windowSec: 60 },
  clientLogProcess: { max: 300, windowSec: 60 },
  /** v1.6 (ADR-013 C-11): import previews per user. */
  importPreview: { max: 20, windowSec: 3600 },
} as const;

/** Limits keyed by client IP: with TRUSTED_PROXY=none every client shares one key (ADR-001 §A3). */
const PER_IP: ReadonlySet<keyof typeof LIMITS> = new Set([
  'signIn',
  'signUp',
  'magicLink',
  'health',
  'watchRegion',
  'events',
  'clientLog',
]);

/**
 * Auth limits are best-effort. Demo mode (local data, E2E from one IP) gets 10× headroom so test
 * suites never trip them; per-IP limits get another 20× under `TRUSTED_PROXY=none`, where every client
 * shares the key `shared` (ADR-001 §A3). The export and set-password limits are per user and identical
 * in both modes.
 */
export function limitFor(
  name: keyof typeof LIMITS,
  demo: boolean,
  trust: TrustedProxy,
): { max: number; windowSec: number } {
  const l = LIMITS[name];
  const perUser =
    name === 'export' ||
    name === 'setPassword' ||
    name === 'importPreview' ||
    name === 'clientLogProcess';
  const factor = (demo && !perUser ? 10 : 1) * (trust === 'none' && PER_IP.has(name) ? 20 : 1);
  return factor === 1 ? l : { max: l.max * factor, windowSec: l.windowSec };
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

/**
 * Client address for per-IP limits, from the one header the configured edge overwrites
 * (TRUSTED_PROXY, ADR-001 §A3). `none` trusts no header: every client shares the key `shared`.
 * A missing header gives 'unknown' (also one shared key, never a free pass).
 */
export function clientIp(headers: Pick<Headers, 'get'>, trust: TrustedProxy): string {
  const h = (name: string) => headers.get(name)?.trim() || undefined;
  const xff = (h('x-forwarded-for') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let ip: string | undefined;
  if (trust === 'none') return 'shared';
  if (trust === 'vercel') ip = h('x-real-ip') ?? xff[0];
  else if (trust === 'netlify') ip = h('x-nf-client-connection-ip');
  else if (trust === 'cloudflare') ip = h('cf-connecting-ip');
  else ip = xff[xff.length - Number(trust.slice(4))];
  return ip || 'unknown';
}

/** ID-5: limiter key for an email. SHA-256 of the lower-cased address; the raw email is never kept. */
export function emailKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

/** Process-local salt: per-IP limiter keys can't be reversed or joined across restarts. */
const IP_SALT = randomBytes(16).toString('hex');

/**
 * v1.6 (ADR-013 C-09/C-13): an in-memory limiter key for an IP. Salted SHA-256, never stored, logged
 * or sent anywhere.
 */
export function ipKey(ip: string): string {
  return createHash('sha256').update(`${IP_SALT}:${ip}`).digest('hex').slice(0, 32);
}
