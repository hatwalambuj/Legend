# ADR-001: Stack and hosting

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect (final call)
Inputs: SYSTEM_DESIGN §6, §11, PRD D13, BRIEF infra direction

## Context
Stubbed is a public, SEO-relevant web app (mobile + desktop) with a small curated catalogue and per-user write data (stubs, reviews, watchlist). It has to run on free tiers for the MVP, be non-commercial (TMDB free tier, OMDb CC BY-NC), and build and test inside a container with no network except the npm registry. Frontend and Backend are built in parallel by two agents, so the boundaries must be crisp.

## Options considered
| | A. Next.js on Vercel Hobby + Supabase Free + GitHub Actions cron | B. Next.js on Cloudflare (OpenNext) + D1 + auth library | C. Next.js on Vercel + Neon + Better Auth |
|---|---|---|---|
| Fit with SSR/SEO | Native | Adapter, and some Node APIs are missing | Native |
| Auth | Built in (email/password, magic link, OAuth, 50k MAU) | Build it ourselves | Library, plus we run email |
| Authorisation | Postgres RLS as defence in depth | App layer only | App layer (RLS needs role plumbing) |
| Search/sort | Postgres (pg_trgm), same SQL as tests | SQLite dialect | Postgres |
| Free-tier risks | Supabase pauses after 7 idle days (the nightly job prevents this). Vercel Hobby is non-commercial | Workers 100k req/day ≈ 7k MAU | Neon CU-hours cap |
| Code we write | Least | Most | Medium |

## Decision
**A — confirmed, with these specifics:**
- **Next.js 16.3 (latest stable), App Router, React 19, TypeScript strict** (`noUncheckedIndexedAccess`). Turbopack build (the Next 16 default). The `proxy.ts` convention replaces `middleware.ts`.
- **Hosting: Vercel Hobby** for the MVP (non-commercial). Function region co-located with the Supabase region.
- **Data + auth: Supabase Free** (Postgres, Auth, RLS). Plain SQL migrations in `supabase/migrations/`. We do **not** use Supabase Storage or Edge Functions, which keeps the exit to Neon or self-hosted Postgres open.
- **Jobs: GitHub Actions cron** (`nightly-sync.yml`, 03:17 UTC). It gives minutes of runtime, can run `sharp`, and its nightly DB write keeps Supabase Free awake.
- **Libraries:** `zod` 4 (all input validation, env parsing), `@supabase/ssr` + `@supabase/supabase-js` (cookie sessions, PostgREST/RPC over HTTP, so there is no connection-pool exhaustion from serverless), `server-only`.
- **Tooling:** ESLint 9 flat config (`eslint-config-next` core-web-vitals + typescript + prettier), Prettier, Vitest 5 (node by default, jsdom per file), `@playwright/test` **pinned to 1.56.1** because the container's pre-installed browser is `chromium-1194` (a newer Playwright would need a browser download, which is not allowed here). TypeScript is pinned to `~5.9` because typescript-eslint does not yet support the TS 7 native compiler.
- **Fonts: self-hosted** (`src/app/fonts/*.woff2`, SIL OFL) via `next/font/local`. `next/font/google` would download at build time and break offline builds. Bricolage ships as latin plus latin-ext families chained in `--font-display` so "Shōgun" renders correctly.
- **Rendering model (MVP):** pages are **dynamically rendered** Server Components that call a typed data-access layer (`@/server/dal`). Caching happens at the data layer: TMDB detail via `fetch` with `next.revalidate` (24 h) and tags, catalogue queries optionally via `unstable_cache` (1 h, tag `catalog`). **Public HTML never depends on the session cookie.** Personal state (stub counts, "Stub again", watchlist, own review) comes from private client islands (`/api/me/*`). That keeps the option of flipping public pages to ISR/CDN caching later without refactoring. `cacheComponents` stays **off** in the MVP to reduce risk for a parallel team. Migrate `unstable_cache` to `'use cache'` in Stage 1.
- **Images:** hot-linked from `image.tmdb.org` at fixed sizes, `images.unoptimized: true` (ADR-007).
- **Mutations:** Route Handlers under `/api/**` with JSON bodies (not Server Actions). One contract serves browser, tests and future mobile clients, and CSRF is handled uniformly (same-origin `Origin` + JSON content type).

- **No AI/LLM anywhere (founder constraint, PRD D15).** No AI SDK, env var, API call or batch step, at runtime or in the nightly job. Every feature (including "Worth it?", ADR-009) is built from stored data, rules and templates. Enforced by an ESLint `no-restricted-imports` rule on AI SDK packages and `tests/lib/guards.test.ts` on `package.json`.
- **Portable server:** nothing requires Vercel-specific APIs. The same build runs as a plain Node server (`next build && next start`, Node ≥ 20.9) on the founder's own machine or any VPS/container; only `DEMO_DATA_DIR` and the cron (GitHub Actions or a system cron running `npm run sync:catalog`) need choosing.

## Consequences
- Zero cost up to about 10k MAU. The first paid step is Supabase Pro ($25/month) for backups and no pausing, then Vercel Pro ($20/month) when we go commercial.
- If the product becomes commercial or bandwidth dominates, we move to Cloudflare Workers Paid + Hyperdrive to the same Postgres. The repository interfaces and plain SQL make that a days-long job.
- Dynamic SSR costs a function invocation per page view. At the MVP peak (0.3 PV/s) that is trivial. The Stage 1 lever is ISR for `/title/*` and `/u/*` plus path-based browse URLs.
- Pinned Playwright/TypeScript versions must be bumped deliberately (CI can `playwright install`; the build container cannot).
- Security headers are set in `next.config.ts`. A nonce-based CSP is a Reviewer/Backend follow-up, because the adaptive background uses inline CSS variables.
