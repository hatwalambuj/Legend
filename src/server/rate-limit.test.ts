import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  MemoryRateLimiter,
  assertUnderLimit,
  clientIp,
  emailKey,
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

  it('enforce and demo / TRUSTED_PROXY=none headroom', () => {
    expect(() => enforce({ ok: false, retryAfter: 5 }, 'x')).toThrow(AppError);
    expect(() => enforce({ ok: true }, 'x')).not.toThrow();
    expect(limitFor('signIn', true, 'vercel').max).toBe(100);
    expect(limitFor('signIn', false, 'vercel').max).toBe(10);
    expect(limitFor('signIn', false, 'none').max).toBe(200);
    expect(limitFor('signIn', true, 'none').max).toBe(2000);
    expect(limitFor('export', true, 'none').max).toBe(1);
    expect(limitFor('setPassword', true, 'none').max).toBe(5);
    // Per inbox, not per IP: demo headroom only.
    expect(limitFor('magicLinkEmail', false, 'none')).toEqual({ max: 5, windowSec: 3600 });
    expect(limitFor('magicLinkEmail', true, 'none').max).toBe(50);
    expect(limitFor('health', false, 'vercel')).toEqual({ max: 60, windowSec: 60 });
  });
});

describe('clientIp (TRUSTED_PROXY, ADR-001 §A3)', () => {
  const all = new Headers({
    'x-forwarded-for': 'spoofed, 1.1.1.1, 2.2.2.2',
    'x-real-ip': '3.3.3.3',
    'x-nf-client-connection-ip': '4.4.4.4',
    'cf-connecting-ip': '5.5.5.5',
  });
  it('reads only the header the configured edge overwrites', () => {
    expect(clientIp(all, 'vercel')).toBe('3.3.3.3');
    expect(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), 'vercel')).toBe(
      '1.2.3.4',
    );
    expect(clientIp(all, 'netlify')).toBe('4.4.4.4');
    expect(clientIp(all, 'cloudflare')).toBe('5.5.5.5');
  });
  it('xff-N takes the N-th entry from the right, so a client-sent prefix is ignored', () => {
    expect(clientIp(all, 'xff-1')).toBe('2.2.2.2');
    expect(clientIp(all, 'xff-2')).toBe('1.1.1.1');
    expect(clientIp(all, 'xff-3')).toBe('spoofed');
    expect(clientIp(all, 'xff-5')).toBe('unknown');
  });
  it('none trusts nothing; a missing header is one shared "unknown" key', () => {
    expect(clientIp(all, 'none')).toBe('shared');
    expect(clientIp(new Headers(), 'vercel')).toBe('unknown');
    expect(clientIp(new Headers({ 'x-forwarded-for': '9.9.9.9' }), 'cloudflare')).toBe('unknown');
  });
  it('hashes emails for limiter keys (never the raw address)', () => {
    expect(emailKey(' Maya@Demo.Stubbed.app ')).toBe(emailKey('maya@demo.stubbed.app'));
    expect(emailKey('maya@demo.stubbed.app')).toMatch(/^[0-9a-f]{64}$/);
    expect(emailKey('maya@demo.stubbed.app')).not.toContain('maya');
  });
});
