# Stubbed

**The collectible diary for movies and TV.** Every watch earns a ticket stub, and the catalogue only includes the good stuff: titles rated **6.5 or higher** on TMDB (plus a vote floor, so a 9.0 from seven votes doesn't count).

Browse and sort by release date or rating, see the **TMDB score and the IMDb rating** on every ticket, get a quick **"Worth it?"** summary on every title, read reviews, then sign up to **stub** what you watch (every rewatch adds another stub) and write reviews. Reviews and ratings live only in Stubbed — nothing is posted to other sites — and you can export your data to Letterboxd CSV or JSON at any time.

No AI anywhere: every feature, including "Worth it?", is built from stored data, rules and templates.

> Status: MVP feature-complete and tested in demo mode (unit, DB and Playwright E2E suites). Not yet run against real Supabase, TMDB and OMDb keys: follow **Going live** below, then do the staging smoke test before announcing ([GAP review](docs/07-gap-review/GAP_REVIEW.md) §6).

## Quick start (demo mode: no keys, no network)

```bash
npm install
npm run dev          # http://localhost:3000
```

With **zero environment variables** the app runs in **demo mode**:
- the bundled catalogue of 71 real titles (66 pass the 6.5 rule) with real IMDb ratings and "Worth it?" data
- local accounts and a local JSON store in `.data/demo`
- a "● DEMO DATA" pill on every page

A **production** server (`npm run build && npm start`, or Vercel) refuses to run in demo mode unless you opt in with `DEMO_MODE_PUBLIC=true` (see Going live §4). Never share a demo URL as the product.

Sign in as `maya@demo.stubbed.app`, `dev@demo.stubbed.app` or `priya@demo.stubbed.app` with password **`stubbed-demo`**. Run `npm run demo:reset` to re-seed.

Posters load from TMDB's CDN in a normal browser. If they can't load (offline, or `IMAGE_MODE=off`), a generated poster in the title's own colours is shown instead.

## Going live

Do these in order. Keep every key out of git; only `NEXT_PUBLIC_*` values ever reach the browser.

### 0. Name and licences (before you spend anything)
- **Trademark:** run a clearance search for "Stubbed" (USPTO and EUIPO, classes 9, 41, 42). Watch for **AMC Stubs** and apps like MyStubs or TicketStub; a one-off opinion from a trademark attorney is worth it. Fallback name: **Punched** ([naming](docs/01-product/naming.md)). Register the domain and handles before announcing.
- **Non-commercial only as built:** the TMDB developer licence and OMDb's data (CC BY-NC) are **non-commercial**, and so is **Vercel Hobby**. No ads, paid plans or sponsorships without a commercial TMDB licence and Vercel Pro.

### 1. TMDB (the catalogue)
- themoviedb.org → Settings → API → request a **Developer** key. Copy the **API Read Access Token** (the long one) → `TMDB_READ_TOKEN`.
- **Replace `public/tmdb-logo.svg` with the official logo** from TMDB's "Logos & Attribution" page (the file in the repo is a placeholder; TMDB's terms require theirs). Keep the attribution text as it is.

### 2. OMDb (the IMDb rating)
- Free key at omdbapi.com/apikey.aspx; click the activation link in the email → `OMDB_API_KEY`. Only the nightly job uses it.
- **Budget:** the free key allows 1,000 calls/day and the job spends `OMDB_DAILY_BUDGET=900` a night, so every title has its IMDb chip after **about 2 weeks** (never-checked titles first, popular ones refreshed weekly). For launch month consider the OMDb Patreon tier (from about $1/month) and raise `OMDB_DAILY_BUDGET` to match.

### 3. Supabase (database + accounts)
- Create a project (region close to your users); save the database password.
- Project Settings → API: copy the **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`, the **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`. The service_role key is a master key: never put it in a `NEXT_PUBLIC_` variable or anywhere public.
- **Migrations:** `supabase link` then `supabase db push`, or paste each file of `supabase/migrations/` into the SQL editor **in name order** (`20260926000000_init.sql`, `…120000_user_data_reads.sql`, `…180000_review_hardening.sql`, then any newer ones).
- Authentication → Providers → Email: turn **Confirm email OFF** for the MVP.
- Authentication → URL Configuration: **Site URL** = your domain (e.g. `https://stubbed.app`). **Redirect URLs**: add `https://stubbed.app/auth/callback` and your Vercel preview pattern (e.g. `https://*-yourteam.vercel.app/auth/callback`). Without this, magic links fail.
- Authentication → Emails → **SMTP settings: set up custom SMTP.** Supabase's built-in sender only delivers to your own project team's addresses (about 2 an hour), so magic links and "Forgot password?" would silently fail for real users. Resend's free tier (3,000/month, 100/day) is enough: verify your domain in Resend, then paste its SMTP host, user and password here.
- The free tier pauses after 7 days without activity (the nightly job keeps it awake) and has **no backups**. Move to Pro once real users arrive.

