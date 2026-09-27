# Stubbed: architecture review (ClearPath)

Arch reviewer · 2026-09-27 · Branch `claude/movie-app-multi-agent-d2x9zd` @ `c88b551` · Mode: review (report-only)
Scope: the **built** system (`src/`, `scripts/`, `supabase/migrations/`, `.github/workflows/`, `next.config.ts`, `src/proxy.ts`)
against SYSTEM_DESIGN, ADR-001…009, API_CONTRACT v1.3 and the BRIEF founder constraints (no third-party posting, IMDb rating
on screen, no AI, free tiers, own server). Prior findings in REVIEW.md (R1–R11, FL1–FL4, FL-R1–R3) and GAP_REVIEW.md are
not repeated unless the architecture makes them worse. Skipped: UI styling, fixtures JSON, lockfile, e2e specs.
Threshold: confidence ≥ 80. A code reviewer is editing in parallel, so line numbers are as of `c88b551`.

## 1. Verdict

**Sound. Ready for a staging deploy. Fix AR-1 to AR-4 before a public launch.** No critical or high findings.

The core decisions hold up in code. The hybrid catalogue (ADR-002), keyset pagination with SQL/JS parity (ADR-003), ports and
adapters with a single composition root (`src/server/container.ts:36-63`), a DAL that pages must go through
(`src/server/dal.ts`), RLS on every table, and SECURITY DEFINER functions revoked from API roles all check out. The founder
constraints are met in the architecture. The gaps are all **operational**: what happens around the nightly job, how outages
are detected, and hosting assumptions that were written for Vercel while the founder wants to run on their own server.

## 2. Findings (severity order)

