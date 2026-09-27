# Stubbed: scope check, launch readiness and Phase 2 plan (ClearPath)

Product Manager · 2026-09-27 · Branch `claude/movie-app-multi-agent-d2x9zd` @ `51dd274` · Mode: plan (report only; no code edited, nothing rebuilt or re-run).

Inputs: `docs/00-orchestrator/BRIEF.md`, `docs/01-product/PRD.md` v1.1, `docs/07-gap-review/GAP_REVIEW.md`,
`docs/08-clearpath/{CODE_REVIEW,ARCH_REVIEW,QA_VERIFICATION}.md`, `README.md` "Going live", plus targeted greps of the tree.

Evidence labels: **Observed** (file:line, spec:line or screenshot read in this pass, or a QA gate result quoted from QA_VERIFICATION) ·
**Inferred** (follows from Observed facts) · **Assumed** (taken as given, not checked) · **Unverified** (needs a check nobody has run) ·
**Blocked** (can't be checked in this container: no network, no keys).

**Bottom line.** Every founder ask is built and works in demo mode (QA G3: 169 passed, 5 skipped, 0 failed). Nothing has run against live
Supabase, TMDB or OMDb yet. Launch is blocked by one founder asset (the TMDB logo), one founder-run staging smoke test, four
operational fixes from the architecture review, and a hosting profile for the founder's own server. None of them is a feature gap.

---

## 1. Current scope check

Status: **Done** = built and verified in demo mode · **Partial** = works, but one criterion is open · **Not done** · **Blocked-on-founder** =
needs a founder account, key or asset before it can be finished or verified.

### 1.1 Founder asks (BRIEF.md)

| # | Founder ask | Status | Evidence |
|---|---|---|---|
| F-1 | Public web app, mobile and desktop | **Done** (demo) | Observed: QA runs `desktop` 1440×900 and `mobile` Pixel 7 375×812, G3 green (QA_VERIFICATION §1). No horizontal scroll on 6 screens at 375 (GAP_REVIEW §2) |
| F-2 | Browse movies **and** shows, with ratings | **Done** | Observed: GAP_REVIEW §3 row 1; type filter A3 PASS |
| F-3 | Sort by release date and rating | **Done** | Observed: GAP_REVIEW §4 A2 PASS (QA) |
| F-4 | Read reviews and details | **Done** | Observed: A5, A6 PASS. A5-AC4 soft 404 is Partial, see story table |
| F-5 | Accounts, track watched, write reviews | **Done in demo · Blocked-on-founder live** | Observed: B1, B2, C1–C6, D1, D2 PASS. Blocked: live Supabase auth, RLS and delete cascade never run (QA_VERIFICATION §5) |
| F-6 | Only titles rated ≥ 6.5 | **Done** | Observed: vote floor plus 6.5 rule, Twilight 6.4 excluded (GAP_REVIEW §3); `isListed` at `src/lib/curation.ts:40` (CODE_REVIEW §4) |
| F-7 | Brand "Stubbed", one stub per rewatch | **Done** | Observed: "5× STUBBED", diary #1…#5 (GAP_REVIEW §3); screenshot `docs/07-gap-review/screenshots/pm-stub-again-today-375.png`. Trademark clearance not done (**Blocked-on-founder**, §4a) |
| F-8 | Titles shown as movie tickets | **Done** | Observed: GAP_REVIEW §3 "Met, strong" |
| F-9 | Gen-Z minimal look, background from poster | **Done in demo · Unverified with real posters** | Observed: palette tint (A5-AC2). Mobile fold fixed: h1, both chips and "Stub it" fully in view at 375×812 (`e2e/clearpath.spec.ts:123-141`; `docs/07-gap-review/screenshots/fix-title-375.png`). Blocked: real posters (`IMAGE_MODE=off` in container) |
| F-10 | Explore alternative names | **Done** | Observed: `docs/01-product/naming.md` exists; fallback "Punched" (README.md:34) |
| F-11 | Free tiers | **Done (design)** | Observed: ARCH_REVIEW §3 "Free tier at MVP scale". Risk: AR-1 dry run can burn the OMDb budget |
| F-12 | Founder Q1: "Why a DB, not real-time?" | **Done** | Observed: hybrid catalogue ADR-002, confirmed in code (ARCH_REVIEW §1) |
| F-13 | Founder Q2: reviews to IMDb | **Done (answered, then retired by founder)** | Observed: research.md; ADR-008 |
| F-14 | No posting to third parties | **Done** | Observed: no outbound write path (ARCH_REVIEW §3); zero outbound requests `e2e/platform.spec.ts:302` |
| F-15 | IMDb rating on every ticket stub and on the detail page | **Done in demo · Blocked-on-founder live** | Observed: wallet stubs now labelled with an IMDb chip, `src/components/WalletStub.tsx:23-27,57-58`; E2E `e2e/clearpath.spec.ts:105-121` (Dune TMDB 8.1 + IMDb 8.5; Bluey no chip). Blocked: needs `OMDB_API_KEY`; about 2 weeks to fill on the free key (README.md:43) |
| F-16 | No AI at runtime or in batch jobs | **Done** | Observed: no AI SDKs in `package.json`, lint rule (CODE_REVIEW §2); ADR-009 |
| F-17 | Runs on its own server | **Partial** | Observed: README.md:86 gives a one-line self-host note only; ADR-001 decides on Vercel (ARCH_REVIEW AR-7). Inferred: without a reverse proxy that overwrites `X-Forwarded-*`, auth rate limits can be bypassed (`src/server/http.ts:103`) |

### 1.2 MVP user stories (PRD §6)

| Story | Status | Evidence |
|---|---|---|
| A1 Browse | **Done** | Observed: GAP_REVIEW §4 PASS; `e2e/platform.spec.ts:41` green in G3 |
| A2 Sort | **Done** | Observed: GAP_REVIEW §4 PASS (QA) |
| A3 Type filter | **Done** | Observed: GAP_REVIEW §4 PASS |
| A4 Search | **Done** | Observed: GAP_REVIEW §4 PASS |
| A5 Title detail | **Partial** | Observed: fold fixed (above). Open: AC3 `og:image` needs real images (`src/app/title/[type]/[slug]/page.tsx:42` sets `openGraph`, Blocked); AC4 unknown title → HTTP 200 + noindex, because `src/app/title/[type]/[slug]/loading.tsx` streams (BUG-03 / GAP-10) |
| A6 Read reviews | **Done** | Observed: PASS (QA) |
| A7 IMDb everywhere | **Done** (demo) | Observed: AC1 fixed at `WalletStub.tsx:57`; `e2e/clearpath.spec.ts:105-121` |
| A8 Community + own rating | **Done** | Observed: PASS (QA) |
| B1 Sign up | **Done** (demo) · live Blocked | Observed: PASS. Live email delivery needs SMTP (founder) |
| B2 Sign in / out | **Done** (demo) | Observed: PASS |
| B3 Profile | **Partial** | Observed: AC2 avatar not editable (GAP-18); no avatar UI under `src/app/me/settings/page.tsx` |
| C1–C6 Stubs, diary, watchlist | **Done** | Observed: PASS. F3 (edit a stub dated today+1) fixed at `src/components/StubSheet.tsx:45-46` (QA_VERIFICATION §3) |
| D1 / D2 Reviews | **Done** | Observed: PASS. F4 count after delete fixed at `src/components/Reviews.tsx:38-40`. R10 residual (count doesn't go up on first review) open, cosmetic |
| D3 No third-party posting | **Done** | Observed: `e2e/platform.spec.ts:302` |
| D4 Export | **Done in demo · Unverified** | Observed: PASS (QA). Unverified: CSV import into a real Letterboxd account |
| F1–F4 "Worth it?" | **Done** | Observed: PASS |
| F5 Link previews | **Partial** | Observed: description only; `og:image` Blocked on real images |
| E1 Attribution | **Blocked-on-founder** | Observed: `public/tmdb-logo.svg:2` is `<!-- PLACEHOLDER: replace with the official TMDB logo … -->` |
| E2 Demo mode | **Done** | Observed: production refuses demo unless `DEMO_MODE_PUBLIC=true` (`src/server/env.ts:69`; README.md:23, :69); pill `Demo: data resets` (`e2e/clearpath.spec.ts:180-187`) |
| E3 Performance | **Not done (unmeasured)** | Unverified: no Lighthouse run anywhere (QA_VERIFICATION §5) |
| E4 Accessibility | **Done** | Observed: axe WCAG A/AA `e2e/platform.spec.ts:271,284` green |
| E5 Security / abuse | **Done** (single process) | Observed: PASS (QA); CODE_REVIEW §4 AuthZ/XSS. Inferred: rate limiter is per-process memory (AR-7) |
| MVP "password reset" | **Partial** | Observed: magic-link recovery only, `src/components/AuthForm.tsx:338-339`, `src/app/me/settings/page.tsx:57`; no set/change password (GAP-07). Live needs SMTP |
| Trust minimum (gap MUST FIX #5) | **Done** | Observed: `DeleteAccount` in `src/app/me/settings/page.tsx:96`; E2E `e2e/clearpath.spec.ts:31-101`; Contact/Terms `:145-155`; Report `:157-178`; notes hint `src/components/StubSheet.tsx:121` |
| PRD §7 analytics events (`stub_created`, `worth_it_viewed`, …) | **Not done** | Observed: grep of `src/` for `stub_created`, `worth_it_viewed`, `analytics`, `plausible`, `umami` returns nothing. Inferred: none of the PRD §7 success metrics can be measured at launch |

**Tally.** Founder asks: 14 Done, 1 Partial (own server), plus live verification Blocked-on-founder for accounts, IMDb data and posters.
MVP rows: 4 Partial (A5, B3, F5, password reset), 1 Blocked-on-founder (E1), 2 Not done (E3 measurement, analytics); every other row is Done in demo mode (D4 still needs a real Letterboxd import check).

---

## 2. Launch readiness: remaining blockers

Merged from GAP_REVIEW §6 (items 1–6 are closed by `0065e2b`; **7 and 8 stay open**), ARCH_REVIEW AR-1…AR-4 and AR-7, and the open
code/QA follow-ups. Sizes: XS < 1 h · S ≤ half a day · M ≤ 2 days · L > 2 days.

| ID | Item | Class | Owner | Size | Evidence / why |
|---|---|---|---|---|---|
| L-1 | **Official TMDB logo** replaces the placeholder (GAP #7, E1) | **Must before launch** | Founder (download) → frontend-dev (swap, check About and footer) | XS | Observed: `public/tmdb-logo.svg:2`. TMDB terms require it (research.md) |
| L-2 | **Staging smoke on real keys** (GAP #8): sign-up, stub, review, export → Letterboxd import, magic link arrives in Gmail, httpOnly `sb-*` cookies, delete-account cascade in Postgres, Lighthouse mobile (E3), `og:image` unfurl, real-poster contrast | **Must before launch** | Founder (keys, inbox) + qa-engineer | M | Blocked items in QA_VERIFICATION §5. Run it on the **own-server** staging box (L-7), not only a Vercel preview |
| L-3 | **AR-1 dry run spends real OMDb/TMDB budget**: skip OMDb completely in `--dry-run`, cap enrich at about 20 rows, log due counts; fix README "writes nothing" wording | **Must before launch** | backend-dev (+ architect: ADR-008 note) | S | Observed: `scripts/sync-catalog.ts:209-235,246-258` (writes skipped, calls not). Inferred: the founder's first-sync recipe (README.md:77-79: dry run, then real run) uses 900 + 900 against OMDb's 1,000/day on a populated catalogue |
| L-4 | **AR-2 guard abort freezes enrich, IMDb, palette and purge**: abort blocks discover/apply only; the other steps still run on the existing index, then exit 1 | **Must before launch** | backend-dev (+ architect: ADR-002 §1) | S | Observed: `scripts/sync-catalog.ts:396` returns `aborted`, `main()` returns before later steps (ARCH_REVIEW AR-2) |
| L-5 | **AR-3 health is always green**: uncached DB ping, 503 on DB failure, `degraded` when last sync > 36 h; point a free uptime monitor at it | **Must before launch** | backend-dev (+ architect: new ADR-010) · founder signs up for the monitor | S | Observed: `src/app/api/health/route.ts:12` `ok: true` unconditionally |
| L-6 | **AR-4 Supabase down → every title page errors**: catch `stats()` failures in `getTitle` and render without community data; fix SYSTEM_DESIGN §14 wording | **Must before launch** | backend-dev (+ system-designer for the doc) | S | Observed: `src/server/dal.ts:110-114`; `src/app/layout.tsx:15` `force-dynamic`; no CDN exists (ARCH_REVIEW AR-4) |
| L-7 | **AR-7 own-server hosting profile**: one Node process `next start` behind Caddy or nginx that **overwrites** `X-Forwarded-For`/`-Proto`/`-Host`, TLS at the proxy, host cron (systemd timer) for the nightly job and keep-alive (replaces AR-6 reliance on GitHub cron), persistent data dir, nightly `pg_dump`, optional free Cloudflare proxy in front. ADR-001 amended; README "Going live" gets an own-server section | **Must before launch** | architect (ADR-001 + deploy files: `Caddyfile`, systemd units, `.env` layout) → backend-dev (health/keep-alive wiring) → founder (server, DNS) | M | Observed: `src/server/http.ts:10-17,103,116-124` trust forwarded headers; `src/server/rate-limit.ts:115-118` in-memory; README.md:86 is one line. Founder constraint: "runs on its own server" (BRIEF) |
| L-8 | **Analytics events** for PRD §7 metrics (privacy-friendly, self-hosted, e.g. Umami or a first-party `events` table) | **Should** | product-manager (event spec) → backend-dev + frontend-dev | M | Observed: no events in `src/` (§1.2). Without it the north star (weekly stubbers) is only derivable by SQL on `stubs`, which is enough for day 1 (Inferred); hence Should, not Must |
| L-9 | **AR-9 error tracking**: Sentry free tier or host log shipping; request ids | **Should** | backend-dev | S | Observed: only `console.error` (`src/server/http.ts:37`) |
| L-10 | **F2 `recheckMissing` caps at 500** and can unlist beyond it without re-check: abort when `skipped > 0` | **Should** | backend-dev | XS | Observed: `src/server/jobs/discover.ts:304-313`. Inferred: only reachable when > 500 titles vanish in one night; CR-1 delta guard usually aborts first |
| L-11 | **F1 health `lastSyncAt` counts single-step runs**: new migration filters `counts ? 'discover'` | **Should** (bundle with L-5; the 36 h check depends on it) | backend-dev | XS | Observed: `supabase/migrations/20260926000000_init.sql:440` |
| L-12 | **AR-5 double `getUser()` per request**: `getClaims()` with asymmetric keys | **Later** (latency, not correctness) | backend-dev + architect (ADR-005) | S | Observed: `src/proxy.ts:21-44`, `src/server/auth/supabase.ts:96-100` |
| L-13 | **AR-8 referenced unlisted rows never refreshed** (TMDB 6-month rule) | **Later** (first breach ≥ 6 months after launch) | backend-dev | S | Observed: ARCH_REVIEW AR-8 |
| L-14 | **R10 "On Stubbed · N" doesn't go up on a first review** | **Later** | frontend-dev | XS | Observed: QA_VERIFICATION §3 residual |
| L-15 | **Flake `e2e/platform.spec.ts:57`** socket hang up on `POST /api/auth/signup` (1 in 4 runs) | **Should** (CI trust) | qa-engineer | XS | Observed: QA_VERIFICATION §1 G2. Fix: one retry on `ECONNRESET` in `e2e/support/fixtures.ts:112`, or `retries: 1` in CI only |
| L-16 | Trademark clearance for "Stubbed" | **Must before launch** (before spend and announcement) | Founder | S (external) | Observed: README.md:34; GAP_REVIEW §8 step 0 |

**Must-before-launch (in order):** L-16, L-7, L-3, L-4, L-5 (+L-11), L-6, L-1, then L-2 last as the gate.

---

## 3. Next phase plan (Phase 2)

### 3.1 Goal

Put Stubbed on the founder's own server with real data, keep it up without anyone watching it, and turn on the share loop. Then
give TV watchers and displaced TV Time users a reason to switch. Every feature stays deterministic (no AI), stores reviews and
ratings only in our DB, and runs on free tiers.

### 3.2 Scope

**In:** launch hardening (§2 Must and Should items), self-host ops, Share button and story images, season picker for shows,
file imports (TV Time, Letterboxd, IMDb CSV), set/change password, real 404/308, where to watch, analytics, mobile polish
(GAP-13/14/15), avatar colour (GAP-18), O2 and R6/R7 polish.

**Out:** episode-level tracking and progress bars (v1 later), follows and feeds, lists and Top 4, streaks, PWA offline queue,
notifications, recommendations, Recap, i18n, moderation admin UI (mailto reports stay), any posting to third parties (D10), any
AI (D15), ads or paid plans (TMDB/OMDb licences are non-commercial), account connections to other services.

### 3.3 Epics (priority order)

**E-H1 Launch hardening (P0).** Stories map to L-3…L-6, L-9…L-11, L-15.
- *H1.1 Dry run is free.* As the founder, I can test the sync without spending tomorrow's quota.
  AC1: `--dry-run` makes 0 OMDb calls (unit test with a counting fake). AC2: enrich in dry run fetches ≤ 20 rows. AC3: log prints due counts per step. AC4: README and ADR-008 match.
- *H1.2 Abort blocks apply only.* AC1: a guard abort still runs enrich, IMDb, palette and purge on the existing index. AC2: `sync_runs.status='aborted'`, exit code 1. AC3: test in `tests/server/`.
- *H1.3 Honest health.* AC1: `/api/health` returns 503 within 5 s when the DB is unreachable. AC2: `status:"degraded"` when the last **discover** run is > 36 h old (needs F1 migration). AC3: never served from the data cache.
- *H1.4 Title pages survive a DB outage.* AC1: with the stats query failing, `/title/*` renders details and hides community data, no `error.tsx`. AC2: test with a failing fake repo.
- *H1.5 Errors are visible.* AC1: server exceptions reach the error tracker with a request id. AC2: no secrets or emails in payloads.
- *H1.6 Recheck cap can't bypass hysteresis* (F2). AC1: run aborts apply when `skipped > 0`.
- *H1.7 CI is trustworthy.* AC1: `platform.spec.ts:57` passes 20/20 with `--repeat-each=20`.

**E-H2 Self-host ops (P0).** Map to L-7, AR-6.
- *H2.1 One-command deploy.* As the founder, I can deploy on a fresh Ubuntu VPS by following one README section.
  AC1: repo ships `deploy/Caddyfile` (or nginx conf), `deploy/stubbed.service`, `deploy/stubbed-sync.{service,timer}`, `deploy/backup.{service,timer}`. AC2: Caddy overwrites `X-Forwarded-For` and `X-Forwarded-Proto`; a spoofed XFF from a client does not change the rate-limit key (E2E or integration test). AC3: `NODE_ENV=production` with no keys refuses to start (already true, re-checked).
- *H2.2 Nightly job and keep-alive on the host.* AC1: systemd timer runs `npm run sync:catalog` at 03:17 UTC. AC2: a keep-alive DB call runs even when `TMDB_READ_TOKEN` is missing. AC3: GitHub workflow becomes manual-only or is documented as the alternative.
- *H2.3 Backups.* AC1: nightly `pg_dump` of the Supabase DB to the server disk, 14-day rotation. AC2: a restore is rehearsed once on staging and written up.
- *H2.4 Single-process guarantee.* AC1: ADR-001 states "one Node process" and why (in-memory limiter, breaker, data cache, `/api/revalidate`). AC2: startup log warns if `NODE_APP_INSTANCE`/cluster mode is detected.

**E-G1 Share (P1, growth loop).**
- *G1.1 Share button.* As a user, I can share a title, my wallet or my review in two taps.
  AC1: Share on the title page, profile wallet and own review. AC2: Web Share API when present, else copy link plus toast "Link copied". AC3: shared URLs carry `?ref=share` (no personal data). AC4: keyboard and screen-reader accessible; works signed out for title pages.
- *G1.2 Story-sized ticket image.* As a user, I can post my stub to an IG or TikTok story.
  AC1: `GET /api/share/stub/{id}.png` returns 1080×1920 and a 1080×1080 variant, rendered server-side with `next/og` (no third-party service, no AI). AC2: shows poster-tinted ticket, title, TMDB + IMDb chips (IMDb hidden when null), stub count, handle and short link. AC3: TMDB attribution line on the image. AC4: only the owner's public stubs; private data (none today) never rendered. AC5: rendered PNG cached; p95 < 800 ms on the own server. AC6: `og:image` for title pages reuses the same renderer (closes A5-AC3 / F5).

**E-T1 TV depth: season picker (P1).**
- *T1.1* As a TV rewatcher, I can stub a season. AC1: the stub sheet for shows has an optional "Season" select from TMDB season count (fixtures carry it). AC2: the stub prints "S03" in the diary, wallet and share image. AC3: no season = whole show (current behaviour, existing stubs unchanged). AC4: export puts the season in the Letterboxd `Review`-safe notes column or JSON only (Letterboxd has no season field). AC5: migration adds nullable `season smallint` with a check `> 0`.

**E-I1 Imports (P1, TV Time cohort).** File upload only; no account connections.
- *I1.1 TV Time export.* AC1: upload the TV Time data export (CSV/ZIP); shows matched by TVDB/IMDb id through TMDB `find`, movies by IMDb id. AC2: preview screen "N matched, M not in Stubbed (below 6.5), K not found" before anything is written. AC3: one stub per watch date, idempotent on re-upload. AC4: titles not in the index are inserted **unlisted** (ADR-002 §3 lazy insert, currently not built) so history is kept. AC5: 10 MB / 20k rows limit, processed server-side, file discarded after import.
- *I1.2 Letterboxd CSV/ZIP* (diary, ratings, reviews). AC1: `Rating10`/stars map to our 1–10; reviews imported as private-to-Stubbed reviews (our DB only). AC2: round-trip: our export → import gives the same stubs.
- *I1.3 IMDb ratings CSV.* AC1: `Const` (tt id) + `Your Rating` + `Date Rated` → rating and one stub (dated) per row, user can untick "create stubs".

**E-A1 Account hygiene (P1).**
- *A1.1 Set / change password* (GAP-07). AC1: Settings "Set a new password" (Supabase `updateUser`; local auth in demo). AC2: needs a fresh session (signed in < 10 min or re-auth). AC3: min length matches sign-up. AC4: toast and other sessions stay valid (documented).
- *A1.2 Avatar colour* (GAP-18, B3-AC2). AC1: pick one of 8 gradients; initials stay; no uploads.

**E-S1 SEO status codes (P1).**
- *S1.1 Real 404 / 308* (GAP-10, BUG-03). AC1: unknown title or handle → HTTP 404 (curl). AC2: wrong slug → 308 to the canonical slug. AC3: `loading.tsx` UX kept for known routes or replaced with a skeleton inside the page. Needs a Next 16 guide read (`node_modules/next/dist/docs/`) before the change.

**E-W1 Where to watch (P2).**
- *W1.1* AC1: title page shows streaming / rent / buy providers for the user's region from TMDB `watch/providers` (JustWatch data), cached with the detail cache. AC2: "Data by JustWatch" attribution on the block (TMDB/JustWatch terms). AC3: region from `Accept-Language`, overridable in Settings, stored in a cookie for signed-out users. AC4: hidden when empty; no affiliate links (non-commercial).

**E-P1 Polish (P2).** GAP-13 diary wrap, GAP-14 neutral wallet badge, GAP-15 mobile density, O2 "Add a stub too?" once, R6 export 429 toast, R10 count up, nonce CSP (R1).

**E-M1 Measurement (P1).** L-8. AC1: events from PRD §7 fire once each (unit tests). AC2: self-hosted or first-party; no third-party ad trackers; no personal data beyond user id hash. AC3: a weekly SQL or dashboard view for WAS, activation, time-to-first-stub.

### 3.4 Milestones

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M1 Launch-ready (week 1–2)** | E-H1, E-H2, L-1, L-16 (founder), L-2 staging smoke on the own server | All Must items closed; staging smoke passes; Lighthouse mobile title page LCP < 2.5 s, CLS < 0.1; first real sync done and 36 h health green. **Then public launch.** |
| **M2 Share + measure (week 3–4)** | E-G1, E-M1, E-S1, E-A1.1 | Share button and story image live; events flowing; real 404/308 by curl |
| **M3 Switchers + TV (week 5–7)** | E-I1 (TV Time first), E-T1, E-W1, E-A1.2, E-P1 | TV Time import tested with a real export file (founder supplies one); season stubs in export |

### 3.5 Success metrics (Phase 2)

| Metric | Target | Measured by |
|---|---|---|
| Uptime (own server) | ≥ 99.5 % / month | uptime monitor on `/api/health` |
| Nightly sync success | ≥ 27 of 30 nights `ok`; no night with IMDb/enrich skipped because of an abort | `sync_runs` |
| OMDb coverage | ≥ 95 % of listed titles with an IMDb rating by day 21 | SQL on `catalog_index` |
| p75 LCP title page (mobile) | < 2.5 s | Lighthouse + field data if analytics allows |
| Share rate | ≥ 0.3 shares per weekly stubber per week (PRD §7) | `share_generated` |
| K-factor | ≥ 0.2 by end of M3 | `?ref=share` sign-ups |
| Import completion | ≥ 70 % of started imports finish; ≥ 90 % rows matched | import logs |
| Activation | ≥ 40 % of sign-ups add 3+ stubs in 24 h (PRD §7) | events |

### 3.6 Risks

| Risk | L / I | Mitigation |
|---|---|---|
| Own server is a single point of failure; no managed CDN | M / H | Health + uptime alert (H1.3), backups (H2.3), optional free Cloudflare proxy, AR-4 degrade path |
| First live sync numbers differ from estimates (guard floors) | M / M | Per-type floors warn on first run (README.md:78); dry run is free after H1.1 |
| OMDb free key too slow for launch month | H / L | Patreon tier about $1/month (README.md:43); chips hide when null |
| TV Time export format undocumented or changes | M / M | Founder supplies a real export before M3; parser tolerant of extra columns; preview before write |
| `next/og` rendering cost on a small VPS | M / M | Cache PNGs by stub id + updated_at; rate limit per user |
| Trademark conflict (AMC Stubs) | M / H | L-16 before spend; fallback "Punched" |
| Scope creep into social features | M / M | Out list in §3.2 is closed for Phase 2 |
| Next 16 API differences (404/308, `next/og`) | M / M | Mandatory guide read per AGENTS.md; reviewer checks it |

### 3.7 Agent pipeline (orchestrator)

Agents in `.claude/agents/`. The orchestrator commits between steps; agents don't commit.

1. **product-manager**: freeze this plan's M1 scope; write the analytics event spec (for M2).
2. **architect**: ADR-001 own-server profile, ADR-002/008 amendments, new ADR-010 operability; `deploy/` files; update WORK_SPLIT.
3. **backend-dev** (H1.1–H1.6, H2.2, F1 migration) ∥ **frontend-dev** (L-1 logo swap once the founder supplies it, H1.4 UI of degraded title page).
4. **code-reviewer** ∥ **arch-reviewer** (ClearPath, changed code only).
5. **qa-engineer**: gate + flake fix (H1.7); after founder keys exist, staging smoke (L-2).
6. **product-manager**: M1 gap review → go/no-go for launch.
7. M2 and M3: **ux-designer** (share image, season picker, import preview, where-to-watch block) → **system-designer** (import pipeline, image cache) → **architect** (contract v1.4) → **backend-dev ∥ frontend-dev** → **code-reviewer ∥ arch-reviewer** → **qa-engineer** → **product-manager** gap review, looping on MUST FIX items.

---

## 4. Checklists

### 4a. Founder launch checklist (in order)

- [ ] **Trademark**: clearance search for "Stubbed" (USPTO, EUIPO; classes 9, 41, 42); watch AMC Stubs. Fallback "Punched". Register domain and handles.
- [ ] **Server**: a small VPS (Ubuntu LTS, 1–2 GB RAM), a domain with an A record to it. SSH key only.
- [ ] **TMDB**: Developer key → `TMDB_READ_TOKEN`. Download the official logo from TMDB "Logos & Attribution" and hand it to engineering to replace `public/tmdb-logo.svg`. Non-commercial.
- [ ] **OMDb**: free key, click activation email → `OMDB_API_KEY` (nightly job only). Optionally Patreon tier and raise `OMDB_DAILY_BUDGET`.
- [ ] **Supabase**: create project; copy Project URL → `NEXT_PUBLIC_SUPABASE_URL`, anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, service_role → `SUPABASE_SERVICE_ROLE_KEY` (never in `NEXT_PUBLIC_*`, never in git).
- [ ] **Migrations**: `supabase link` + `supabase db push`, or run `supabase/migrations/*.sql` in name order in the SQL editor (plus the F1 migration after M1).
- [ ] **Supabase Auth**: Confirm email OFF; Site URL = your domain; Redirect URL `https://<domain>/auth/callback` (and the staging domain).
- [ ] **SMTP**: Resend free tier (3,000/month, 100/day): verify the domain in Resend, paste host/user/password into Supabase → Authentication → SMTP.
- [ ] **Contact inbox**: an address you read → `NEXT_PUBLIC_CONTACT_EMAIL`.
- [ ] **Secrets**: `REVALIDATE_SECRET` = `openssl rand -hex 32`.
- [ ] **Where env vars go (own server)**: all of them in `/etc/stubbed/stubbed.env` (mode 600, owner = service user), read by both `stubbed.service` (web) and `stubbed-sync.service` (nightly job). Web needs: `NEXT_PUBLIC_SITE_URL`, `TMDB_READ_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_CONTACT_EMAIL`. Job adds `OMDB_API_KEY` (optional `SYNC_GUARD_MIN_MOVIE`, `SYNC_GUARD_MIN_TV`, `OMDB_DAILY_BUDGET`, `SYNC_ENRICH_MAX`). `NEXT_PUBLIC_*` must be present **at build time** too. If you keep Vercel/GitHub Actions instead, use the table in README.md:58-67. Never set `DEMO_*` or `IMAGE_MODE=off` on the real site.
- [ ] **First sync** (after H1.1 lands): `npm run sync:catalog -- --dry-run` → read per-type counts → set the two floors to about 80 % → real run → browse works; "Worth it?" fills in 3–5 nights, IMDb chips about 2 weeks.
- [ ] **Uptime monitor** (free tier, e.g. UptimeRobot or Better Stack) on `https://<domain>/api/health`, alerts to your phone.
- [ ] **Staging smoke** with QA (L-2), then announce.

### 4b. Engineering pre-launch checklist

- [ ] L-3 dry run makes 0 OMDb calls (test) · L-4 abort blocks apply only (test) · L-5 + L-11 health 503/degraded, F1 migration · L-6 title page degrades without community data (test).
- [ ] L-7: ADR-001 own-server profile, `deploy/` files, Caddy overwrites `X-Forwarded-*` (spoof test), systemd web + sync + backup timers, keep-alive independent of TMDB token, README own-server section.
- [ ] L-9 error tracking wired; no PII in payloads.
- [ ] L-10 F2 recheck cap aborts apply.
- [ ] L-15 flake fixed; `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check && npm run test:e2e` green twice in a row.
- [ ] L-1 official logo in `public/tmdb-logo.svg`; About and footer visually checked.
- [ ] `npm audit --omit=dev` has no high/critical; `.env.example` lists every variable used by `src/server/env.ts`.
- [ ] Production boot refuses demo and partial configs (re-check on the server).
- [ ] Backup restore rehearsed once on staging.
- [ ] L-2 staging smoke passed and recorded in `docs/06-qa/` with screenshots and Lighthouse numbers.
- [ ] code-reviewer and arch-reviewer verdict SHIP on the M1 diff.

### 4c. Phase 2 definition of done (per story)

- [ ] Every AC in §3.3 has an automated test (unit, DB or E2E) or a recorded manual check with evidence.
- [ ] Full gate green on both viewports; axe A/AA green on new screens; no new console errors; zero third-party requests in demo mode (`e2e/platform.spec.ts:302` stays green).
- [ ] Works in demo mode with fixtures (seasons, providers, a sample TV Time and Letterboxd file in `e2e/fixtures/`).
- [ ] No outbound writes to any third party; no AI/LLM dependency; no new paid service.
- [ ] Attribution added where new data appears (JustWatch on where-to-watch, TMDB on share images).
- [ ] API_CONTRACT and the relevant ADR updated in the same change; `.env.example` and README updated for any new variable.
- [ ] Next 16 guide read for any new Next API (`node_modules/next/dist/docs/`), noted in the PR.
- [ ] code-reviewer + arch-reviewer: no open finding ≥ 80 confidence; PM gap review marks the story PASS.

---

— clearpath: mode=review · evidence=labeled · verify=n/a
   memory=off · unverified=live Supabase/TMDB/OMDb behaviour, real-poster fold and contrast, Lighthouse/E3, Letterboxd import of our CSV, TV Time export format, own-server XFF behaviour (no proxy config exists yet), repo visibility (AR-6)