### 4. Vercel (the website)
- Import the GitHub repo (framework Next.js, Node 22 as in `.nvmrc`).
- Settings → Environment Variables, for **Production and Preview**:

| Variable | Vercel | GitHub Actions (nightly job) |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` (your domain) | ✓ | ✓ as a **variable** |
| `TMDB_READ_TOKEN` | ✓ | ✓ secret |
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | ✓ secret |
| `SUPABASE_SERVICE_ROLE_KEY` (export, detail cache, **account deletion**) | ✓ | ✓ secret |
| `REVALIDATE_SECRET` (`openssl rand -hex 32`, same value in both) | ✓ | ✓ secret |
| `NEXT_PUBLIC_CONTACT_EMAIL` (inbox for Contact and review reports) | ✓ | — |
| `OMDB_API_KEY` | — | ✓ secret |

- **Do not** set any `DEMO_*` variable or `IMAGE_MODE=off` on the real site. A production server **refuses to start in demo mode** (no keys, or only some of them) unless `DEMO_MODE_PUBLIC=true` is set. Only set that for a deliberate throwaway demo: its data resets, the demo accounts are shared, and it must never be presented as the product.
- Add your custom domain.

### 5. GitHub Actions (the nightly job)
- Repo → Settings → Environments → create **`production`** (`.github/workflows/nightly-sync.yml` uses it).
- Settings → Secrets and variables → Actions: add the secrets and the `NEXT_PUBLIC_SITE_URL` variable from the table above (repo level or in the `production` environment). Optional tuning variables: `SYNC_GUARD_MIN_MOVIE`, `SYNC_GUARD_MIN_TV`, `OMDB_DAILY_BUDGET`, `SYNC_ENRICH_MAX`.

### 6. First sync
1. Actions → "Nightly catalogue sync" → **Run workflow** with **dry_run = true**. The log prints the listed count per type against its guardrail, e.g. `[sync] listed tv 1450 (min 1000, max 25000)`, and writes nothing.
2. Guardrails: the run aborts (index untouched) if a type is below its minimum (`SYNC_GUARD_MIN_MOVIE`, default 3,000; `SYNC_GUARD_MIN_TV`, default 1,000), above `SYNC_GUARD_MAX`, or moves more than 20% against the last good run. On the **first run** (empty catalogue) the minimums only warn, so the first sync can't brick an empty site. Once you know the real numbers, set the two minimums to about **80%** of them (the log prints this hint when a floor is hit).
3. Run it again with **dry_run = false**. Browse and search work after this first run. "Worth it?" details and ticket time lines backfill over **3 to 5 nights** (`SYNC_ENRICH_MAX=3000` detail calls a night at about 10 req/s), IMDb chips over about 2 weeks on the free OMDb key.
4. After that it runs by itself every night at 03:17 UTC. `npm run sync:catalog -- --from-fixtures` seeds a project from the demo data instead (no TMDB needed); `-- --only=imdb|enrich|discover` runs one step.

### 7. Before telling anyone
- Staging smoke on a Vercel preview with real keys: sign up, stub, stub again, review, delete a stub, export and import the CSV into your own Letterboxd account, request a magic link to a Gmail address (it must arrive), check the `sb-*` cookies are httpOnly, delete a test account, run Lighthouse mobile on a title page (LCP < 2.5 s, CLS < 0.1) and check link unfurls and real-poster backgrounds.
- Check the About page: official TMDB logo, "IMDb ratings via OMDb", privacy text, contact. Make sure the `NEXT_PUBLIC_CONTACT_EMAIL` inbox is read (reports arrive there; hide reported reviews in the Supabase table editor).

Self-hosting instead of Vercel: `npm run build && npm start` with the same variables, and `npm run sync:catalog` from a system cron. Providers switch on purely through env vars; a **partial** configuration (e.g. a Supabase URL without a key) refuses to boot instead of silently falling back to demo.

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
