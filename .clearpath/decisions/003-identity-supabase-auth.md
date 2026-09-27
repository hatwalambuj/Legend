---
type: decision
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 91d9085662416a6cf983f3f92907b4e7f52e40ee
source: docs/04-architecture/ADR-010-identity.md
confidence: high
---
# 003-identity-supabase-auth

Identity store = Supabase Auth `auth.*` (users, identities, sessions, bcrypt, magic link, OAuth-ready, TOTP available); product profile = `public.profiles` 1:1 via trigger (init.sql:125-169); cascade delete to stubs/reviews/watchlist/rate_events. No hand-rolled password table. Portable via `AuthProvider` port (ports.ts:111-139). Launch tasks ID-1 confirm-email-safe sign-up, ID-2 set-password, ID-3 SMTP, ID-4 TRUSTED_PROXY, ID-5 per-email magic-link limit, ID-6 privacy copy (ADR-010 §7).

Source: `docs/04-architecture/ADR-010-identity.md`
