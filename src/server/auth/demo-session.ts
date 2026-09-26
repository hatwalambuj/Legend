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

/* ---------- Demo magic link token (the "email" is returned as devLink instead of sent) ---------- */

export const MAGIC_TOKEN_TTL_SECONDS = 15 * 60;

/** Separate key derivation so a session token can never be replayed as a magic token (or vice versa). */
const magicKey = (secret: string) => `${secret}:magic-link`;

export function signMagicToken(email: string, secret: string, now = Date.now()): string {
  const payload = b64u(
    Buffer.from(
      JSON.stringify({
        p: 'magic',
        em: email,
        exp: Math.floor(now / 1000) + MAGIC_TOKEN_TTL_SECONDS,
      }),
    ),
  );
  const sig = b64u(createHmac('sha256', magicKey(secret)).update(payload).digest());
  return `${payload}.${sig}`;
}

/** Returns the email, or null for a bad signature / wrong purpose / expired token. */
export function verifyMagicToken(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): string | null {
  if (!token || token.length > 1024) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', magicKey(secret)).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const { p, em, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      p?: unknown;
      em?: unknown;
      exp?: unknown;
    };
    if (p !== 'magic' || typeof em !== 'string' || typeof exp !== 'number') return null;
    return now / 1000 <= exp ? em : null;
  } catch {
    return null;
  }
}
