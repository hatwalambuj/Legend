# ADR-001: Stack and hosting

Status: **Accepted**, amended 2026-09-27 (Amendment A below: $0 hard constraint, free alternates, portability; supersedes the "own server" reading of ARCH_REVIEW AR-7) · Date: 2026-09-26 · Decider: Architect (final call)
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
- **Rendering model (MVP):** pages are **dynamically rendered** Server Components that call a typed data-access layer (`@/server/dal`). Caching happens at the data layer: TMDB detail via `fetch` with `next.revalidate` (24 h) and tags, catalogue queries via the Supabase client's `fetch` data cache (1 h, tag `catalog`, `src/server/supabase/server.ts:66-81`). **Public HTML never depends on the session cookie.** Personal state (stub counts, "Stub again", watchlist, own review) comes from private client islands (`/api/me/*`). That keeps the option of flipping public pages to ISR/CDN caching later without refactoring. `cacheComponents` stays **off** in the MVP to reduce risk for a parallel team. Move to `'use cache'` in Stage 1.
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

---

## Amendment A (2026-09-27): $0 is a hard constraint; free alternates; portability

Founder, 2026-09-27 (highest precedence): *"use free DB like Supabase and free server like Vercel; alternates allowed but must
be free of cost."* This supersedes the "own server" reading of ARCH_REVIEW AR-7 and NEXT_PHASE_PLAN L-7/E-H2: there is **no
requirement to run our own machine**. AR-7 is reframed as **free-tier portability** plus a `TRUSTED_PROXY` setting (§A3).

### A1. Decision
- **$0 infrastructure is a hard constraint.** No paid plan, add-on or overage is allowed without a new founder decision. The
  "first paid step" line in Consequences above is now a *future option only*, not a plan.
- **Primary stack (unchanged): Supabase Free** (Postgres, Auth, RLS) **+ Vercel Hobby** (Next.js) **+ GitHub Actions** (nightly
  job, keep-alive, backups; ADR-011).
- **Non-commercial.** Vercel Hobby, TMDB's free key and OMDb's free key are all non-commercial. If Stubbed ever earns money, the
  $0 path is to move hosting to a free tier that allows commercial use (Netlify Free or Cloudflare Workers Free, §A2) *and* to
  re-check the TMDB/OMDb terms; it is not to buy Vercel Pro.
- **Portability rule for all new code:** no Vercel-only or Supabase-only API outside the adapters that already exist
  (`src/server/auth/supabase.ts`, `src/server/repositories/supabase/**`, `src/server/supabase/**`). No Supabase Storage, Edge
  Functions or Realtime. Plain SQL migrations.

### A2. Verified free-alternatives matrix (checked 2026-09-27)

Facts come from vendor docs or recent pricing write-ups (sources at the end). "Effort" is for **our** code as it is today.

**Database + auth**

