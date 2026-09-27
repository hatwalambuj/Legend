# ADR-011: Operations on free tiers (sync job, health, degradation, keep-alive, backups)

Status: **Accepted** · Date: 2026-09-27 · Decider: Architect (final call)
Inputs: ARCH_REVIEW AR-1, AR-2, AR-3, AR-4, AR-6; CODE_REVIEW F1, F2; NEXT_PHASE_PLAN L-3…L-6, L-10, L-11, E-H1, E-H2; ADR-001 Amendment A.
Amends: ADR-002 §1 (abort scope), ADR-008 §3 (dry-run headroom), SYSTEM_DESIGN §13/§14 (health, Supabase down).
Constraint: **$0**, and every mechanism here must work on the primary stack (Supabase Free + Vercel Hobby + GitHub Actions) and on
the ADR-001 §A2 alternates without code changes.

This ADR is an **implementation spec for backend-dev** (and the listed frontend-dev/qa-engineer parts). Task ids (M1-xx) match
WORK_SPLIT §5.

## 1. Dry run spends no budget (AR-1 → M1-01)

**Observed:** `--dry-run` skips writes but still makes up to `OMDB_DAILY_BUDGET` (900) OMDb calls and up to `SYNC_ENRICH_MAX`
(3,000) TMDB detail calls (`scripts/sync-catalog.ts:209-258`), and discover's recheck makes up to 500 more.

**Rule:** a dry run makes **0 OMDb calls, 0 TMDB detail calls, 0 image fetches and 0 database writes.** Exactly this is allowed:

| Step | Allowed in `--dry-run` | Not allowed | Printed |
|---|---|---|---|
| discover | TMDB `/genre/{movie,tv}/list` (2 calls) and `/discover/*` pages (throttled as today). TMDB has no daily quota, only a rate limit, and these calls are the point of a dry run (per-type counts to set the floors, README first-sync recipe). Supabase `select` of listed keys and last `ok` runs | `recheckMissing` detail calls; staging upserts; `catalog_apply_staging`; marking `gone` | `listed` per type, `missing` (= would be re-checked), guard report computed with missing titles **counted as still listed** (upper bound) and again as unlisted (lower bound); `GUARD: pass/fail` |
| enrich | `rpc('catalog_enrich_due')` (a `stable` SQL function, read-only) | any TMDB `/movie/{id}` or `/tv/{id}` call; `catalog_set_enrichment` | `due` |
| imdb | `rpc('catalog_imdb_due', { p_limit: OMDB_DAILY_BUDGET })` (read-only) | any OMDb call; `catalog_set_imdb` | `due`, split into never-checked / hot / rest if cheap to compute, else just `due` |
| palettes | the existing `select` of rows needing a palette | poster downloads, `sharp`, updates | `due` |
| disagreements | read-only report (as today) | — | report |
| purge, revalidate | nothing | `catalog_purge_stale`, `POST /api/revalidate` | `skipped: dry_run` |
| bookkeeping | nothing | `sync_runs` insert/update | — |

- Exit code: `0` when the guard passes, `1` when it fails (still no writes).
- `--from-fixtures --dry-run` stays as it is (no network at all).
- `--only=<step> --dry-run` applies the same table to that step.
- **Implementation shape:** the step functions take `dryRun` and return **before** constructing `TmdbDetailProvider` /
  `OmdbRatingProvider` calls. `refreshImdbRatings` (`src/server/jobs/imdb-refresh.ts`) gets an option `{ dryRun }` that returns
  `{ due, dry_run: true }` without calling `lookup`. `recheckMissing` gets `{ dryRun }` that returns
  `{ rows: [], gone: [], skipped: missing.length, errors: 0, dryRun: true }` without calling `detail`.
- **Tests** (`tests/server/sync-dry-run.test.ts`): counting fakes prove `lookup` = 0, TMDB detail = 0, `detail` in recheck = 0,
  and a fake DB records 0 write calls, for the full run and for each `--only`.
- **Docs:** README "First sync" says "a dry run reads TMDB discover pages and the database, and spends no OMDb or enrich budget;
  it writes nothing". ADR-008 §3's "100 calls of headroom" holds again.

## 2. A guard abort blocks only discover/apply (AR-2 → M1-02)

