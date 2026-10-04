# Architecture review: close-out (ADR-013 C-01 to C-15)

Mode: review (report only, no code edited) · Scope: `git diff b4287cd..HEAD` (208 files) · Date: 2026-10-04 · Protocol: `docs/08-clearpath/protocol/deterministic-review.md`
Skipped: PNG mock-ups in `docs/02-design/share/`, the font binary and licence, fixtures, lockfile.

## 1. Findings (confidence 80 or higher, most severe first)

| id | sev | category | file:line | evidence | conf | recommendation | status |
|---|---|---|---|---|---|---|---|
| AR-C1 | medium | operability / deploy order | `src/server/auth/supabase.ts:117,122`; `README.md:48`; `scripts/lib/launch-check.ts:321-324` | Observed: the session read now selects `avatar_color` and throws `internal` on any error (`:122`). `dal.getSession` has no fallback (`src/server/dal.ts:49`). The new code also calls `stub_insert(..., p_season)` and `catalog_page(..., p_watch_tag)`. Inferred: if the code ships before migrations 090-096, every signed-in request fails. The README covers a fresh install in the right order (step 3 before step 4). There is no rule for later releases ("apply migrations, then merge or deploy"), and `migrations-applied` is a `manual` item with nothing automated behind it (`launch-check.ts:321-324`). The `--live` `health_probe` only proves the 09-27 schema. Note: the migrations are backward compatible (default params, only appended columns), so "migrate first" is safe. | 85 | Add one rule to the README and the runbook: **run `db:apply` before merging or deploying any commit that adds a migration**. Make `launch:check --live` compare `public._stubbed_migrations` with `supabase/migrations/*.sql` and fail when files are pending. | open |
| AR-C2 | medium | observability | `docs/04-architecture/ADR-013-closeout.md:11,211-221`; `src/server/log.ts`; `src/instrumentation.ts:15` | Observed: C-13 writes errors only to `console.*`, to be read in Vercel logs. External fact (vercel.com/docs/logs/runtime): runtime logs are kept for **1 hour on Hobby**, and log drains are not offered on Hobby. Inferred: on the $0 tier the founder cannot see an error that happened more than an hour ago, so in practice C-13 tracks nothing after the fact. Nothing in ADR-011/013 or the README states this ceiling (grep for "retention" finds only the backup artifact, `ADR-011:185`). | 85 | $0 fix with no new vendor: also count `request_error`/`client_error` by `{routeType or kind}` (no message) in the existing `events` table via `recordEvent`. `scripts/metrics.ts` then shows error rates for 400 days. Record the 1 h ceiling in ADR-013 §18. | open |
| AR-C3 | low | catalog budget | `supabase/migrations/20261003092000_enrich_core_refresh.sql:70-74,82-83`; `supabase/migrations/20260926000000_init.sql:604-608` | Observed: `catalog_mark_gone` sets only `source_status`. It does not set `enriched_at` or `synced_at`, and `catalog_enrich_due` does not filter `source_status = 'gone'`. A referenced gone row is never purged (the purge skips rows with stubs, reviews or watchlist entries, init `:606-608`). Its `synced_at` stays more than 120 days old, so it sorts **first** every night. Inferred: each such row costs one TMDB 404 call plus a 100 ms sleep per night, forever. The number of gone rows only grows, and they take enrich budget (`SYNC_ENRICH_MAX`) away from rows that need it. | 90 | Add `and c.source_status = 'active'` to `catalog_enrich_due`, or have `catalog_mark_gone` stamp `enriched_at = now()`. Make it a new migration (applied files are immutable under `db:apply` checksums). | open |
| AR-C4 | low | analytics integrity | `supabase/migrations/20261003096000_events_dim_cap.sql:131,147`; `src/lib/analytics.ts:41` | Observed: the global cap is 1,000 new `(name, dim)` rows per UTC day, shared by client and server events. `provider_clicked` dims are client-chosen (`[A-Z]{2}` × `[1-9]\d{0,9}`), so about 50 anonymous requests of 20 events can fill the day. After that, the first `signup_completed`/`stub_created`/`import_completed` row of the day is dropped (`where ranked.known or ranked.rn <= v_room`). The storage bound works (≤ 400k rows); the cost is that server counters can be starved. | 85 | Exempt the server-only names (`client: false` in `ANALYTICS_EVENTS`) from `v_room`. They come from a fixed set of about 12 dims, so they cannot grow the table. Or reserve about 50 rows for them. | open |
| AR-C5 | low | ADR ↔ code drift (launch kit) | `docs/04-architecture/ADR-013-closeout.md:224-225`; `e2e-live/smoke.spec.ts:47,55,77,106,125`; `scripts/lib/launch-check.ts` | Observed: C-14 says `launch:check` validates `NEXT_PUBLIC_BRAND_NAME` (warns while it is the default). A grep for "brand" in `scripts/`, `e2e-live/` and `.github/workflows/` finds nothing. C-14 also says `smoke:live` hits `/title/movie/0-x` (404), a wrong slug (308), `/api/watch/providers?region=US` and a title `opengraph-image` (PNG). None of the five smoke tests does any of these. These are exactly the close-out behaviours (C-03, C-02, C-08) that only show up on a real deploy (streaming status, font tracing). | 90 | Add the 4 requests to `e2e-live/smoke.spec.ts` and the brand warning to `launch-check.ts`. If they are deferred, amend ADR-013 C-14 instead. | open |

