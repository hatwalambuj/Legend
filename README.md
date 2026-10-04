# Stubbed

## What is Stubbed

- **A collectible diary for movies and TV.** Every watch earns a ticket stub; every rewatch adds another.
- **Only the good stuff:** titles rated **6.5 or higher** on TMDB, with a vote floor (a 9.0 from seven votes doesn't count).
- Every title shows the **TMDB score**, the **IMDb rating** (via OMDb), a rules-based **"Worth it?"** summary and **Where to watch** for your region.
- Browse and sort by release date or rating, filter by streaming service, search, read reviews.
- Sign up to stub what you watch (with a season for shows), write reviews, keep a watchlist and a public wallet.
- Share a title, wallet, review or stub, with preview cards and a story-sized stub image.
- Import from Letterboxd, IMDb ratings or TV Time (beta); export to Letterboxd CSV or JSON at any time.
- Reviews and ratings live only in Stubbed: **nothing is posted to other sites**. Analytics are first-party counts only.
- **No AI anywhere**: every feature is built from stored data, rules and templates. Runs on free tiers ($0).
- Status: feature-complete and tested in demo mode. **Not yet run on real keys**: follow [LAUNCH.md](docs/09-closeout/LAUNCH.md).

**Start here:** [Launch runbook](docs/09-closeout/LAUNCH.md) (founder, step by step) · [Founder inputs F1–F12](docs/09-closeout/FOUNDER_INPUTS.md) · [Release notes](docs/09-closeout/RELEASE_NOTES.md) · Architecture: [ADRs](docs/04-architecture/) ([close-out ADR-013](docs/04-architecture/ADR-013-closeout.md)), [API contract](docs/04-architecture/API_CONTRACT.md), [work split](docs/04-architecture/WORK_SPLIT.md) · "Architecture in one screen" below.

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

The founder's numbered runbook with checks for every step is [LAUNCH.md](docs/09-closeout/LAUNCH.md); this section is the reference behind it. Do these in order. Keep every key out of git; only `NEXT_PUBLIC_*` values ever reach the browser.

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
- **Migrations:** `SUPABASE_DB_URL=<session pooler string> npm run db:apply` shows the plan (dry run), `-- --yes` applies the pending files in name order, once each (needs `psql`; or run Actions → "Apply database migrations" with `confirm` = `yes`). Without psql: `supabase link` then `supabase db push`, or paste each file of `supabase/migrations/` into the SQL editor **in name order**; then run `npm run db:apply -- --baseline --yes` once so later runs know they are applied.
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
| `NEXT_PUBLIC_BRAND_NAME` (only after a rename, see F8; build-time) | ✓ | — |
| `OMDB_API_KEY` | — | ✓ secret |

- **Do not** set any `DEMO_*` variable or `IMAGE_MODE=off` on the real site. A production server **refuses to start in demo mode** (no keys, or only some of them) unless `DEMO_MODE_PUBLIC=true` is set. Only set that for a deliberate throwaway demo: its data resets, the demo accounts are shared, and it must never be presented as the product.
- Add your custom domain.

### 5. GitHub Actions (the nightly job)
- Repo → Settings → Environments → create **`production`** (all four ops workflows use it: `nightly-sync.yml`, `db-apply.yml`, `smoke-live.yml`, `backup.yml`).
- Settings → Secrets and variables → Actions: add the secrets and the `NEXT_PUBLIC_SITE_URL` variable from the table above (repo level or in the `production` environment). Optional tuning variables: `SYNC_GUARD_MIN_MOVIE`, `SYNC_GUARD_MIN_TV`, `OMDB_DAILY_BUDGET`, `SYNC_ENRICH_MAX`.
- Also: secret `SUPABASE_DB_URL` (session pooler string; `db-apply.yml`, `smoke-live.yml`, `backup.yml`), secret `BACKUP_PASSPHRASE` (`backup.yml`) and variable `SMOKE_EMAIL` (an address on a real mail domain, `smoke-live.yml`).

### Environment
M1 additions (ADR-001 §A3, ADR-011). Set them in Vercel unless noted:

| Variable | Default | What |
|---|---|---|
| `TRUSTED_PROXY` | auto: `vercel` when `VERCEL=1`, `netlify` when `NETLIFY=true`, else `none` | Which proxy headers to trust for the client IP and forwarded host/proto: `vercel`, `netlify`, `cloudflare`, `xff-1`…`xff-5` (N proxies you run, e.g. Caddy on a VM = `xff-1`) or `none`. A **live production server without it and without an auto-detected platform refuses to boot.** Leave it unset on Vercel |
| `HEALTH_MAX_SYNC_AGE_HOURS` | `36` | `/api/health` reports `degraded` when the last full sync is older |
| `SYNC_RECHECK_MAX` | `500` | GitHub Actions variable. More titles missing from discover than this aborts the apply for a human to look at |
| `SUPABASE_DB_URL`, `BACKUP_PASSPHRASE` | — | GitHub Actions **secrets** for the backup workflow (see "Backups and restore") |

Close-out additions (ADR-013 §16):

| Variable | Default | What |
|---|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | `Stubbed` | Brand name in the UI and share images (1–24 letters, digits, space `. ' & -`). Inlined at build time: a rename needs a redeploy |
| `ANALYTICS_ENABLED` | `true` | First-party anonymous daily counts in our own DB. `false` turns `/api/events` and server events into no-ops |
| `IMPORT_MAX_ROWS_PER_DAY` | `20000` | Per-user cap on imported rows per 24 h |

Monitoring (free): two uptime monitors (UptimeRobot or Better Stack), every 5 minutes: `https://<domain>/api/health` alerts when the site or database is **down** (503), `https://<domain>/api/health?strict=1` also alerts when the catalogue sync is **stale** (> 36 h). The first one also keeps Supabase Free from pausing.

### 6. First sync
1. Actions → "Nightly catalogue sync" → **Run workflow** with **dry_run = true**. A dry run reads TMDB discover pages and the database, and spends no OMDb or enrich budget; it writes nothing (no image downloads either). The log prints the listed count per type against its guardrail, e.g. `[sync] listed tv 1450 (min 1000, max 25000)` (titles that went missing are counted as still listed, and a second line shows the counts if they all dropped), then `[sync] GUARD: pass` or `fail`. A failing guard exits 1.
2. Guardrails: the run keeps the index membership untouched (no titles added or removed; enrich, IMDb, palettes and the purge still run, and the workflow fails) if a type is below its minimum (`SYNC_GUARD_MIN_MOVIE`, default 3,000; `SYNC_GUARD_MIN_TV`, default 1,000), above `SYNC_GUARD_MAX`, or moves more than 20% against the last good run, or more than `SYNC_RECHECK_MAX` previously listed titles went missing. On the **first run** (empty catalogue) the minimums only warn, so the first sync can't brick an empty site. Once you know the real numbers, set the two minimums to about **80%** of them (the log prints this hint when a floor is hit).
3. Run it again with **dry_run = false**. Browse and search work after this first run. "Worth it?" details and ticket time lines backfill over **3 to 5 nights** (`SYNC_ENRICH_MAX=3000` detail calls a night at about 10 req/s), IMDb chips over about 2 weeks on the free OMDb key.
4. After that it runs by itself every night at 03:17 UTC. `npm run sync:catalog -- --from-fixtures` seeds a project from the demo data instead (no TMDB needed); `-- --only=imdb|enrich|discover` runs one step.

### Launch kit (one command per founder step)
| Command | What it does |
|---|---|
| `npm run launch:check` | Offline checklist: every live env var (names only, never values), no demo/E2E switches, no secret in a `NEXT_PUBLIC_*` variable, the production boot, the placeholder TMDB logo, the placeholder contact email, migration files, and warns while `NEXT_PUBLIC_BRAND_NAME` is unset or the default (do the F8 trademark search first). Exits 1 with a numbered "to fix" list. Reads the environment, then `.env.local`/`.env`. |
| `npm run launch:check -- --live` | Also probes TMDB (and the `watch/providers` append), OMDb, Supabase Auth (email sign-up on, Confirm email off), `health_probe()` and `<site>/api/health`, and compares `public._stubbed_migrations` (read-only: `psql` + `SUPABASE_DB_URL`, else REST with the service_role key) with `supabase/migrations/`: fails naming every file not applied yet. Redirect URLs and SMTP stay a manual check. |
| `npm run launch:check -- --migrations` | Only that migrations comparison: the pre-deploy gate. Exits 1 when a file is pending or the database cannot be read. First step of Actions → "Live smoke (staging)". |
| `npm run db:apply [-- --yes]` | Applies `supabase/migrations/*.sql` to `SUPABASE_DB_URL`, tracked with checksums in `public._stubbed_migrations`. Dry run unless `--yes`; refuses on an edited, missing or out-of-order file. `-- --pglite --yes` rehearses on in-memory Postgres. |
| `npm run smoke:live -- --url https://<deploy>` | Playwright `e2e-live/` on a real deploy: health ok, real posters, TMDB `watch/providers` key, TMDB + IMDb + Where to watch on a title, real 404 (unknown title) and 308 (wrong slug) status codes, "On {Service}" chips on `/browse`, the title OG image (1200×630 PNG), then one throwaway account: sign-up, stub, story image (1080×1920 PNG), review, export, delete. Evidence in `test-results-live/evidence/`. Needs `TMDB_READ_TOKEN`; set `SMOKE_EMAIL` to an address on a real mail domain. Also Actions → "Live smoke (staging)". |
| `npm run check:provider-links` | Requests every allowlisted Where to watch URL; fails only on DNS, TLS, 5xx or non-https (403/429 bot-blocks are tolerated). Runs in the live smoke workflow too. |

**Every release (after the first launch): migrate, then deploy.** New code may need a new column or function, and the migrations only ever add (defaulted params, appended columns), so the old code keeps working on the new schema but not the other way round. For any commit that adds a file to `supabase/migrations/`:
1. `npm run db:apply` (dry run, read the plan), then `npm run db:apply -- --yes` (or Actions → "Apply database migrations", `confirm` = `yes`).
2. `npm run launch:check -- --migrations` must pass (it names any pending file).
3. Only then merge / deploy, and run the live smoke on the deploy.

### 7. Before telling anyone
- Staging smoke on a Vercel preview with real keys: sign up, stub, stub again, review, delete a stub, export and import the CSV into your own Letterboxd account, request a magic link to a Gmail address (it must arrive), check the `sb-*` cookies are httpOnly, delete a test account, run Lighthouse mobile on a title page (LCP < 2.5 s, CLS < 0.1) and check link unfurls and real-poster backgrounds.
- Check the About page: official TMDB logo, "IMDb ratings via OMDb", privacy text, contact. Make sure the `NEXT_PUBLIC_CONTACT_EMAIL` inbox is read (reports arrive there; hide reported reviews in the Supabase table editor).

### Backups and restore
Supabase Free has no backups, so `.github/workflows/backup.yml` makes one every night at 04:07 UTC (and on **Run workflow**):
- Secrets (repo → Settings → Secrets → Actions, `production` environment): `SUPABASE_DB_URL` = the **session pooler** connection string from Supabase → Connect (IPv4; role `postgres`, with the database password), and `BACKUP_PASSPHRASE` = a long random passphrase **kept in your password manager**. Without the passphrase the backups are useless. Without both secrets the workflow does nothing.
- Check the server version once with `select version();` and keep `PG_MAJOR` in the workflow equal to its major (17 today).
- Each run uploads `db-YYYY-MM-DD.tar.gpg` (encrypted: AES256) as a workflow artifact, kept **14 days**. It holds two `pg_dump` files: the `public` schema (without the detail cache and staging data) and `auth.users` + `auth.identities` (accounts must be restorable). Keep the repo private: artifacts of a public repo can be downloaded by anyone (they are encrypted, but still).
- Deleted accounts disappear from backups after at most 14 days.

**Restore** (rehearse once on a staging project before launch):
1. Create a new Supabase project and apply every migration in `supabase/migrations/` in name order.
2. Download the artifact, then `gpg -d db-YYYY-MM-DD.tar.gpg > db.tar && tar -xf db.tar` (asks for the passphrase).
3. Restore without firing the triggers (`on_auth_user_created`, `title_stats`) twice, auth first:
   `PGOPTIONS='-c session_replication_role=replica' pg_restore --data-only --no-owner -d "$NEW_DB_URL" auth.dump`, then the same for `public.dump`. If Supabase's `postgres` role may not set `session_replication_role`, restore `auth.dump` first, delete the auto-created `profiles` rows (`delete from public.profiles;`), then restore `public.dump`.
4. Check: `select public.catalog_count('all');` matches the old site, and sign in with a known staging account.

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
| `npm run launch:check` / `db:apply` / `smoke:live` / `check:provider-links` | Launch kit, see "Launch kit" above |
| `npm run format` / `format:check` | Prettier write / check (CI runs the check) |
| `npx tsx scripts/metrics.ts` | Weekly product metrics and 7 days of error counts (service role key needed) |

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
- **Identity** ([ADR-010](docs/04-architecture/ADR-010-identity.md)), **free-tier operations** ([ADR-011](docs/04-architecture/ADR-011-operations-free-tier.md): sync guardrails, health, keep-alive, backups), **Where to watch** ([ADR-012](docs/04-architecture/ADR-012-where-to-watch.md)), **close-out** ([ADR-013](docs/04-architecture/ADR-013-closeout.md): share images, imports, seasons, first-party analytics and error logs, brand config).
- **Contract**: [API_CONTRACT.md](docs/04-architecture/API_CONTRACT.md). **Who owns what**: [WORK_SPLIT.md](docs/04-architecture/WORK_SPLIT.md).

```
src/
  app/                 pages (Frontend) · app/api/** route handlers (Backend)
  components/ hooks/   UI (Frontend)
  lib/                 shared, frozen: types, zod contracts, errors, api-client, sort/cursor, curation, images, palette, format
                       (+ worth-it.ts / vibes.ts: "Worth it?" rules, Backend-tuned)
  server/              Backend: dal.ts (what pages call), ports, repositories (memory | supabase), providers, auth, jobs
  og/                  share/OG image cards (next/og) + bundled font
  fixtures/            demo seed (generated)
  styles/tokens.css    design tokens (DESIGN.md §2)
supabase/migrations/   schema + RLS + triggers + catalogue RPCs
scripts/               sync-catalog, build-fixtures, demo-reset, metrics + launch kit (launch-check, db-apply, smoke-live, check-provider-links)
tests/                 shared-lib, server/route and DB (PGlite) tests
e2e/                   Playwright, demo mode · e2e-live/ Playwright against a real deploy (smoke:live)
docs/                  brief → PRD → design → system design → ADRs → review → QA → close-out (09-closeout)
```

## Attribution
This product uses the TMDB API but is not endorsed or certified by TMDB. IMDb ratings come via OMDb (CC BY-NC). Fonts: Bricolage Grotesque and Geist (SIL Open Font License), self-hosted.