**Observed:** on a guard failure `main()` calls `finish('aborted')` and returns before enrich, IMDb, palettes and purge
(`scripts/sync-catalog.ts:514-521`).

**Rule:** the guard protects the **index membership** (which titles are listed). It does not protect the steps that only work on
rows already in `catalog_index`. New order in the orchestrator:

1. `discover` → if the guard fails: do **not** stage, apply or mark `gone`; record `counts.discover = { …summary, aborted: reasons }`;
   set `aborted = true`; **continue**.
2. `enrich`, `imdb`, `palettes`, `disagreements`, `purge` run on the existing index exactly as on a good night.
3. `revalidate(['catalog'])` runs if any step changed data (enrich/imdb/palettes wrote ≥ 1 row), so fresh IMDb chips appear.
4. `finish(aborted ? 'aborted' : 'ok', aborted ? reasons.join('; ') : undefined)`; `process.exitCode = aborted ? 1 : 0`.
   The workflow still fails loudly (GitHub failure email), and `/api/health` turns `degraded` after 36 h because an
   `aborted` run is not a full sync (§3, F1).
- A thrown error in any step keeps today's behaviour: `finish('failed')`, rethrow (exit 1), later steps skipped.
- `purge` after an abort is safe: it only removes **unlisted**, unreferenced rows past their age (`init.sql:597-608`); listed rows
  are never purged.
- **Implementation shape:** move the orchestration out of `main()` into `src/server/jobs/sync-runner.ts`:
  `runSync(steps: SyncSteps, args: { dryRun: boolean; only: Step | null }): Promise<{ status: 'ok' | 'aborted'; counts }>`,
  where `SyncSteps` are injected functions (`discover`, `enrich`, `imdb`, `palettes`, `disagreements`, `purge`, `revalidate`,
  `startRun`, `finishRun`). `scripts/sync-catalog.ts` keeps the Supabase/TMDB/OMDb wiring and calls `runSync`.
- **Tests** (`tests/server/sync-runner.test.ts`): (a) guard fail → enrich/imdb/palettes/purge each called once, apply not called,
  `finishRun('aborted', …)`, result status `aborted`; (b) guard pass → `ok`; (c) step throws → `failed`, later steps not called;
  (d) dry run → `startRun`/`finishRun`/`purge`/`revalidate` not called.

## 3. `/api/health` contract (AR-3 + F1 → M1-03, M1-04)

**Observed:** always `ok: true`, and its reads go through the 1 h data cache (`src/app/api/health/route.ts:11-16`,
`src/server/supabase/server.ts:66-72`). `last_catalog_sync()` counts any `ok` run, including `--only=imdb` runs (`init.sql:440-443`).

### 3.1 Behaviour

| Mode / condition | HTTP | `status` | `checks` | `reasons` |
|---|---|---|---|---|
| Demo (any) | 200 | `ok` | `{ db: 'skipped', sync: 'skipped' }` | `[]` |
| Live, probe fails or takes > 3 s | **503** | `down` | `{ db: 'fail', sync: 'unknown' }` | `['db_unreachable']` |
| Live, no full sync ever | 200 (503 with `?strict=1`) | `degraded` | `{ db: 'ok', sync: 'never' }` | `['sync_never']` |
| Live, last full sync older than `HEALTH_MAX_SYNC_AGE_HOURS` (default 36) | 200 (503 with `?strict=1`) | `degraded` | `{ db: 'ok', sync: 'stale' }` | `['sync_stale']` |
| Live, `catalogCount = 0` | 200 (503 with `?strict=1`) | `degraded` | db ok | `['catalog_empty']` (can combine) |
| Live, all good | 200 | `ok` | `{ db: 'ok', sync: 'ok' }` | `[]` |

- **Full sync** = a `sync_runs` row with `kind='catalog'`, `status='ok'` and `counts ? 'discover'` whose discover part has an
  `applied` key (F1, §9). Aborted, failed, dry and single-step runs do not count.
- **No caching at any layer:** the route keeps `export const dynamic = 'force-dynamic'`; the probe uses the **uncached** public
  client (`supabasePublic()`, not `supabaseCatalog()`); response `Cache-Control: no-store`. It never reads cookies and never
  sets them.
