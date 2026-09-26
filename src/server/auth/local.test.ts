import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_FALLBACK_SECRET, parseEnv } from '@/server/env';
import { resetDemoStoreSingleton } from '@/server/repositories/memory/store';
import { memoryCookieJar } from './cookies';
import { isSecureRequest } from './cookies';
import { DEMO_SESSION_COOKIE } from './demo-session';
import { LocalAuthProvider, demoSessionSecret } from './local';

let jar: ReturnType<typeof memoryCookieJar>;
let auth: LocalAuthProvider;

beforeEach(() => {
  resetDemoStoreSingleton();
  jar = memoryCookieJar();
  auth = new LocalAuthProvider(async () => jar);
});

describe('LocalAuthProvider', () => {
  it('sign-up hashes the password, normalises email/handle and starts a session', async () => {
    const s = await auth.signUp({
      email: ' Zed@X.test ',
      password: 'password1',
      handle: 'Zed_1',
      displayName: '',
    });
    expect(s.user).toMatchObject({ email: 'zed@x.test', handle: 'zed_1', displayName: 'zed_1' });
    expect(jar.values.get(DEMO_SESSION_COOKIE)).toBeTruthy();
    expect((await auth.getSession())!.user.id).toBe(s.user.id);
    expect(await auth.isHandleAvailable('ZED_1')).toBe(false);
    await auth.signOut();
    expect(await auth.getSession()).toBeNull();
    const again = await auth.signIn({ email: 'zed@x.test', password: 'password1' });
    expect(again.user.id).toBe(s.user.id);
  });

  it('rejects duplicate email before handle, with field errors', async () => {
    await expect(
      auth.signUp({
        email: 'maya@demo.stubbed.app',
        password: 'password1',
        handle: 'maya',
        displayName: 'M',
      }),
    ).rejects.toMatchObject({ code: 'email_taken', fields: { email: expect.any(String) } });
    await expect(
      auth.signUp({ email: 'new@x.test', password: 'password1', handle: 'MAYA', displayName: 'M' }),
    ).rejects.toMatchObject({ code: 'handle_taken' });
  });

  it('sign-in failures are generic', async () => {
    await expect(
      auth.signIn({ email: 'maya@demo.stubbed.app', password: 'wrong' }),
    ).rejects.toMatchObject({
      code: 'invalid_credentials',
      message: "That email and password don't match.",
    });
    await expect(auth.signIn({ email: 'nobody@x.test', password: 'wrong' })).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    expect(jar.values.size).toBe(0);
  });

  it('ignores forged cookies and sessions of deleted users', async () => {
    jar.values.set(DEMO_SESSION_COOKIE, 'forged.value');
    expect(await auth.getSession()).toBeNull();
  });

  it('magic link → callback signs in; code-only callbacks fail in demo mode', async () => {
    const { devLink } = await auth.sendMagicLink({
      email: 'PRIYA@demo.stubbed.app',
      redirectTo: 'http://localhost:3000/auth/callback?next=%2F',
    });
    const token = new URL(devLink!).searchParams.get('demo_token');
    expect(await auth.completeCallback({ code: 'abc' })).toBe(false);
    expect(await auth.completeCallback({ demoToken: token })).toBe(true);
    expect((await auth.getSession())!.user.handle).toBe('priya');
  });
});

describe('cookie security flag', () => {
  it('follows x-forwarded-proto, else the site URL', () => {
    expect(isSecureRequest(new Headers({ 'x-forwarded-proto': 'https' }), 'http://localhost')).toBe(
      true,
    );
    expect(
      isSecureRequest(new Headers({ 'x-forwarded-proto': 'http' }), 'https://stubbed.app'),
    ).toBe(false);
    expect(isSecureRequest(new Headers(), 'https://stubbed.app')).toBe(true);
    expect(isSecureRequest(new Headers(), 'http://127.0.0.1:3100')).toBe(false);
  });
});

describe('demoSessionSecret', () => {
  it('never uses the public fallback in production; persists a random secret per data dir', () => {
    expect(demoSessionSecret(parseEnv({ NODE_ENV: 'development' }))).toBe(DEMO_FALLBACK_SECRET);
    expect(
      demoSessionSecret(
        parseEnv({
          NODE_ENV: 'production',
          DEMO_MODE_PUBLIC: 'true',
          DEMO_SESSION_SECRET: 'x'.repeat(40),
        }),
      ),
    ).toBe('x'.repeat(40));
    const dir = mkdtempSync(join(tmpdir(), 'stubbed-secret-'));
    const prod = parseEnv({ NODE_ENV: 'production', DEMO_MODE_PUBLIC: 'true', DEMO_DATA_DIR: dir });
    const s = demoSessionSecret(prod);
    expect(s).not.toBe(DEMO_FALLBACK_SECRET);
    expect(s.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(join(dir, 'session-secret'), 'utf8')).toBe(s);
    expect(demoSessionSecret(prod)).toBe(s);
  });
});
