/**
 * Local (demo) AuthProvider (ADR-005 "Demo mode", ADR-006): users live in the demo JSON store,
 * passwords are scrypt-hashed, the session is a signed httpOnly cookie `stubbed_demo_session`.
 * Magic links are not emailed: the link is returned as `devLink` and completed at /auth/callback.
 * OWNER: Backend.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { DEMO_FALLBACK_SECRET, env, type ServerEnv } from '@/server/env';
import { REAUTH_WINDOW_MS, type AuthProvider } from '@/server/ports';
import { demoStore, isSeededDemoUser, type DemoUser } from '@/server/repositories/memory/store';
import { demoWatchRegion } from '@/server/repositories/memory/user-data';
import { requestCookieJar, type CookieJar } from './cookies';
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_MAX_AGE,
  signMagicToken,
  signSession,
  verifyMagicToken,
  verifySession,
  verifySessionClaims,
} from './demo-session';
import { hashPassword, verifyPassword } from './password';

function toSession(u: DemoUser): Session {
  return {
    user: {
      id: u.id,
      email: u.email,
      handle: u.handle,
      displayName: u.displayName,
      avatarUrl: u.avatarUrl,
      avatarColor: u.avatarColor ?? null,
      watchRegion: demoWatchRegion(demoStore().get(), u.id),
    },
  };
}

const generatedSecrets = new Map<string, string>();

/**
 * HMAC key for demo sessions. The public fallback constant is fine for local dev/tests, but a production
 * build without DEMO_SESSION_SECRET (a publicly deployed demo) would let anyone forge a session for any
 * user id (ids are public, e.g. `Review.author.id`). There we use a random secret persisted next to the
 * demo store (shared by every worker of the server; in memory when DEMO_PERSIST=memory).
 */
export function demoSessionSecret(e: ServerEnv = env()): string {
  if (e.demo.sessionSecret !== DEMO_FALLBACK_SECRET || e.nodeEnv !== 'production')
    return e.demo.sessionSecret;
  const file = e.demo.dataDir ? join(e.demo.dataDir, 'session-secret') : null;
  const cached = generatedSecrets.get(file ?? '');
  if (cached) return cached;
  const read = () => {
    const v = file && existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
    return v.length >= 32 ? v : null;
  };
  let secret: string;
  try {
    secret = read() ?? randomBytes(32).toString('base64url');
    if (file && !existsSync(file)) {
      mkdirSync(e.demo.dataDir!, { recursive: true });
      writeFileSync(file, secret, { flag: 'wx', mode: 0o600 }); // wx: a racing worker's file wins
    }
  } catch {
    secret = read() ?? randomBytes(32).toString('base64url');
  }
  generatedSecrets.set(file ?? '', secret);
  return secret;
}

