import { describe, expect, it } from 'vitest';
import {
  DEMO_SESSION_MAX_AGE,
  MAGIC_TOKEN_TTL_SECONDS,
  signMagicToken,
  signSession,
  verifyMagicToken,
  verifySession,
} from './demo-session';

const S = 'secret';

describe('demo session + magic tokens', () => {
  it('verifies signed sessions and rejects tampering, other secrets and expiry', () => {
    const now = Date.parse('2026-09-26T00:00:00Z');
    const t = signSession('uid-1', S, now);
    expect(verifySession(t, S, now)).toBe('uid-1');
    expect(verifySession(t, 'other', now)).toBeNull();
    expect(verifySession(`${t}x`, S, now)).toBeNull();
    expect(
      verifySession(
        t.replace(/^[^.]+/, Buffer.from('{"uid":"admin","iat":1}').toString('base64url')),
        S,
        now,
      ),
    ).toBeNull();
    expect(verifySession(t, S, now + (DEMO_SESSION_MAX_AGE + 1) * 1000)).toBeNull();
    expect(verifySession(undefined, S)).toBeNull();
  });

  it('magic tokens expire after 15 minutes and are not interchangeable with sessions', () => {
    const now = Date.parse('2026-09-26T00:00:00Z');
    const m = signMagicToken('a@b.test', S, now);
    expect(verifyMagicToken(m, S, now + 60_000)).toBe('a@b.test');
    expect(verifyMagicToken(m, S, now + (MAGIC_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
    expect(verifySession(m, S, now)).toBeNull();
    expect(verifyMagicToken(signSession('uid', S, now), S, now)).toBeNull();
    expect(verifyMagicToken('garbage', S, now)).toBeNull();
  });
});