- `GET` and `HEAD` (same status, no body; some free monitors send `HEAD`).
- `?strict=1` exists so one monitor can alert on "site down" (default) and a second on "sync stale" (strict), without the
  default endpoint flapping for Playwright's `webServer` check (demo mode is always 200).
- Timeout: the probe is aborted after 3,000 ms (`AbortSignal.timeout(3000)` on the RPC), so a hung DB returns 503 in < 5 s.
- Abuse: per-IP limit 60/min in memory (`TRUSTED_PROXY` key) → `429`. One cheap RPC per call otherwise.
- The body contains no error messages, hostnames or stack traces; failures are logged server-side only (`console.error`
  with the error code, never the connection string).

### 3.2 Implementation shape
- New migration (§9) adds `public.health_probe()` → `jsonb { catalog_count, last_full_sync_at }`, `security definer`, `stable`,
  `grant execute … to anon, authenticated`.
- Port: add `CatalogRepository.probe(opts: { timeoutMs: number }): Promise<{ catalogCount: number; lastFullSyncAt: string | null }>`
  (`src/server/ports.ts`); Supabase impl calls `rpc('health_probe')` on `supabasePublic()` with `.abortSignal(...)`; memory impl
  returns fixture count and `null`.
- `lastSyncAt()` (used elsewhere) switches to the fixed `last_catalog_sync()` (§9) so both agree.
- Response type in API_CONTRACT §5.1 (v1.4).
- **Tests:** `src/app/api/health/route.test.ts` or `tests/server/health.test.ts` with a fake container: probe throws → 503
  `down`; probe hangs → 503 within 3.5 s (fake timers); stale → 200 `degraded`, strict → 503; demo → 200 `ok`; header
  `no-store`. DB test (`tests/db/migrations.test.ts`): `health_probe` ignores `aborted`, `--only` and dry rows; anon can execute.

## 4. Title pages degrade when Supabase is down (AR-4 → M1-05, M1-06)

**Observed:** `getTitle` awaits `catalog.getEntry` and `titleStates.stats` with no fallback (`src/server/dal.ts:28-49`); the
root layout is `force-dynamic` (`src/app/layout.tsx:15`) and there is no CDN layer on Vercel Hobby by default, so any DB error
reaches `error.tsx`.

**Chosen approach (free on every host): a layered fallback inside the DAL, with a banner.** ISR/`'use cache'` for `/title/*` is
the Stage-1 lever (ADR-001) but is not taken in M1 because it changes caching for a parallel team late in the phase.

`dal.getTitle(mediaType, tmdbId)`:
1. `entry = await catalog.getEntry(...)`.
   - returns `null` → `null` (404, as today).
   - **throws** (any non-`not_found` error) → `degraded = 'catalog'`, then:
     a. **last-good entry**: an in-process LRU (1,000 entries, filled on every successful `getEntry`) in
        `src/server/degraded.ts`. On serverless this is per instance and may be empty; that is acceptable.
     b. else **TMDB-derived entry**: `detail.getDetail(mediaType, tmdbId)` (TMDB, its own 24 h data cache, independent of
        Supabase) mapped by a new pure function `summaryFromDetail(mediaType, tmdbId, detail, rule)` in `src/server/degraded.ts`:
        `isListed` from `isListed()` in `src/lib/curation.ts`, `palette: null` (genre tint), `imdbRating/imdbVotes: null` (chip
        hidden, ADR-008 rule), enrichment fields empty.
     c. TMDB returns `null` → `null` (404). TMDB also fails → throw `AppError('upstream_unavailable')` → `error.tsx`.
2. `stats` → on throw: zero stats (the same shape `index_only` titles get) and `degraded = degraded ?? 'community'`.
3. `recommended` (`catalog.getMany`) → on throw: empty map.
4. `loadDetail` keeps its current TMDB fallback.
5. Return `TitleDetail` with a new field **`degraded: null | 'community' | 'catalog'`** (API_CONTRACT §1a v1.4).
   `worthIt` is still built (it tolerates zero stats and empty enrichment).
- Every fallback logs one `console.error('[dal.getTitle] degraded', { key, degraded, code })`. No PII.
- Profile, diary and settings pages are **not** degraded in M1: they show `error.tsx` with the `upstream_unavailable` copy.
  Home and browse likewise (browse without the index would be misleading).