/** Verified against when the email is unknown, so timing doesn't reveal which emails exist. */
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  constructor(private readonly jar: () => Promise<CookieJar> = requestCookieJar) {}

  private secret(): string {
    return demoSessionSecret();
  }

  private async startSession(u: DemoUser): Promise<Session> {
    (await this.jar()).set(DEMO_SESSION_COOKIE, signSession(u.id, this.secret()), {
      maxAge: DEMO_SESSION_MAX_AGE,
    });
    return toSession(u);
  }

  async getSession(): Promise<Session | null> {
    const uid = verifySession((await this.jar()).get(DEMO_SESSION_COOKIE), this.secret());
    if (!uid) return null;
    const u = demoStore()
      .get()
      .users.find((x) => x.id === uid);
    return u ? toSession(u) : null;
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    const h = handle.trim().toLowerCase();
    return !demoStore()
      .get()
      .users.some((u) => u.handle === h);
  }

  async signUp(input: {
    email: string;
    password: string;
    handle: string;
    displayName: string;
  }): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const handle = input.handle.trim().toLowerCase();
    const passwordHash = hashPassword(input.password); // slow part outside the store mutation
    const user = demoStore().mutate((d) => {
      if (d.users.some((u) => u.email === email))
        throw new AppError('email_taken', ERROR_COPY.email_taken, {
          fields: { email: ERROR_COPY.email_taken },
        });
      if (d.users.some((u) => u.handle === handle))
        throw new AppError('handle_taken', ERROR_COPY.handle_taken, {
          fields: { handle: ERROR_COPY.handle_taken },
        });
      const u: DemoUser = {
        id: randomUUID(),
        handle,
        email,
        displayName: input.displayName.trim() || handle,
        bio: '',
        avatarUrl: null,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      d.users.push(u);
      return u;
    });
    return this.startSession(user);
  }

  async signIn(input: { email: string; password: string }): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    const u = demoStore()
      .get()
      .users.find((x) => x.email === email);
    const ok = verifyPassword(input.password, u?.passwordHash ?? getDummyHash());
    if (!u || !ok) throw new AppError('invalid_credentials', ERROR_COPY.invalid_credentials);
    return this.startSession(u);
  }

  async signOut(): Promise<void> {
    (await this.jar()).delete(DEMO_SESSION_COOKIE);
  }

  /**
   * `devLinks: 'any'` (dev/test/E2E): always returns a devLink (for unknown emails too, so the response
   * never reveals whether an account exists); an unknown email simply fails at the callback.
   * `devLinks: 'seeded'` (default in production, GAP-04): only the public seeded demo accounts get a
   * link — otherwise a public demo would let anyone sign in as anyone. The seed list is public, so this
   * still reveals nothing about real accounts.
   */
  async sendMagicLink(input: { email: string; redirectTo: string }): Promise<{ devLink?: string }> {
    const email = input.email.trim().toLowerCase();
    if (env().demo.devLinks === 'seeded' && !isSeededDemoUser({ email })) return {};
    const url = new URL(input.redirectTo);
    url.searchParams.set('demo_token', signMagicToken(email, this.secret()));
    return { devLink: url.toString() };
  }

  /**
   * ADR-010 ID-2 (demo): re-hash in the store. The session cookie's `iat` is the sign-in time (it is only
   * issued at sign-up, sign-in and the magic-link callback). The shared seeded accounts can't change
   * their password: on a public demo that would lock everyone else out.
   */
  async updatePassword(password: string): Promise<void> {
    const claims = verifySessionClaims((await this.jar()).get(DEMO_SESSION_COOKIE), this.secret());
    const user =
      claims &&
      demoStore()
        .get()
        .users.find((x) => x.id === claims.uid);
    if (!claims || !user) throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
    if (Date.now() - claims.iat * 1000 > REAUTH_WINDOW_MS)
      throw new AppError('reauth_required', ERROR_COPY.reauth_required);
    if (isSeededDemoUser({ id: user.id }))
      throw new AppError(
        'forbidden',
        "Demo accounts can't change their password. Create your own to try it.",
      );
    const passwordHash = hashPassword(password); // slow part outside the store mutation
    demoStore().mutate((d) => {
      const u = d.users.find((x) => x.id === user.id);
      if (!u) throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
      u.passwordHash = passwordHash;
    });
  }

  /**
   * GAP-06: erase the user and everything they own (stubs, reviews, watchlist, settings, profile) in one store
   * mutation — the demo mirror of the `on delete cascade` chain from auth.users — then sign out.
   * The shared seeded demo accounts can't be deleted (everyone signs in with them).
   */
  async deleteAccount(userId: string): Promise<void> {
    if (isSeededDemoUser({ id: userId }))
      throw new AppError('forbidden', "Demo accounts can't be deleted. Create your own to try it.");
    demoStore().mutate((d) => {
      d.users = d.users.filter((u) => u.id !== userId);
      d.stubs = d.stubs.filter((s) => s.userId !== userId);
      d.reviews = d.reviews.filter((r) => r.userId !== userId);
      d.watchlist = d.watchlist.filter((w) => w.userId !== userId);
      d.settings = (d.settings ?? []).filter((x) => x.userId !== userId);
    });
    await this.signOut();
  }

  async completeCallback(input: { code?: string | null; demoToken?: string | null }) {
    const email = verifyMagicToken(input.demoToken, this.secret());
    if (!email) return false;
    const u = demoStore()
      .get()
      .users.find((x) => x.email === email);
    if (!u) return false;
    await this.startSession(u);
    return true;
  }
}
