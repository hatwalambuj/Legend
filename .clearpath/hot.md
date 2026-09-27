---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 91d9085662416a6cf983f3f92907b4e7f52e40ee
source: session
confidence: high
---
# Hot Cache  (≤600 words · expires 7 days / 20 commits after `updated`)

## Current Goal
Close M1 launch-hardening items via the agent pipeline under ClearPath, keeping infra $0 (Supabase Free + Vercel Hobby or free alternates).

## Active Context
- MVP built and verified in demo mode; ClearPath code/arch/QA reviews all SHIP (demo) — see [[reviews/_index.md]].
- Identity = Supabase Auth + profiles; ADR-010 written, launch tasks ID-1…ID-6 ([[decisions/003-identity-supabase-auth.md]]).
- $0 hard constraint; ADR-001 Amendment A (free alternates matrix, TRUSTED_PROXY). Ops specs ADR-011 ([[decisions/007-operations-free-tier.md]]).
- API_CONTRACT v1.4 (health, degraded, set-password). WORK_SPLIT §5 = M1 task list M1-00…M1-17.
- Open must-before-launch: L-3, L-4, L-5, L-6, L-7 ([[issues/_index.md]]).
- Founder constraint added 2026-09-27: DB/server must be free of cost ([[meta/rules.md]]).
- New scope 2026-09-27: Where to watch (OTT icons, clickable) — PM ∥ UX scoping ([[issues/where-to-watch.md]]).
- Architect ADR run done (docs only). Running: QA (flake root cause; overlaps M1-16 flake part).

## Recent Changes
- Architect (docs only): ADR-010, ADR-011, ADR-001 amendment, contract v1.4, WORK_SPLIT §5; no src/ edits.
- ClearPath protocol + memory initialised; code-reviewer and arch-reviewer agents added.
- QA fixed F3 (diary today+1) and F4 (review count after delete).

## Open Questions
- Will the GitHub repo be public? (AR-6: scheduled workflows disabled after 60 days inactivity.)
- Launch commercially later? (Vercel Hobby + TMDB/OMDb free are non-commercial.)

## Next Best Step
backend-dev M1-00 (shared types) → backend-dev M1-01…M1-13 ∥ frontend-dev M1-06, M1-11/12 UI, M1-14 → code-reviewer + arch-reviewer → qa-engineer M1-16/17 → PM go/no-go.
