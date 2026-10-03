# Work split: Frontend ∥ Backend

Owner: Architect · Date: 2026-09-26 (v1.3 2026-10-03: §7 close-out, ADR-013 · v1.1: ADR-008 IMDb everywhere + no posting, ADR-009 "Worth it?", no AI · v1.2 2026-09-27: §5 M1 task list for ADR-010/011 and ADR-001 Amendment A)
Applies to: Frontend Dev, Backend Dev, Reviewer, QA

Two agents work at the same time with **zero file conflicts**. Every path in the repo has exactly one owner.
Only edit what you own. If you need a change in a frozen file, write it under "Contract change requests" in
your hand-off notes and work around it — do not edit the file. The Reviewer or orchestrator decides.

Hard rules for everyone: **no AI/LLM anywhere** (PRD D15 — no AI SDK, env var, API call or job step; ESLint
blocks AI SDK imports) and **nothing is posted to third parties** (ADR-008 — `tests/lib/guards.test.ts`
fails on `imdb-shared`, `trakt`, `sync_jobs`, `imdb-assist`… in `src/`, `scripts/`, `.github/`).

## 1. Ownership map (exact)

### 🔒 Architect — shared layer, FROZEN (read-only for FE and BE)
| Path | What |
|---|---|
| `src/lib/types.ts` | Domain types: `TitleSummary` (incl. `imdbRating`, `imdbVotes`, `episodeCount`, `episodeRuntimeMinutes`), `TitleDetail` (incl. `worthIt`), `WorthIt`, `TitleEnrichment`, … |
| `src/lib/contracts.ts` | zod request schemas + response types for every route |
| `src/lib/errors.ts` | Error model, `ERROR_COPY` |
| `src/lib/data-access.ts` | `DataAccess` interface (what pages call) |
| `src/lib/api-client.ts` | Typed browser client (`api.*`) |
| `src/lib/format.ts` | `titleScores()` (TMDB always, IMDb only when known), `formatScore`, `formatCount`, `ticketAccessibleName`, `IMDB_SOURCE_LABEL` |
| `src/lib/catalog-order.ts`, `curation.ts`, `text.ts`, `keys.ts`, `routes.ts`, `images.ts`, `palette.ts` | Order/cursor, curation rule, normalisation, URLs (`titleHref`, `browseHref`, `safeNext`, `imdbTitleHref`), image URLs + fallback, colour maths |
| `src/server/env.ts` | Env parsing + mode resolution |
| `src/styles/tokens.css`, `src/app/fonts.ts`, `src/app/fonts/*` | Design tokens (incl. `--imdb`, `--on-imdb`, `--chip-on-paper-line`), self-hosted fonts |
| `src/fixtures/catalog.json`, `src/fixtures/seed.json`, `src/fixtures/schema.ts` | Generated demo data (regenerate only with `npm run fixtures:build`) |
| `scripts/build-fixtures.ts`, `scripts/fixtures/titles.source.ts`, `scripts/fixtures/seed.source.ts`, `scripts/fixtures/pitch.source.ts` | Fixture sources (titles + IMDb ratings, users/stubs/reviews, "Worth it?" data) |
| `supabase/migrations/20260926000000_init.sql` | Initial schema + RLS + RPCs (never edit once applied; add new files instead) |
| `tests/lib/**`, `tests/stubs/**` | Tests of the frozen shared layer (incl. `worth-it.test.ts`, `format.test.ts`, `guards.test.ts`), vitest stubs |
| `docs/04-architecture/**`, `README.md` | ADRs, contract, this file |
| `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/nightly-sync.yml`, `.env.example`, `.prettierrc.json`, `.prettierignore`, `.nvmrc`, `.gitignore`, `next-env.d.ts` | Config |

> **Dependencies:** `package.json` is frozen. If you truly need a dependency, run `npm install <pkg>` **once**
> and list it in your hand-off notes. Frontend should not need any (no UI kit, no Tailwind, no state
> library). **AI/LLM packages are forbidden** for everyone.

### 🛠 Backend Dev
| Path | What |
|---|---|
| `src/lib/worth-it.ts`, `src/lib/vibes.ts` | "Worth it?" rules + vibe mapping table. **Exported signatures and the `WorthIt` types are frozen**; you may tune thresholds, copy, weights and the allowlist (keep `tests/lib/worth-it.test.ts` green; never allowlist a spoiler keyword) |
| `src/server/dal.ts` | Implements `DataAccess` (computes `worthIt` in `getTitle`) |
| `src/server/container.ts`, `src/server/ports.ts` (may **add** methods), `src/server/http.ts` | Composition root, ports, route helpers |
| `src/server/auth/demo-session.ts`, `local.ts`, `password.ts`, `supabase.ts` | Local + Supabase auth |
| `src/server/providers/tmdb.ts`, `fixtures-detail.ts`, `omdb.ts` | TMDB detail (L1/L2 cache, timeout, breaker), fixtures, OMDb (job-only) |
| `src/server/jobs/enrich.ts`, `src/server/jobs/imdb-refresh.ts` | Nightly enrich mapping + IMDb refresh orchestration (reference implementations exist) |
| `src/server/repositories/memory/catalog.ts`, `store.ts`, `user-data.ts`, `src/server/repositories/not-implemented.ts`, `src/server/repositories/supabase/index.ts`, `src/server/supabase/server.ts` | Demo + live repositories |
| `src/server/**` new files | e.g. `rate-limit.ts`, `export/letterboxd.ts`, `repositories/supabase/*.ts`, and all `src/server/**/*.test.ts` |
| `src/app/api/**` (all 21 `route.ts` files) | Every route handler |
| `src/app/auth/callback/route.ts`, `src/proxy.ts` | Auth callback, session refresh |
| `scripts/sync-catalog.ts`, `scripts/demo-reset.ts`, new `scripts/*.ts` (not `build-fixtures.ts`) | Jobs |
| `supabase/migrations/<new timestamp>_*.sql` | **New** migrations only |
| `tests/db/**`, `tests/server/**` | DB tests, job/provider tests (may extend; keep green) |

