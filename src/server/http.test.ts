import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import {
  assertSameOrigin,
  errorResponse,
  parseQuery,
  redirectRelative,
  requestOrigin,
} from './http';

const r = (url: string, headers: Record<string, string> = {}) => new NextRequest(url, { headers });

describe('http helpers', () => {
  it('derives the origin the client used (Host / X-Forwarded-*)', () => {
    expect(requestOrigin(r('http://localhost:3100/x', { host: '127.0.0.1:3100' }))).toBe(
      'http://127.0.0.1:3100',
    );
    expect(
      requestOrigin(
        r('http://internal/x', {
          host: 'internal',
          'x-forwarded-host': 'stubbed.app',
          'x-forwarded-proto': 'https',
        }),
      ),
    ).toBe('https://stubbed.app');
  });

  it('redirects relatively and privately', () => {
    const res = redirectRelative('/me/stubs');
    expect([res.status, res.headers.get('location'), res.headers.get('cache-control')]).toEqual([
      302,
      '/me/stubs',
      'private, no-store',
    ]);
  });

  it('blocks cross-origin and malformed origins, allows same-origin and absent Origin', () => {
    expect(() =>
      assertSameOrigin(r('http://a.test/x', { host: 'a.test', origin: 'http://a.test' })),
    ).not.toThrow();
    expect(() => assertSameOrigin(r('http://a.test/x', { host: 'a.test' }))).not.toThrow();
    expect(() =>
      assertSameOrigin(r('http://a.test/x', { host: 'a.test', origin: 'http://evil.test' })),
    ).toThrow(AppError);
    expect(() =>
      assertSameOrigin(r('http://a.test/x', { host: 'a.test', origin: 'null' })),
    ).toThrow(AppError);
  });

  it('maps zod failures to fields and hides unexpected errors', async () => {
    try {
      parseQuery(r('http://a.test/x?limit=0'), z.object({ limit: z.coerce.number().min(1) }));
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).fields).toEqual({ limit: expect.any(String) });
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorResponse(new Error('SELECT secret FROM users'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'internal', message: 'Something went wrong. Try again.' },
    });
    log.mockRestore();
    const limited = errorResponse(new AppError('rate_limited', 'slow', { retryAfter: 7 }));
    expect(limited.headers.get('retry-after')).toBe('7');
  });
});
