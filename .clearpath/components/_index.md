---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 24fcfd3dd0071d844d86b4a677bb0c00b4873685
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