| id | sev | category | file:line | evidence | conf | recommendation | status |
|---|---|---|---|---|---|---|---|
| AR-1 | medium | cost / free-tier budget | `scripts/sync-catalog.ts:246-258`, `:209-235`, `:504-505`; `README.md:77` | Observed: `--dry-run` skips only the **writes** in the IMDb step (`save: … if (!dryRun)`). `provider.getImdbRating` still makes up to `OMDB_DAILY_BUDGET` (900) real OMDb calls. The enrich step still makes up to `SYNC_ENRICH_MAX` (3,000) TMDB detail calls and throws the results away. The discover step returns `{dry_run:true}`, not `aborted`, so both steps run. The README says a dry run "writes nothing" and tells the founder to follow it with a real run. Inferred: on a populated catalogue, dry run + real run on the same day = 900 + up to 900 against OMDb's 1,000/day. The real run stops at the limit, so IMDb refresh loses a day. ADR-008 §3's "100 calls of headroom for manual runs" does not hold | 90 | In `--dry-run`, skip OMDb completely and cap enrich at a small sample (for example 20 rows) so the mapping still gets tested. Log the number of rows that are due instead. Document this in ADR-008 and in the README | open |
| AR-2 | medium | failure mode / catalogue sync | `scripts/sync-catalog.ts:500-511` | Observed: when the discover guardrails fail, `main()` calls `finish('aborted')` and **returns** before the enrich, IMDb, palette, purge and revalidate steps. Those steps only work on rows already in `catalog_index` and do not depend on today's discover. Inferred: an abort (for example FL-R1: the second night after a first run below the floor) also freezes the "Worth it?" backfill, IMDb chips, palettes and the 150-day TMDB purge until someone fixes the guard | 90 | "Index untouched" should apply to the **discover/apply** step only. After an abort, still run enrich, IMDb, palettes and purge on the existing index, then exit 1 so the workflow still fails loudly. Record this in ADR-002 §1 | open |
| AR-3 | medium | observability / failure detection | `src/app/api/health/route.ts:11-16`; `src/server/repositories/supabase/index.ts:148-149, 241-248`; `src/server/supabase/server.ts:66-72` | Observed: `/api/health` always returns `ok: true`. It reads `catalog_count` and `last_catalog_sync` through `supabaseCatalog()`, whose GETs go through the Next data cache with `revalidate: 3600`. There is no check on how old the last sync is. Inferred: a paused or down Supabase project, or a sync that has not run for days, can still produce a green health check for about an hour, and longer while stale entries are served (Unverified: exactly how long Next serves stale data after a failed revalidation). SYSTEM_DESIGN §13 asks for "DB ping + last-sync age < 36 h" | 85 | Health reads through the uncached `supabasePublic()` (one cheap RPC), returns 503 when the DB fails, and sets `ok: false` (or `degraded`) when `lastSyncAt` is older than 36 h. Point an uptime monitor at it (free tier). Put this in the new ADR-010 |
| AR-4 | medium | failure mode / Supabase down | `src/app/layout.tsx:15`; `src/server/dal.ts:110-114`; SYSTEM_DESIGN §14 "Supabase down" | Observed: the root layout forces every page to render dynamically, and no CDN or ISR layer exists (ADR-001 MVP). `getTitle` puts `titleStates.stats()` (uncached `supabasePublic`, `index.ts:732-734`) in the same `Promise.all` as detail loading, with no fallback. Only TMDB detail failures degrade (`loadDetail` try/catch, `dal.ts:230-247`). Inferred: when Supabase is down or paused, title, profile and diary pages go to `error.tsx`. SYSTEM_DESIGN §14 says "public pages keep serving from CDN (SWR / stale-if-error)", but that CDN layer does not exist. On an own server no CDN exists at all | 80 | Short term: catch `stats()` failures in `getTitle` (render without community data, the way `index_only` works for TMDB). Stage 1: ISR/`'use cache'` for `/title/*` (ADR-001 already names this lever). Correct SYSTEM_DESIGN §14 to match what is actually built |
| AR-5 | medium | scalability / latency | `src/proxy.ts:21-44`; `src/server/auth/supabase.ts:96-100` | Observed: for every request that carries an `sb-*-auth-token` cookie (pages, RSC fetches, `/api/me`, `/api/me/title-states`, every mutation), `proxy.ts` calls `auth.getUser()`, which is a network round trip to Supabase Auth. After that, `getSession()` in the DAL or route calls `auth.getUser()` **again**, plus a `profiles` select. Observed: the installed auth-js recommends `getClaims()` for verifying identity (`node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:1406-1411`). Inferred: a signed-in page view with its two islands costs about 6 Auth round trips. That adds latency on every signed-in view and multiplies Auth load at 100k–1M MAU | 85 | Turn on asymmetric JWT signing keys in Supabase and verify locally with `getClaims()` in `getSession()`. Keep a `getUser()` refresh only in `proxy.ts`, or only when the token is close to expiry. Record this in ADR-005 |
| AR-6 | medium | operability / free-tier keep-alive | `.github/workflows/nightly-sync.yml:7-8, 66-71`; ADR-001:24 | Observed: the only thing that keeps Supabase Free awake is the scheduled GitHub Actions run. The workflow also **skips everything**, including the keep-alive DB write, when the TMDB secret is missing (`:69`). Verified externally: GitHub disables scheduled workflows in **public** repositories after 60 days without a commit, and Supabase Free pauses after about 7 days without API activity. Unverified: whether this repo will be public. Inferred: a quiet repo leads to the cron being disabled, then Supabase pausing about a week later, and AR-4 then takes the site down | 80 | On the founder's own server, run the job with a system cron or systemd timer (ADR-001:33 already allows this). If GitHub Actions stays, keep the repo private or add a keep-alive, and make the keep-alive independent of the TMDB secret. Alert on sync age (AR-3). Record this in ADR-001 |
| AR-7 | medium | ADR drift / hosting (founder: own server) | ADR-001:22, 33; `src/server/rate-limit.ts:115-118`; `src/server/http.ts:10-17, 116-124`; `src/server/container.ts:65-70`; `src/server/providers/tmdb.ts:210-223` | Observed: ADR-001 **decides** on Vercel Hobby and treats self-hosting as a one-line portability note. The code assumes a trusted edge in several places: `clientIp` trusts the first `X-Forwarded-For` hop, `requestOrigin` and `isSecureRequest` trust `x-forwarded-proto/host`, public `s-maxage` headers only help if a CDN exists, and the auth limiter and TMDB breaker live in process memory, so they are only correct on a single process. Inferred: on an own server with no reverse proxy, auth rate limits can be bypassed (R4). The CDN caching in SYSTEM_DESIGN §5 does not exist, so `/api/search` and `/api/catalog` hit the data cache and Postgres directly. A multi-process deploy splits the limiters, and `/api/revalidate` only clears one instance's data cache | 85 | Write a first-class "own server" profile in ADR-001: one Node process, `next start` behind Caddy or nginx that **overwrites** XFF and X-Forwarded-Proto, TLS at the proxy, persistent `DEMO_DATA_DIR`, cron on the host, and optionally a free Cloudflare proxy in front for CDN, stale-if-error and rate-limit rules. Say that Vercel is optional |
| AR-8 | low | data retention / TMDB terms | `scripts/sync-catalog.ts:318-334`; `supabase/migrations/20260926000000_init.sql:604-608`, `:553-578` | Observed: only rows that are **currently listed** get re-checked when discover misses them. After a row is unlisted it is never re-fetched: its title, score, poster and overview stay frozen. The purge keeps any row that has stubs, reviews or watchlist entries. The enrich step refreshes only enrichment columns, although it already fetches the full detail every 30 days. Inferred: TMDB-derived fields on referenced, unlisted titles (for example Twilight, "BELOW 6.5 NOW") can be older than 6 months without a refresh, which contradicts ADR-002 §4 ("keeps us under TMDB's 6-month rule"). The shown score also goes stale | 80 | Have the enrich call also refresh `vote_average`, `vote_count`, `title`, `poster_path` and `synced_at` for unlisted rows. Keep `is_listed` false unless discover lists the row again. Update ADR-002 §4 |
| AR-9 | low | observability | `package.json:24-32`; SYSTEM_DESIGN §13 | Observed: there is no error tracking (Sentry or similar), no request ids and no structured logs. Server errors go to `console.error` (`src/server/http.ts:37`, `dal.ts:245`). The only sync alert is the GitHub Actions failure email | 90 | For MVP: Sentry Developer (free) or the host's log shipper, plus AR-3 health checks with an uptime monitor. Put this in ADR-010 |

