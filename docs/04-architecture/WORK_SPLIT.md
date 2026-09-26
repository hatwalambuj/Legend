# Work split: Frontend ∥ Backend

Owner: Architect · Date: 2026-09-26 · Applies to: Frontend Dev, Backend Dev, Reviewer, QA

The goal is two agents working at the same time with **zero file conflicts**. Every path in the repo has exactly one owner. Only edit what you own. If you need a change in a frozen file, write it up under "Contract change requests" at the bottom of your phase notes. Do not edit the file. The Reviewer or orchestrator decides.

## 1. Ownership map

### 🔒 Architect: shared and FROZEN (read-only for FE and BE)
| Path | What |
|---|---|
| `src/lib/types.ts` | Domain types |
| `src/lib/contracts.ts` | zod request schemas + response types |
| `src/lib/errors.ts` | Error model, `ERROR_COPY` |
| `src/lib/data-access.ts` | `DataAccess` interface (what pages call) |
| `src/lib/api-client.ts` | Typed browser client (`api.*`) |
| `src/lib/catalog-order.ts`, `curation.ts`, `text.ts`, `keys.ts`, `routes.ts`, `images.ts`, `palette.ts` | Shared pure logic (order/cursor, curation rule, normalisation, URLs, image URLs + fallback, colour maths) |
| `src/server/env.ts` | Env parsing + mode resolution |
| `src/styles/tokens.css`, `src/app/fonts.ts`, `src/app/fonts/*` | Design tokens, self-hosted fonts |
| `src/fixtures/*.json`, `src/fixtures/schema.ts`, `scripts/fixtures/*`, `scripts/build-fixtures.ts` | Demo seed (regenerate only with `npm run fixtures:build`) |
| `supabase/migrations/20260926000000_init.sql` | Initial schema (applied migrations are immutable) |
| `docs/04-architecture/**`, `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts`, `.github/workflows/**`, `.env.example`, `.prettierrc.json` | Config and contract |

> **Dependencies:** `package.json` is frozen. If you truly need a new dependency, the owning agent may run `npm install <pkg>` **once** and must list it in their hand-off notes. Frontend should not need any: no UI library, no Tailwind (plain CSS Modules + tokens), no state library.

### 🎨 Frontend Dev
| Path | What |
|---|---|
| `src/app/**` **except** `src/app/api/**`, `src/app/auth/callback/**`, `src/app/fonts.ts`, `src/app/fonts/**` | Pages, layouts, `loading.tsx`, `error.tsx`, `not-found.tsx`, `globals.css`, metadata/OG, `opengraph-image` if any |
| `src/components/**` | All UI components + their `*.module.css` + `*.test.tsx` |
| `src/hooks/**` | Client hooks (`useTitleStates`, `useToast`, `useAuthSheet`, …) |
| `public/**` | Static assets (logo, TMDB logo, favicon) |

### 🛠 Backend Dev
| Path | What |
|---|---|
| `src/server/**` **except** `src/server/env.ts` | DAL (`dal.ts`), container, ports (may **add** methods), repositories (memory + supabase), providers (TMDB, OMDb, fixtures), auth (local + supabase), `http.ts`, rate limiting, export, sync adapters, and all `src/server/**/*.test.ts` |
| `src/app/api/**` | Every route handler |
| `src/app/auth/callback/**` | Supabase / magic-link callback |
| `src/proxy.ts` | Session refresh |
| `scripts/sync-catalog.ts`, `scripts/demo-reset.ts`, new `scripts/*.ts` (not `build-fixtures`) | Jobs |
| `supabase/migrations/<new timestamp>_*.sql` | **New** migrations only (keep `tests/db/migrations.test.ts` green) |
| `tests/db/**` | DB tests (may extend) |

### 🧪 QA: `e2e/**`, `docs/06-qa/**`. 🔎 Reviewer: may touch any file for fixes (records them in `docs/05-review/REVIEW.md`).
`tests/lib/**` belongs to the Architect (tests of the frozen shared lib). Agents add their own tests next to their code.

## 2. The seams you code against

**Frontend does not wait for Backend.** Catalogue reads already work end to end in demo mode (`dal.listCatalog/listTrending/searchCatalog/getTitle/getProfile`, `/api/catalog`, `/api/search`, `/api/me`, `/api/health`). Everything else returns contract-shaped empty data (`[]`, `{}`, null stats) or `501 not_implemented`, with request validation already live.