### 🎨 Frontend Dev
| Path | What |
|---|---|
| `src/app/layout.tsx`, `src/app/page.tsx` (replace the placeholder), `src/app/not-found.tsx`, `src/app/globals.css` | Shell, Home, 404, base styles (import tokens; never redefine them) |
| New: `src/app/error.tsx`, `src/app/loading.tsx`, `src/app/browse/page.tsx`, `src/app/search/page.tsx`, `src/app/title/[type]/[slug]/page.tsx` (+ `generateMetadata` from `worthIt.metaDescription`), `src/app/u/[handle]/page.tsx`, `src/app/me/stubs/page.tsx`, `src/app/me/settings/page.tsx`, `src/app/signin/page.tsx`, `src/app/signup/page.tsx`, `src/app/about/page.tsx`, any `loading.tsx`/`error.tsx`/`opengraph-image.tsx` under them | Pages |
| `src/components/**` | All UI. Suggested: `Header`, `TabBar`, `Footer` (TMDB + "IMDb ratings via OMDb" attribution), `DemoPill`, `AdaptiveBackground`, `Ticket` (grid/rail/row/hero), `Poster` (fallback), `ScoreChip`, `ImdbChip`, `WorthIt` (programme slip), `StubButton`, `StubSheet`, `Toast`, `AuthSheet`, `ReviewComposer`, `ReviewCard`, `StarInput`, `SortSelect`, `TypeFilter`, `EmptyState`, `Skeleton`, `WalletStub`, `DiaryRow` + their `*.module.css` and `*.test.tsx` |
| `src/hooks/**` | `useTitleStates`, `useToast`, `useAuthSheet`, `useMe`, … |
| `public/**` | Logo, TMDB logo, favicon |

### 🧪 QA: `e2e/**`, `docs/06-qa/**` · 🔎 Reviewer: `docs/05-review/**` and any file for fixes (recorded in REVIEW.md)
`e2e/smoke.spec.ts` is a scaffold smoke test; QA may replace it.

## 2. The seams you code against

**Frontend does not wait for Backend.** In demo mode these already work end to end: `dal.listCatalog`,
`listTrending`, `searchCatalog`, `getTitle` (**with IMDb rating and a full `worthIt` block**), `getProfile`,
and `/api/catalog`, `/api/search`, `/api/me`, `/api/health`. Everything else returns contract-shaped empty
data (`[]`, `{}`, zero stats) or `501 not_implemented`, with request validation already live.

```ts
// Page (RSC): read directly
import { dal } from '@/server/dal';
const mode = dal.getMode();
const page = await dal.listCatalog({ type, sort, cursor });
const title = await dal.getTitle('movie', 693134);       // title.worthIt, title.imdbRating

// Any component: display rules (pure, client-safe)
import { titleScores, ticketAccessibleName } from '@/lib/format';
import { ticketTimeLabel } from '@/lib/worth-it';
titleScores(t)        // [{source:'tmdb',label:'TMDB',value:'8.1',…}, {source:'imdb',…}?]  ← IMDb only if known
ticketTimeLabel(t)    // "2024 · 2H 46M" | "2022 · 4 SEASONS · ≈33H" | "2024"

// Client component: mutations + personal reads
import { api, ApiError } from '@/lib/api-client';
const { stub, state } = await api.createStub({ mediaType, tmdbId });   // throws ApiError(code, …)
```

- **Types** `@/lib/types` · **URLs** `@/lib/routes` · **Images** `@/lib/images` · **Sort labels**
  `BROWSE_SORT_OPTIONS` in `@/lib/catalog-order` · **Scores** `@/lib/format` · **Ticket time** `@/lib/worth-it`.
- **IMDb chip (ADR-008):** on every stub next to `TMDB x.x`, and a detail score chip with votes and
  `IMDB_SOURCE_LABEL`. Render from `titleScores()` only — it already hides null. Colours via `--imdb`/`--on-imdb`.
- **"Worth it?" (ADR-009, DESIGN §7.4.1):** render `title.worthIt` as given; hide missing lines; "FROM TMDB"
  label when `hook.source` starts with `tmdb_`; never print a blended number.
- **Optimistic UI:** apply locally, call `api.*`, reconcile with the returned `state`, roll back on
  `ApiError` (DESIGN §5.1). Handle `code === 'not_implemented'` with a toast during development.
- **Personal state islands:** one `api.titleStates(keys)` per page for all visible tickets (never N+1).
  It returns `{}` when signed out.
- **Auth UI:** `api.signUp/signIn/signOut/magicLink/handleAvailable`. Map `fields` to inline errors. Show
  `mode.demoAccounts` in the demo banner.
- **Backend must preserve** the shapes in `contracts.ts`/`types.ts` and the semantics in ADR-003 (order,
  cursor, curation), ADR-004 (review rules, export format), ADR-005 (auth errors, cookies), ADR-008 (IMDb
  storage + refresh) and ADR-009 ("Worth it?" rules). `tests/db/**`, `tests/lib/**`, `tests/server/**` stay green.

## 3. Build order