No findings ≥ 80 on: RLS, SECURITY DEFINER exposure, CSRF, the public-HTML/session split, cursor safety, or "no AI".

## 3. Not flagged (checked)

- **Layering:** pages import only `@/server/dal`. Public pages never read cookies (grep of `src/app/**/*.tsx`: only `/me/*` call `getSession`). Personal state comes through `/api/me/*` islands. Container selection happens once per process, and in demo mode no provider is constructed (`container.ts:39-61`).
- **Caching works despite `force-dynamic`:** Next 16.3.6 `patch-fetch.js:392-398` only forces no-store under `force-dynamic` when a fetch has **no** explicit `revalidate`. The TMDB L1 (`tmdb.ts:281`, 24 h) and catalogue (`server.ts:70`, 1 h) data caches do apply. (The local Next docs, `caching-without-cache-components.md:97-99`, overstate this.)
- **RLS/definer:** RLS is on for all 10 tables. The views are `security_invoker` (`…user_data_reads.sql:11,21`). Every job RPC is revoked from `public/anon/authenticated` (`init.sql:664-671`). Invoker read functions keep the watchlist owner-only. `consume_rate_limit` only affects the caller's own rows.
- **Sync correctness:** staging is applied in one transaction, unlisting never deletes, an `imdb_id` change resets the IMDb columns (`init.sql:462-465`, `:560-563`), and the OMDb tiers match the ADR-008 maths (≈650 calls a night at 15k rows). Budget stop on 401/limit (`omdb.ts:156-159`).
- **Founder constraints:** no outbound write path to IMDb, TMDB or Trakt. The request path never calls OMDb (`omdb.ts` is imported only by the job). No AI dependencies (`package.json`). The IMDb rating is stored per row and hidden when null.
- **Free tier at MVP scale:** about 15k index rows plus a detail cache sit far below Supabase Free's 500 MB. At the defaults TMDB gets about 3.5k calls a night and OMDb 900.

## 4. ADR drift table

