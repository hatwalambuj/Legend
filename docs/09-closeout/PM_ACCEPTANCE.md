# PM acceptance: close-out (C-01 to C-18)

Product manager · 2026-10-14 · Branch `claude/movie-app-multi-agent-d2x9zd` @ `24fcfd3` · Mode: gate (report only; nothing re-run or rebuilt).

Inputs: `docs/00-orchestrator/BRIEF.md`, `docs/08-clearpath/NEXT_PHASE_PLAN.md`, `docs/09-closeout/{CLOSEOUT_BOARD,FOUNDER_INPUTS,LAUNCH,RELEASE_NOTES,SECURITY_REVIEW,ARCH_REVIEW_CLOSEOUT}.md`,
`docs/08-clearpath/QA_VERIFICATION.md` "Close-out (C-18)", `docs/02-design/share/final-first-story.png`, plus targeted greps.

Evidence labels: **Observed** (file:line, doc section or screenshot read in this pass; gate numbers quoted from the orchestrator's C-18 run) · **Inferred** · **Assumed** · **Unverified** · **Blocked** (needs live keys, network or devices).

**Verdict: ACCEPTED for launch in demo-verified form.** Every founder ask is built and covered by the demo-mode gate (Observed: QA_VERIFICATION.md:233-246: 718 unit, 262 E2E passed, 6 skipped, 0 failed). Nothing has run on real Supabase, TMDB or OMDb (Blocked → F2–F7). Two small **documentation** items are still open on the engineering side (§3.2). Neither blocks launch, but they are not closed.

---

## 1. Founder asks

| # | Ask (source) | Decision | Evidence |
|---|---|---|---|
| A-1 | Public web app, mobile and desktop (BRIEF:4) | **Accepted** (demo) | Observed: E2E runs desktop 1440 and mobile 375 (QA_VERIFICATION.md:244). Live deploy Blocked → F5 |
| A-2 | Browse movies **and** shows, sort by release date and rating (BRIEF:5) | **Accepted** | Observed: A1–A3 PASS (NEXT_PHASE_PLAN §1.2), still green in 262-spec run; `e2e/browse.spec.ts` (10 tests) |
| A-3 | Read reviews and details (BRIEF:6) | **Accepted** | Observed: A5/A6 PASS; A5-AC4 soft 404 closed by C-03 (real 404 + 308, `e2e/seo-status.spec.ts`) |
| A-4 | Accounts, track watched, write reviews (BRIEF:7) | **Accepted-with-limits** | Observed: B1/B2, C1–C6, D1/D2 PASS; set/change password added (`src/components/SetPasswordForm.tsx`). Limit: live Supabase auth, RLS, SMTP Blocked → F2, F3, F4, F6 |
| A-5 | Catalogue only rating ≥ 6.5 (BRIEF:8) | **Accepted** | Observed: `isListed` at `src/lib/curation.ts:40` (NEXT_PHASE_PLAN F-6); release notes "6.5 or higher" plus vote floor (RELEASE_NOTES.md:11) |
| A-6 | Brand "Stubbed", one stub per rewatch, stub count (BRIEF:11-13) | **Accepted-with-limits** | Observed: "1× STUBBED" / "STUB #1" on the story image (`docs/02-design/share/final-first-story.png`); brand is one setting `NEXT_PUBLIC_BRAND_NAME` (C-15, `e2e/brand.spec.ts`). Limit: trademark not cleared → F8 |
| A-7 | Titles as movie tickets (BRIEF:14) | **Accepted** | Observed: ticket card, perforation and torn edge on share story (final-first-story.png); GAP_REVIEW "Met, strong" (NEXT_PHASE_PLAN F-8) |
| A-8 | Gen-Z minimal look, background from poster (BRIEF:15) | **Accepted-with-limits** | Observed: palette tint in demo (NEXT_PHASE_PLAN F-9). Unverified: real-poster contrast and fold → LAUNCH.md Step 19 / F6 |
| A-9 | Explore alternative names (BRIEF:16) | **Accepted** | Observed: `docs/01-product/naming.md`; fallback "Punched" |
| A-10 | Founder Q1 "why a DB, not real-time?" (BRIEF:21) | **Accepted** | Observed: hybrid catalogue decided in ADR-002 |
| A-11 | Founder Q2 "reviews to IMDb" (BRIEF:22) | **Accepted** (answered, then retired by A-12) | Observed: `docs/01-product/research.md`; ADR-008 |
| A-12 | **No posting to third parties** (BRIEF:48-49) | **Accepted** | Observed: zero outbound requests test `e2e/platform.spec.ts:302`; no Trakt or "Also post" strings in `src/**/*.tsx` (grep, this pass); release notes "Nothing is posted to other sites" (RELEASE_NOTES.md:23) |
| A-13 | **IMDb rating on screen**: every ticket stub and title detail; hidden when absent (BRIEF:51-53) | **Accepted-with-limits** | Observed: `src/components/Ticket.tsx:75,132-135` (`data-testid="imdb-rating"`), title page `ScoreChips` at `src/app/title/[type]/[slug]/page.tsx:220`, wallet stub chip; Bluey hides chip (`e2e/clearpath.spec.ts:107-117`); story image shows IMDb 8.5 (final-first-story.png). Limit: live chips fill over ~2 weeks on the free OMDb key (RELEASE_NOTES.md:72); needs F2 |
| A-14 | "Worth it?" summary (PRD F1–F4, BRIEF:56) | **Accepted-with-limits** | Observed: `src/components/WorthIt.tsx` wired at `page.tsx:17`; F1–F4 PASS. Limit: live details fill over 3–5 nights (RELEASE_NOTES.md:73) |
| A-15 | **No AI at runtime or in batch** (BRIEF:55-56) | **Accepted** | Observed: no `openai/anthropic/@ai-sdk/langchain` in `package.json` or `src/` (grep, this pass); ADR-009 deterministic rules; ARCH_REVIEW_CLOSEOUT §2 C-09/C-13 row |
| A-16 | **Where to watch, clickable** (ADR-012) | **Accepted-with-limits** | Observed: `src/components/ProviderTile.tsx:105-107` (`href`, `target="_blank"`, `rel="noopener noreferrer"`), allowlisted templates `src/lib/provider-links.ts:167`; 23 tests in `e2e/where-to-watch.spec.ts`; "On {Service}" chips (C-02). Unverified: TMDB `watch/providers` live key and real-phone deep links → F6, F7 |
| A-17 | **$0 stack** (ADR-001 Amendment A) | **Accepted-with-limits** | Observed: no new vendor, dependency or host in close-out (ARCH_REVIEW_CLOSEOUT §2, §3); events table ≤ 400k rows ≈ 10% of Supabase Free. Limits: non-commercial only (TMDB, OMDb CC BY-NC, Vercel Hobby); errors visible ~1 h on Hobby, then daily counts only (RELEASE_NOTES.md:75-76); commercial plan → F10 |
| A-18 | "Runs on its own server" (NEXT_PHASE_PLAN F-17) | **Accepted** (superseded) | Observed: ADR-001:47-48 Amendment A replaces own-machine reading with free-tier portability + `TRUSTED_PROXY` (README.md:90, :144) |
| A-19 | **Identity table** ("like IDS") | **Accepted** | Observed: ADR-010 §1-2: Supabase Auth `auth.*` is the identity store, `public.profiles` 1:1 with cascade; no password stored by the app in live mode. Optional F12 asymmetric keys |
| A-20 | **ClearPath memory** for overall context | **Accepted** | Observed: `.clearpath/hot.md` updated 2026-10-14, `verified_against: 24fcfd3`; `.clearpath/log.md:69-71` close-out entry |
| A-21 | Close everything except founder inputs (founder, 2026-10-03; `.clearpath/log.md:50-51`) | **Accepted-with-limits** | Observed: CLOSEOUT_BOARD all done; two doc-only items still open (§3.2) |

Tally: 13 Accepted, 8 Accepted-with-limits, 0 Not accepted. Every limit is either a founder input or a live-only check.

---

## 2. Close-out items C-01 to C-18

E2E coverage below is the spec list in QA_VERIFICATION.md:248-250 (Observed), green in the 262-test run.

| ID | Item | Decision | Evidence |
|---|---|---|---|
| C-01 | `watchHint` on list APIs + stub provider logo | **Accepted** | Observed: commits `90f5d95`, `a52e09d`; E2E "stub provider logo" |
| C-02 | "On {Service}" chips + index | **Accepted** | Observed: migration `20261003090000_watch_filter.sql`; E2E "provider chips" |
| C-03 | Real 404 + 308 slug redirect | **Accepted** | Observed: `e2e/seo-status.spec.ts`; `loading.tsx` removed (SECURITY_REVIEW.md frontend §); live probe in `smoke:live` (AR-C5 closed, `b3c4c15`) |
| C-04 | "On Stubbed · N" increments after review | **Accepted** | Observed: E2E "review count" |
| C-05 | Supabase `getClaims()` local check | **Accepted-with-limits** | Observed: `src/server/auth/supabase.ts:170`, no fallback to unverified session (SECURITY_REVIEW.md). Unverified: live JWKS; local verify only after F12 |
| C-06 | Refresh referenced unlisted rows (TMDB 6-month rule) | **Accepted** | Observed: migration `20261003092000_enrich_core_refresh.sql`; gone-row leak AR-C3 fixed (`20261004092000_enrich_skip_gone.sql`) |
| C-07 | Web Share + copy link (title, wallet, review, stub) | **Accepted** | Observed: E2E "Share + copy-link fallback"; wallet unblocked by contract v1.6.1 (`20261004090000_wallet_latest_stub.sql`) |
| C-08 | Story ticket image + og:image, offline fonts | **Accepted-with-limits** | Observed: `docs/02-design/share/final-*.png` (6 files); E2E checks PNG size, no Set-Cookie, no external fetch, canonical `?v=`; CR-CO-1 fixed. Limit: non-Latin titles drop to fallback text on images (RELEASE_NOTES.md:71); posters Blocked in demo |
| C-09 | First-party analytics, no cookies, no third party | **Accepted** | Observed: migrations 094/096/`20261004091000_events_source_caps.sql`; SR-1 and AR-C4 fixed; E2E "analytics" |
| C-10 | Season picker for show stubs | **Accepted** | Observed: `20261003091000_stub_season.sql`; E2E "season picker + diary/wallet season" (`e2e/season.spec.ts`) |
| C-11 | Imports: Letterboxd, IMDb CSV, TV Time | **Accepted-with-limits** | Observed: `20261003095000_imports.sql`; E2E incl. oversize rejected. Limit: TV Time is beta until a real export is checked (F11); imports match the catalogue only |
| C-12 | Avatar colour picker | **Accepted** | Observed: `20261003093000_profile_avatar_color.sql`; allowlisted in zod, read path and DB (SECURITY_REVIEW.md); E2E "avatar colour" |
| C-13 | Error tracking without third party | **Accepted-with-limits** | Observed: `/api/log` caps + `redact()`; daily error counts added (`3c23771`, AR-C2). Limit: raw log lines ~1 h on Vercel Hobby |
| C-14 | Launch kit | **Accepted** | Observed: `launch:check` (incl. `--migrations`, brand warn), `db:apply`, `smoke:live`, `check:provider-links` + workflows (`d5b809c`, `b3c4c15`); LAUNCH.md:225 "migrate, then deploy" |
| C-15 | Brand name as config | **Accepted** | Observed: `NEXT_PUBLIC_BRAND_NAME`; guard test `tests/lib/guards.test.ts`; `e2e/brand.spec.ts` |
| C-16 | README, LAUNCH runbook, release notes | **Accepted-with-limits** | Observed: LAUNCH.md Steps 1–21 map to F1–F11. Limit: RELEASE_NOTES.md is stale on C-18 (§3.2 E-1) |
| C-17 | Security + code + arch review, fix all ≥ 80 | **Accepted** | Observed: SECURITY_REVIEW.md SHIP (SR-1, SR-2 fixed; frontend pass no findings ≥ 80); ARCH_REVIEW_CLOSEOUT SHIP, AR-C1…C5 closed (status section, `b3c4c15`, `3c23771`); CR-CO-1 fixed (`2f6ef2c`) |
| C-18 | Full gate + full E2E + PM acceptance | **Accepted** | Observed: QA_VERIFICATION.md:233-246 (lint, typecheck, 718 unit, build, format, 262 E2E / 6 skipped / 0 failed / 0 flaky, at `223a437`, committed `24fcfd3`); this document is the PM part |

18 of 18 Accepted (5 with limits; each limit maps to a founder input or a known, documented ceiling).

---

## 3. What remains

### 3.1 Founder-only (from FOUNDER_INPUTS.md) — the launch list, in LAUNCH.md order

| # | Founder step | Runbook |
|---|---|---|
| F8 | Trademark search "Stubbed" (USPTO / EUIPO); rename is one env var if it fails | LAUNCH Step 1 |
| F10 | Repo public or private; commercial or not | Step 2 |
| F1 | Replace `public/tmdb-logo.svg` with the official TMDB logo (Observed: placeholder marker still at `public/tmdb-logo.svg:2`; `launch:check` fails until then) | Step 4 |
| F2 | TMDB, OMDb, Supabase keys into Vercel + GitHub | Steps 5–7, 13 |
| F3 | Apply migrations with `npm run db:apply --yes` | Step 9 |
| F4 | Supabase Auth URLs + custom SMTP | Step 10 |
| F9 | Contact email `NEXT_PUBLIC_CONTACT_EMAIL` | Step 11 |
| F5 | Vercel project + domain | Step 12 |
| F6 | Staging smoke on real keys (`smoke:live` workflow), incl. Lighthouse mobile LCP < 2.5 s / CLS < 0.1 | Steps 16–17, 19 |
| F7 | Provider links on real phones (`check:provider-links` + checklist) | Step 18 |
| F11 | (Optional) a real TV Time export | Step 21 |
| F12 | (Optional) Supabase asymmetric JWT signing keys | FOUNDER_INPUTS F12 |

Also founder-run but not numbered in FOUNDER_INPUTS: uptime monitors (LAUNCH Step 20) and backups setup (Step 15). Inferred: both are account clicks covered by the runbook, so no engineering work is needed.

### 3.2 Engineering items NOT closed (documentation only, non-blocking)

| ID | Item | Evidence | Owner · size |
|---|---|---|---|
| E-1 | **RELEASE_NOTES.md is stale on C-18.** It still says C-18 is "Not recorded yet" and the close-out E2E is "Unverified", and that the board Status column was not updated. All three are now false. | Observed: `docs/09-closeout/RELEASE_NOTES.md:64`, `:88`, `:43` vs QA_VERIFICATION.md:233-246 and CLOSEOUT_BOARD.md:45-48 | tech-writer · XS: replace with 718 unit / 262 E2E at `24fcfd3`, link this file |
| E-2 | **ADR drift from ARCH_REVIEW_CLOSEOUT §8 not applied.** ADR-013 still says "the 6 migrations" (there are now 10 close-out files, 090…096 plus three dated 20261004); ADR-013 has no "migrate, then deploy" rule and no "errors visible ~1 h on Hobby" shortcut; ADR-002 §4 has no 120-day referenced-row refresh or "gone rows excluded from enrich" text. | Observed: `docs/04-architecture/ADR-013-closeout.md:224`; grep for "migrate, then deploy"/"Hobby" in ADR-013 finds nothing; `ADR-002-catalog-sourcing.md:40` mentions only the 150-day purge; `ls supabase/migrations` | architect · XS. Behaviour is right in code and in LAUNCH.md:225; only the ADRs lag |

No code, test or security item is open. Inferred from: board all done, both reviews SHIP with no open finding ≥ 80, and the gate is green.

---

## 4. After launch (not blocking)

Ordered by product value. None blocks launch.

1. **Measure the loops**: after 2 weeks of real traffic, read `scripts/metrics.ts` for weekly stubbers, activation (3+ stubs in 24 h) and shares per weekly stubber, against the PRD §7 targets (NEXT_PHASE_PLAN §3.5). Unverified until live.
2. **TV Time import out of beta** once F11 arrives; add the file to `e2e/fixtures/`.
3. **Non-Latin share images**: bundle a static CJK/Devanagari subset font for `next/og` (Observed limit `src/og/ShareCard.tsx:83`), so Japanese and Hindi titles print on the story image.
4. **Story/OG render cost on Hobby** (ARCH R1, Unverified): measure CPU per render after launch; add a per-IP limiter to the story route if usage spikes.
5. **CSV formula-injection guard on export** (security below threshold, conf ~40), as an opt-in that keeps Letterboxd round-trip.
6. **Import review rate limit** (security below threshold, conf ~60); trigger: review spam seen in moderation.
7. **Enrich budget watch** (ARCH R2): alert when `sync_runs.stats.enrich.unlisted_refreshed` nears `SYNC_ENRICH_MAX`.
8. **Paid OMDb tier (~$1/month)** if IMDb coverage is under 95% by day 21. This breaks the $0 rule, so it needs founder sign-off.
9. Phase 2 out-of-scope items stay parked (NEXT_PHASE_PLAN §3.2): episode tracking, follows/feeds, lists/Top 4, streaks, Recap, i18n, moderation UI. Still no AI and no posting.

---

```
— clearpath: mode=gate · evidence=labeled · verify=SHIP (demo build; live Blocked on F2–F7)
   memory=unchanged · unverified=live Supabase/TMDB/OMDb, real posters and phones, Lighthouse, TV Time format, OG CPU on Hobby; open docs E-1, E-2
```

## Orchestrator follow-up (2026-10-14)
E-1 closed: RELEASE_NOTES updated with the C-18 gate result. E-2 closed: ADR-013 Amendment 1 (10 migrations, migrate-then-deploy, log window, OG caching) and ADR-002 amendment (120-day referenced refresh, gone rows). Uptime monitor and backups added to FOUNDER_INPUTS as F13, F14. No engineering item remains open.
