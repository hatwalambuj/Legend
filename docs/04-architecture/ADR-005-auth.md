# ADR-005: Authentication and authorisation

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect · **Extended 2026-09-27 by ADR-010** (identity model, launch tasks ID-1…ID-7)
Inputs: PRD B1–B3, E5; SYSTEM_DESIGN §7, §8.1

## Decision

### Live mode: Supabase Auth
- **Methods:** email + password (min 8, max 72), magic link (also used as the password-reset path), and Google OAuth (P1, the same callback).
- **Sessions:** `@supabase/ssr` cookie sessions (httpOnly, Secure, SameSite=Lax). `src/proxy.ts` refreshes the access token on every request. Server code validates with `auth.getUser()`, never trusting `getSession()` alone.
- **Sign-up flow:** `POST /api/auth/signup {email, password, handle, displayName?}`.
  1. zod validates the input (handle `^[a-z0-9_]{3,20}$`, not reserved).
  2. `rpc('handle_available')` runs as a pre-check.
  3. `auth.signUp` is called with `options.data = {handle, display_name}`.
  4. The **`on_auth_user_created` trigger** creates the `profiles` row atomically. A duplicate handle raises a unique violation, which maps to `handle_taken`.
  5. The user is **logged in immediately** (B1-AC3). The Supabase project setting "Confirm email" is **OFF** for the MVP. Email verification before the first public review is a v1 moderation item (Stage 1), and until then rate limits apply.
- **Sign-in errors are generic** (B2-AC1): any failure becomes `invalid_credentials` "That email and password don't match." A sign-up with an existing email returns `email_taken` (this reveals existence, which is acceptable per B1-AC2's "clear error" requirement). Magic-link requests always return 202.
- **Callback:** `GET /auth/callback?code&next` exchanges the PKCE code and redirects to `safeNext(next)`, which only allows same-origin relative paths.
- **Resume after login (B2-AC3):** protected actions redirect or open the auth sheet with `?next=<current path>&action=stub|review|watchlist`. After auth, the client replays the action.

### Authorisation: defence in depth
1. **The DAL and route handlers** always derive `userId` from the session and never from the request body. Every write repository method takes `userId` and filters by it.
2. **Postgres RLS** on every table (`supabase/migrations/…_init.sql`):
   - Catalogue, stats and detail cache: public read-only.
   - Profiles: public read. Owners can update `display_name`, `bio` and `avatar_url` only (column grants; the handle is immutable, B3-AC2).
   - Stubs and reviews: public read (public diaries, PRD B3), owner-only writes.
   - Watchlist: owner-only.
   - `sync_runs` and `catalog_staging`: no access for API roles at all. Job RPCs (`catalog_apply_staging`, `catalog_set_enrichment`, `catalog_set_imdb`, `catalog_*_due`, `catalog_purge_stale`, `catalog_rating_disagreements`) are service-role only. There are no third-party token tables (ADR-008).
   - These rules are tested in PGlite (`tests/db/migrations.test.ts`).
3. **The service role** is server- and job-only: the nightly sync (discover, enrich, IMDb ratings), catalogue cache writes (L2 detail cache, lazy unlisted inserts), editorial `pitch_hook`s, and export. It is never exposed as `NEXT_PUBLIC_*`.
4. **CSRF:** mutations need a JSON content type plus a same-origin `Origin` header (`src/server/http.ts`), with SameSite=Lax cookies.

### Demo mode: local auth (see ADR-006)
- `LocalAuthProvider` implements the same `AuthProvider` port.
- Users live in the demo JSON store. Passwords are hashed with scrypt (`src/server/auth/password.ts`).
- The session is a signed httpOnly cookie `stubbed_demo_session` (HMAC-SHA256 with `DEMO_SESSION_SECRET`, falling back to a public constant, 30-day expiry; `src/server/auth/demo-session.ts`).
- Seed accounts `maya`, `dev` and `priya` use the password **`stubbed-demo`**, shown in the demo pill tooltip and the auth sheet. A magic link returns `devLink` instead of sending an email.
- The UI copy is identical in both modes, except the banner "Demo mode — accounts are stored on this server only".

## Consequences
- There is no password handling in our code in live mode (PRD E5).
- Public pages never read cookies, so they stay cacheable. The header avatar is a client island (`GET /api/me`).
- Moving auth off Supabase later means replacing one adapter plus the `auth.uid()` RLS helper.
