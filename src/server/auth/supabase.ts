/**
 * Supabase Auth provider (live mode, ADR-005). OWNER: Backend.
 * - getSession: `auth.getUser()` (validates the JWT with Supabase, never trusts getSession() alone) +
 *   the profiles row → Session.
 * - signUp: handle pre-check via rpc('handle_available'), then auth.signUp with
 *   options.data = { handle, display_name }; the `on_auth_user_created` trigger creates the profile
 *   atomically (a racing duplicate handle surfaces as "Database error saving new user" → handle_taken).
 *   Project setting "Confirm email" is OFF at launch, so the user is signed in immediately (B1-AC3);
 *   with it ON, signUp returns null (no session yet) and the route answers 202 (ADR-010 ID-1).
 * - signIn: any failure → generic invalid_credentials (B2-AC1); Supabase's own 429 → rate_limited.
 * - sendMagicLink: signInWithOtp (existing users only); never reveals whether the email exists.
 * - completeCallback: PKCE / magic-link code exchange (sets the session cookies).
 * - updatePassword (ADR-010 ID-2): verified JWT claims (`getClaims`), the newest `amr` timestamp is the
 *   session's last sign-in; older than 10 min → reauth_required. Then `updateUser({ password })`.
 * - deleteAccount: service-role `auth.admin.deleteUser` (hard delete); the FK chain auth.users →
 *   profiles → stubs / reviews / watchlist / rate_events is `on delete cascade`, and the title_stats
 *   triggers fire for every cascaded row. Then the session cookies are cleared.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import { REAUTH_WINDOW_MS, type AuthProvider } from '@/server/ports';

type ClientFn = () => SupabaseClient | Promise<SupabaseClient>;

const defaultClient: ClientFn = async () =>
  (await import('@/server/supabase/server')).supabaseForRequest();
const defaultAdmin: ClientFn = async () =>
  (await import('@/server/supabase/server')).supabaseAdmin();

interface AuthErrorLike {
  message?: string;
  status?: number;
  code?: string;
}

const isRateLimited = (e: AuthErrorLike) =>
  e.status === 429 ||
  e.code === 'over_request_rate_limit' ||
  e.code === 'over_email_send_rate_limit';

/** Maps a Supabase sign-up error to the contract (API_CONTRACT §5.18). Exported for tests. */
export function mapSignUpError(e: AuthErrorLike): AppError {
  const msg = (e.message ?? '').toLowerCase();
  if (
    e.code === 'user_already_exists' ||
    e.code === 'email_exists' ||
    msg.includes('already registered')
  )
    return new AppError('email_taken', ERROR_COPY.email_taken, {
      fields: { email: ERROR_COPY.email_taken },
    });
  if (msg.includes('database error'))
    return new AppError('handle_taken', ERROR_COPY.handle_taken, {
      fields: { handle: ERROR_COPY.handle_taken },
    });
  if (e.code === 'weak_password')
    return new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { password: 'Pick a stronger password.' },
    });
  if (e.code === 'email_address_invalid')
    return new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { email: 'Enter a valid email' },
    });
  if (isRateLimited(e))
    return new AppError('rate_limited', 'Too many attempts. Try again shortly.', {
      retryAfter: 60,
    });
  return new AppError('internal', 'Something went wrong. Try again.', { cause: e });
}

/** Maps a Supabase `updateUser({ password })` error to the contract (API_CONTRACT §5.18). */
export function mapPasswordError(e: AuthErrorLike): AppError {
  if (e.code === 'same_password')
    return new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { password: 'Pick a password you have not used here before.' },
    });
  if (e.code === 'weak_password')
    return new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: { password: 'Pick a stronger password.' },
    });
  if (e.code === 'reauthentication_needed' || e.code === 'session_not_found')
    return new AppError('reauth_required', ERROR_COPY.reauth_required);
  if (isRateLimited(e))
    return new AppError('rate_limited', 'Too many attempts. Try again shortly.', {
      retryAfter: 60,
    });
  return new AppError('internal', 'Something went wrong. Try again.', { cause: e });
}

