# Security review: close-out diff (ADR-013)

Reviewer: security-reviewer (ClearPath deterministic review, threshold 80).
Scope: `git diff b4287cd..HEAD -- src/server src/app/api src/lib src/og scripts supabase .github e2e-live playwright.live.config.ts .env.example`, reviewed at HEAD `6e1754f` (which already holds the SR-1 and SR-2 fixes from the interrupted first pass). Out of scope: `src/components`, `src/app` pages and `src/hooks`, which the frontend agent was still editing.

## Verdict: SHIP (for this scope)

Two findings were at confidence 80 or higher. Both are fixed and covered by regression tests. No open findings at 80 or higher.

## Findings (severity order)

| id | severity | category | file:line | evidence | confidence | recommendation | status |
|---|---|---|---|---|---|---|---|
| SR-1 | medium | availability / unbounded storage | `supabase/migrations/20261003094000_events.sql:21`, `src/app/api/events/route.ts:16` | Observed: `POST /api/events` is anonymous. `provider_clicked` dims hold a region and provider id chosen by the client (`src/lib/analytics.ts:40`). The original `events_track` inserted every new `(day, name, dim)` row. The per-IP limiter is in memory and per instance, so it did not bound table growth. On the free tier, database size is an availability limit. | 85 | Cap the new distinct rows created per UTC day. Rows that already exist keep counting. | **Fixed**: `supabase/migrations/20261003096000_events_dim_cap.sql` (at most 1,000 new rows per day). The demo store mirrors it (`src/server/repositories/memory/user-data.ts:677`). Tests: `tests/db/closeout.test.ts:267` and `tests/server/closeout-routes.test.ts:424`. |
| SR-2 | medium | secret exposure (CI artifact) | `e2e-live/smoke.spec.ts:74` (pre-fix), `playwright.live.config.ts:23` | Observed: the TMDB check used `playwright.request.newContext({ extraHTTPHeaders: { Authorization: Bearer … } })`, which put `api_key` in `params`. With `trace: 'retain-on-failure'`, Playwright traces record request headers and queries. `smoke-live.yml` uploads `test-results-live` as an artifact that is kept for 30 days. | 85 | Make secret-bearing calls with plain `fetch`, outside any traced request context. Never echo the URL. | **Fixed**: `e2e-live/smoke.spec.ts:74-104` now uses `fetch` and reports only the status. Guard test: `scripts/lib/live-smoke-guard.test.ts`. |

## Surfaces checked with no finding at 80 or higher (Observed)

- **/api/events**: same-origin check, an 8 KB cap via `readBodyCapped` (checks the declared length and the streamed size), at most 20 events, names from the client allowlist plus a regex for each dim, and `Sec-GPC` / `ANALYTICS_ENABLED` turn it off. The limiter key is a salted in-memory SHA-256 (`src/server/rate-limit.ts` `ipKey`). Only `{day,name,dim,count}` is stored. The table and the RPCs are revoked from anon and authenticated, and `security definer` functions set `search_path`.
- **/api/log**: 4 KB cap, a 10/min per-IP limit and a 300/min per-process limit, every field `redact()`ed (emails, JWTs, `sb-*` cookies, bearer tokens and URL queries; secret-named keys are dropped). The path has its query stripped, only the UA family is logged, and log lines are written with `JSON.stringify`, so newlines can't be injected. Nothing is echoed back (204).
- **Imports**: preview cap of 20k rows / 4 MB with 20 previews per user per hour. Commit cap of 1,000 rows / 1 MB, re-matched on the server against the catalogue only (no outbound call). There is a 24 h stub budget in both the app and SQL. `import_apply` is `security invoker` with RLS, `auth.uid()` and EXECUTE revoked from anon. The `stubbed.bulk_import` GUC is set only inside the function, and a direct insert can't fake `source`/`import_key` (test at `tests/db/closeout.test.ts:349`).
- **Share / OG**: `getStubShare` is limited to a UUID and picks explicit fields (no note, review body or spoiler text) (`src/server/dal.ts:195-233`). Share text never carries user content (`src/lib/share.ts`). `loadPosterDataUrl` uses a fixed host (`image.tmdb.org`), a strict path regex `^/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$`, a 1.5 s timeout, a 1.5 MB streamed cap and an image MIME check, and it is off in demo mode. No SSRF path found.
- **getClaims** (`src/server/auth/supabase.ts:170`): verified claims, no `sub` gives null, and a missing profile gives null. There is no fallback to unverified `getSession()`.
- **Migrations**: every new `security definer` function has `set search_path = public` and has EXECUTE revoked from public/anon/authenticated. `avatar_color` is a CHECK allowlist with column grants, and the handle stays immutable. The read RPCs granted to anon are `security invoker` and stable.
- **Launch kit**: `db-apply` keeps the password in `PGPASSWORD` (not argv) and masks it in errors. Migration names are regex-validated before any SQL is interpolated, and the tool refuses edited or out-of-order files. The workflows are `workflow_dispatch` only with `permissions: contents: read`, `environment: production`, no `pull_request_target`, and inputs passed through `env`, so no secrets reach forks. The smoke account is deleted in `finally`.
- **Input validation**: region `^[A-Za-z]{2}$` is normalised and checked against config, provider is a positive int32, and `avatarColor` is a `z.enum` in both the app and the DB.
- **Founder constraints**: no third-party tracker, error service or AI SDK in scope (`SENTRY_DSN` was removed from `.env.example`, and `launch-check` names it only as a legacy key).

## Below threshold (recorded, not reported)

- CSV formula injection on export (`=`/`+`/`-`/`@` cells): the `csvCell` code was already there before this diff, it only exports the user's own data, and adding a prefix would break the Letterboxd round-trip. Confidence about 40.
- Import reviews skip the 10/min review limit. They are bounded at one per (user, title) by the catalogue size, which is a similar daily volume to the app path. Commit has no limit per request beyond the stub budget (authenticated, 1,000-row cap). Confidence about 60. Upgrade trigger: review spam seen in moderation.
- `getClaims` with asymmetric keys accepts a signed-out JWT until it expires. This is an accepted ADR-013 C-05 trade-off.

## Gate (run at HEAD plus the frontend's uncommitted work)

- lint: pass. typecheck (`tsc --noEmit`): pass. build: pass.
- test: 665/667 on the first run. Two failures were in the frontend's in-progress `ProviderFilter` test. A re-run passed. The SR-1/SR-2 suites passed 33/33.
- format:check: **fails on frontend files only** (`src/components/Reviews.test.tsx`, `ShareButton.tsx`, `StubSheet.test.tsx`). No file in this scope is affected.

— clearpath: mode=review · evidence=labeled · verify=SHIP
   memory=unchanged · unverified=OG/story route handlers under src/app (FE-owned, not in scope); live Supabase getClaims JWKS behaviour
