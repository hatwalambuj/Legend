/**
 * Supabase Auth provider (live mode, ADR-005). OWNER: Backend. SKELETON.
 * - signUp: supabase.auth.signUp({ email, password, options: { data: { handle, display_name } } });
 *   the `on_auth_user_created` trigger creates the profile row (see migrations). Pre-check handle with
 *   rpc('handle_available'). Project setting: "Confirm email" OFF for MVP (B1-AC3 logs in immediately).
 * - signIn: signInWithPassword → map any failure to AppError('invalid_credentials').
 * - sendMagicLink: signInWithOtp({ email, options: { emailRedirectTo: `${siteUrl}/auth/callback?next=…` } }).
 * - getSession: supabase.auth.getUser() (validates the JWT) + profiles row → Session.
 */
import { AppError } from '@/lib/errors';
import type { Session } from '@/lib/types';
import type { AuthProvider } from '@/server/ports';

export class SupabaseAuthProvider implements AuthProvider {
  readonly name = 'supabase' as const;
  async getSession(): Promise<Session | null> {
    return null; // TODO(Backend)
  }
  async signUp(): Promise<Session> {
    throw new AppError('not_implemented', 'Supabase sign-up not implemented yet.');
  }
  async signIn(): Promise<Session> {
    throw new AppError('not_implemented', 'Supabase sign-in not implemented yet.');
  }
  async signOut(): Promise<void> {
    throw new AppError('not_implemented', 'Supabase sign-out not implemented yet.');
  }
  async sendMagicLink(): Promise<{ devLink?: string }> {
    throw new AppError('not_implemented', 'Supabase magic link not implemented yet.');
  }
  async isHandleAvailable(): Promise<boolean> {
    throw new AppError('not_implemented', 'Supabase handle check not implemented yet.');
  }
}