No critical or high findings at confidence 80 or higher.

## 2. ADR-013 ↔ code drift

| Item | ADR says | Code | Label |
|---|---|---|---|
| §0 migrations | 6 files | 7 files: `20261003096000_events_dim_cap.sql` (SR-1) was added after the ADR | Observed `supabase/migrations/`. Doc drift only; `db:apply` applies every file in name order |
| C-06 | "ADR-002 §4 is amended" | `ADR-002` has no 120-day text (grep finds nothing) | Observed; doc drift |
| C-08 JSX | `TitleCard.tsx`, `StoryCard.tsx`, `StubCard.tsx` | one file, `src/og/ShareCard.tsx` (785 lines), with `OgCard`/`StoryCard` | Observed; harmless |
| C-08 tracing | fonts traced for OG/story | `next.config.ts` `outputFileTracingIncludes`; the build `.nft.json` files of all 3 routes list `src/og/fonts/Geist-Regular.ttf` | Observed (`.next/server/app/**/route.js.nft.json`, build 2026-10-04 05:23 is newer than HEAD) |
| C-14 | brand check + 4 smoke probes | missing | AR-C5 |
| C-05 | proxy uses `getClaims` | `src/proxy.ts` diff: `getUser` → `getClaims` | Observed |
| C-09 / C-13 / §0 | no vendor, no new deps, no new host | `package.json` diff adds only 4 scripts; no `sentry\|posthog\|plausible\|gtag\|mixpanel\|openai\|anthropic` in `src/`; the only new outbound URL is the TMDB poster CDN (`src/server/og-assets.ts:101`), with no fetch in demo/off mode (`:98`) | Observed |
| C-11 | browser parse, no outbound call, 20k/24 h budget | `import_apply` budget is in SQL (`20261003095000_imports.sql:136-141`); preview is rate-limited (`src/server/imports/commit.ts:101`); lookup indexes added (`:19-20`) | Observed |

## 3. Free-tier impact ($0)

- **events table:** at most 1,000 rows/day × 400-day retention = ≤ 400k narrow rows. Inferred: roughly 40-60 MB with the primary key, about 10% of the 500 MB Supabase Free DB. Purge runs nightly on full runs (`src/server/jobs/sync-runner.ts:77`). Writes go through `after()` (`src/server/events.ts:37`). Acceptable; the upgrade trigger is already in the 096 header.
- **OG/story rendering:** title OG uses `s-maxage=86400, swr=604800`; stub OG and story use `s-maxage=600`. Fonts are read once per process (`og-assets.ts:58-63`) and the poster fetch uses `force-cache` with a 1.5 s timeout and a 1.5 MB cap. Unverified: the CPU per render on Vercel Hobby (satori + resvg at 1080×1920). Assumed: CDN cache keys include the query string, so `?x=random` bypasses the cache, and the routes have no rate limit. Risk R1 below.
- **Imports:** no TMDB/OMDb/Letterboxd calls. `catalog_match` (≤ 1000 items, indexed) runs at most 20 times per 20k preview; previews are rate-limited per user. OK.
- **Nightly referenced-row refresh:** stays inside the existing `SYNC_ENRICH_MAX` detail calls with no extra request (`scripts/sync-catalog.ts` enrich step reuses the same detail response). The OMDb budget is untouched. Leak: AR-C3.

