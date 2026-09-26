/**
 * Local (demo) AuthProvider: users live in the demo JSON store, passwords are scrypt-hashed,
 * the session is a signed httpOnly cookie. OWNER: Backend. PARTIAL SKELETON.
 */
import { cookies } from 'next/headers';
import { AppError } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { env } from '@/server/env';
import type { AuthProvider } from '@/server/ports';
import { demoStore } from '@/server/repositories/memory/store';
import { DEMO_SESSION_COOKIE, verifySession } from './demo-session';

export class LocalAuthProvider implements AuthProvider {
  readonly name = 'local' as const;

  async getSession(): Promise<Session | null> {
    const jar = await cookies();
    const uid = verifySession(jar.get(DEMO_SESSION_COOKIE)?.value, env().demo.sessionSecret);
    if (!uid) return null;
    const u = demoStore()
      .get()
      .users.find((x) => x.id === uid);
    return u
      ? {
          user: {
            id: u.id,
            email: u.email,
            handle: u.handle,
            displayName: u.displayName,
            avatarUrl: u.avatarUrl,
          },
        }
      : null;
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    return !demoStore()
      .get()
      .users.some((u) => u.handle === handle.toLowerCase());
  }

  async signUp(): Promise<Session> {
    throw new AppError('not_implemented', 'Local sign-up not implemented yet (Backend).');
  }
  async signIn(): Promise<Session> {
    throw new AppError('not_implemented', 'Local sign-in not implemented yet (Backend).');
  }
  async signOut(): Promise<void> {
    throw new AppError('not_implemented', 'Local sign-out not implemented yet (Backend).');
  }
  async sendMagicLink(): Promise<{ devLink?: string }> {
    throw new AppError('not_implemented', 'Magic link not implemented yet (Backend).');
  }
}