| Step | Frontend | Backend |
|---|---|---|
| 1 | App shell: header (logo, nav, header search, **demo pill**, avatar island via `api.me`), mobile tab bar, footer + TMDB/OMDb attribution, adaptive background, `globals.css` | **Demo memory repositories**: stubs, reviews, watchlist, profiles, title states, **title stats** (drives the Stubbed chip and the "Worth it?" verdict — e.g. Transformers becomes "Split opinions"), rate limits, contract tests per repository |
| 2 | Ticket card (grid/rail/row/hero, CSS-mask notches, fallback poster on `onError`/`images:'off'`, **TMDB score + IMDb chip**, **`ticketTimeLabel` meta line**, accessible name), Home + Browse (type filter, sort select, cursor "Load more"), skeletons, empty/error states | **Local auth** (sign-up/in/out, magic-link `devLink`, cookie) + all `/api/auth/*`. Implement `/api/stubs*`, `/api/reviews*`, `/api/watchlist*`, `/api/me/*` |
| 3 | Title detail (SSR tint, facts, cast, trailer link, **score chips incl. IMDb with votes**, **"Worth it?" slip**, stub CTA + tear + toast/undo + details sheet), `generateMetadata` from `worthIt.metaDescription`, reviews list + composer + spoiler blur | Export (Letterboxd CSV + JSON). `dal` profile stats / wallet / diary / profile reviews. "If you liked…" island support (`likeCandidates` + `titleStates`). Revalidation after writes |
| 4 | Auth sheet + `/signin` `/signup` (resume pending action), profile `/u/{handle}` (wallet, diary, reviews, watchlist tabs), `/me/stubs`, `/me/settings` (export links), `/about`, 404 | **Live adapters:** Supabase repositories (RPC `catalog_page`/`catalog_search`/`catalog_count`, `getEntry` selecting the enrichment columns, RLS client), Supabase auth + `proxy.ts` + `/auth/callback`, TMDB detail provider (L1/L2 cache, timeout, circuit breaker) |
| 5 | a11y pass (keyboard, focus, labels, reduced motion), responsive at 375/1440, component tests | `scripts/sync-catalog.ts`: discover path (shards, throttling, guardrails, staging apply), palettes with sharp, disagreement report, purge + revalidate, `sync_runs` bookkeeping. The **enrich** and **IMDb** steps and `--from-fixtures` are already wired — verify against a real project when keys exist |
| Both | `npm run lint && npm run typecheck && npm test && npm run build` green before hand-off | same |

Integration point: after step 2 on both sides the demo app is fully interactive, and QA's flows
(browse → sign up → stub → rewatch → review → profile) can run.

## 4. Conventions
- CSS Modules per component + tokens from `tokens.css`. No inline hex colours except palette-driven CSS variables.
- Server Components by default; `'use client'` only for interactive leaves.
- Components get data via props from pages. Only pages import `@/server/dal` (ESLint enforces it for
  `src/components` and `src/hooks`).
- `data-testid`s from API_CONTRACT §8 (incl. `imdb-rating`, `ticket-time`, `worth-it-*`). There is no `imdb-assist`.
- All user-visible copy follows DESIGN §10.

## 5. M1 task list (launch hardening, v1.2 · ADR-001 §A, ADR-010, ADR-011)

**Frozen-file waiver for M1 (single writer = backend-dev):** the architect is docs-only in this run, so backend-dev makes
exactly these additive edits to frozen files, and nobody else touches them: `src/lib/types.ts` (`TitleDetail.degraded`),
`src/lib/contracts.ts` (`HealthResponse` v1.4, `AuthResponse.confirmEmail`, `setPasswordSchema`), `src/lib/errors.ts`
(`reauth_required` + copy), `src/lib/api-client.ts` (`api.setPassword`), `src/server/env.ts` (`TRUSTED_PROXY`,
`HEALTH_MAX_SYNC_AGE_HOURS`, `SYNC_RECHECK_MAX`), `.github/workflows/nightly-sync.yml`, new `.github/workflows/backup.yml`,
`.env.example`, and the README sections "First sync", "Backups and restore", "Environment". Shapes must match API_CONTRACT v1.4
exactly. **Order:** backend-dev lands M1-00 first (types/contracts/errors/api-client only, gate green), then frontend-dev starts.

