# Stubbed — ClearPath code review (whole repo)

Code reviewer · 2026-09-27 · branch `claude/movie-app-multi-agent-d2x9zd` @ `c88b551` · protocol
`docs/08-clearpath/protocol/` (deterministic-review, review-protocol, evidence, minimal-code, verifier).

**Verdict: SHIP.** One medium finding clears the ≥ 80 confidence bar. It is fixed and covered by a test.
There are no critical or high findings. Every fix from `docs/05-review/REVIEW.md` (#1–#18, FL1–FL4) still holds.

## 1. Scope

- **Override (founder):** this is a **whole-repo audit**, not the default "changed code only" scope
  (deterministic-review §1). The user's instruction takes precedence.
- **In scope (enumerated with `git ls-files`):** `src/` (app routes and pages, components, hooks, lib, server:
  auth, providers, repositories, jobs, services, export), `scripts/` (sync-catalog, build-fixtures,
  demo-reset), `supabase/migrations/` (3 files), `tests/` (unit, server, db/PGlite), `e2e/` (specs, support,
  net-guard), `.github/workflows/` (ci, nightly-sync), and config (`next.config.ts`, `eslint.config.mjs`,
  `playwright.config.ts`, `vitest.config.mts`, `tsconfig.json`, `package.json`, `.env.example`, `.gitignore`).
- **Skipped:** generated or data files (`src/fixtures/*.json`, `scripts/fixtures/*.source.ts` data tables,
  `package-lock.json`, fonts, `public/*.svg`, `docs/06-qa/screenshots`) and `docs/` prose (the architecture
  reviewer owns `ARCH_REVIEW.md`).
- **Groups reviewed together:** route handler + service + repository (memory and Supabase) + SQL function;
  auth provider + cookie jar + proxy; sync script + `jobs/discover` + workflow.

## 2. Rules applied (project first)

`AGENTS.md` (Next 16 is not the Next you know; no API was changed, so no guide was needed),
ADR-001…009, `API_CONTRACT.md`, `WORK_SPLIT.md` (frozen files), `eslint.config.mjs` (no `dangerouslySetInnerHTML`,
no AI SDKs, no server imports in components), and the BRIEF founder constraints (nothing posted to third
parties, no AI).

## 3. Findings (confidence ≥ 80)

| id | severity | category | file | line | evidence | confidence | recommendation | status |
|---|---|---|---|---|---|---|---|---|
| CR-1 | medium | data integrity / guardrail bypass | `scripts/sync-catalog.ts` | 371–379 (was 347–355) | **Observed (before the fix):** the delta guardrail read only the newest `sync_runs` row with `kind='catalog'` and `status='ok'` (`.limit(1).maybeSingle()`). **Observed:** single-step runs (`--only=enrich` / `--only=imdb`, offered as `workflow_dispatch` choices in `.github/workflows/nightly-sync.yml:17-20`) also insert and finish a `kind='catalog'`, `status='ok'` run (`main()`, `finish('ok')`), but their `counts` have no `discover.listed`. **Observed:** `lastListedCounts()` then returns `null`, and `checkGuardrails()` skips the Δ check when `last` is null (`src/server/jobs/discover.ts:379-380`). **Inferred:** after any manual single-step run, the next nightly sync runs with the ±20 % delta guard switched off. That guard is what stops a bad TMDB response from mass-unlisting titles through `catalog_apply_staging` (only the absolute floor 3000/1000 remains). A query error was also swallowed and had the same effect | 88 | Compare against the newest ok run that actually ran discover. Fail the run if that lookup errors | **Fixed.** New pure `latestListedCounts(runs)` scans the last 50 ok runs, newest first. The query error now throws, so the run is recorded as `failed` instead of silently skipping the guard. Test added in `tests/server/discover.test.ts` ("counts listed per type…") |

No other finding reached 80. In the protocol's terms, this is a complete review.

**Related symptom, same root cause, not fixed (below the fix threshold):** `last_catalog_sync()`
(`supabase/migrations/20260926000000_init.sql:440`), shown as `/api/health.lastSyncAt`, also counts
single-step runs as catalogue syncs. It is cosmetic (health only), and the correct fix is a new migration
(filter on `counts ? 'discover'`), so it is left as a follow-up (F1).

## 4. Not flagged (checked)

- **Prior fixes still hold (Observed):** `safeNext` control-char, backslash and origin checks (`src/lib/routes.ts:44-55`).
  The hardening migration owns `created_at`, `updated_at` and `edited_at` for API roles, and the review limit counts content edits only
  (`20260926180000_review_hardening.sql`). httpOnly + SameSite=Lax auth cookies are set in both the request client and the proxy
  (`src/server/supabase/server.ts:33`, `src/proxy.ts:25-30`). The production demo HMAC secret is random
  (`src/server/auth/local.ts:47`). The composer resends `stubId` (`ReviewComposer.tsx:56`). The CSP is in place (`next.config.ts:12`).
  `stubCount` and diary `total` are implemented. `typedTuple` cursor validation is in place (`supabase/index.ts:104`). `safeReviewUrl` is in place (`tmdb.ts:127`).
  `Vary: Cookie` is set on errors, 204s and redirects (`http.ts:29-44,131`). The XFF first hop is used (`http.ts:103`). Destructive confirms
  focus Cancel (`ConfirmDialog.tsx:20`). Workflow permissions are `contents: read`. `deleteAccount` returns generic copy
  and logs server-side (FL1), and signOut is try/caught (FL2). The mailto validator rejects `?&#%`, and CRLF is used (FL3). DeleteAccount has
  `aria-describedby` and Escape support (FL4).
- **AuthZ:** every mutation route calls `assertSameOrigin` + `requireSession`, and the user id always comes from the session
  (`src/app/api/**`). Repositories scope by `userId`. RLS covers owner-only writes, and the watchlist is owner-only read.
  Trigger functions check immutable columns.
- **Injection:** the only PostgREST logic-tree filter (`supabase/index.ts:660`) quotes type-checked values.
  `catalog_search` gets `normalizeSearch()`d input (no LIKE wildcards). `catalog_page` uses `format('%s')` only with
  server constants and binds every user value with `$n`.
- **XSS:** no `dangerouslySetInnerHTML` (lint-enforced). Every `href` built from data is checked: the trailer is
  `encodeURIComponent`, TMDB review URLs are https-only, the IMDb link is regex-gated, `devLink` is our own origin, and mailto uses `URLSearchParams`.
- **Keyset parity:** SQL and JS orders match (tested on PGlite). NULL `release_date` can't reach a listed row
  (`isListed` requires a date, `src/lib/curation.ts:40`).
- **Demo auth:** HMAC session and magic tokens use separate keys, `timingSafeEqual`, and TTLs. Unknown emails verify
  against a dummy hash. Seeded accounts can't be deleted.
- **Sync job:** retries and backoff, throttle, per-type floors, first-run warning, and `selectAll` paging past PostgREST's
  1,000-row cap. Fixture seeding (71 titles) stays under the cap.
- **Next 16:** `proxy.ts` (renamed middleware), async `params`/`searchParams`, and `revalidateTag(tag, profile)` all pass
  typecheck and build.

## 5. Follow-ups (below threshold or out of scope; not blocking)

| # | Item |
|---|---|
| F1 | `last_catalog_sync()` counts `--only=enrich/imdb` runs (health `lastSyncAt` only). New migration: `… and counts ? 'discover'` |
| F2 | `recheckMissing` stops at 500 titles (`discover.ts:299`). Titles beyond that are unlisted by `catalog_apply_staging` without a re-check, which bypasses hysteresis. Only reachable when more than 500 titles vanish from discover in one night, and the delta guard (now reliable, CR-1) usually aborts first. Consider aborting when `skipped > 0` |
| F3 | The diary "Edit stub" form rejects `date > today` on the client, so an existing stub dated server-today + 1 (accepted by the API's UTC slack) can't be re-saved without changing its date. This is the same root cause as REVIEW R7 (clamp `max`) |
| F4 | Cosmetic: after deleting a review on the title page, the "On Stubbed · N" count isn't decremented (REVIEW R10 family) |

## 6. Verifier checklist

- [x] Read every file I changed or judged. The whole in-scope tree was read at least at the handler, service and repository level. Fixture data was skipped.
- [x] Inspected callers of the change. `discoverStep` is the only consumer of the last-run counts; `lastListedCounts` is kept (still tested).
- [x] Respected the written rules. No frozen file was touched (`scripts/` and `tests/` are Backend-owned), and no new dependency was added.
- [x] Memory claims: `.clearpath/` does not exist, so memory=off.
- [x] Git history: the touched lines date from `63b03c1` (phase 4a), with no later deliberate decision. GAP-03
  (per-type floors, `cc8ac0d`) left the last-run query unchanged.
- [x] No speculative code. One pure helper (rung 7, 10 lines) plus an error check.
- [x] Security, validation and data safety: the change fails closed, because a lookup error now aborts instead of skipping the guard.
- [x] Checks run: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` →
  all green (44 files, 272 tests). No UI or route change, so E2E was not re-run (not required by the task rule).

**Rollback:** `git checkout -- scripts/sync-catalog.ts tests/server/discover.test.ts`.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=off · unverified=live Supabase/PostgREST behaviour of the 50-row sync_runs query (no live project; R2 in REVIEW.md)

---

# M1 review (launch hardening, 2026-09-27)

Reviewer: code-reviewer (ClearPath). Scope: `git diff 4d842f2..HEAD -- src scripts supabase tests .github playwright.config.ts .env.example README.md`
(62 files, +3,000/−204). Specs: WORK_SPLIT §5 (M1-00…M1-17), ADR-010, ADR-011, ADR-001 §A3, API_CONTRACT v1.4.
Skipped: `docs/**`, `docs/06-qa/screenshots/**`, `package-lock.json`, fixture JSON. `src/components/AppProvider.tsx` is not in the
diff and was not edited (QA §6a / auth.spec.ts:206 race awaits a founder decision).

## M1.1 Findings (confidence ≥ 80)

| id | sev | category | file:line | evidence | conf | recommendation | status |
|---|---|---|---|---|---|---|---|
| M1-CR-1 | low | UX / error copy | `src/components/SetPasswordForm.tsx:52-66` (pre-fix) | **Observed:** the demo provider rejects the shared seeded accounts with `403 forbidden` "Demo accounts can't change their password. Create your own to try it." (`src/server/auth/local.ts:185-189`). The form had no `forbidden` branch, so it fell through to `ERROR_COPY.internal`, "Something went wrong. Try again.", which invites a retry that can never work. Reachable: sign in with a listed demo account (`AuthForm` shows them) → Settings → Save new password | 90 | Show the server copy for `forbidden` | **Fixed**: one `else if` branch + test `on forbidden (seeded demo account) shows the server reason` (`SetPasswordForm.test.tsx`) |

No critical, high or medium findings ≥ 80.

## M1.2 Spec conformance (each task, Observed unless labeled)

| Task | Verdict | Evidence |
|---|---|---|
| M1-00 | meets | `types.ts:133-143` `degraded?` (optional, reason documented), `contracts.ts` `AuthResponse` union, `HealthResponse` v1.4, `setPasswordSchema`; `errors.ts` `reauth_required` 401 + copy; `api.setPassword` |
| M1-01 dry run | meets | `enrichStep` returns before constructing `TmdbDetailProvider` (`sync-catalog.ts:237`); `imdbStep` never constructs `OmdbRatingProvider` and passes rejecting `lookup/save` (`:269-275`); `recheckMissing` early return (`discover.ts:321`); `paletteStep` returns before `sharp` (`:490`); runner skips `startRun/finishRun/purge/revalidate` (`sync-runner.ts:55-75`). Due RPCs are `stable` (`init.sql:501,543`). Tests drive the real `buildSteps` with counting fakes for the full run and each `--only` (`sync-dry-run.test.ts:190-227`) |
| M1-02 guard scope | meets | `runSync` records `aborted`, continues enrich/imdb/palettes/disagreements/purge, `finishRun('aborted', …)`; throw → `failed` + rethrow (`sync-runner.ts:55-78`); `sync-runner.test.ts` (a)–(d) |
| M1-03 health | meets | `force-dynamic`; probe on `clients.public()` (cookie-less `supabasePublic`, POST rpc = no data cache) with `AbortSignal.timeout` plus a `Promise.race` fallback (`health.ts:23-29`); `Cache-Control: no-store` on 200/503 and `private, no-store` on 429 (`http.ts:47`); 60/min per `clientIp`; body built only from probe numbers, logs `code` only (`health.ts:46`); `HEAD` has no body |
| M1-04 migration | meets | `20260927000000_ops_health.sql`: both functions `security definer set search_path = public`, every relation and function schema-qualified; `create or replace` keeps `last_catalog_sync` grants (anon call in `migrations.test.ts`); `health_probe` revoked from `public`, granted to anon/authenticated/service_role; uses `catalog_count('all')` (ADR §9 option). `sync_runs` RLS unchanged (no policy; definer only) |
| M1-05 DAL degrade | meets | `loadEntry` → last-good LRU (1,000, catalogue rows only, no session/user data) → `summaryFromDetail` → `null` (404) / `upstream_unavailable` (503) (`dal.ts:58-87`); stats → `ZERO_STATS` + `community`; recommended → empty map; per-user data stays on its own calls, which the page wraps in `safe()` (`page.tsx:80-87`) |
| M1-06 banner/CTAs | meets | `DegradedBanner` `role="status"`, `data-testid`; Stub, details, Watchlist and all review buttons `aria-disabled` + `aria-describedby="degraded-desc"`, handlers inert, still focusable |
| M1-07 keep-alive | meets | first step, anon key only, `curl -fsS … /rpc/health_probe`, "keep-alive skipped" when unset (`nightly-sync.yml:69-78`) |
| M1-08 backup | meets | skip guard; PGDG client pinned `PG_MAJOR=17`; two custom-format dumps per ADR §7; `umask 077`; passphrase piped via the `printf` builtin (not in argv); AES256 symmetric; plaintext removed before upload; only size logged; `permissions: contents: read`; 14-day retention; no `set -x`, URL never echoed |
| M1-09 F2 | meets | `SYNC_RECHECK_MAX` parsed; `recheck_capped` guard reason; errored keys carried forward with `STAGING_COLUMNS` identical to `catalog_staging` (`init.sql:89-111`) |
| M1-10 TRUSTED_PROXY | meets | regex-validated enum; auto-detect `VERCEL=1`/`NETLIFY=true`; boot fails in live production outside the build phase (`env.ts:251-264`); `clientIp` reads only the edge's header, `xff-N` from the right, `none` → `shared`, missing → `unknown` (never a per-request free key); forwarded host/proto ignored under `none` (`http.ts:15-19,126-135`, `cookies.ts:17-25`) |
| M1-11 confirm email | meets | adapter returns `null` without a session, still maps empty identities to `email_taken` (`supabase.ts:162-167`); route 202 without a cookie; `AuthForm` "Check your inbox" view (mounted with `key={view}`, so "Back to sign in" resets it) |
| M1-12 set password | meets | `assertSameOrigin` + JSON-only `parseBody` (CSRF), `requireSession`, per-user 5/10 min, reauth from newest JWT `amr` timestamp (Supabase) / cookie `iat` issued only by `startSession` (demo); unknown time → reauth; form: label, hint + error in `aria-describedby`, `aria-invalid`, alert + status regions, show/hide with `aria-pressed` |
| M1-13 magic-link per email | meets | key = SHA-256 of trimmed lower-cased email, 5/h, consumed for every address before the provider call, so the 429 says nothing about existence |
| M1-14 privacy copy | meets | `/about`: where data lives, immediate deletion, backups ≤ 14 days |
| M1-15 | not in diff | waits for the founder's logo (expected) |
| M1-16/17 | partly | only the harness change is here (`playwright.config.ts` `E2E_REUSE_SERVER`); `e2e/ops.spec.ts` and the staging smoke are QA's |

## M1.3 Not flagged (checked)

- **Spoofing:** under `vercel` a client-sent `X-Forwarded-For` prefix is ignored when `x-real-ip` is present, and `xff-N` counts from the right
  (`rate-limit.test.ts:81-99`). `assertSameOrigin` still compares against the host the edge sets.
- **Limiter eviction bypass:** per-IP keys are touched on every request, including rejected ones, before any per-email key is created. An
  over-limit IP therefore can't flood the LRU to evict itself (Inferred from `magic-link/route.ts:22-34`).
- **Inbox lock-out:** anyone can spend a victim's 5 magic links per hour. This is inherent to ID-5 as specified (accepted by the ADR, not a defect).
- **Supabase `amr` refresh:** auth-js lists no `token_refresh` method (`node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:315`), so a token
  refresh should not reset the 10-minute window. This is Inferred, not proven against live GoTrue. **Unverified → M1-17**.
- **Degraded slug:** `summaryFromDetail` uses `slugify(title)`, the same function discover uses (`discover.ts:157`). A TMDB rename during an
  outage could 308 to the new slug. That is cosmetic and below threshold.
- **Degrade logging:** the `getMany` fallback (`dal.ts:104`) does not log, although ADR §4 says every fallback logs. This is below threshold (no
  user impact, and it only fires when `getEntry` already logged or the DB is partly up).
- **Not reportable:** `Reviews` F4 still miscounts when your own review isn't on the loaded first page. That is pre-existing family R10 and cosmetic.
- **Backup restore (Unverified):** `session_replication_role` on Supabase's `postgres` role is flagged by the ADR itself and needs the M1-17 rehearsal.
  `NETLIFY`/`VERCEL` availability at function runtime is also Unverified. If they are missing, boot fails loudly, which is fail-safe.

## M1.4 Verifier checklist

- [x] Read every judged file in full or at the hunk plus its callers: routes, `http.ts`, `rate-limit.ts`, `env.ts`, `health.ts`, `dal.ts`, `degraded.ts`,
  `tmdb.ts` detail path, auth adapters, sync script/runner/discover/imdb, migration + `init.sql` dependencies, workflows, and the frontend components.
- [x] Callers checked: `AuthResponse` consumers (`AuthForm` only), `limitFor`/`clientIp` call sites (typecheck), `dal.getTitle` (title page only), `proxy.ts` → `isSecureRequest`.
- [x] Project rules: WORK_SPLIT §5 frozen-file waiver respected (frontend commit `d0998fd` touched only `src/app/**` pages/css and `src/components/**`).
  AppProvider not touched. No new dependency.
- [x] Memory: `.clearpath/hot.md` read; its M1 claims were checked against the live diff.
- [x] Git history: the XFF first-hop trust (`d55b289`, "cookie/CSP hardening") is superseded on purpose by ADR-001 §A3. No other past decision is contradicted.
- [x] No speculative code in the fix (one branch, one test).
- [x] Security, validation, a11y and data safety intact. The fix shows server-authored copy only.
- [x] Gate: see M1.5.

## M1.5 Gate

`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` → all green (53 files, 338 tests; build and format clean).
`npm run test:e2e` (UI file touched; `E2E_PORT=3247`) → 169 passed, 5 skipped, 0 failed (6.0m). Then `git checkout -- docs/06-qa/screenshots`.

**Rollback:** `git checkout -- src/components/SetPasswordForm.tsx src/components/SetPasswordForm.test.tsx docs/08-clearpath/CODE_REVIEW.md`.

**Verdict: SHIP** (M1 code). There are no critical, high or medium findings, and the one low finding is fixed. Open before launch, outside code review: M1-15 logo,
M1-16/17 QA work (live amr refresh, spoofed-XFF, restore rehearsal), and the AppProvider §6a founder decision.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=unchanged · unverified=live GoTrue amr on refresh, restore with session_replication_role, VERCEL/NETLIFY runtime detection, live health probe latency

---

# Where to watch review (a1b98af^..92b871d)

Scope (Observed, `git diff --stat d9c964a 92b871d -- src scripts supabase tests .github`): 62 files. Judged: `src/lib/provider-links.ts`, `src/server/region.ts`,
`src/server/watch.ts`, `src/server/jobs/watch-map.ts`, `src/server/jobs/watch-refresh.ts`, `scripts/sync-catalog.ts` (enrich + watch steps),
`supabase/migrations/20260928120000_where_to_watch.sql`, both new routes, the signin and `/auth/callback` hunks, `dal.ts`, `http.ts`, `rate-limit.ts`,
`env.ts` (`parseWatchConfig`), the Supabase and memory settings/provider repos, export, `WhereToWatch.tsx`, `ProviderTile.tsx`, `WatchRegionSelect.tsx`,
the title page, About and Settings. Fixtures JSON were only sanity-checked (`tests/server/fixtures/tmdb-watch-providers.json`, small by design). Skipped: docs/, screenshots,
`e2e/` (QA is writing it), and `src/components/AppProvider.tsx` (frontend is fixing it).
Rules: ADR-012, API_CONTRACT v1.5 §5.21/§5.22, PRD §13 W1–W8, DESIGN §7.4.2, ADR-010 ID-6, ADR-001 §A3, and the `sync-runner.ts:7` failure rule.

## Findings (confidence ≥ 80)

| id | sev | category | file:line | evidence | conf | recommendation | status |
|---|---|---|---|---|---|---|---|
| WTW-1 | high | reliability / data | `supabase/migrations/20260928120000_where_to_watch.sql:22-23` (was), `:99` | **Observed:** `pg_column_size(watch) <= 4096`. **Observed (PGlite measure):** 10 regions × 33 ids (s4 a2 r12 b15) come to 4628 B, about 14 B per id; the mapper's own cap (`watch-map.ts:32`, 30 × 5 types × 10 regions) is ~19 KB. **Observed:** a violating row raises 23514 for the whole `catalog_set_watch` batch of 200. `rpc()` throws (`sync-catalog.ts:215-218`), and `sync-runner.ts:7` says "a thrown error ends the run `failed` and skips the remaining steps". The title stays due and first in order, so it recurs every night. That means no IMDb, palettes, purge or revalidate. **Inferred:** well-covered titles (DE/US/FR rent+buy lists) reach it. ADR §3's ~200 B median estimate is low. | 85 | Raise the cap to 32 KB. The RPC skips any row over the cap, so it can't fail the batch. | **Fixed:** migration `:22-25` and `:99-103` (unapplied per `.clearpath/hot.md`, so edited in place). New test `tests/db/watch.test.ts` "a realistic 10-region payload (> 4 KB) is stored; an oversized row is skipped, not fatal". It fails on the old cap. The existing constraint test now uses 10 000 ids. |
| WTW-2 | medium | project rule / privacy | `src/app/about/page.tsx:111` (was) | Rule ADR-010 ID-6: "Privacy wording: what we store". **Observed:** the copy said "We store your email, handle, stubs, ratings, reviews and watchlist. That's it." But v1.5 stores `user_settings.watch_region` (migration `:50-54`) and sets the `stubbed_region` cookie for everyone (`region.ts:333-336`). | 90 | Disclose the saved country and the cookie, and add "settings" to the deletion line. | **Fixed:** `src/app/about/page.tsx`. New test `src/app/about/page.test.tsx`. |

No other findings ≥ 80.

## Architecture calls

1. **Title page reads `?region=` (ADR-012 §5.1 said API only): ACCEPTED.** Observed: `page.tsx` `pageRegion()` normalises with `normalizeRegionCode`, and an unsupported code
   gets `fallback: true`. The page is `force-dynamic`, so its HTML is `private, no-store` and never stored by a shared cache. `Vary` is therefore moot. Only the public
   `/api/.../watch` needs URL keying, and it has that (`watch/route.ts` reads no cookie or header, and `watch-routes.test.ts:104-108` asserts `public` with no `Vary`).
   SEO: `alternates.canonical: titleHref(t)` has no query, so `?region=` variants fold into one canonical URL, with no duplicate-content risk. Recorded as ADR-012 Amendment 1.1.
2. **`setWatchRegion` when signed out: ACCEPTED.** Observed: `watch-region/route.ts:33-35`. Signed out, it writes the cookie only. `requestCookieJar` sets
   `HttpOnly; SameSite=Lax; Path=/; Secure` per `isSecureRequest` and `Max-Age=31536000` (`cookies.ts:29-35`, `region.ts:223`). The value is strictly `^[A-Z]{2}$`. No server row,
   no identifier, not script-readable. It is a functional preference as W3-AC3 intends, not tracking. Disclosure was missing, which is WTW-2 (fixed). Recorded as Amendment 1.2.

## Not flagged (checked)

- Links (Observed): every `href` comes from `providerHref`/`tmdbWatchHref` on the server (`watch.ts:86,95`). The upstream `link` is only compared, never stored or rendered (`watch-map.ts:126-140`).
  Checks: https only, no credentials or port, exact host allowlist, banned-key regex, `encodeURIComponent`, and dot-segment reject (`provider-links.ts:140-184`). Hostile titles are tested.
  All anchors use `target=_blank rel="noopener noreferrer"` (`ProviderTile.tsx`, `WhereToWatch.tsx:207-225`). There is no redirect route. `trackEvent` is fire-and-forget.
- Region: the geo header is honoured only if `WATCH_GEO_HEADER` is set and `TRUSTED_PROXY≠none` (`region.ts:247`). Placeholders are dropped. Accept-Language parsing is bounded
  (1000 chars / 10 entries), q-sorted and stable. Invalid query gets zod 400; an unsupported region gets fallback. Env is boot-validated (`parseWatchConfig`).
- Caching: the cached layers hold region-agnostic `watch` only, and the block is built per request (`dal.ts` `watchBlock`). `PUT` is `private, no-store` + `Vary: Cookie` (`http.ts:32-36`).
  The provider directory is a cookie-less anon client.
- Migration: `user_settings` has owner-only select/insert/update, nothing for anon, and column grants. `user_settings_set_watch_region` is SECURITY INVOKER with an `auth.uid()` guard, and execute
  is revoked from public/anon. The job RPCs are security definer with `search_path` set, and execute is revoked (PGlite tests pass).
- Nightly: a missing or malformed append gives `null`, which is not written and is counted `watch_missing`. A failed fetch leaves stored data alone. Dry run makes 0 calls because the client is never built.
  A partial provider-list failure keeps the old priorities. The budget accounts for enriched ids.
- Export includes `settings.watchRegion`. Account delete cascades from `auth.users`, and the demo mirror filters `settings`.
- a11y: text group headings, tile names "Open X (type) — opens in a new tab", `alt=""` logos, native `<select>` with aria-label, `aria-busy`, and focus moves to the first revealed tile on "+N".
- Out of scope / not reportable: sign-out leaves the `stubbed_region` cookie (functional, same as signed-out behaviour). A title still over 32 KB is re-fetched nightly
  (ceiling: 1 call per such title; upgrade trigger: `catalog_set_watch` count < rows sent).

## Verifier checklist

- [x] Read every judged file (hunks + callers: `rpc()`, `sync-runner.ts`, `requestCookieJar`, `json()`, `titleHref` canonical).
- [x] Project rules quoted (ADR-010 ID-6, ADR-012 §3/§5/§6.2/§7/§10, sync-runner rule).
- [x] Memory: `.clearpath/hot.md` said "migration not applied" and flagged the `?region=` deviation. Both were checked against live files and `supabase/migrations/`.
- [x] Git history: `f7adc9e` (ADR-012) set the 4 KB cap and "API only". Both are amended in writing, not silently overridden.
- [x] No speculative code: one SQL predicate, one constant, copy lines, two tests.
- [x] Security, validation, a11y and data safety intact.
- [x] Gate run (below).

## Gate

`npm run lint && npm run typecheck && npm test && npm run build`: green (64 files, 535 tests; build compiled).
`npm run format:check`: fails **only** on `e2e/where-to-watch.spec.ts` (QA's in-progress file, SyntaxError at 14:11, off-limits to this review). Every file this review touched is Prettier-clean.
E2E not run (QA owns W-20). Migration not applied to any live project, which is gated (needs founder approval).

**Rollback:** `git checkout -- supabase/migrations/20260928120000_where_to_watch.sql tests/db/watch.test.ts src/app/about/page.tsx docs/04-architecture/ADR-012-where-to-watch.md docs/08-clearpath/CODE_REVIEW.md && rm src/app/about/page.test.tsx`.

**Verdict: SHIP** (after the fixes above). WTW-1 (high) and WTW-2 (medium) are fixed and tested. Open items: QA's e2e spec must parse and be formatted before the full gate is green, W2-AC5 device check, and applying the migration.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=unchanged · unverified=real TMDB payload sizes (measured synthetic only), live Postgres TOAST behaviour vs PGlite, W2-AC5 link templates, e2e (QA)

---

# Close-out review (2026-10-04)

**Scope (Observed, `git diff --stat b4287cd..HEAD -- src scripts supabase .github e2e-live`):** 175 files. Excluded: `docs/`, `e2e/` (QA editing), screenshots, fixtures JSON, `src/og/fonts/*` (binary + licence). Backend/launch-kit security was covered in `docs/09-closeout/SECURITY_REVIEW.md`. This pass covers frontend + route handlers, plus a correctness pass over the whole diff.

**Rules applied:** ADR-013 C-03 (404/308 before any Suspense boundary), C-08 (share images: no note/review text, no Set-Cookie, no fetch at render), arch review R1 ("one canonical URL per content version", `src/server/share-cache.ts:1-15`), AGENTS.md ("read `node_modules/next/dist/docs/` before writing code"). For the file-metadata rule: `generate-metadata.md:114` says "File-based metadata has the higher priority and will override the `metadata` object and `generateMetadata` function".

## Findings

| id | severity | category | file | line | evidence | confidence | recommendation | status |
|---|---|---|---|---|---|---|---|---|
| CR-CO-1 | medium | bug (SEO/sharing) | `src/server/share-cache.ts` / `src/proxy.ts` | share-cache.ts:62-72 (pre-fix), proxy.ts:23-29 | **Observed:** every page's `og:image` was Next's file-convention URL `…/opengraph-image?<contenthash>`. In the build output this is `url:f+"?1adcf28b8130d06b"`, and `next-metadata-image-loader.js:64` builds it as `hashQuery = '?' + contentHash`. `shareImageRedirect` 308s any search that isn't `?v=<version>`, and the old unit test asserted that `?0123456789abcdef` redirects. So every crawler og:image fetch cost a 308. **Inferred:** crawlers that don't follow og:image redirects show no card. Next's hash can't be accepted without reopening R1 (any 16-hex value would force a render). Because file-based metadata overrides `generateMetadata`, the convention had to go. | 95 | Turn both og images into route handlers at the same path, and have `generateMetadata` emit `canonicalOgImage()` (the exact `?v=` URL). Also accept the previous bucket's `v`, so a URL emitted just before a rollover still returns 200. | **fixed** |

No other findings ≥ 80.

### Fix (CR-CO-1): 6 files, about 90 lines; rollback = `git checkout` of the files below + `git mv` the two routes back
- `src/app/title/[type]/[slug]/opengraph-image.tsx` → `opengraph-image/route.tsx`, and `src/app/share/stub/[id]/opengraph-image.tsx` → `opengraph-image/route.tsx`. Each is now a `GET` handler. A non-canonical query gets a 308 before any render (same guard as `story/route.tsx`). Unknown title or stub → 404 `private, no-store`. Cache-Control is unchanged.
- `src/server/share-cache.ts`: new `canonicalOgImage(pagePath, kind)`, `redirectImage`, `notFoundImage`. The previous bucket is accepted, so renders stay bounded (at most 2 keys per version window). The stub 10-min deletion ceiling still holds because every render re-reads the stub.
- `src/app/title/[type]/[slug]/page.tsx` and `src/app/share/stub/[id]/page.tsx`: `openGraph.images = [{ url: canonicalOgImage(...), 1200×630, image/png, alt }]`. Twitter inherits it.
- Tests (`src/og/share-images.test.tsx`, +3): (1) the metadata URL equals `…/opengraph-image?v=<shareVersion>` for both pages, the proxy passes it (`x-middleware-next: 1`), and the route returns 200; (2) the previous bucket is accepted and anything older is redirected; (3) the og routes themselves 308 junk and 404 unknown stubs.
- **Observed on a production build** (`next start`, DEMO_MODE_PUBLIC): the title page emits `og:image` and `twitter:image` = `…/opengraph-image?v=dev-20730`, and that URL returns `200 image/png` with `immutable`. The stub landing og URL returns `200 image/png`. Unknown title → 404. The old `?1adcf28b8130d06b` URL still 308s, as intended.

### Checked, no finding ≥ 80 (Observed)
- Title + profile pages: existence and slug/handle-case 308 run before `<Suspense>` (`title/[type]/[slug]/page.tsx:114-124`, `u/[handle]/page.tsx:58-66`). The removed root `loading.tsx` no longer turns 404s into streamed 200s.
- `ShareButton`/`share.ts`: URLs are built from `NEXT_PUBLIC_SITE_URL` (only when it is `http(s)`) or `location.origin`, plus app-built paths. The payload carries title, year and rating only.
- `ImportFlow` + `src/lib/import/*`: file-size cap before reading. ZIP limits are enforced while streaming (entries, per-entry bytes, total bytes). Encryption and zip64 are rejected. All untrusted text renders as React text (no `dangerouslySetInnerHTML` anywhere in the diff).
- `ProviderFilter`/`parseBrowse`: `provider` must match `^[1-9]\d{0,8}$` and is re-serialised with `URLSearchParams`.

### Out of scope / noted for QA (not a code finding)
- **Observed:** `e2e/share.spec.ts:216-217` expects `GET ${base}/opengraph-image` with `maxRedirects: 0` → 404 after delete. A bare URL gets a 308 by design (R1; true before this fix too). QA should request `canonicalOgImage(...)` or follow redirects. I did not edit `e2e/`.

## Verifier checklist
- [x] Read every changed or judged file, plus callers (`proxy.ts`, `story/route.tsx`, both pages, `next.config.ts` tracing key, which is unchanged because the route path is the same).
- [x] Rules quoted (R1, C-03, C-08, Next metadata priority).
- [x] Git history: R1 canonical keys came in `3c23771`. This fix keeps its invariant: query strings still can't force unbounded renders.
- [x] No speculative code. Safety intact: no cookies on image routes, 404 `no-store`.
- [x] Gate run (below).

## Gate
`npm run lint` pass · `npm run typecheck` pass · `npm test` 83 files / 718 tests pass · `npm run build` pass · `npm run format:check` pass. E2E not run (QA owns it).

**Verdict: SHIP.** CR-CO-1 is fixed and tested. Open: the QA e2e expectation above.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=unchanged · unverified=real social crawler behaviour on 308 (inferred from the ticket), live Vercel CDN keying, e2e (QA)