## 4. Layering

- Observed: no `'use client'` file imports `@/server`, `@/og` or `server-only` (scanned all of `src/`). `src/og/render.tsx:6` and `src/server/og-assets.ts:11` are `server-only`. `src/lib/import/*` is client-safe and imported by `ImportFlow.tsx:13`.
- Unverified: client bundle size of `/me/import` (the parsers plus a 372-line component). It is route-scoped, so it does not touch other pages' first load. Not measured.

## 5. Migrations and deploy order

- Observed: filename order is consistent with the dependencies (095 needs 091; 096 replaces 094's function). `db:apply` uses `ON_ERROR_STOP` and one transaction per file (`scripts/lib/db-apply.ts:238-244`), refuses edited or out-of-order files, and the workflow needs `confirm=yes` (`.github/workflows/db-apply.yml:57`).
- Inferred: the migrations are backward compatible with the old code (only defaulted params and appended columns are added), and the new code depends on them, so the order must be **migrate, then deploy**. That rule is not written down (AR-C1).

## 6. Launch kit operability (founder path, zero to live)

README "Going live" steps 0-7 (`README.md:28-112`) are in a workable order: TMDB, then OMDb, then Supabase plus `db:apply`, then Vercel env, then Actions, then a dry-run sync and a real sync, then the staging smoke. `launch:check` (offline and `--live`), `db:apply` (plan by default), `smoke:live` and `check:provider-links` each map to one step. Gaps: AR-C1 (no rule for later releases), AR-C5 (the smoke misses the close-out checks), and Vercel Hobby's 1 h log window (AR-C2).

## 7. Risks (not findings)

- R1 (Inferred, medium): the anonymous story/OG routes are CPU-heavy and can be cache-busted with a query string. A scripted loop could use up the monthly Hobby compute and pause the site. Mitigation: ignore query params other than `download`, and add a per-IP `MemoryRateLimiter` to `story/route.tsx` like `/api/events`.
- R2 (Inferred): at large scale, referenced unlisted rows share the enrich budget (each comes due every `p_ttl_days`). Once about 90k such rows exist, the 3,000/night budget is saturated. The upgrade trigger is `sync_runs.stats.enrich.unlisted_refreshed` near `SYNC_ENRICH_MAX`.
- R3 (Observed, accepted in ADR §18): a deleted stub's image can stay cached up to 10 minutes.

## 8. Recommended ADR changes

1. ADR-013 §0: list 7 migrations (add `096_events_dim_cap`), and add the rule "migrate, then deploy".
2. ADR-013 §18: add the shortcut "errors are visible for 1 h on Vercel Hobby", with the error counter as the upgrade path (AR-C2).
3. ADR-002 §4: add the 120-day unlisted re-sync text that C-06 promised, plus "gone rows are excluded from enrich".
4. ADR-013 C-14: either implement or drop the brand check and the 4 smoke probes (AR-C5).

## Verdict

**SHIP**, with AR-C1 handled before the first post-launch release and AR-C2 to AR-C5 as follow-ups. The constraints hold: $0, no AI, no third-party tracking or error service, no posting, no new dependency or host. No finding blocks launch on a fresh install, which follows the README order.

Sources: [Vercel runtime logs](https://vercel.com/docs/logs/runtime), [Vercel limits](https://vercel.com/docs/limits)

```
— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=unchanged · unverified=OG render CPU on Hobby, /me/import bundle size, CDN query-string cache key behaviour
```
