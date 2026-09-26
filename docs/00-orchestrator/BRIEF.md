# Project Brief (source of truth for every agent)

## What the founder asked for
A public web app (open by URL, mobile + desktop) where anyone can:
- Browse movies **and shows**, see ratings, sort by **release date** and **rating**.
- Read reviews and details.
- Create an account, **track what they've watched**, and **write reviews**.
- Catalog is limited to **top-rated titles only: rating >= 6.5** (this also solves API/DB limits).

Product/brand direction:
- Working brand: **Stubbed** — "your ticket stub = proof you watched". Works as a verb: "I stubbed Dune."
  - Marking watched = **adding a stub**. Every rewatch adds another stub (stub count per title).
- Titles are displayed as **movie tickets** (ticket-shaped cards, perforations, stub tear-off).
- Minimal, Gen-Z "pro" aesthetic. Background adapts to the current movie/show **poster** (dominant colour / blurred poster).
- PM should still explore alternative movie/show-related names.

Infra direction: free tiers (e.g. Vercel + Supabase), open to better options.

Founder questions that must be answered in docs:
1. "Why put everything in a DB — can't we get it real-time?" → Architect makes the final call.
2. "Reviews saved directly to IMDb and our DB" → research feasibility honestly (IMDb has no public write API; evaluate TMDB, Trakt, OMDb, IMDb datasets, etc.).

## Pipeline (no human in the loop)
Orchestrator → Product Manager → UI/UX Designer → System Designer → Architect (final technical call, scaffolds) →
Frontend Dev ∥ Backend Dev → Reviewer → QA (browser E2E) → Product Manager gap review → (loop back to engineering if gaps).

## Environment constraints (important for every agent)
- Build container: outbound network is blocked except npm/pypi registries. `WebSearch`/`WebFetch` tools DO work for research.
- The running app inside this container can NOT reach TMDB/OMDb/Trakt/Supabase. Therefore the app MUST support a
  **fixture/demo mode** (bundled seed data, local auth + storage) that is used automatically when API keys are absent.
  QA runs against this mode. Real providers switch on purely via env vars.
- No credentials are available yet. Never hard-code secrets; document every env var in `.env.example`.
- Chromium for Playwright: `/opt/pw-browsers` (PLAYWRIGHT_BROWSERS_PATH is set). Never run `playwright install`.
- Git branch: `claude/movie-app-multi-agent-d2x9zd`. Agents do NOT commit; the orchestrator commits between phases.

## Artifacts per phase
| Phase | Output |
|---|---|
| PM | `docs/01-product/PRD.md` (+ `research.md`, `naming.md`) |
| UI/UX | `docs/02-design/DESIGN.md`, `docs/02-design/prototype.html` |
| System design | `docs/03-system-design/SYSTEM_DESIGN.md` |
| Architect | `docs/04-architecture/ADR-*.md`, `docs/04-architecture/API_CONTRACT.md`, project scaffold |
| FE / BE | app code |
| Reviewer | `docs/05-review/REVIEW.md` + fixes |
| QA | `e2e/*.spec.ts`, `docs/06-qa/QA_REPORT.md` |
| PM gap review | `docs/07-gap-review/GAP_REVIEW.md` |

## Founder scope change — 2026-09-26 (overrides all earlier docs)
- **No posting to third parties.** Remove every outbound write of reviews or ratings: no "Also post on IMDb" copy-and-open,
  no Trakt sync, no TMDB rating push, no sync tables, outbox, flags or env vars for it. Reviews and ratings live only in our DB.
- **Show the IMDb rating on screen**: on every ticket stub (next to the TMDB score) and on the title detail page.
  Source: OMDb (`OMDB_API_KEY`), cached in our DB and refreshed by the nightly job; hidden when a title has no IMDb rating.
  Demo fixtures must carry real IMDb ids and IMDb ratings.
- See `docs/04-architecture/ADR-008-scope-change-no-third-party-posting.md`.
- **No AI at runtime or in batch jobs.** The app runs on its own server with no LLM/AI access. Every feature (including the
  "should I watch?" summary) must be built deterministically from API data, rules and templates.
