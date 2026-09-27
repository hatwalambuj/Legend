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