| id | Task (spec) | Owner | Exact files |
|---|---|---|---|
| M1-00 | Shared-type edits above, no behaviour (contract v1.4) | backend-dev | `src/lib/types.ts`, `src/lib/contracts.ts`, `src/lib/errors.ts`, `src/lib/api-client.ts` |
| M1-01 | Dry run: 0 OMDb, 0 TMDB detail, 0 image fetches, 0 DB writes (ADR-011 §1) | backend-dev | `scripts/sync-catalog.ts`, `src/server/jobs/imdb-refresh.ts`, `src/server/jobs/discover.ts` (`recheckMissing` `dryRun`), new `tests/server/sync-dry-run.test.ts`, README "First sync" |
| M1-02 | Guard abort blocks discover/apply only; orchestration moved to a testable runner (ADR-011 §2) | backend-dev | new `src/server/jobs/sync-runner.ts`, `scripts/sync-catalog.ts`, new `tests/server/sync-runner.test.ts` |
| M1-03 | Honest `/api/health` + `HEAD`, `?strict=1`, uncached probe, 3 s timeout, 60/min per IP (ADR-011 §3) | backend-dev | `src/app/api/health/route.ts`, `src/server/ports.ts` (`CatalogRepository.probe`), `src/server/repositories/supabase/index.ts`, `src/server/repositories/memory/catalog.ts`, `src/server/env.ts`, new `tests/server/health.test.ts` |
| M1-04 | F1 migration: full-sync-only `last_catalog_sync()`, `health_probe()` (ADR-011 §9) | backend-dev | new `supabase/migrations/20260927000000_ops_health.sql`, `tests/db/migrations.test.ts` |
| M1-05 | DAL degrade: last-good LRU → TMDB-derived entry → 503; stats/recommended fallbacks; `degraded` field (ADR-011 §4) | backend-dev | `src/server/dal.ts`, new `src/server/degraded.ts`, new `tests/server/dal-degraded.test.ts` |
| M1-06 | `DegradedBanner` + disabled Stub/Review/Watchlist CTAs when `degraded === 'catalog'` | frontend-dev | new `src/components/DegradedBanner.tsx` + `.module.css` + `.test.tsx`, `src/app/title/[type]/[slug]/page.tsx`, the CTA components under `src/components/**` |
| M1-07 | Keep-alive step before the secrets guard, anon key only (ADR-011 §5) | backend-dev | `.github/workflows/nightly-sync.yml` |
| M1-08 | Encrypted nightly `pg_dump` artifact, 14 days; README restore runbook (ADR-011 §7) | backend-dev | new `.github/workflows/backup.yml`, README "Backups and restore" |
| M1-09 | F2: `SYNC_RECHECK_MAX`, `skipped > 0` aborts apply, errored re-checks carried forward (ADR-011 §10) | backend-dev | `src/server/jobs/discover.ts`, `scripts/sync-catalog.ts`, `src/server/env.ts`, `src/server/jobs/discover.test.ts` (or `tests/server/`) |
| M1-10 | `TRUSTED_PROXY` for client IP and forwarded host/proto; boot fails in live production when unset and not auto-detected (ADR-001 §A3) | backend-dev | `src/server/env.ts`, `src/server/rate-limit.ts`, `src/server/rate-limit.test.ts`, `src/server/http.ts`, `src/app/api/auth/**/route.ts`, `.env.example` |
| M1-11 | ID-1 confirm-email-safe sign-up (`202 { session: null, confirmEmail: true }`) | backend-dev (adapter + route) · frontend-dev (message) | `src/server/auth/supabase.ts`, `src/app/api/auth/signup/route.ts` · `src/components/AuthForm.tsx` |
| M1-12 | ID-2 "Set a new password": `PUT /api/auth/password`, `reauth_required` after 10 min | backend-dev (route + port) · frontend-dev (form) | `src/server/ports.ts` (`AuthProvider.updatePassword`), `src/server/auth/supabase.ts`, `src/server/auth/local.ts`, new `src/app/api/auth/password/route.ts` · new `src/components/SetPasswordForm.tsx` (+ css, test), `src/app/me/settings/page.tsx` |
| M1-13 | ID-5 magic-link limit per hashed email (5/h) in addition to per IP | backend-dev | `src/app/api/auth/magic-link/route.ts`, `src/server/rate-limit.ts` |
| M1-14 | ID-6 privacy copy: what is stored where, immediate deletion, backups ≤ 14 days | frontend-dev | `src/app/about/page.tsx` |
| M1-15 | L-1 official TMDB logo (after the founder supplies it) | frontend-dev | `public/tmdb-logo.svg` |
| M1-16 | E2E: health (demo 200, `no-store`, `HEAD`), set-password flow, sign-up unchanged in demo; flake L-15 (retry on `ECONNRESET`) | qa-engineer | new `e2e/ops.spec.ts`, `e2e/support/fixtures.ts` |
| M1-17 | Staging smoke L-2 + restore rehearsal + spoofed-XFF check per `TRUSTED_PROXY` + "do many clients share GoTrue's per-IP limit?" check | qa-engineer (+ founder keys) | new `docs/06-qa/STAGING_SMOKE.md`, screenshots under `docs/06-qa/screenshots/` |

Founder (no code): custom SMTP in Supabase (Resend), two free uptime monitors (`/api/health` and `/api/health?strict=1`),
secrets `SUPABASE_DB_URL` + `BACKUP_PASSPHRASE`, keep the repo private (recommended), `TRUSTED_PROXY` only if leaving Vercel.

Gate for every task: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
(+ `npm run test:e2e` for M1-06, M1-11, M1-12, M1-16).

## 6. Where to watch task list (M2 · ADR-012 · API_CONTRACT v1.5 · PRD §13 W1–W8 · DESIGN §7.4.2)

**Start condition:** M1 merged and green (M1 is editing `types.ts`, `contracts.ts`, `errors.ts`, `api-client.ts`, `dal.ts`, `ports.ts`,
`env.ts`, `scripts/sync-catalog.ts`, `sync-runner.ts`, `tests/db/migrations.test.ts`, the auth routes and `/me/settings`). No W task
touches those files earlier. **Single writer for shared files = backend-dev in W-00**, same waiver as §5; after W-00 the frontend
never edits `src/lib/{types,contracts,api-client,provider-links,regions,images}.ts`, and the backend never edits `src/components/**` or
`src/app/**/page.tsx`. Changes to `provider-links.ts` entries after W-00 need an ADR-012 table update (Architect) first.

