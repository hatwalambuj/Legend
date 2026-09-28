---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-28
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: session
confidence: high
---
# Hot Cache  (≤600 words · expires 7 days / 20 commits after `updated`)

## Current Goal
M1 + Where to watch done. Next: founder launch tasks + staging smoke on real keys; then Phase 2 M2 (share, analytics, 404/308).

## Active Context
- M1 launch hardening DONE and reviewed (SHIP). Stub-count race fixed ([[issues/stub-count-race.md]]).
- Where to watch DONE ([[issues/where-to-watch.md]]): TMDB/JustWatch providers, region (URL/cookie/setting), allowlisted links; review SHIP; 212 E2E + 535 unit green at 06e1627.
- Orchestrator holds standing approval for in-repo decisions ([[meta/rules.md]]).
- Constraints: $0 infra, no AI, no third-party posting.

## Recent Changes
- QA-WTW-1 region kept on slug redirect; QA-WTW-2 AA contrast for Prime Video/Paramount+ tiles.
- WTW-1 32 KB watch cap; WTW-2 privacy copy for region cookie.

## Open Questions
- Repo public or private? (AR-6 scheduled workflows.)
- Launch commercially later? (Vercel Hobby, TMDB, OMDb, JustWatch data are non-commercial.)

## Next Best Step
Founder: TMDB logo, trademark, SMTP, keys, apply 5 migrations to Supabase, staging smoke (M1-17) + real-device provider-link check (W-21). Engineering: W-30/31/32 P1 (ticket watch hint, browse chips), then M2.
