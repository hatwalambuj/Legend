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
- M1 launch hardening DONE: backend + frontend implemented, ClearPath code review SHIP (338 unit, 169 E2E green).
- Open: stub-count race ([[issues/stub-count-race.md]]) awaiting founder decision; founder tasks (TMDB logo, trademark, SMTP, staging smoke M1-17).
- Next feature: Where to watch — spec ready (ADR-012, API v1.5, WORK_SPLIT §6), not started.
- Constraints: $0 infra, no AI, no third-party posting ([[meta/rules.md]]).

## Recent Changes
- Architect (docs only): ADR-010, ADR-011, ADR-001 amendment, contract v1.4, WORK_SPLIT §5; no src/ edits.
- ClearPath protocol + memory initialised; code-reviewer and arch-reviewer agents added.
- QA fixed F3 (diary today+1) and F4 (review count after delete).

## Open Questions
- Will the GitHub repo be public? (AR-6: scheduled workflows disabled after 60 days inactivity.)
- Launch commercially later? (Vercel Hobby + TMDB/OMDb free are non-commercial.)

## Next Best Step
Founder decision on stub-count race → frontend-dev applies QA §6a patch; then Where to watch W-00 (backend) → backend ∥ frontend → code-reviewer → QA → PM.
