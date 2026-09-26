# Stubbed

**The collectible diary for movies and TV.** Every watch earns a ticket stub, and the catalogue only includes the good stuff: titles rated **6.5 or higher** on TMDB (plus a vote floor, so a 9.0 from seven votes doesn't count).

Browse and sort by release date or rating, read reviews, then sign up to **stub** what you watch (every rewatch adds another stub) and write reviews. Your data stays yours: export it to Letterboxd CSV or JSON at any time.

> Status: MVP in progress. Architecture and scaffold are done; the UI and backend are being built in parallel (see [WORK_SPLIT](docs/04-architecture/WORK_SPLIT.md)).

## Quick start (demo mode: no keys, no network)

```bash
npm install
npm run dev          # http://localhost:3000
```

With **zero environment variables** the app runs in **demo mode**:
- the bundled catalogue of 70 real titles (66 pass the 6.5 rule)
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
2. Apply `supabase/migrations/*.sql` to your Supabase project (`supabase db push`, or paste into the SQL editor). In Auth settings, turn **Confirm email OFF** for the MVP.
3. Seed or refresh the catalogue with `npm run sync:catalog`. This is the nightly job; `-- --from-fixtures` seeds from the demo data instead.
4. Deploy to Vercel. Add the same secrets to GitHub Actions for `.github/workflows/nightly-sync.yml`.

Providers switch on purely through env vars. A **partial** configuration (for example a Supabase URL without a key) refuses to boot instead of silently falling back to demo.

## Scripts
| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next.js 16 (App Router, Turbopack) |
| `npm run lint` | ESLint (flat config, `--max-warnings=0`) |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest: unit tests + **migration tests on PGlite** (real Postgres in WASM: schema, RLS, triggers, SQL/JS sort parity) |
| `npm run test:e2e` | Playwright (Chromium, desktop + mobile), against a production build in demo mode |
| `npm run sync:catalog` | Nightly TMDB → `catalog_index` sync (`--dry-run`, `--from-fixtures`) |
| `npm run fixtures:build` | Regenerate `src/fixtures/*.json` from `scripts/fixtures/*.source.ts` |
| `npm run demo:reset` | Reset the demo JSON store |

Playwright is pinned to **1.56.1** to match the pre-installed `chromium-1194` in the build container. There, never run `playwright install`; CI does it itself.

## Architecture in one screen
- **Stack** ([ADR-001](docs/04-architecture/ADR-001-stack-and-hosting.md)): Next.js 16 + React 19 + TypeScript strict on Vercel Hobby, with Supabase (Postgres + Auth + RLS) and a nightly GitHub Actions job.
- **Catalogue** ([ADR-002](docs/04-architecture/ADR-002-catalog-sourcing.md)): a hybrid. A nightly-synced curated index (about 15k rows) powers browse, sort and search in Postgres. Title details are fetched live from TMDB and cached for 24 h. User data is always ours.
- **Rules** ([ADR-003](docs/04-architecture/ADR-003-curation-sort-pagination.md)): ≥ 6.5, votes ≥ 200 (movies) / 100 (TV), all configurable. Sorts are total orders, pagination is keyset.
- **Reviews** ([ADR-004](docs/04-architecture/ADR-004-reviews-and-external-sync.md)): our DB is the source of truth. The IMDb option is honest copy-and-open (IMDb has no write API), plus Letterboxd export. Trakt sync is v1, behind a flag.
- **Auth** ([ADR-005](docs/04-architecture/ADR-005-auth.md)): Supabase Auth in production, a local signed-cookie auth in demo mode.
- **Demo mode** ([ADR-006](docs/04-architecture/ADR-006-demo-fixture-mode.md)): the same ports, backed by an in-memory store persisted to a JSON file.
- **Images and colour** ([ADR-007](docs/04-architecture/ADR-007-images-and-poster-palette.md)): images are hot-linked from TMDB. The poster palette is computed once per title at ingest with `sharp`, so the background adapts to each poster with guaranteed contrast.
- **Contract**: [API_CONTRACT.md](docs/04-architecture/API_CONTRACT.md). **Who owns what**: [WORK_SPLIT.md](docs/04-architecture/WORK_SPLIT.md).

```
src/
  app/                 pages (Frontend) · app/api/** route handlers (Backend)
  components/ hooks/   UI (Frontend)
  lib/                 shared, frozen: types, zod contracts, errors, api-client, sort/cursor, curation, images, palette
  server/              Backend: dal.ts (what pages call), ports, repositories (memory | supabase), providers, auth
  fixtures/            demo seed (generated)
  styles/tokens.css    design tokens (DESIGN.md §2)
supabase/migrations/   schema + RLS + triggers + catalogue RPCs
scripts/               sync-catalog, build-fixtures, demo-reset
tests/                 shared-lib + DB tests · e2e/ Playwright
docs/                  brief → PRD → design → system design → ADRs → review → QA
```

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB. IMDb ratings (optional) come via OMDb. Fonts: Bricolage Grotesque and Geist (SIL Open Font License), self-hosted.
