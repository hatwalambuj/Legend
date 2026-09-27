import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseAuthProvider, lastAuthMs, mapPasswordError, mapSignUpError } from './supabase';

const user = { id: 'u1', email: 'a@b.test', identities: [{}] };

function fakeClient(over: Record<string, unknown> = {}) {
  const profile = { handle: 'alice', display_name: 'Alice', avatar_url: null };
  const auth = {
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    signUp: vi.fn(async () => ({ data: { user, session: {} }, error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    signInWithOtp: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    ...over,
  };
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }),
  }));
  const client = { auth, rpc, from } as unknown as SupabaseClient;
  return { client, auth, rpc, provider: new SupabaseAuthProvider(() => client) };
}

describe('SupabaseAuthProvider', () => {
  it('getSession validates with getUser() and joins the profile', async () => {
    const { provider } = fakeClient();
    expect(await provider.getSession()).toEqual({
      user: { id: 'u1', email: 'a@b.test', handle: 'alice', displayName: 'Alice', avatarUrl: null },
    });
    const anon = fakeClient({
      getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }),
    });
    expect(await anon.provider.getSession()).toBeNull();
  });

  it('sign-up pre-checks the handle and passes metadata for the profile trigger', async () => {
    const { provider, auth, rpc } = fakeClient();
    const s = await provider.signUp({
      email: 'a@b.test',
      password: 'password1',
      handle: 'Alice',
      displayName: '',
    });
    expect(rpc).toHaveBeenCalledWith('handle_available', { h: 'alice' });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: 'a@b.test',
      password: 'password1',
      options: { data: { handle: 'alice', display_name: 'alice' } },
    });
    expect(s?.user.handle).toBe('alice');

    const taken = fakeClient();
    taken.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      taken.provider.signUp({
        email: 'a@b.test',
        password: 'password1',
        handle: 'alice',
        displayName: 'A',
      }),
    ).rejects.toMatchObject({ code: 'handle_taken' });

    const obfuscated = fakeClient({
      signUp: async () => ({
        data: { user: { ...user, identities: [] }, session: null },
        error: null,
      }),
    });
    await expect(
      obfuscated.provider.signUp({
        email: 'a@b.test',
        password: 'password1',
        handle: 'alice',
        displayName: 'A',
      }),
    ).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('maps sign-up errors', () => {
    expect(mapSignUpError({ code: 'user_already_exists' }).code).toBe('email_taken');
    expect(mapSignUpError({ message: 'Database error saving new user' }).code).toBe('handle_taken');
    expect(mapSignUpError({ code: 'weak_password' }).fields).toEqual({
      password: expect.any(String),
    });
    expect(mapSignUpError({ status: 429 }).code).toBe('rate_limited');
    expect(mapSignUpError({ message: '???' }).code).toBe('internal');
  });

  it('sign-in failures are generic; 429 stays a rate limit', async () => {
    const bad = fakeClient({
      signInWithPassword: async () => ({
        data: { user: null },
        error: { message: 'Invalid login credentials', status: 400 },
      }),
    });
    await expect(bad.provider.signIn({ email: 'a@b.test', password: 'x' })).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: "That email and password don't match.",
    });
    const limited = fakeClient({
      signInWithPassword: async () => ({
        data: { user: null },
        error: { message: 'slow', status: 429 },
      }),
    });
    await expect(
      limited.provider.signIn({ email: 'a@b.test', password: 'x' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    expect(
      (await fakeClient().provider.signIn({ email: 'a@b.test', password: 'x' })).user.handle,
    ).toBe('alice');
  });

  it('magic link never reveals existence; callback exchanges the code', async () => {
    const unknown = fakeClient({
      signInWithOtp: async () => ({
        error: { message: 'Signups not allowed for otp', status: 422 },
      }),
    });
    expect(
      await unknown.provider.sendMagicLink({
        email: 'x@y.test',
        redirectTo: 'https://s.app/auth/callback',
      }),
    ).toEqual({});
    const { provider, auth } = fakeClient();
    await provider.sendMagicLink({
      email: 'x@y.test',
      redirectTo: 'https://s.app/auth/callback?next=%2F',
    });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'x@y.test',
      options: { emailRedirectTo: 'https://s.app/auth/callback?next=%2F', shouldCreateUser: false },
    });
    expect(await provider.completeCallback({ code: 'c' })).toBe(true);
    expect(await provider.completeCallback({ demoToken: 't' })).toBe(false);
    const failing = fakeClient({
      exchangeCodeForSession: async () => ({ error: { message: 'bad' } }),
    });
    expect(await failing.provider.completeCallback({ code: 'c' })).toBe(false);
  });

  it('deleteAccount: owner only, hard-deletes the auth user via the service role, clears cookies', async () => {
    const deleteUser = vi.fn(async (_id: string) => ({ data: {}, error: null as unknown }));
    const adminClient = { auth: { admin: { deleteUser } } } as unknown as SupabaseClient;
    const { client, auth } = fakeClient();
    const provider = new SupabaseAuthProvider(
      () => client,
      () => adminClient,
    );
    await provider.deleteAccount('u1');
    expect(deleteUser).toHaveBeenCalledWith('u1');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });

    // The JWT must belong to the account being deleted (re-validated with getUser()).
    deleteUser.mockClear();
    await expect(provider.deleteAccount('someone-else')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    const anon = fakeClient({
      getUser: async () => ({ data: { user: null }, error: { message: 'no session' } }),
    });
    await expect(
      new SupabaseAuthProvider(
        () => anon.client,
        () => adminClient,
      ).deleteAccount('u1'),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(deleteUser).not.toHaveBeenCalled();

    // An admin API failure is surfaced (the session stays, so the user can retry).
    deleteUser.mockImplementationOnce(async () => ({ data: {}, error: { message: 'boom' } }));
    const fresh = fakeClient();
    await expect(
      new SupabaseAuthProvider(
        () => fresh.client,
        () => adminClient,
      ).deleteAccount('u1'),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(fresh.auth.signOut).not.toHaveBeenCalled();

    // No service role key: generic copy (the config detail never reaches the browser).
    const noKey = fakeClient();
    await expect(
      new SupabaseAuthProvider(
        () => noKey.client,
        () => {
          throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
        },
      ).deleteAccount('u1'),
    ).rejects.toMatchObject({ code: 'internal', message: 'Something went wrong. Try again.' });
    expect(noKey.auth.signOut).not.toHaveBeenCalled();
  });

  it('confirm-email ON: sign-up returns null instead of throwing (ADR-010 ID-1)', async () => {
    const { provider } = fakeClient({
      signUp: async () => ({ data: { user, session: null }, error: null }),
    });
    expect(
      await provider.signUp({
        email: 'a@b.test',
        password: 'password1',
        handle: 'alice',
        displayName: 'A',
      }),
    ).toBeNull();
  });

  describe('updatePassword (ADR-010 ID-2)', () => {
    const NOW = 1_800_000_000_000;
    const claims = (secondsAgo: number | null) => ({
      data: {
        claims: {
          sub: 'u1',
          amr:
            secondsAgo === null
              ? []
              : [
                  { method: 'password', timestamp: NOW / 1000 - 3600 },
                  { method: 'otp', timestamp: NOW / 1000 - secondsAgo },
                ],
        },
      },
      error: null,
    });
    const make = (secondsAgo: number | null, updateError: unknown = null) => {
      const updateUser = vi.fn(async () => ({ data: {}, error: updateError }));
      const f = fakeClient({ getClaims: async () => claims(secondsAgo), updateUser });
      const provider = new SupabaseAuthProvider(
        () => f.client,
        () => f.client,
        () => NOW,
      );
      return { provider, updateUser };
    };

    it('updates when the newest sign-in (amr) is under 10 min old', async () => {
      const { provider, updateUser } = make(9 * 60);
      await provider.updatePassword('new-password-1');
      expect(updateUser).toHaveBeenCalledWith({ password: 'new-password-1' });
    });
    it('reauth_required when older than 10 min or unknown; unauthenticated without claims', async () => {
      for (const ago of [10 * 60 + 1, null]) {
        const { provider, updateUser } = make(ago);
        await expect(provider.updatePassword('new-password-1')).rejects.toMatchObject({
          code: 'reauth_required',
          status: 401,
          message: 'Sign in again to change your password.',
        });
        expect(updateUser).not.toHaveBeenCalled();
      }
      const anon = fakeClient({
        getClaims: async () => ({ data: null, error: { message: 'no session' } }),
      });
      await expect(anon.provider.updatePassword('new-password-1')).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    });
    it('maps Supabase errors', async () => {
      await expect(
        make(60, { code: 'same_password' }).provider.updatePassword('x'.repeat(8)),
      ).rejects.toMatchObject({
        code: 'validation_failed',
        fields: { password: expect.any(String) },
      });
      expect(mapPasswordError({ code: 'weak_password' }).code).toBe('validation_failed');
      expect(mapPasswordError({ code: 'reauthentication_needed' }).code).toBe('reauth_required');
      expect(mapPasswordError({ status: 429 }).code).toBe('rate_limited');
      expect(mapPasswordError({ message: 'boom' }).code).toBe('internal');
    });
    it('lastAuthMs takes the newest amr timestamp and ignores junk', () => {
      expect(
        lastAuthMs({ amr: [{ timestamp: 10 }, { timestamp: 20 }, 'x', { timestamp: 'y' }] }),
      ).toBe(20_000);
      expect(lastAuthMs({ amr: ['password'] })).toBeNull();
      expect(lastAuthMs(null)).toBeNull();
    });
  });
});