| id | Task (spec) | Owner | Exact files | After |
|---|---|---|---|---|
| W-00 | Shared types/contracts, no behaviour: `TitleWatch` + friends, `TitleDetail.watch` (always `null` for now), `SessionUser.watchRegion`, `AppMode.watchRegions`, `watchQuerySchema`, `setWatchRegionSchema`, `TitleWatchResponse`, `SetWatchRegionResponse`, `api.titleWatch`, `api.setWatchRegion`; `provider-links.ts` (§6.3 table, `providerHref`, `tmdbWatchHref`, host set); `regions.ts`; `providerLogoUrl()`; `trackEvent()` no-op + `ProviderClickedEvent` type | backend-dev | `src/lib/types.ts`, `src/lib/contracts.ts`, `src/lib/api-client.ts`, `src/lib/images.ts`, `src/lib/data-access.ts` (`getWatchRegion`, `getTitle` opts), new `src/lib/provider-links.ts`, new `src/lib/regions.ts`, new `src/lib/analytics.ts`, new `src/lib/provider-links.test.ts` (W8-AC2 guard, ADR-012 §10.1) | M1 |
| W-01 | Migration: `catalog_index.watch/watch_checked_at/watch_tags`, `watch_provider`, `user_settings` (owner-only RLS), RPCs `catalog_set_watch`, `catalog_watch_due`, `watch_provider_set_priorities`, grants (ADR-012 §3) | backend-dev | new `supabase/migrations/20260928120000_where_to_watch.sql`, `tests/db/migrations.test.ts` | W-00 |
| W-02 | Mapper `mapTmdbWatch` + append `watch/providers` to the enrich call; recorded TMDB fixture pinning the `"watch/providers"` key and shape; `link` equals `tmdbWatchHref` check (ADR-012 §1–2) | backend-dev | new `src/server/jobs/watch-map.ts`, `src/server/jobs/enrich.ts`, new `tests/server/watch-map.test.ts`, new `tests/server/fixtures/tmdb-watch-providers.json` | W-00 |
| W-03 | Job steps `watch` (due list, per-title fetch, budget, throttle) and weekly provider-list sync; dry-run = 0 calls; `sync_runs.stats.watch`; env `SYNC_WATCH_MAX/TTL_DAYS/HOT_DAYS`; revalidate tag `watch-providers` (ADR-012 §4) | backend-dev | new `src/server/jobs/watch-refresh.ts`, `src/server/jobs/sync-runner.ts`, `scripts/sync-catalog.ts`, `src/server/env.ts`, new `tests/server/watch-refresh.test.ts`, `tests/server/sync-dry-run.test.ts` | W-01, W-02 |
| W-04 | Region resolution (query → cookie → trusted geo header → `Accept-Language` → default; `UK→GB`; fallback flag); env `WATCH_REGION_DEFAULT`, `WATCH_REGIONS`, `WATCH_GEO_HEADER` with boot validation (ADR-012 §5) | backend-dev | new `src/server/region.ts`, new `src/server/region.test.ts`, `src/server/env.ts`, `.env.example` | W-00 |
| W-05 | Read path: `buildTitleWatch` (stale 30 d, none, group order, rent+buy merge, hrefs), repositories return `watch`/`watch_checked_at`, provider map cache, `dal.getWatchRegion`, `dal.getTitle(…, {region})`, `watch: null` when degraded (ADR-012 §6) | backend-dev | new `src/server/watch.ts`, new `tests/server/watch.test.ts`, `src/server/ports.ts`, `src/server/dal.ts`, `src/server/repositories/supabase/index.ts`, `src/server/repositories/memory/catalog.ts` | W-01, W-04 |
| W-06 | Demo fixtures: 20 titles × US/GB/IN with `scenario` tags and `ageDays`; `--from-fixtures` loads them (ADR-012 §8, W6) | backend-dev | new `src/fixtures/watch.json`, `src/fixtures/schema.ts`, `src/server/repositories/memory/catalog.ts`, `scripts/sync-catalog.ts` | W-05 |
| W-07 | Routes: `GET /api/titles/{type}/{tmdbId}/watch`, `PUT /api/me/watch-region` (cookie + `user_settings`), `watchRegion` in `/api/me`, cookie re-set on sign-in/callback; `user_settings` in export and delete (API_CONTRACT §5.21–5.22) | backend-dev | new `src/app/api/titles/[type]/[tmdbId]/watch/route.ts`, new `src/app/api/me/watch-region/route.ts`, `src/app/api/me/route.ts`, `src/app/api/auth/signin/route.ts`, `src/app/auth/callback/route.ts`, `src/server/repositories/supabase/index.ts`, `src/server/repositories/memory/user-data.ts`, `src/app/api/me/export/route.ts` (JSON export gains `settings`), new `tests/server/watch-routes.test.ts` | W-05 |
| W-10 | `WhereToWatch` block: groups, 6-cap + "+N", tiles, monogram fallback, ↗ badge, attribution, "Checked" line, All options, empty/error/skeleton states, rail at 375 / wrap ≥ 640, a11y names (W1, W2, W4, W5) — build against a local mock `TitleWatch` until W-05 lands | frontend-dev | new `src/components/WhereToWatch.tsx`, `.module.css`, `.test.tsx`, new `src/components/ProviderTile.tsx` | W-00 |
| W-11 | Region switcher (`<select>` of `mode.watchRegions`, "Showing: … · Change"), in-place refetch via `api.titleWatch`, persist via `api.setWatchRegion`, cookie-heal island; `trackEvent('provider_clicked')` on click without delaying navigation | frontend-dev | new `src/components/WatchRegionSelect.tsx` (+ css, test), `src/components/WhereToWatch.tsx` | W-10 |
| W-12 | Place block on the title page (under stub row, above Worth it?; hidden when `watch === null`, no CLS); region in Settings; JustWatch on About | frontend-dev | `src/app/title/[type]/[slug]/page.tsx`, `src/app/title/[type]/[slug]/title.module.css`, `src/app/me/settings/page.tsx`, `src/app/about/page.tsx` | W-05, W-07, W-10 |
| W-20 | E2E demo: US/GB/IN via `Accept-Language` (`en-GB`, `hi-IN`, bare `en`), switcher persists across reload (signed out and in), spoofed geo header ignored, unsupported-region fallback, `none_us` empty state, `stale` hidden, `many` "+N", `href`/`rel`/`target` asserts, no request to `image.tmdb.org`, axe on the block (W1–W6) | qa-engineer | new `e2e/where-to-watch.spec.ts`, `e2e/support/fixtures.ts` | W-12 |
| W-21 | Manual device matrix for the top 15 templates (desktop Chrome, iOS, Android): app / site / search / login; failing templates reported to Architect to drop to `home` (W2-AC5); link check each release | qa-engineer (+ founder devices) | new `docs/06-qa/WATCH_LINKS.md` | W-12, real keys |
| W-30 | P1 filter + stub hint: `..._watch_filter.sql` (recreate `catalog_page`/`catalog_count` with `p_watch_tag`), `region`/`provider` on catalogue, `GET /api/watch/providers`, `watchHint` (ADR-012 §9) | backend-dev | new `supabase/migrations/<ts>_watch_filter.sql`, `src/lib/contracts.ts`, `src/lib/types.ts`, new `src/app/api/watch/providers/route.ts`, `src/app/api/catalog/route.ts`, repositories, `tests/db/migrations.test.ts` | W-20 green |
| W-31 | P1 UI: provider chips in browse (`?provider=`), stub logo `ticket-providers` (decorative, not a link) (W7) | frontend-dev | new `src/components/ProviderFilter.tsx` (+ css, test), ticket card component + `TicketGrid.tsx`, browse page | W-30 |
| W-32 | P1 E2E: chips filter with ≥ 6.5 rule, combine with sort/type, no zero-count chip, stub logo name | qa-engineer | `e2e/where-to-watch.spec.ts` | W-31 |

