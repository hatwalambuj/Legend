---
type: decision
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 8f05df682bbd42007fe1f63cf347391d5b3cbb15
source: supabase/migrations/20260926000000_init.sql
confidence: high
---
# 003-identity-supabase-auth

Identity = Supabase Auth (`auth.users`, `auth.identities`, sessions; bcrypt, magic link, OAuth-ready) with 1:1 `public.profiles` created by trigger `handle_new_user` (init.sql:125-169). Demo mode: local users with scrypt + signed cookie (src/server/auth/local.ts, password.ts). No separate hand-rolled password table by design.

Source: `supabase/migrations/20260926000000_init.sql`
