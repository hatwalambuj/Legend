---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: session
confidence: high
---
# components

- Catalog + sync: `src/server/jobs/`, `scripts/sync-catalog.ts` (TMDB discover, OMDb IMDb refresh, palettes)
- Data access: `src/server/dal.ts` (implements `src/lib/data-access.ts`)
- Auth: `src/server/auth/` (local demo + Supabase)
- Repositories: `src/server/repositories/{memory,supabase}`
- API: `src/app/api/**`
- UI: `src/components/**`, pages under `src/app/`
- DB: `supabase/migrations/` (init, user_data_reads, review_hardening)