Frontend (M1-06): when `title.degraded !== null`, render a `DegradedBanner` at the top of the title page:
`catalog` → "We can't reach our database right now. You're seeing a lighter version of this page. Stubs and reviews are
paused." `community` → "Community stats are taking a break." For `catalog`, the Stub, Review and Watchlist buttons render
`aria-disabled="true"` with that copy as the accessible description. `data-testid="degraded-banner"`.

**Tests:** `tests/server/dal-degraded.test.ts` with a fake container: `getEntry` throws + last-good present → last-good;
`getEntry` throws + TMDB ok → TMDB-derived, `isListed` per rule, `imdbRating` null, `degraded='catalog'`; `stats` throws →
`degraded='community'`; TMDB also fails → `upstream_unavailable`. E2E (qa): a demo-only switch is **not** added; the unit
tests are the gate.

## 5. Keep-alive independent of the TMDB secret (AR-6 → M1-07)

Supabase Free pauses after about 7 days without activity. Two independent keep-alives, both $0:

1. **Uptime monitor on `/api/health`** (founder: UptimeRobot or Better Stack free, 5-minute interval). Every live call runs
   `health_probe()` against the DB (uncached, §3), so the project never sits idle, and it does not depend on GitHub at all.
   Cost: ≈ 8,640 function invocations/month, under 1 % of Vercel Hobby's 1M.
2. **Nightly workflow keep-alive step** (`.github/workflows/nightly-sync.yml`): a first step that needs only
   `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`:
   `curl -fsS -X POST "$URL/rest/v1/rpc/health_probe" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Content-Type: application/json' -d '{}' > /dev/null`.
   It runs **before** the "Skip when not configured" guard and does not depend on `TMDB_READ_TOKEN`. If the two Supabase vars
   are missing it prints "keep-alive skipped" and continues.
- Public repos: GitHub disables scheduled workflows after 60 days without a commit. Mechanism 1 covers that gap. **Recommended:
  keep the repo private** (the nightly job uses roughly 10–20 min/night, within GitHub Free's private-repo minutes; Assumed:
  2,000 min/month). If public, re-enable the workflow when GitHub emails the warning.
- Unverified: exactly which requests Supabase counts as "activity". Both mechanisms make real PostgREST calls, and the nightly
  sync still writes `sync_runs` when fully configured.

## 6. Portability of these mechanisms

Nothing here is Vercel-specific: health is a Route Handler, the degrade path lives in the DAL, keep-alive and backups are
GitHub Actions + HTTP/SQL. On Netlify/Cloudflare/Oracle (ADR-001 §A2) the only change is `TRUSTED_PROXY`. On an Oracle VM the
same scripts may run from systemd timers instead of GitHub Actions.

## 7. Free backups (new → M1-08)

Supabase Free has no backups. New workflow `.github/workflows/backup.yml`, daily 04:07 UTC + `workflow_dispatch`:

1. Skip (success, message) if `SUPABASE_DB_URL` or `BACKUP_PASSPHRASE` is unset.
2. Install the Postgres client matching the server major version from the PGDG apt repo (`postgresql-client-17`; check with
   `select version()` at setup, and pin the major in the workflow).
3. `SUPABASE_DB_URL` = the **session pooler** connection string (IPv4; GitHub runners have no IPv6, and the direct host is
   IPv6-only on Free), role `postgres`, stored as a secret.
4. Two dumps, custom format:
   - `pg_dump --format=custom --no-owner --no-privileges --schema=public --exclude-table-data=public.title_detail_cache --exclude-table-data=public.catalog_staging`
   - `pg_dump --format=custom --data-only --table=auth.users --table=auth.identities` (identity must be restorable, ADR-010).
5. `tar` both, then `gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 0` with
   `BACKUP_PASSPHRASE` on stdin. The founder keeps the passphrase in a password manager; without it the backups are useless.
6. `actions/upload-artifact@v4`, `retention-days: 14`, name `db-YYYY-MM-DD.tar.gpg`. Log only the file size.
7. `permissions: contents: read`. No `set -x`. Never echo the URL.

**Public-repo exposure:** artifacts and logs of a public repository can be downloaded by anyone. That is why step 5 is
mandatory, not optional, and why a private repo is recommended (§5). Private-repo artifact storage on GitHub Free is limited
(Assumed: 500 MB); 14 dumps of a few MB each fit.

