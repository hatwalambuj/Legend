# Work split: Frontend ∥ Backend

Owner: Architect · Date: 2026-09-26 (v1.1: ADR-008 IMDb everywhere + no posting, ADR-009 "Worth it?", no AI)
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
