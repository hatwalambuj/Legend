---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 8f05df682bbd42007fe1f63cf347391d5b3cbb15
source: docs/03-system-design + docs/04-architecture
confidence: high
---
# Overview
Stubbed: public web app to browse top-rated (>=6.5 TMDB) movies/shows as ticket cards, see TMDB + IMDb ratings and a rule-based "Worth it?" summary, create an account, add a stub per watch (rewatches = more stubs), write reviews, keep a wallet/diary/watchlist, export data.

- Next.js App Router (RSC reads via `dal`, client mutations via `api-client` → route handlers).
- Supabase Postgres + Auth + RLS in live mode; in-memory/JSON store + local auth in demo mode (auto when keys absent).
- Nightly GitHub Actions job syncs catalog_index from TMDB, IMDb ratings from OMDb (900/night budget), palettes via sharp.
- Posters direct from image.tmdb.org with palette-gradient fallback.
- Tests: vitest (272) + Playwright E2E desktop/mobile (169).
