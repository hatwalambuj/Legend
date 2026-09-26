import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  MemoryRateLimiter,
  assertUnderLimit,
  clientIp,
  enforce,
  limitFor,
  retryAfterSeconds,
} from './rate-limit';

describe('MemoryRateLimiter', () => {
  it('allows max hits per rolling window per key and reports the wait', async () => {
    let now = 1_000_000;
    const l = new MemoryRateLimiter(() => now);
    expect(await l.consume('a', 2, 60)).toEqual({ ok: true });
    now += 10_000;
    expect(await l.consume('a', 2, 60)).toEqual({ ok: true });
    now += 5_000;
    expect(await l.consume('a', 2, 60)).toEqual({ ok: false, retryAfter: 45 });
    expect(await l.consume('b', 2, 60)).toEqual({ ok: true });
    now += 45_001;
    expect(await l.consume('a', 2, 60)).toEqual({ ok: true });
  });

  it('bounds memory by evicting the least recently used key', () => {
    const l = new MemoryRateLimiter(() => 0, 2);
    l.consumeSync('a', 1, 60);
    l.consumeSync('b', 1, 60);
    l.consumeSync('c', 1, 60); // evicts a
    expect(l.consumeSync('a', 1, 60)).toEqual({ ok: true });
  });
});

describe('helpers', () => {
  it('computes Retry-After from the blocking hit', () => {
    expect(retryAfterSeconds([0, 30_000], 2, 60, 40_000)).toBe(20);
    expect(retryAfterSeconds([0], 1, 60, 59_999)).toBe(1);
  });

  it('assertUnderLimit throws rate_limited with retryAfter like the DB trigger', () => {
    const now = Date.parse('2026-09-26T12:01:00Z');
    const times = Array.from({ length: 30 }, (_, i) => new Date(now - 50_000 + i).toISOString());
    try {
      assertUnderLimit(times, 30, 'slow down', now);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('rate_limited');
      expect((e as AppError).status).toBe(429);
      expect((e as AppError).retryAfter).toBe(10);
    }
    expect(() => assertUnderLimit(times.slice(1), 30, 'ok', now)).not.toThrow();
    expect(() => assertUnderLimit(times, 30, 'old', now + 60_000)).not.toThrow();
  });

  it('enforce, clientIp and demo headroom', () => {
    expect(() => enforce({ ok: false, retryAfter: 5 }, 'x')).toThrow(AppError);
    expect(() => enforce({ ok: true }, 'x')).not.toThrow();
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4');
    expect(clientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(new Headers())).toBe('unknown');
    expect(limitFor('signIn', true).max).toBe(100);
    expect(limitFor('signIn', false).max).toBe(10);
    expect(limitFor('export', true).max).toBe(1);
  });
});