Parallelism: W-01, W-02, W-04 and W-10 run in parallel after W-00; W-03 ∥ W-05; W-06 ∥ W-07 ∥ W-11. Reviews: code-reviewer +
arch-reviewer after W-07 and W-12 (ADR-012 §10 checklist), then QA W-20.

Gate for every task: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
(+ `npm run test:e2e` for W-12, W-20, W-31, W-32).

## 7. Close-out task list (ADR-013 · API_CONTRACT v1.6 · CLOSEOUT_BOARD C-01…C-15)

**Start condition:** the tree is green at `b4287cd`. **Single writer for the shared layer = backend-dev in C-00**, with the same waiver as §5/§6. After C-00:
- frontend-dev never edits `src/lib/**`, `src/server/**` or `src/app/api/**`;
- backend-dev never edits `src/components/**`, `src/hooks/**`, `src/og/*.tsx` or any `page.tsx`/`layout.tsx`/`loading.tsx`/`error.tsx`/`opengraph-image.tsx` (exception: `story/route.tsx` is FE, see C-08b);
- qa-engineer owns `e2e/**` and `docs/06-qa/**` only.
Close-out waivers of §1 frozen files: `next.config.ts`, `tests/lib/**` → backend-dev (C-00 only); `src/styles/tokens.css` → frontend-dev (append `--avatar-*` only, C-12b);
`.env.example`, `package.json`, `.github/workflows/**` → **devops-release** (C-14). BE and FE send env lines in hand-off notes (ADR-013 §16). No new dependencies and no new npm scripts.