| Option | Free limits that matter to us | Pauses / deletes | Commercial on free | Fit | Migration effort for our code |
|---|---|---|---|---|---|
| **Supabase Free (primary)** | 500 MB DB, 50k MAU auth, 5 GB egress, 2 projects, no backups | pauses after 7 idle days (API activity counts; ADR-011 keep-alive) | no restriction found | Postgres + PostgREST + GoTrue + RLS: exactly what we built | — |
| **Neon Free + Neon Auth (Managed Better Auth)** | 0.5 GB/project, 100 CU-hours/project/month, scale-to-zero after 5 min; auth free to 60k MAU on Free | compute sleeps, data stays; cold start on first query | no restriction found (Unverified: read ToS before switching) | Same Postgres SQL, functions, `citext`, `pg_trgm` | **M–L, ~5–8 days.** New repositories adapter that calls our SQL functions over a Postgres driver instead of PostgREST (`select * from catalog_page(...)`); new `AuthProvider` for Better Auth (ADR-010 §8, bcrypt hashes import as-is); migration replacing the `auth.users` FK/trigger with the Better Auth user table; RLS becomes defence-in-depth via a JWT-claim helper or is replaced by the DAL's user-id filters (already present) |
| **Self-hosted Supabase on an Oracle Always Free VM** | whatever the VM has (§ hosting) | VM can be reclaimed if idle (below) | see Oracle row | Identical APIs | **S for code (none), L for ops**: Docker compose, TLS, upgrades, backups are ours |
| **Nhost Free** | 1 GB DB, 1 GB storage, 5 GB egress, one active project | pauses after 1 week of inactivity | not checked | Postgres, but GraphQL (Hasura) + Hasura Auth instead of PostgREST/GoTrue | **L**: new repository adapter (GraphQL), new auth adapter, permissions rewritten from RLS to Hasura rules |
| Firebase Spark (Auth only, with Neon) | Auth free to 50k MAU; Firestore 1 GiB, 50k reads/20k writes per day | — | allowed | Auth fine; Firestore does not fit (no SQL, keyset/trigram search, 50k reads/day ≈ 2.5k browse pages/day) | Auth adapter **M**; Firestore **rejected** |
| Appwrite Cloud Free | 75k MAU, 2 GB storage, 1 database | **pauses after 7 days without *development* activity; end-user traffic does not count; paused projects deleted after 90 days** | — | Document DB | **Rejected**: a live site cannot be kept awake, and a data-layer rewrite |
| Turso Free / Cloudflare D1 | Turso: 5 GB, 500M row reads/month | — | — | SQLite dialect: no plpgsql, `citext`, `pg_trgm`, RLS | **Rejected** (XL): every migration and RPC rewritten |

**Hosting (Next.js 16 server)**

| Option | Free limits that matter to us | Sleep / reclaim | Commercial on free | Migration effort for our code |
|---|---|---|---|---|
| **Vercel Hobby (primary)** | 1M function invocations, 4 active-CPU hours, 100 GB fast data transfer, 1M edge requests per month | none | **no** (personal, non-commercial) | — |
| **Netlify Free** | 300 credits/month, hard cap (site stops when used up, no overage) | none, but hard stop at the cap | yes | **S, ~1 day**: Netlify's Next.js runtime, `netlify.toml`, env vars, `TRUSTED_PROXY=netlify`. Measure credits per 1k page views on staging before relying on it |
| **Cloudflare Workers Free via OpenNext** (`@opennextjs/cloudflare`) | 100k requests/day, **10 ms CPU per request** (network wait not counted), 128 MB memory, bundle up to 64 MiB uncompressed since 2026-09-04 | none | yes | **M, ~3–5 days**: `wrangler` config, OpenNext incremental cache for the Next data cache (KV/R2 free quotas apply), demo mode memory-only (no filesystem `DEMO_DATA_DIR`), `TRUSTED_PROXY=cloudflare`. **Risk: SSR of a title page may exceed 10 ms CPU** (Unverified; spike and measure first). The nightly job stays on GitHub Actions (it needs `sharp` and minutes of runtime) |
| **Oracle Cloud Always Free VM** (Ampere A1) | since 2026-06-15: 2 OCPU + 12 GB RAM total (was 4 + 24); 200 GB block storage | **reclaimed if p95 CPU, network and memory all stay < 20 % for 7 days**; a sign-up card check is required (not charged) | no restriction found (Unverified) | **M, ~2 days + ongoing ops**: `next start` behind Caddy (TLS, overwrite `X-Forwarded-*`), systemd units for web, nightly job and `pg_dump`, `TRUSTED_PROXY=xff-1`. The only free option where the job, backups and even Postgres can live on one box |
| Render Free web service | 750 instance-hours/month (enough for one always-on service) | **spins down after 15 min idle**; 30–60 s cold start | Unverified | **S**: build `npm ci && npm run build`, start `npm start`, `TRUSTED_PROXY=xff-1`. **Staging only**: cold starts fail E3 (LCP) and the uptime monitor would have to keep it awake |

**Ranking if we must leave the primary:** hosting → Netlify Free (least work, commercial OK), then Cloudflare Workers Free
(most headroom, after a CPU spike), then Oracle VM (most control, most ops). DB/auth → Neon Free + Neon Auth, then self-hosted
Supabase on the Oracle VM. Appwrite, Firestore, Turso and D1 are rejected.

### A3. `TRUSTED_PROXY` (replaces AR-7's reverse-proxy requirement)

