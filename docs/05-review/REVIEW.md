# Stubbed — Staff review (phase 5)

Reviewer · 2026-09-26 · Branch `claude/movie-app-multi-agent-d2x9zd` · Scope: `src/`, `scripts/`, `supabase/`,
`tests/`, `.github/`, checked against BRIEF (incl. founder constraints), ADR-001…009, API_CONTRACT, WORK_SPLIT.

## 1. Verdict

**Ship to QA.** The codebase is in good shape: the contract is followed closely, the shared semantics (curation,
sort/cursor, stub numbering, "Worth it?") are single-sourced and parity-tested against real Postgres (PGlite),
RLS is on for every table, and the founder constraints hold (nothing is posted to third parties, IMDb is shown
everywhere with null → hidden, no AI dependency or step anywhere).

The review found **1 high, 8 medium and 9 low** issues. All of them are fixed in this phase with minimal diffs and
covered by new or extended tests. There are no open blockers. The six pending contract change requests are all
**accepted**. API_CONTRACT is now **v1.2** (§3 below).

End state: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` pass
(38 files, 247 tests). A browser pass against the production build in demo mode (sign in → title → stub →
My stubs with a type filter → profile → search → browse + Load more) finished with **zero console errors**, with the
new CSP active. The repo's `e2e/smoke.spec.ts` passes on desktop and mobile.

## 2. Findings

Severity: **H** = exploitable or data-integrity bug with real impact · **M** = contract/security/perf defect worth
fixing before launch · **L** = hardening, parity or polish. File:line points at the fixed code.

| # | Sev | Where | Issue | Fix / status |
|---|---|---|---|---|
| 1 | H | `src/lib/routes.ts:44` (`safeNext`), used by `src/app/auth/callback/route.ts` and `AuthPage` | **Open redirect.** `safeNext` blocked `//` and `/\` but not `/\t/evil.com`, `/\n/evil.com` or `/\t\\evil.com`. Browsers strip tab/CR/LF from URLs and read `\` as `/`, so the callback's relative `Location` (and `router.replace(next)`) became `//evil.com` | **Fixed.** The function now rejects control characters and backslashes, rejects a leading `//`, and then requires `new URL(next, base).origin === base`. Tests are in `tests/lib/text-routes.test.ts` |
| 2 | M | `supabase/migrations/20260926000000_init.sql:256,288` (triggers) | **Server-controlled columns were client-writable.** Through PostgREST, a signed-in user could insert or update `created_at`, `updated_at` and `edited_at` on their own stubs and reviews. That let them (a) back-date `created_at` to bypass the 30 stubs/min and 10 reviews/min triggers, (b) pin a review to the top of "Newest" with a future `created_at`, and (c) clear the EDITED tag | **Fixed** in the new `supabase/migrations/20260926180000_review_hardening.sql`. For the API roles (`anon`/`authenticated`), the triggers now own those columns. Service role and owner keep control for imports and tests. PGlite tests are in `tests/db/user-data.test.ts` |
| 3 | M | `src/server/supabase/server.ts:40`, `src/proxy.ts:27` | **Live auth cookies were not httpOnly.** `@supabase/ssr` defaults to `httpOnly: false`, while ADR-005 says httpOnly + Secure + SameSite=Lax. Any XSS could have read the access and refresh tokens | **Fixed.** Both clients now pass `cookieOptions { httpOnly: true, sameSite: 'lax', secure: <https>, path: '/' }`. The browser never reads auth cookies: all Supabase calls are server-side |
| 4 | M | `src/server/env.ts:139`, `src/server/auth/local.ts:46` | **Forgeable demo sessions in production.** Without `DEMO_SESSION_SECRET`, the HMAC key was a public constant. ADR-006 treats a zero-env public demo as a feature, and user ids are public (`Review.author.id`), so anyone could mint a session for any account | **Fixed.** `demoSessionSecret()` keeps the constant for dev and tests. In production it uses a random 256-bit secret persisted in `<DEMO_DATA_DIR>/session-secret` (`wx`, 0600), which every worker shares, or an in-memory secret when `DEMO_PERSIST=memory`. Tested in `src/server/auth/local.test.ts` |
| 5 | M | `src/components/ReviewComposer.tsx:54` | **Editing a review dropped its stub link.** The upsert replaces `stubId`, and the composer never sent it, so "STUB #2" disappeared after any edit (seed: Dune: Part Two) | **Fixed.** The composer resends `existing.stubId`. The upsert semantics are now spelled out in API_CONTRACT §5.11 |
| 6 | M | `next.config.ts:26` | **No Content-Security-Policy** (ADR-001 left it as a follow-up) | **Fixed with a baseline CSP.** `default-src 'self'`, `img-src 'self' data: blob: https://image.tmdb.org`, `connect-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`. `script-src` and `style-src` still allow `'unsafe-inline'` (Next's inline RSC scripts and palette CSS variables); `'unsafe-eval'` and `ws:` are added only in dev. Verified in the browser with no violations. Nonce-based CSP is residual risk R1 |
| 7 | M | `src/components/AppProvider.tsx:152` | **Wallet badge cost up to 5 sequential diary requests on every page load** for signed-in users, and it was wrong above 100 stubs (CR e) | **Fixed.** `MeResponse.stubCount` comes from one indexed count (`StubRepository.count`, `user_diary_count()`), so there is no diary paging |
| 8 | M | `src/app/me/stubs/page.tsx:41` | **"N STUBS" was wrong** with a type filter or on later pages: it showed the page length (≤ 50). It also made an extra `getProfile` call (CR f) | **Fixed.** The count is `DiaryResponse.total` (every stub matching `type`), and the extra call is removed |
| 9 | M | `src/server/ports.ts`, both repositories | The diary had no total and there was no cheap stub count (the port gap behind #7 and #8) | **Fixed.** Added `StubRepository.count(userId, type?)` and `diary().total` in memory and Supabase, plus the SQL `user_diary_count()`. Tests cover memory, Supabase (mocked PostgREST), routes and PGlite |
| 10 | L | `src/server/repositories/supabase/index.ts:100` (`typedTuple`) | **Tampered keyset cursors returned 500 in live mode.** A cursor that decodes cleanly but carries `"not-a-date"` or a huge int reached `::date`, `::uuid` or `::int` casts, but ADR-003 says a bad cursor restarts at page 1 | **Fixed.** Every keyset tuple (catalogue, diary, wallet, reviews, user reviews, watchlist) is type-checked per position before the RPC call. An invalid tuple becomes `null`, which means page 1. Tested |
| 11 | L | `src/server/providers/tmdb.ts:167` | TMDB review `url` was rendered as `<a href>` without a scheme check (a `javascript:` URL from upstream data would run) | **Fixed.** `safeReviewUrl()` keeps https URLs and otherwise uses the canonical TMDB review page. Tested |
| 12 | L | `src/server/http.ts:29,41,131` | Error bodies, 204 responses and redirects lacked `Vary: Cookie` (API_CONTRACT §4: "all errors … `private, no-store` + `Vary: Cookie`") | **Fixed.** Asserted in `tests/server/routes.test.ts` |
| 13 | L | init migration `reviews_before_write`, `src/server/repositories/memory/user-data.ts:422` | The review rate limit also fired on non-content updates. That includes the FK `stub_id … on delete set null`, so **deleting a linked stub could return 429** after 10 review writes in a minute | **Fixed.** Only inserts and content edits (rating, body, spoiler) count, in SQL and in the demo store (parity) |
| 14 | L | `supabase/migrations/20260926120000_user_data_reads.sql:199` (`consume_rate_limit`) | The function is callable directly with any `kind`, and only pruned the requested kind, so `rate_events` could grow without bound | **Fixed.** Each call also prunes the caller's events older than 1 day (the maximum window) |
| 15 | L | `profiles.avatar_url` | https was enforced only in the app layer. A direct PostgREST update could store `javascript:…` (not rendered today: `Avatar` draws initials) | **Fixed.** CHECK constraint `profiles_avatar_https`, tested |
| 16 | L | `src/server/http.ts:102` (`assertSameOrigin`) | Used the raw `x-forwarded-host`. Behind chained proxies (`a, b`), every mutation returned 403. It was also inconsistent with `requestOrigin()` | **Fixed.** Uses the first hop, like `requestOrigin()` |
| 17 | L | `src/components/ConfirmDialog.tsx:31` | Destructive confirms ("Delete this stub?", "Delete your review?") autofocused **Delete** | **Fixed.** Destructive dialogs focus Cancel; the others still focus the confirm button |
| 18 | L | `.github/workflows/ci.yml:8`, `nightly-sync.yml:21` | Default `GITHUB_TOKEN` permissions. The nightly job also did not pass `CATALOG_KEEP_RATING` / `CATALOG_EXCLUDE_TV_GENRES`, so the job's curation could drift from the configured rule | **Fixed.** `permissions: contents: read`, and both variables are passed through |

### Checked and found correct (no change)
- **Stub numbering:** 1-based rank by `(watchedOn, createdAt, id)` is identical in SQL (`stub_details`, `user_diary`) and in the memory store, and the Letterboxd `Rewatch` flag uses the same order.
- **Same-day logic:** `hasStubToday` is computed against server "today" (`DEMO_TODAY` in demo). A duplicate is allowed and the UI confirms first, including on replay after sign-in.
- **One review per user:** `UNIQUE (user_id, title_id)`, update-then-insert with a 23505 fallback, and `created` maps to 201 or 200.
- **Pagination:** every sort is a total order ending in the unique key. `COLLATE "C"` columns keep JS and SQL comparisons identical. Cursors are opaque and restart on mismatch. `limit + 1` probing, no OFFSET.
- **Curation:** `isListed()` at one-decimal precision with vote floors (200 movies / 100 TV). The TV genre exclusions apply and IMDb never affects membership. Hysteresis works through the discover floor `min(min, keep) − 0.05`, the `wasListed` flag, and `catalog_apply_staging`, which unlists and never deletes referenced rows.
- **IMDb null handling:** `posOrNull` on read and `titleScores()` hide the chip for null, 0 or NaN, and the accessible name omits IMDb.
- **"Worth it?":** pure rules, no numbers in output, the spoiler keyword guard is tested, and the meta description never uses review text.
- **Authz on every write:** the user id always comes from the session, and repositories scope by `userId`. RLS enforces owner-only writes, and someone else's row returns 404.
- **SECURITY DEFINER functions:** all of them set `search_path` and are revoked from `public`/`anon`/`authenticated` except the three intended RPCs. Trigger functions can't be called directly.
- **Other security:** no `dangerouslySetInnerHTML`, and `rel="noopener noreferrer"` on every `_blank` link. Revalidation uses a timing-safe secret. Mutations require CSRF protection (same-origin + JSON). The magic-link response never reveals whether an account exists.
- **Resilience:** TMDB calls have a 2.5 s timeout, request coalescing, and a breaker (5 failures in 30 s opens it for 60 s, then one half-open trial). Failures fall back to L1/L2/in-process stale data and then index-only; a title page never 500s.
- **Performance:** one batched `title-states` call per tick (≤ 60 keys), and no N+1 in lists. Client bundles contain no zod and no vibe tables. Caching headers match §4.

## 3. Decisions on contract change requests (all accepted → API_CONTRACT v1.2)

| CR | Decision | Rationale | Implemented |
|---|---|---|---|
| (a) Letterboxd CSV **movies only**, plus one row with **empty `WatchedDate`** for a reviewed-but-never-stubbed movie | **Accept** | Letterboxd is films-only and matches `tmdbID` as a movie id, while TV ids collide (`tv:1396` ≠ `movie:1396`). The empty-date row keeps ratings and reviews that would otherwise be dropped. TV stays in the JSON export | Already in `src/server/export/letterboxd.ts` (tested). Contract §5.16 updated |
| (b) Export limit **1 per 10 min per format** | **Accept** | Settings offers CSV and JSON side by side, and a per-user limit would block the second click. Abuse cost stays negligible (2 exports per 10 min) | Already in `src/server/services/export.ts`. Contract §5.16 updated |
| (c) `watchedOn` allows **today + 1 day** | **Accept** | Server "today" is UTC, so users ahead of UTC would otherwise be unable to log their local today. The DB trigger already had the same slack, so the contract now matches the implementation | Already in `validateWatchedOn` and the trigger. Contract §5.7/§5.8 updated |
| (d) **Relative `Location`** on the magic-link / callback redirect | **Accept** | Keeps the browser on the host it used (for example 127.0.0.1 vs localhost under `next start`), so cookies stay on the same host. It is safe because `safeNext()` guarantees a same-origin path, and it is hardened by finding #1 | Already in `redirectRelative`. Contract §5.18 updated |
| (e) `stubCount` in `MeResponse`, replacing the diary-paging wallet badge | **Accept** | One indexed count instead of up to 5 sequential requests on every page load, and it stays correct above 100 stubs | `contracts.ts`, `/api/me`, `StubRepository.count`, `user_diary_count()`, `AppProvider` (#7) |
| (f) `total` on the diary page response | **Accept** | "N STUBS" must count the whole filter, not just the page | `DiaryResponse = Page<DiaryEntry> & { total }`, both repositories, `/me/stubs` (#8) |

Frozen files touched for these decisions: `src/lib/contracts.ts` (`MeResponse.stubCount`, `DiaryResponse.total`),
`src/lib/types.ts` (a doc comment on `Page.total`), `src/lib/routes.ts` (#1), `src/server/env.ts` (exports the
fallback constant, #4), `next.config.ts`, the workflows, and `docs/04-architecture/API_CONTRACT.md`. The applied
migrations are untouched: the changes are in a new file.

## 4. Residual risks and follow-ups

| # | Risk | Recommendation |
|---|---|---|
| R1 | The CSP still allows `'unsafe-inline'` scripts | Stage 1: nonce-based CSP via `proxy.ts` (`x-nonce` + `script-src 'nonce-…' 'strict-dynamic'`), which needs dynamic rendering (already the case) |
| R2 | Live mode has never run against a real Supabase or TMDB project. SQL is proven on PGlite, and adapters are tested against mocked PostgREST | First deploy: run `sync:catalog --from-fixtures` and a smoke of sign-up → stub → review, and confirm the httpOnly `sb-*` cookies and that `rate_events` pruning works |
| R3 | Demo magic links return `devLink` for any email, so on a **public** demo, knowing an email is enough to sign in (by design, ADR-005/006; the data is labelled demo) | Keep demos private, or accept. A real deployment uses Supabase email |
| R4 | Per-IP auth limits trust the first `X-Forwarded-For` hop, which a client can spoof when self-hosted without a proxy | Behind Vercel this is fine. Self-hosted: put a proxy in front that overwrites XFF. Supabase Auth has its own limits in live mode |
| R5 | Letterboxd CSV cells are not formula-escaped (`=`, `+`, `-`, `@`) | Accepted: it is the user's own text, and escaping would corrupt a Letterboxd import |
| R6 | Export links use `<a download>`, so a 429 saves the JSON error as a file | UX follow-up: a small client button that fetches and toasts `retryAfter` |
| R7 | The stub sheet's date picker `max` = server today, while the server accepts +1. Users ahead of UTC can't pick their local date in the sheet (a plain tap uses server today) | Follow-up: clamp `max` to `min(local today, server today + 1)` once E2E clock handling is settled |
| R8 | Stub notes are public in diaries (PRD B3), but the sheet doesn't say so | PM/design: add a "Notes are public" hint |
| R9 | The demo JSON store is O(n) per query, and its mtime-based reload can miss a write from another process within the same mtime tick | Accepted for demo sizes (ADR-006) |
| R10 | Cosmetic: the "On Stubbed · N" count doesn't include a just-posted first review until reload, and the "Stub again today?" copy says "today" when a past date matches `lastWatchedOn` | Frontend polish |
| R11 | Test gaps: no component test for the composer resending `stubId`, and no E2E yet (QA phase) | QA: cover review edit → "STUB #2" kept, the `/me/stubs?type=tv` count, the wallet badge, and the open-redirect payloads on `/auth/callback` |

## Fix loop 1 review (GAP_REVIEW §6 items 1–6, diff `b0479a9..HEAD`)

Scope: mobile title layout, wallet scores, `DELETE /api/me`, contact/report mailto, per-type sync guard,
production demo opt-in, README "Going live", API_CONTRACT v1.3. Verdict: **approve with 4 small fixes**
(applied below). Gates after the fixes: lint, typecheck, unit/DB tests (272), build, format:check and
Playwright E2E (151 passed, 3 skipped) are green.

### Fixed

| # | Sev | Where | Finding | Fix |
|---|---|---|---|---|
| FL1 | Med | `src/server/auth/supabase.ts` `deleteAccount` | A missing `SUPABASE_SERVICE_ROLE_KEY` made `supabaseAdmin()` throw an `AppError('internal', 'SUPABASE_SERVICE_ROLE_KEY is not configured')`, which `errorResponse` sends as-is and the Settings panel displays: config detail leaked to the browser. Admin API failures were also never logged (AppErrors are not logged by `route()`), so a failed deletion left no server trace | Admin-client creation and `deleteUser` errors now log server-side and map to the generic `internal` copy; nothing is deleted and the session stays, so the user can retry. Unit test added |
| FL2 | Low | same | After a **successful** `deleteUser`, a throw from the cookie-clearing `signOut({ scope: 'local' })` would turn an irreversible success into a 500 (the user retries and gets 401) | Wrapped in try/catch + warn; the route still returns 204 |
| FL3 | Low | `src/lib/contact.ts` | The address validator rejected `@ < > " ' , ;` and whitespace but allowed `? & # %`, so `NEXT_PUBLIC_CONTACT_EMAIL=me@x.com?bcc=other` produced a mailto with an injected header (operator-controlled only, but cheap to close). Body line breaks were bare `%0A`; RFC 6068 §5 requires `%0D%0A` | Validator also rejects `? & # %`; body newlines are normalised to CRLF. Tests extended |
| FL4 | Low (a11y) | `src/components/DeleteAccount.tsx` | The typed-confirm input was only described by the error (the "can't be undone" text was on the form, not the field), and Escape did nothing in the inline confirm | Input is `aria-describedby` the warning (+ the error when present); Escape cancels and returns focus to the trigger. Unit test added |

### Checked and found correct (no change)
- **Account deletion authz/CSRF:** `parseBody` enforces same-origin + JSON before anything else, the body must be the literal `{ confirm: "DELETE" }`, the user id comes only from the session, and the Supabase path re-validates the JWT with `getUser()` and refuses when the id differs, so a caller can never delete another user. Demo refuses the shared seeded accounts (403). Demo cascade covers every per-user collection in `DemoData`; the live cascade (`profiles → stubs/reviews/watchlist/rate_events`, `reviews.stub_id on delete set null`) and the `title_stats` decrements are proven on PGlite (`tests/db/account-delete.test.ts`). `deleteUser` is a single statement, so there is no partial-delete state; sessions on other devices die with the user (demo: `getSession` looks the user up; live: GoTrue drops the sessions).
- **Session cleared:** demo cookie deleted server-side; client uses `signOut({ remote: false })` and leaves `/me`.
- **Demo opt-in:** the production gate runs in `parseEnv` (every request path, the proxy included) and only `next build` (`NEXT_PHASE=phase-production-build`, set by Next itself) is exempt; half-configured live is still demo and still gated. `devLinks` defaults to `seeded` in production, so a public demo can't be used to sign in as a real sign-up. `DEMO_DEV_LINKS=any` in production is an explicit, documented E2E-only override (see follow-up FL-R2).
- **Sync guard:** first run = no listed rows in `catalog_index` (a dry run writes no `sync_runs` row, so it can't mask this); below-floor only warns on the first run, `0` of a type and `> SYNC_GUARD_MAX` always abort; empty workflow `vars.*` resolve to the defaults via `optionalString`; invalid values fail fast with the variable name.
- **README vs code:** every variable named in "Going live" exists in `.env.example`, `env.ts` and `nightly-sync.yml` with the same name; secrets vs variables, the `production` environment, the `dry_run` input, 03:17 UTC and the migration file names match.
- **Report link:** only on other people's reviews (session handle check), accessible name "Report review by {handle}" starts with the visible text (WCAG 2.5.3); all user/TMDB text goes through `URLSearchParams`. Wallet stub accessible name includes both scores; IMDb hidden when unknown.
- R3 (public demo devLinks) and R8 (notes are public hint) from §4 are resolved by this loop.

### Follow-ups (not blocking)
| # | Item |
|---|---|
| FL-R1 | Only the **first** run tolerates a low floor. If the first live sync warned (e.g. tv 900 < 1000), the next nightly run aborts until `SYNC_GUARD_MIN_TV` is set (the log prints the exact value to use). Loud, not bricking (index untouched, site keeps the first-run data), and the README says so. Separately, the delta guard is symmetric, so a first run that was abnormally small would block a later normal-sized one; consider ignoring increases |
| FL-R2 | Consider logging a boot warning when `DEMO_DEV_LINKS=any` is combined with `NODE_ENV=production` |
| FL-R3 | No E2E for the delete-account flow (covered by unit, route and PGlite tests); add one using a freshly signed-up user |
