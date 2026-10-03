/** ADR-013 C-05: the live proxy refreshes the session with one getClaims() call and never getUser(). */
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const auth = {
  getClaims: vi.fn(async () => ({ data: { claims: { sub: 'u1' } }, error: null })),
  getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
};
vi.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth }) }));

const { resetEnvCache } = await import('@/server/env');
const { proxy } = await import('@/proxy');

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe('proxy (live mode)', () => {
  it('calls getClaims once and getUser never, only with a Supabase auth cookie', async () => {
    vi.stubEnv('DATA_MODE', 'supabase');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    resetEnvCache();
    await proxy(new NextRequest('http://localhost/browse'));
    expect(auth.getClaims).not.toHaveBeenCalled();
    await proxy(
      new NextRequest('http://localhost/browse', { headers: { cookie: 'sb-p-auth-token=x' } }),
    );
    expect(auth.getClaims).toHaveBeenCalledTimes(1);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
});