/** Newest authentication time of this session (JWT `amr` timestamps, seconds) in ms, or null. */
export function lastAuthMs(claims: { amr?: unknown } | null | undefined): number | null {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as unknown[]) : [];
  const ts = amr
    .map((a) => (a && typeof a === 'object' ? (a as { timestamp?: unknown }).timestamp : null))
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return ts.length ? Math.max(...ts) * 1000 : null;
}

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = 'supabase' as const;

  constructor(
    private readonly client: ClientFn = defaultClient,
    private readonly admin: ClientFn = defaultAdmin,
    private readonly now: () => number = Date.now,
  ) {}

  private async sessionFor(db: SupabaseClient, user: User): Promise<Session | null> {
    const [{ data, error }, watchRegion] = await Promise.all([
      db
        .from('profiles')
        .select('handle, display_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle(),
      this.watchRegionOf(db, user.id),
    ]);
    if (error) throw new AppError('internal', 'Something went wrong. Try again.', { cause: error });
    if (!data) return null;
    const p = data as { handle: string; display_name: string; avatar_url: string | null };
    return {
      user: {
        id: user.id,
        email: user.email ?? '',
        handle: String(p.handle),
        displayName: p.display_name,
        avatarUrl: p.avatar_url ?? null,
        watchRegion,
      },
    };
  }

  /**
   * ADR-012 §7: the owner-only saved region (`user_settings`, RLS). Best effort: a failure (e.g. the
   * migration not applied yet) must never break sign-in, so it reads as "automatic".
   */
  private async watchRegionOf(db: SupabaseClient, userId: string): Promise<string | null> {
    try {
      const { data, error } = await db
        .from('user_settings')
        .select('watch_region')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) {
        console.warn('[auth] user_settings read failed', error.code ?? 'error');
        return null;
      }
      const r = (data as { watch_region?: unknown } | null)?.watch_region;
      return typeof r === 'string' && /^[A-Z]{2}$/.test(r) ? r : null;
    } catch {
      return null;
    }
  }

  async getSession(): Promise<Session | null> {
    const db = await this.client();
    const { data, error } = await db.auth.getUser();
    if (error || !data.user) return null;
    return this.sessionFor(db, data.user);
  }

  async isHandleAvailable(handle: string): Promise<boolean> {
    const db = await this.client();
    const { data, error } = await db.rpc('handle_available', { h: handle.trim().toLowerCase() });
    if (error) throw new AppError('internal', 'Something went wrong. Try again.', { cause: error });
    return data === true;
  }

  async signUp(input: {
    email: string;
    password: string;
    handle: string;
    displayName: string;
  }): Promise<Session | null> {
    const db = await this.client();
    const handle = input.handle.trim().toLowerCase();
    if (!(await this.isHandleAvailable(handle)))
      throw new AppError('handle_taken', ERROR_COPY.handle_taken, {
        fields: { handle: ERROR_COPY.handle_taken },
      });
    const displayName = input.displayName.trim() || handle;
    const { data, error } = await db.auth.signUp({
      email: input.email,
      password: input.password,
      options: { data: { handle, display_name: displayName } },
    });
    if (error) throw mapSignUpError(error);
    // With "Confirm email" ON, an existing address comes back as a user without identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      throw mapSignUpError({ code: 'user_already_exists' });
    if (!data.user) throw mapSignUpError({});
    // "Confirm email" ON (ADR-010 ID-1): the account exists, the session starts after confirmation.
    if (!data.session) return null;
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? input.email,
        handle,
        displayName,
        avatarUrl: null,
        watchRegion: null,
      },
    };
  }

  async signIn(input: { email: string; password: string }): Promise<Session> {
    const db = await this.client();
    const { data, error } = await db.auth.signInWithPassword(input);
    if (error && isRateLimited(error))
      throw new AppError('rate_limited', 'Too many attempts. Try again shortly.', {
        retryAfter: 60,
      });
    if (error || !data.user)
      throw new AppError('invalid_credentials', ERROR_COPY.invalid_credentials);
    const session = await this.sessionFor(db, data.user);
    if (!session) throw new AppError('invalid_credentials', ERROR_COPY.invalid_credentials);
    return session;
  }

  async signOut(): Promise<void> {
    const db = await this.client();
    await db.auth.signOut(); // clears the auth cookies via the request client's cookie adapter
  }

  async sendMagicLink(input: { email: string; redirectTo: string }): Promise<{ devLink?: string }> {
    const db = await this.client();
    const { error } = await db.auth.signInWithOtp({
      email: input.email,
      options: { emailRedirectTo: input.redirectTo, shouldCreateUser: false },
    });
    if (error && isRateLimited(error))
      throw new AppError('rate_limited', 'Too many emails. Try again in a few minutes.', {
        retryAfter: 60,
      });
    // Any other error (e.g. unknown email) is swallowed: the response never reveals existence.
    return {};
  }

  async updatePassword(password: string): Promise<void> {
    const db = await this.client();
    const { data, error } = await db.auth.getClaims();
    if (error || !data?.claims?.sub)
      throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
    const at = lastAuthMs(data.claims);
    // No amr (unknown sign-in time) is treated as too old: re-authenticating is always safe.
    if (at === null || this.now() - at > REAUTH_WINDOW_MS)
      throw new AppError('reauth_required', ERROR_COPY.reauth_required);
    const { error: updateError } = await db.auth.updateUser({ password });
    if (updateError) throw mapPasswordError(updateError);
  }

  async deleteAccount(userId: string): Promise<void> {
    const db = await this.client();
    // Re-validate the JWT with Supabase right before the irreversible step: only the owner may delete.
    const { data, error } = await db.auth.getUser();
    if (error || !data.user || data.user.id !== userId)
      throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
    // Missing SUPABASE_SERVICE_ROLE_KEY or an admin API error: log it server-side, show generic copy
    // (the config detail must not reach the browser); nothing was deleted, the session stays.
    let delError: unknown;
    try {
      delError = (await (await this.admin()).auth.admin.deleteUser(userId)).error;
    } catch (e) {
      delError = e;
    }
    if (delError) {
      console.error('[auth] deleteAccount failed', delError);
      throw new AppError('internal', 'Something went wrong. Try again.', { cause: delError });
    }
    // The account is gone at this point, so a cookie-clearing hiccup must not turn it into a 500.
    try {
      await db.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('[auth] signOut after deleteAccount failed', e);
    }
  }

  async completeCallback(input: { code?: string | null; demoToken?: string | null }) {
    if (!input.code) return false;
    const db = await this.client();
    const { error } = await db.auth.exchangeCodeForSession(input.code);
    return !error;
  }
}