**Restore runbook** (README, rehearsed once on a staging Supabase project, M1-13): new project → apply all migrations →
`gpg -d` → `pg_restore --data-only` of the auth dump, then of the public dump, inside a session with
`set session_replication_role = replica` so triggers (`on_auth_user_created`, `title_stats`) do not double-insert
(Unverified on Supabase's `postgres` role: the rehearsal must confirm it; fallback is restoring `profiles` before re-enabling
the trigger), then `select public.catalog_count('all')` and a sign-in with a known staging account.

## 8. Logging (minimal, M1)

Server errors keep `console.error` (Vercel/Netlify/Cloudflare keep function logs for free for a short period). Rules: never
log emails, passwords, tokens, cookies, connection strings or request bodies; log `code`, route and title key. Error tracking
(AR-9, Sentry free) stays **Should**, not in M1.

## 9. F1 migration spec (→ M1-04)

New file `supabase/migrations/20260927000000_ops_health.sql` (never edit applied files):

```sql
-- Last FULL catalogue sync: discover ran and applied (F1). Aborted, failed, dry and --only runs don't count.
create or replace function public.last_catalog_sync()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(finished_at) from public.sync_runs
   where kind = 'catalog' and status = 'ok'
     and counts ? 'discover' and (counts -> 'discover') ? 'applied'
$$;

create or replace function public.health_probe()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'catalog_count', (select count(*) from public.catalog_index where is_listed),
    'last_full_sync_at', public.last_catalog_sync())
$$;
revoke all on function public.health_probe() from public;
grant execute on function public.health_probe() to anon, authenticated, service_role;
```
- Keep `last_catalog_sync()`'s existing grants (a `create or replace` keeps them; the DB test asserts it).
- If `catalog_count` must match `catalog_count('all')` exactly (for example extra listing rules), call that function instead of
  the inline `count(*)`.
- Tests in `tests/db/migrations.test.ts`: insert `ok` runs with `{discover:{applied:…}}`, `{imdb:…}` only, and an `aborted`
  run; assert only the first counts.

## 10. F2 recheck cap (→ M1-09)

**Observed:** `recheckMissing` re-checks at most 500 missing titles (`src/server/jobs/discover.ts:304-313`). Titles past the
cap, and titles whose re-check threw, are not staged, so `catalog_apply_staging` unlists them (`init.sql:477-481`) without a
re-check, bypassing the hysteresis rule.

**Rule:**
1. Cap becomes `SYNC_RECHECK_MAX` (env, default 500, parsed in `src/server/env.ts`).
2. `skipped > 0` → add guard reason `recheck_capped: <missing> missing titles exceed SYNC_RECHECK_MAX=<n>` → the run aborts
   apply (§2 then keeps the other steps running). A mass disappearance is an anomaly that a human should look at.
3. Re-check **errors** (transient TMDB failures) are **carried forward**: the job reads those titles' current rows from
   `catalog_index` and stages them unchanged (`is_listed` as it is), so they stay listed until a later night re-checks them.
   `recheckMissing` returns `erroredKeys: TitleKey[]` for this.
4. Tests (`src/server/jobs/discover.test.ts` or `tests/server/`): 501 missing with cap 500 → guard fails with
   `recheck_capped`; 3 errors → 3 carried-forward staging rows, 0 unlisted.

## 11. Consequences

- A dry run is safe to run any day; the budget maths in ADR-008 holds again.
- One bad discover night no longer freezes IMDb chips, "Worth it?" backfill, palettes or the purge.
- Monitoring is honest: "down" means the DB is unreachable, "degraded" means data is stale; both are free to watch.
- Title pages (the SEO entry points) survive a Supabase outage with TMDB data and a banner; accounts and diaries do not.
- Backups exist at $0, encrypted, 14 days, with a rehearsed restore.
- New env vars: `TRUSTED_PROXY` (ADR-001 §A3), `HEALTH_MAX_SYNC_AGE_HOURS`, `SYNC_RECHECK_MAX`; new secrets: `SUPABASE_DB_URL`,
  `BACKUP_PASSPHRASE`. All go into `.env.example` and README.
