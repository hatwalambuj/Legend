/**
 * Supabase Auth provider (live mode, ADR-005). OWNER: Backend.
 * - getSession: `auth.getUser()` (validates the JWT with Supabase, never trusts getSession() alone) +
 *   the profiles row → Session.
 * - signUp: handle pre-check via rpc('handle_available'), then auth.signUp with
 *   options.data = { handle, display_name }; the `on_auth_user_created` trigger creates the profile
 *   atomically (a racing duplicate handle surfaces as "Database error saving new user" → handle_taken).
 *   Project setting "Confirm email" is OFF for the MVP, so the user is signed in immediately (B1-AC3).
 * - signIn: any failure → generic invalid_credentials (B2-AC1); Supabase's own 429 → rate_limited.
 * - sendMagicLink: signInWithOtp (existing users only); never reveals whether the email exists.
 * - completeCallback: PKCE / magic-link code exchange (sets the session cookies).
 * - deleteAccount: service-role `auth.admin.deleteUser` (hard delete); the FK chain auth.users →
 *   profiles → stubs / reviews / watchlist / rate_events is `on delete cascade`, and the title_stats
 *   triggers fire for every cascaded row. Then the session cookies are cleared.
 */
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { AppError, ERROR_COPY } from '@/lib/errors';
import type { Session } from '@/lib/types';
import type { AuthProvider } from '@/server/ports';

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

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = 'supabase' as const;

  constructor(
    private readonly client: ClientFn = defaultClient,
    private readonly admin: ClientFn = defaultAdmin,
  ) {}

  private async sessionFor(db: SupabaseClient, user: User): Promise<Session | null> {
    const { data, error } = await db
      .from('profiles')
      .select('handle, display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();
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
      },
    };
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
  }): Promise<Session> {
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
    if (!data.user || !data.session)
      throw new AppError(
        'unauthenticated',
        'Check your inbox to confirm your email, then sign in.',
      );
    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? input.email,
        handle,
        displayName,
        avatarUrl: null,
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

  async deleteAccount(userId: string): Promise<void> {
    const db = await this.client();
    // Re-validate the JWT with Supabase right before the irreversible step: only the owner may delete.
    const { data, error } = await db.auth.getUser();
    if (error || !data.user || data.user.id !== userId)
      throw new AppError('unauthenticated', ERROR_COPY.unauthenticated);
    const admin = await this.admin();
    const { error: delError } = await admin.auth.admin.deleteUser(userId);
    if (delError)
      throw new AppError('internal', 'Something went wrong. Try again.', { cause: delError });
    // The server already dropped the sessions; this clears the sb-* cookies (401/404 are ignored).
    await db.auth.signOut({ scope: 'local' });
  }

  async completeCallback(input: { code?: string | null; demoToken?: string | null }) {
    if (!input.code) return false;
    const db = await this.client();
    const { error } = await db.auth.exchangeCodeForSession(input.code);
    return !error;
  }
}
