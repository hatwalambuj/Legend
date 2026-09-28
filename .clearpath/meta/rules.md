---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
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

## Standing authorization (founder, 2026-09-27)
- "These approvals need to be done by the orchestrator itself, the one who is managing the project."
- Scope: in-repo engineering decisions — assigning fixes to the owning agent, accepting/rejecting review findings and spec deviations, committing/pushing to the feature branch.
- Not covered (still ask the founder): production deploys, applying migrations to a real database, secrets/credentials, external service writes, paid services, git history rewrite, anything that breaks the $0 / no-AI / no-third-party-posting constraints.
