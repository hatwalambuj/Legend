import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { hasSupabaseAuthCookie, proxy } from '@/proxy';

describe('proxy', () => {
  it('is a no-op in demo mode', async () => {
    const res = await proxy(
      new NextRequest('http://localhost/browse', { headers: { cookie: 'sb-x-auth-token=abc' } }),
    );
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
  it('only refreshes when a Supabase auth cookie is present', () => {
    expect(
      hasSupabaseAuthCookie(
        new NextRequest('http://l/', { headers: { cookie: 'sb-proj-auth-token.0=x' } }),
      ),
    ).toBe(true);
    expect(
      hasSupabaseAuthCookie(
        new NextRequest('http://l/', { headers: { cookie: 'stubbed_demo_session=x' } }),
      ),
    ).toBe(false);
  });
});