Today `clientIp()` trusts the first `X-Forwarded-For` hop (`src/server/rate-limit.ts:115-118`) and `requestOrigin`,
`assertSameOrigin` and `isSecureRequest` trust `x-forwarded-host/-proto` (`src/server/http.ts:95-124`). That is only safe
behind an edge that overwrites those headers. New env var, parsed in `src/server/env.ts`:

| `TRUSTED_PROXY` | Client IP source | `x-forwarded-host/-proto` | Use on |
|---|---|---|---|
| `vercel` | `x-real-ip`, else first `x-forwarded-for` hop (Vercel overwrites both) | trusted | Vercel (auto-selected when `VERCEL=1`) |
| `netlify` | `x-nf-client-connection-ip` | trusted | Netlify (auto-selected when `NETLIFY=true`) |
| `cloudflare` | `cf-connecting-ip` | trusted | Cloudflare Workers, or any host behind the Cloudflare proxy |
| `xff-<N>` (N = 1..5) | the N-th `x-forwarded-for` entry **from the right** (N = number of proxies we control that append to XFF) | trusted | Render (`xff-1`), Caddy/nginx on a VM (`xff-1`) |
| `none` | no header is trusted; every client shares the key `shared`, and auth limits are multiplied by 20 | ignored; origin comes from `Host` + `NEXT_PUBLIC_SITE_URL` | local `next start`, tests |

Rules: in production live mode, if `TRUSTED_PROXY` is unset and no platform is auto-detected, **boot fails** with
"Set TRUSTED_PROXY (see ADR-001 §A3)", the same way partial configs fail today. Demo and test default to `none`, except that the
existing tests keep passing an explicit mode. One helper, `clientIp(headers, trust)`, is used by every per-IP limiter.

Still true on every host: the auth limiter and the TMDB breaker live in process memory, so they are exact on one process and
best-effort on serverless (per instance). Per-user limits (`consume_rate_limit`) are in Postgres and are exact everywhere.

### A4. Sources (free tiers, checked 2026-09-27)
- Supabase Free: 500 MB DB, 50k MAU, pause after 7 days ([jetadmin](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/), [Supabase docs: billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Supabase docs: pausing](https://supabase.com/docs/guides/platform/free-project-pausing))
- Vercel Hobby: non-commercial, 1M invocations, 4 CPU-h ([Vercel docs: Hobby](https://vercel.com/docs/plans/hobby), [costbench](https://costbench.com/software/developer-tools/vercel/free-plan/))
- Neon Free: 0.5 GB, 100 CU-h, scale to zero ([Neon plans](https://neon.com/docs/introduction/plans), [Neon FAQ](https://neon.com/faqs/free-plan-limits-and-quotas)); Neon Auth free to 60k MAU ([Neon Auth docs](https://neon.com/docs/auth/overview))
- Cloudflare Workers Free: 100k req/day, 10 ms CPU ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/index.md)); 64 MiB bundle ([changelog 2026-09-04](https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/)); OpenNext ([opennext.js.org/cloudflare](https://opennext.js.org/cloudflare))
- Netlify Free: 300 credits, hard cap, commercial allowed ([Netlify: free plan](https://www.netlify.com/blog/introducing-netlify-free-plan/), [Netlify docs: credits](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/))
- Render Free: 750 h, spin-down after 15 min ([Render docs](https://render.com/docs/free))
- Oracle Always Free: A1 halved to 2 OCPU/12 GB on 2026-06-15; idle reclaim ([InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm))
- Appwrite Free: pause after 7 days without development activity; delete after 90 days paused ([changelog 2026-02-20](https://appwrite.io/changelog/entry/2026-02-20-1), [changelog 2026-06-29](https://appwrite.io/changelog/entry/2026-06-29))
- Nhost Free: pause after 1 week, one active project ([Nhost pricing](https://nhost.io/pricing))
- Firebase Spark: Auth 50k MAU; Firestore 50k reads/day ([Firebase pricing](https://firebase.google.com/pricing), [Firestore quotas](https://firebase.google.com/docs/firestore/quotas))
- Turso Free: 5 GB ([Turso pricing](https://turso.tech/pricing))
