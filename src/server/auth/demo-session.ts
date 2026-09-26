/**
 * Demo-mode session cookie: `stubbed_demo_session` = base64url(payload).base64url(HMAC-SHA256).
 * httpOnly, SameSite=Lax, Secure in production, 30-day expiry. Payload holds only { uid, iat }.
 * OWNER: Backend (helper by Architect).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEMO_SESSION_COOKIE = 'stubbed_demo_session';
export const DEMO_SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const b64u = (b: Buffer) => b.toString('base64url');

export function signSession(uid: string, secret: string, now = Date.now()): string {
  const payload = b64u(Buffer.from(JSON.stringify({ uid, iat: Math.floor(now / 1000) })));
  const sig = b64u(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { uid, iat } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      uid?: unknown;
      iat?: unknown;
    };
    if (typeof uid !== 'string' || typeof iat !== 'number') return null;
    if (now / 1000 - iat > DEMO_SESSION_MAX_AGE) return null;
    return uid;
  } catch {
    return null;
  }
}
