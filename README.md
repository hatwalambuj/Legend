# Stubbed

**The collectible diary for movies and TV.** Every watch earns a ticket stub, and the catalogue only includes the good stuff: titles rated **6.5 or higher** on TMDB (plus a vote floor, so a 9.0 from seven votes doesn't count).

Browse and sort by release date or rating, see the **TMDB score and the IMDb rating** on every ticket, get a quick **"Worth it?"** summary on every title, read reviews, then sign up to **stub** what you watch (every rewatch adds another stub) and write reviews. Reviews and ratings live only in Stubbed — nothing is posted to other sites — and you can export your data to Letterboxd CSV or JSON at any time.

No AI anywhere: every feature, including "Worth it?", is built from stored data, rules and templates.

> Status: MVP in progress. Architecture and scaffold are done; the UI and backend are being built in parallel (see [WORK_SPLIT](docs/04-architecture/WORK_SPLIT.md)).

## Quick start (demo mode: no keys, no network)

```bash
npm install
npm run dev          # http://localhost:3000
```

With **zero environment variables** the app runs in **demo mode**:
- the bundled catalogue of 71 real titles (66 pass the 6.5 rule) with real IMDb ratings and "Worth it?" data
- local accounts and a local JSON store in `.data/demo`
- a "● DEMO DATA" pill on every page

Sign in as `maya@demo.stubbed.app`, `dev@demo.stubbed.app` or `priya@demo.stubbed.app` with password **`stubbed-demo`**. Run `npm run demo:reset` to re-seed.

Posters load from TMDB's CDN in a normal browser. If they can't load (offline, or `IMAGE_MODE=off`), a generated poster in the title's own colours is shown instead.

## Going live
1. Copy `.env.example` to `.env.local` and set:
   - `TMDB_READ_TOKEN` (or `TMDB_API_KEY`)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `REVALIDATE_SECRET`
   - `OMDB_API_KEY` (optional; free key, used only by the nightly job to cache IMDb ratings)
2. Apply `supabase/migrations/*.sql` to your Supabase project (`supabase db push`, or paste into the SQL editor). In Auth settings, turn **Confirm email OFF** for the MVP.
3. Seed or refresh the catalogue with `npm run sync:catalog` (the nightly job: TMDB discover → enrich → IMDb ratings via OMDb). `-- --from-fixtures` seeds a project from the demo data instead; `-- --only=imdb` runs just the IMDb step.
4. Deploy to Vercel, or run it on your own server with `npm run build && npm start`. Add the same secrets to GitHub Actions for `.github/workflows/nightly-sync.yml` (or run `npm run sync:catalog` from a system cron).

Providers switch on purely through env vars. A **partial** configuration (for example a Supabase URL without a key) refuses to boot instead of silently falling back to demo.

## Scripts
| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js 16 (App Router, Turbopack) |
| `npm run lint` | ESLint (flat config, `--max-warnings=0`) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: unit tests + **migration tests on PGlite** (real Postgres in WASM: schema, RLS, triggers, SQL/JS sort parity) |
| `npm run test:e2e` | Playwright (Chromium, desktop + mobile), against a production build in demo mode |
| `npm run sync:catalog` | Nightly job: TMDB → `catalog_index`, enrich, IMDb ratings (`--dry-run`, `--from-fixtures`, `--only=discover\|enrich\|imdb`) |
| `npm run fixtures:build` | Regenerate `src/fixtures/*.json` from `scripts/fixtures/*.source.ts` |
| `npm run demo:reset` | Reset the demo JSON store |

Playwright is pinned to **1.56.1** to match the pre-installed `chromium-1194` in the build container. There, never run `playwright install`; CI does it itself.

## Architecture in one screen
- **Stack** ([ADR-001](docs/04-architecture/ADR-001-stack-and-hosting.md)): Next.js 16 + React 19 + TypeScript strict on Vercel Hobby, with Supabase (Postgres + Auth + RLS) and a nightly GitHub Actions job.
- **Catalogue** ([ADR-002](docs/04-architecture/ADR-002-catalog-sourcing.md)): a hybrid. A nightly-synced curated index (about 15k rows) powers browse, sort and search in Postgres. Title details are fetched live from TMDB and cached for 24 h. User data is always ours.
- **Rules** ([ADR-003](docs/04-architecture/ADR-003-curation-sort-pagination.md)): ≥ 6.5, votes ≥ 200 (movies) / 100 (TV), all configurable. Sorts are total orders, pagination is keyset.
- **Reviews** ([ADR-004](docs/04-architecture/ADR-004-reviews-and-external-sync.md)): our DB is the only place reviews and ratings are written. Letterboxd CSV / JSON export for portability.
- **No third-party posting, IMDb rating everywhere** ([ADR-008](docs/04-architecture/ADR-008-scope-change-no-third-party-posting.md)): IMDb ratings come from OMDb, cached on the catalogue row by the nightly job (tiered refresh within the free 1,000 calls/day) and returned in every title payload; the chip is hidden when unknown.
- **"Worth it?"** ([ADR-009](docs/04-architecture/ADR-009-worth-it-deterministic-summary.md)): hook, vibes, time commitment, certification and a verdict word, computed by pure rules from stored data. No AI.
- **Auth** ([ADR-005](docs/04-architecture/ADR-005-auth.md)): Supabase Auth in production, a local signed-cookie auth in demo mode.
- **Demo mode** ([ADR-006](docs/04-architecture/ADR-006-demo-fixture-mode.md)): the same ports, backed by an in-memory store persisted to a JSON file.
- **Images and colour** ([ADR-007](docs/04-architecture/ADR-007-images-and-poster-palette.md)): images are hot-linked from TMDB. The poster palette is computed once per title at ingest with `sharp`, so the background adapts to each poster with guaranteed contrast.
- **Contract**: [API_CONTRACT.md](docs/04-architecture/API_CONTRACT.md). **Who owns what**: [WORK_SPLIT.md](docs/04-architecture/WORK_SPLIT.md).

```
src/
  app/                 pages (Frontend) · app/api/** route handlers (Backend)
  components/ hooks/   UI (Frontend)
  lib/                 shared, frozen: types, zod contracts, errors, api-client, sort/cursor, curation, images, palette, format
                       (+ worth-it.ts / vibes.ts: "Worth it?" rules, Backend-tuned)
  server/              Backend: dal.ts (what pages call), ports, repositories (memory | supabase), providers, auth, jobs
  fixtures/            demo seed (generated)
  styles/tokens.css    design tokens (DESIGN.md §2)
supabase/migrations/   schema + RLS + triggers + catalogue RPCs
scripts/               sync-catalog, build-fixtures, demo-reset
tests/                 shared-lib + DB tests · e2e/ Playwright
docs/                  brief → PRD → design → system design → ADRs → review → QA
```

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB. IMDb ratings come via OMDb (CC BY-NC). Fonts: Bricolage Grotesque and Geist (SIL Open Font License), self-hosted.
