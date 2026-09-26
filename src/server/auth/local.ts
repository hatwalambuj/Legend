/**
 * Local (demo) AuthProvider (ADR-005 "Demo mode", ADR-006): users live in the demo JSON store,
 * passwords are scrypt-hashed, the session is a signed httpOnly cookie `stubbed_demo_session`.
 * Magic links are not emailed: the link is returned as `devLink` and completed at /auth/callback.
 * OWNER: Backend.
 */
import { randomUUID } from 'node:crypto';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { env } from '@/server/env';
import type { AuthProvider } from '@/server/ports';
import { demoStore, type DemoUser } from '@/server/repositories/memory/store';
import { requestCookieJar, type CookieJar } from './cookies';
import {
  DEMO_SESSION_COOKIE,
  DEMO_SESSION_MAX_AGE,
  signMagicToken,
  signSession,
  verifyMagicToken,
  verifySession,
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
    },
  };
}

/** Verified against when the email is unknown, so timing doesn't reveal which emails exist. */
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  constructor(private readonly jar: () => Promise<CookieJar> = requestCookieJar) {}

  private secret(): string {
    return env().demo.sessionSecret;
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
   * Always returns a devLink (for unknown emails too, so the response never reveals whether an account
   * exists); an unknown email simply fails at the callback.
   */
  async sendMagicLink(input: { email: string; redirectTo: string }): Promise<{ devLink?: string }> {
    const url = new URL(input.redirectTo);
    url.searchParams.set(
      'demo_token',
      signMagicToken(input.email.trim().toLowerCase(), this.secret()),
    );
    return { devLink: url.toString() };
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
