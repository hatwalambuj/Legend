/**
 * Session helpers for route handlers. The user id ALWAYS comes from the session, never from the body
 * (ADR-005 "defence in depth"). OWNER: Backend.
 */
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import type { Container } from './ports';

export async function requireSession(c: Pick<Container, 'auth'>): Promise<Session> {
  const s = await c.auth.getSession();
  if (!s) throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
  return s;
}
