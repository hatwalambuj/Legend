---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 8f05df682bbd42007fe1f63cf347391d5b3cbb15
source: user + docs/00-orchestrator/BRIEF.md
confidence: high
---
# Project Rules

## Founder constraints (user's words; highest precedence after the current instruction)
- **$0 infrastructure**: DB and hosting must be free-tier (Supabase Free + Vercel Hobby today). Alternatives allowed only if also free. (user, 2026-09-27)
- **No AI/LLM** anywhere: no SDK, API call or job step (BRIEF.md; ESLint blocks AI SDK imports; ADR-001).
- **No posting to third parties**: reviews/ratings live only in our DB (ADR-008; `tests/lib/guards.test.ts`).
- **IMDb rating on screen**: every ticket stub + detail page, via OMDb, hidden when null (ADR-008).
- Catalogue = TMDB `vote_average >= 6.5` with vote floors 200 movies / 100 TV (ADR-003).
- Brand "Stubbed": ticket cards; each watch = a stub; rewatches add stubs.

## Engineering rules
- File ownership per `docs/04-architecture/WORK_SPLIT.md`; frozen shared layer owned by the architect.
- Gate before any commit: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` (+ `npm run test:e2e` when UI/routes change; then `git checkout -- docs/06-qa/screenshots`).
- Migrations: never edit an applied file; add new timestamped files (`supabase/migrations/`).
- Playwright pinned 1.56.1; never `playwright install` in the container (README.md).
- Demo mode must work with zero env vars and zero network (ADR-006).
- Branch: `claude/movie-app-multi-agent-d2x9zd`. Orchestrator commits after each phase; agents don't commit.
- Secrets never in git, chat or `.clearpath/`.