| ADR | Says | Built | Drift |
|---|---|---|---|
| 001 | Vercel Hobby is the host; self-hosting is a note | Code assumes a trusted proxy and CDN (AR-7) | **Yes**: founder wants own server |
| 001 | Catalogue cached "optionally via `unstable_cache`" | Supabase client `fetch` data cache, tag `catalog` (`server.ts:66-81`) | Wording only |
| 002 §1 | Guardrail abort leaves the index untouched | Also skips enrich, IMDb, palette and purge (AR-2) | **Yes** |
| 002 §3 | Unknown title by URL is lazily inserted as unlisted | Not built: `getEntry` null → 404 (`dal.ts:107-108`); no app insert into `catalog_index` | **Yes** (mark deferred to v1 imports) |
| 002 §4 | Purge keeps us under TMDB's 6-month rule | Referenced unlisted rows are never refreshed (AR-8) | **Yes** |
| 003 §2 | Unknown `sort`/`type` "never produce an error" | API returns 400; pages fall back (GAP O1) | Wording (decision already taken) |
| 005 | Validate with `getUser()` | Done twice per request (AR-5) | Perf, not security |
| 006 | "Mutations return 501 until Backend fills" | All implemented | Stale text |
| 007 | First run handles ~15k posters | `paletteStep` max 2,000 a night (`sync-catalog.ts:404`), about 8 nights; genre-default tints until then | Minor |
| 008 §3 | 100 calls of headroom for manual runs | A dry run spends up to 900 (AR-1) | **Yes** |
| SD §13/§14 | Health = DB ping + sync age; Supabase down → CDN serves | Neither exists (AR-3, AR-4) | **Yes** |

## 5. Recommended ADR changes

1. **ADR-001 (amend):** make "own server" a first-class hosting profile. Cover the single Node process behind a reverse proxy that overwrites `X-Forwarded-*`, host cron for the job and the keep-alive, an optional free Cloudflare proxy in front for CDN, stale-if-error and rate limiting, and the fact that in-memory limiters and the breaker are only correct on one process. Keep Vercel as the alternative. Replace the `unstable_cache` wording.
2. **ADR-002 (amend):** a guard abort blocks **apply only**, and the steps that work on the existing index still run (AR-2). Define dry-run semantics (AR-1). Mark the lazy unlisted insert as deferred. Refresh the core fields of referenced unlisted rows in the enrich call (AR-8).
3. **ADR-005 (amend):** verify sessions locally with `getClaims()` using asymmetric signing keys. Only the proxy refreshes (AR-5).
4. **ADR-008 (amend):** a dry run makes no OMDb calls, and the headroom maths is restated.
5. **ADR-003 / ADR-006 / ADR-007:** wording fixes from the drift table.
6. **New ADR-010, Operability and observability:** health semantics (uncached DB ping, sync age < 36 h, 503 on failure), uptime monitor, error tracking, sync alerting, keep-alive independent of the TMDB secret, graceful degradation when Supabase is down (AR-4), and backups (Supabase Free has none, so either a nightly `pg_dump` from the own server or Pro).

## 6. Risks (not findings: below threshold or out of scope)

- Unique `/api/search` queries each create a Next data-cache entry (`catalogFetch` caches every GET). On a self-hosted filesystem cache, whether entries get evicted is unverified (confidence about 60). Consider not data-caching `catalog_search`.
- Scale from 1k to 1M MAU: every page renders dynamically (ADR-001 accepts this for MVP). Past about 100k MAU the levers are ISR or `'use cache'` for `/title/*` and `/u/*` plus a CDN, as ADR-001:38 already names. Postgres load is bounded by a fixed ~15k-row catalogue. User tables grow linearly and have keyset indexes.
- Supabase Free has no backups (GAP §8). On an own server, a nightly `pg_dump` cron costs $0.

## 7. Sources (free-tier facts checked for this review)

- GitHub: in public repos, scheduled workflows are disabled after 60 days without activity ([community discussion #86087](https://github.com/orgs/community/discussions/86087), [GitHub docs](https://docs.github.com/en/enterprise-server@3.5/actions/using-workflows/disabling-and-enabling-a-workflow))
- Supabase Free pauses after about 1 week of inactivity ([Supabase docs: project pausing](https://supabase.com/docs/guides/platform/free-project-pausing))
- OMDb free = 1,000 calls/day: as cited in ADR-008 and `docs/01-product/research.md`; not re-checked.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=off · unverified=repo visibility (AR-6), Next stale-on-error duration (AR-3), data-cache eviction on self-host (§6)