```ts
// In a page (RSC): read directly
import { dal } from '@/server/dal';
const mode = dal.getMode();
const page = await dal.listCatalog({ type, sort, cursor });

// In a client component: mutate / personal reads through the typed client
import { api, ApiError } from '@/lib/api-client';
const { stub, state } = await api.createStub({ mediaType, tmdbId });  // throws ApiError(code, …)
```

- **Types:** `@/lib/types`. **URLs:** `@/lib/routes` (`titleHref`, `browseHref`, `safeNext`). **Images:** `@/lib/images` (`tmdbImage`, `posterSrcSet`, `posterFallbackStyle`, `adaptiveBgVars`, `paletteOrDefault`). **Sort labels:** `BROWSE_SORT_OPTIONS` in `@/lib/catalog-order`.
- **Optimistic UI:** apply the change locally, call `api.*`, reconcile with the returned `state`. Roll back on `ApiError` (DESIGN §5.1). Handle `code === 'not_implemented'` gracefully during development (a toast), because that code disappears once Backend lands.
- **Personal state islands:** one `api.titleStates(keys)` call per page for all visible tickets (never N+1). It returns `{}` when signed out.
- **Auth UI:** `api.signUp/signIn/signOut/magicLink/handleAvailable`. Map `fields` to inline errors. Show `mode.demoAccounts` in the demo banner.
- **Backend must preserve** the shapes in `contracts.ts`, and the semantics in ADR-003 (order, cursor, curation), ADR-004 (review rules, IMDb flag, export format) and ADR-005 (auth errors, cookies). `tests/db/migrations.test.ts` and `tests/lib/*` must stay green.

## 3. Build order

| Step | Frontend | Backend |
|---|---|---|
| 1 | App shell: header (logo, nav, header search, **demo pill**, avatar island via `api.me`), mobile tab bar, footer + TMDB attribution, adaptive background component, `globals.css` | **Demo memory repositories** (stubs, reviews, watchlist, profiles, title states, stats), so every endpoint works in demo mode. Rate limits. Contract tests per repository |
| 2 | Ticket card (grid/rail/row/hero variants, CSS mask notches, fallback poster on `onError`/`images:'off'`), Home + Browse (segmented type filter, sort select, cursor "Load more"), skeletons, empty/error states | **Local auth** (sign-up/in/out, magic-link `devLink`, cookie) + all `/api/auth/*`. Implement `/api/stubs*`, `/api/reviews*`, `/api/watchlist*`, `/api/me/*` |
| 3 | Title detail (SSR tint, facts, cast, trailer link, score chips, stub CTA + tear animation + toast/undo + details sheet), reviews list + composer + IMDb assist + spoiler blur | Export (Letterboxd CSV + JSON). `dal` profile stats / wallet / diary / profile reviews. Revalidation calls after writes where data caching is used |
| 4 | Auth sheet + `/signin` `/signup` (resume pending action), profile `/u/{handle}` (wallet, diary, reviews, watchlist tabs), `/me/stubs`, `/me/settings` (export links), `/about`, 404 | **Live adapters:** Supabase repositories (RPC `catalog_page`/`catalog_search`/`catalog_count`, RLS client), Supabase auth + `proxy.ts` refresh + `/auth/callback`, TMDB detail provider (L1/L2 cache, timeout, circuit breaker), OMDb (flagged) |
| 5 | a11y pass (keyboard, focus, labels, reduced motion), responsive at 375/1440, component tests | `scripts/sync-catalog.ts` live path (shards, throttling, guardrails, staging apply, palettes with sharp, purge, revalidate) and `--from-fixtures` |
| Both | `npm run lint && npm run typecheck && npm test && npm run build` green before hand-off | same |

Integration point: after step 2 on both sides, the demo app is fully interactive, and QA's flows (browse → sign up → stub → rewatch → review → profile) can run.

## 4. Conventions
- CSS Modules per component + tokens from `tokens.css`. No inline hex colours except palette-driven CSS variables.
- Server Components by default. Add `'use client'` only for interactive leaves.
- Components get data via props from pages. Only pages import `@/server/dal`.
- `data-testid`s from API_CONTRACT §8.
- All user-visible copy follows DESIGN §10. Route strings through a tiny `t()` helper when convenient (i18n-ready, PRD §10).