| id | Task (spec) | Owner | Exact files | After |
|---|---|---|---|---|
| **C-00** | Shared types/contracts, no behaviour: `WatchHint`, `TitleSummary.watchHint?`, `Stub.season`, `AvatarColor`/`PublicProfile.avatarColor`, `WatchProviderChip`, `StubShareCard`, `ImportRow`/`ImportSource` + preview/commit schemas and responses, `trackEventsSchema`, `clientLogSchema`, `signUpSchema.ref`, `createStub/updateStub.season`, `updateProfile.avatarColor`, `CatalogQuery.region/provider`; `payload_too_large` (413) + `ERROR_COPY` using `BRAND_NAME`; `api.importPreview/importCommit/watchProviders`, region args on `api.catalog/search/watchlist`; DAL `resolveTitle`, `listWatchProviders`, `getStubShare`, `{region}` opts; `brand.ts`, `share.ts` (`shareData`), `avatar.ts`, `report-error.ts`, `analytics.ts` (allowlist + beacon queue + GPC/DNT); `format.ts` (`seasonLabel`, hint in `ticketAccessibleName`); `routes.ts` (`browseHref` provider, `shareStubHref`, `storyHref`, `importHref`); guard tests (vendor ban, no fetch in `src/lib/import`); `next.config.ts` `outputFileTracingIncludes`; copy `src/og/fonts/Geist-Regular.ttf` + `LICENSE-Geist-og.txt` from `node_modules/next/dist/compiled/@vercel/og/` | backend-dev | `src/lib/{types,contracts,errors,api-client,data-access,format,routes,analytics}.ts`, new `src/lib/{brand,share,avatar,report-error}.ts` (+ `*.test.ts`), `tests/lib/guards.test.ts`, `tests/lib/format.test.ts`, `next.config.ts`, new `src/og/fonts/*` | — |
| C-01a | `watchHintFor`; `region` on catalog/search/watchlist/trending repos + routes; echo `region` | backend-dev | `src/server/watch.ts`, `tests/server/watch.test.ts`, `src/server/dal.ts`, `src/server/ports.ts`, `src/server/repositories/{supabase/index,memory/catalog,memory/user-data}.ts`, `src/app/api/{catalog,search,me/watchlist}/route.ts`, `tests/server/routes.test.ts` | C-00 |
| C-02a | Migration `20261003090000_watch_filter.sql` (recreated `catalog_page`/`catalog_count` + `p_watch_tag`, `watch_provider_counts`); `provider` filter; `GET /api/watch/providers`; `dal.listWatchProviders` | backend-dev | new migration, `tests/db/watch.test.ts`, new `src/app/api/watch/providers/route.ts`, repositories (as C-01a), `src/server/dal.ts` | C-01a |
| C-03a | `dal.resolveTitle` (index-only, `cache()`-shared with `getTitle`) | backend-dev | `src/server/dal.ts`, `tests/server/dal.test.ts` | C-00 |
| C-05 | `getClaims()` in `getSession` + proxy | backend-dev | `src/server/auth/supabase.ts`, `src/server/auth/supabase.test.ts`, `src/proxy.ts`, `tests/server/proxy.test.ts` | C-00 |
| C-06 | Migration `20261003092000_enrich_core_refresh.sql`; enrich core mapping; `catalog_mark_gone`; stats counter | backend-dev | new migration, `src/server/jobs/enrich.ts`, `src/server/jobs/sync-runner.ts`, `scripts/sync-catalog.ts`, `tests/server/jobs.test.ts`, `tests/server/sync-dry-run.test.ts`, `tests/db/migrations.test.ts` | C-00 |
| C-10a | Migration `20261003091000_stub_season.sql`; `season` in stub create/update/repos/export; 400 rules | backend-dev | new migration, `src/server/services/stubs.ts`, `src/server/services/export.ts`, repositories, `src/app/api/stubs/route.ts`, `src/app/api/stubs/[id]/route.ts`, `tests/db/user-data.test.ts`, `tests/server/routes.test.ts` | C-00 |
| C-12a | Migration `20261003093000_profile_avatar_color.sql`; profile route + repos; `review_details.author.avatarColor` | backend-dev | new migration, `src/app/api/me/profile/route.ts`, repositories, `tests/db/user-data.test.ts` | C-10a (shared repo files) |
| C-09a | Migration `20261003094000_events.sql`; `src/server/events.ts` (`recordEvent` via `after()`, service-role client, memory counter); `POST /api/events`; server emits in signup/stubs/reviews/watchlist/export; `events_purge` in nightly job; `scripts/metrics.ts` | backend-dev | new migration, new `src/server/events.ts` (+test), new `src/app/api/events/route.ts`, `src/app/api/{auth/signup,stubs,reviews,watchlist/[type]/[tmdbId],me/export}/route.ts`, `src/server/repositories/memory/store.ts`, `src/server/container.ts`, `src/server/jobs/sync-runner.ts`, new `scripts/metrics.ts`, `tests/db/migrations.test.ts` | C-12a |
| C-13a | `src/server/log.ts` (+ `redact`), use in `http.ts`/`dal.ts`; `src/instrumentation.ts` `onRequestError`; `POST /api/log` | backend-dev | new `src/server/log.ts` (+test), `src/server/http.ts`, `src/server/dal.ts`, new `src/instrumentation.ts`, new `src/app/api/log/route.ts`, `tests/server/routes.test.ts` | C-09a |
| C-11a | Parsers `src/lib/import/{csv,zip,letterboxd,imdb,tvtime,index}.ts`; matcher + commit service; migration `20261003095000_imports.sql`; preview/commit routes; `import_completed` | backend-dev | new `src/lib/import/*` (+tests), new `tests/fixtures/imports/*`, new `src/server/imports/{match,commit}.ts` (+tests), new migration, new `src/app/api/me/imports/route.ts`, new `src/app/api/me/imports/preview/route.ts`, repositories, `tests/db/user-data.test.ts` | C-10a, C-09a |
| C-08a | `dal.getStubShare`, `src/server/share.ts` (`isProfileShareable`), `src/server/og-assets.ts` (`loadOgFonts`, `loadPosterDataUrl`: 1.5 s, 1.5 MB, no fetch in demo) | backend-dev | `src/server/dal.ts`, new `src/server/share.ts`, new `src/server/og-assets.ts` (+tests), repositories | C-10a, C-12a |
| C-15a | Brand in server-side copy (`ERROR_COPY` done in C-00; export/email copy); then add the `Stubbed`-literal guard to `tests/lib/guards.test.ts` (it must pass on landing) | backend-dev | `src/server/services/export.ts`, `src/server/auth/*` copy only, `tests/lib/guards.test.ts` | C-15b |
| C-01b | Ticket stub logo `ticket-providers` (decorative); pass `region` on Load more | frontend-dev | `src/components/Ticket.tsx` (+css, test), `src/components/TicketGrid.tsx`, `src/components/LoadMore.tsx`, `src/components/BrowseSection.tsx` | C-00 (mock), C-01a (live) |
| C-02b | `ProviderFilter` chips on browse | frontend-dev | new `src/components/ProviderFilter.tsx` (+css, test), `src/components/BrowseToolbar.tsx`, `src/app/browse/page.tsx` | C-01b |
| C-03b | Delete `src/app/loading.tsx`, `src/app/title/[type]/[slug]/loading.tsx`, `src/app/u/[handle]/loading.tsx`; add `browse/`, `search/`, `me/stubs/` `loading.tsx`; existence/slug check before `<Suspense>` in title and profile pages; `TitleSkeleton`/`ProfileSkeleton` | frontend-dev | those files, `src/app/title/[type]/[slug]/page.tsx`, `src/app/u/[handle]/page.tsx`, new `src/components/TitleSkeleton.tsx`, new `src/components/ProfileSkeleton.tsx` | C-03a |
| C-04 | R10 count +1 on a first review | frontend-dev | `src/components/Reviews.tsx` (+test) | C-00 |
| C-07 | `ShareButton` (native → copy → fallback sheet) on title, wallet, own review, stub menus; `ref=share` capture; signup sends `ref` | frontend-dev | new `src/components/ShareButton.tsx` (+css, test), `src/components/{TitleActions,ReviewCard,WalletStub,DiaryRowMenu,AppProvider,AuthForm}.tsx`, `src/app/u/[handle]/page.tsx` | C-03b (same page files) |
| C-08b | OG/story JSX from the UX arena winner; routes; share landing; "Story image" action | frontend-dev (+ ux-designer) | new `src/og/{TitleCard,StoryCard,StubCard}.tsx`, new `src/app/title/[type]/[slug]/opengraph-image.tsx`, new `src/app/share/stub/[id]/{page.tsx,opengraph-image.tsx}`, new `src/app/share/stub/[id]/story/route.tsx`, `src/components/{WalletStub,DiaryRowMenu}.tsx`; remove `openGraph.images` from the title `generateMetadata` | C-08a, C-07 |
| C-09b | `worth_it_viewed` observer; About "What we count" | frontend-dev | `src/components/WorthIt.tsx` (+test), `src/app/about/page.tsx` | C-00 |
| C-10b | Season `<select>` in `StubSheet`; `S03` on diary, wallet, ticket | frontend-dev | `src/components/{StubSheet,Diary,WalletStub}.tsx` (+tests) | C-00 |
| C-11b | `/me/import` page: source → file → parse → preview → toggles → chunked commit → summary; links from Settings and empty diary | frontend-dev | new `src/app/me/import/page.tsx` (+css), new `src/components/ImportFlow.tsx` (+css, test), `src/app/me/settings/page.tsx`, `src/components/Diary.tsx` | C-11a (parsers), C-10b (Diary) |
| C-12b | `AvatarColorPicker` in Settings; `Avatar` gradient; `--avatar-*` tokens | frontend-dev | new `src/components/AvatarColorPicker.tsx` (+css, test), `src/components/Avatar.tsx` (+css), `src/styles/tokens.css` (append only), `src/app/me/settings/page.tsx` | C-11b (settings page) |
| C-13b | `global-error.tsx`; `reportError` in `error.tsx`; window listeners | frontend-dev | `src/app/error.tsx`, new `src/app/global-error.tsx`, `src/components/AppProvider.tsx` | C-07 (AppProvider) |
| C-15b | Replace user-visible `Stubbed` literals with `BRAND_NAME` (`grep -rn "Stubbed" src/app src/components` is clean except comments; C-15a then locks it with a guard) | frontend-dev | `src/app/layout.tsx`, `src/components/{Header,Footer,SearchPanel,Reviews,EmptyState,AuthPage,AuthForm}.tsx`, `src/app/about/page.tsx`, any other file the guard lists | **last FE task** (touches files of earlier tasks) |
| C-Q1 | E2E: `ticket-providers` W7-AC1; chips W-32 | qa-engineer | `e2e/where-to-watch.spec.ts`, `e2e/support/fixtures.ts` | C-01b, C-02b |
| C-Q2 | E2E: 404/308 by status (`maxRedirects: 0`); replace the soft-404 asserts | qa-engineer | new `e2e/seo-status.spec.ts`, `e2e/title.spec.ts`, `e2e/clearpath.spec.ts` | C-03b |
| C-Q3 | E2E: R10; season; avatar | qa-engineer | `e2e/reviews.spec.ts`, new `e2e/season.spec.ts`, `e2e/profile.spec.ts` | C-04, C-10b, C-12b |
| C-Q4 | E2E: share (native stubbed, clipboard, fallback, `og:image`, story 1080×1920 PNG, 404 for a deleted stub, no note/review text in the landing HTML) | qa-engineer | new `e2e/share.spec.ts` | C-08b |
| C-Q5 | E2E: analytics + errors (intercept `/api/events` and `/api/log`; GPC header → nothing; no non-origin request on any page) | qa-engineer | new `e2e/analytics.spec.ts` | C-09b, C-13b |
| C-Q6 | E2E: imports (Letterboxd CSV, our export round-trip, IMDb CSV, oversize file message, re-upload → all duplicate) | qa-engineer | new `e2e/imports.spec.ts`, new `e2e/fixtures/imports/*` | C-11b |
| C-Q7 | Full suite + brand build check (`NEXT_PUBLIC_BRAND_NAME=Reel` header text) | qa-engineer | `docs/06-qa/CLOSEOUT_QA.md` | C-15b, all |

**Order and parallelism.** C-00 lands first; review it, then both lanes start.
BE lane (serial where files are shared): C-01a → C-02a; C-03a ∥ C-05 ∥ C-06; C-10a → C-12a → C-09a → C-13a; C-11a and C-08a after C-10a + C-09a; C-15a last (after FE C-15b).
FE lane: C-04 ∥ C-09b ∥ C-10b first (mock data from C-00 types); then C-01b → C-02b; C-03b → C-07 → C-13b; C-08b after C-08a; C-11b → C-12b; C-15b last.
QA follows each FE pair. Reviews: security-reviewer on C-09/C-11/C-13 + share routes; code-reviewer + arch-reviewer after both lanes finish (C-17).
**Shared-file rule inside a lane:** the "After" column serialises every task that touches the same file, so no two agents ever hold one file at once.

Gate for every task: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
(+ `npm run test:e2e` for any task that touches pages, components or routes; then `git checkout -- docs/06-qa/screenshots`).
