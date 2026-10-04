# Release notes: Stubbed close-out (v0.1.0)

Date: 2026-10-04 · Branch `claude/movie-app-multi-agent-d2x9zd` · Version from `package.json`: `0.1.0`.

Stubbed is a collectible diary for movies and TV. It is built and tested in demo mode. It has **not yet run on real Supabase, TMDB and OMDb keys**. That is the founder's job, step by step, in [LAUNCH.md](LAUNCH.md).

## What the product does today

**Browse and decide**
- A curated catalogue: only titles rated **6.5 or higher** on TMDB, with a vote floor (200 for movies, 100 for TV). All configurable (ADR-003).
- Browse and sort by release date or rating. Search.
- Every title shows the **TMDB score** and the **IMDb rating** (from OMDb). The IMDb chip is hidden when the rating is unknown.
- **"Worth it?"**: a short summary on every title (hook, vibes, time commitment, age rating, verdict word). Built by fixed rules from stored data. **No AI anywhere.**
- **Where to watch**: streaming, rent and buy options per region (TMDB data from JustWatch), with a region switch and links only to allowlisted service sites.
- **"On {Service}" chips** on `/browse` to filter by streaming service. *(new in close-out)*
- Reviews from TMDB and from Stubbed users on each title.

**Your diary**
- Sign up with email and password or a magic link. Delete your account at any time.
- **Stub** what you watch. Every rewatch adds another stub. Each stub is a ticket in your wallet.
- **Pick a season** when you stub a TV show (for example S03). *(new)*
- Write reviews and ratings. They live **only** in Stubbed. Nothing is posted to other sites.
- Watchlist. Public profile at `/u/{handle}` with wallet, diary, reviews and watchlist tabs.
- **Avatar colour**: pick one of 8 colours in Settings. *(new)*

**Share and move your data**
- **Share** a title, your wallet, a review or a single stub: the phone's share sheet, or "Link copied". Share text never includes review text or private notes. *(new)*
- **Share images**: every title link gets a preview card (1200×630), and each stub has a story-sized image (1080×1920) you can post. *(new)*
- **Export** to Letterboxd CSV or JSON.
- **Import** from Letterboxd, IMDb ratings and TV Time (beta) at `/me/import`. The file is read on your device. Only matched titles, dates and ratings are sent. You see a preview first, and re-importing the same file adds no duplicates. *(new)*

**Privacy and trust**
- **First-party counts only**: anonymous daily totals in our own database. No cookies, no IP stored, no third-party tracker. Honours Global Privacy Control and Do Not Track. Can be switched off with `ANALYTICS_ENABLED=false`. *(new)*
- **Error reporting without a third party**: server errors and browser errors are logged as JSON lines with personal data removed, and counted per day. *(new)*
- Report a review by email. Spoiler tags on reviews.

**Running it**
- Demo mode with zero setup: 71 bundled titles, three demo accounts, no network.
- A nightly catalogue sync with guardrails, an encrypted nightly backup, a health endpoint for uptime monitors, all on free tiers.

## What was built in this close-out (C-01 to C-18)

Source: [CLOSEOUT_BOARD.md](CLOSEOUT_BOARD.md) and [ADR-013](../04-architecture/ADR-013-closeout.md). The board's "Status" column was not updated in the file; the done state below comes from the commit log (`git log`) and the review files.

| ID | What | Evidence |
|---|---|---|
| C-01 | Ticket stubs show where the title streams ("On {Service}" logo) | commits `90f5d95` (backend), `a52e09d` (frontend) |
| C-02 | "On {Service}" provider chips on `/browse`, plus a database index | `90f5d95`, `a52e09d`; migration `20261003090000_watch_filter.sql` |
| C-03 | Real 404 status for unknown titles, 308 redirect for a wrong slug | `90f5d95`, `a52e09d`; live smoke probes it |
| C-04 | "On Stubbed · N" review count goes up right after you post | `a52e09d` |
| C-05 | Faster, local session check with Supabase `getClaims()` | `90f5d95`; `src/server/auth/supabase.ts` |
| C-06 | Titles that left the catalogue but are in someone's diary get refreshed within TMDB's 6-month rule | `90f5d95`; migration `20261003092000_enrich_core_refresh.sql` |
| C-07 | Share button (Web Share, copy link, fallback) on title, wallet, review, stub | `a52e09d`; wallet stubs unblocked in `55fafa5` |
| C-08 | Share images: title card and stub story image, designed in a 3-way design arena | `4ac60f2` (design), `a52e09d`; `src/og/ShareCard.tsx`, `src/app/share/stub/[id]/` |
| C-09 | First-party, privacy-safe analytics | migrations `20261003094000_events.sql`, `…096000_events_dim_cap.sql`, `20261004091000_events_source_caps.sql`; `npx tsx scripts/metrics.ts` |
| C-10 | Season picker for show stubs | migration `20261003091000_stub_season.sql` |
| C-11 | Imports: Letterboxd, IMDb ratings, TV Time | migration `20261003095000_imports.sql`; `src/components/ImportFlow.tsx` |
| C-12 | Avatar colour picker | migration `20261003093000_profile_avatar_color.sql` |
| C-13 | Error logging and counting without a third-party service | `src/server/log.ts`, `/api/log`; error counts added in `3c23771` |
| C-14 | Launch kit: `launch:check`, `db:apply`, `smoke:live`, `check:provider-links` and their workflows; "migrate, then deploy" gate | `d5b809c`, `b3c4c15`; `scripts/`, `.github/workflows/` |
| C-15 | Brand name is one setting (`NEXT_PUBLIC_BRAND_NAME`) in case the trademark search fails | `a52e09d`; guard test `tests/lib/guards.test.ts` |
| C-16 | Docs: [LAUNCH.md](LAUNCH.md), these notes, README refresh | this change |
| C-17 | Security, code and architecture review of the close-out | [SECURITY_REVIEW.md](SECURITY_REVIEW.md): SHIP, SR-1 and SR-2 fixed. [ARCH_REVIEW_CLOSEOUT.md](ARCH_REVIEW_CLOSEOUT.md): SHIP; AR-C1 and AR-C5 closed in `b3c4c15`, AR-C2 to AR-C4 in `3c23771` (the review file itself still says "open") |
| C-18 | Full gate, full E2E, PM acceptance | **Not recorded yet** in any file I could see. QA E2E was still in progress at commit `3e510e3` |

## Known limits

- **TV Time import is beta.** The parser was built from documented column names, not a real export file. The UI labels it "beta" until a founder sample is checked (FOUNDER_INPUTS F11).
- **Share images drop non-Latin text.** To avoid a third-party font download at render time, image text keeps only Latin characters and a few punctuation marks (`src/og/ShareCard.tsx:83`). A Japanese or Hindi title, for example, may print as the fallback text on the image. The web pages are not affected.
- **IMDb chips take about 2 weeks to fill** on the free OMDb key (1,000 calls a day; the job spends 900). Until then some titles show only the TMDB score. A paid OMDb tier and a higher `OMDB_DAILY_BUDGET` make it faster.
- **"Worth it?" details fill over 3 to 5 nights** after the first sync (`SYNC_ENRICH_MAX` = 3,000 detail calls a night).
- **Non-commercial only.** The TMDB developer licence, OMDb data (CC BY-NC), JustWatch data via TMDB and Vercel Hobby are non-commercial. No ads, paid plans or sponsors without a commercial TMDB licence and Vercel Pro.
- **Errors are visible for about 1 hour** in Vercel Hobby logs. After that only the daily error counts remain (`npx tsx scripts/metrics.ts`).
- **Imports only match titles already in the catalogue.** Others are listed as "Not in Stubbed" and can be downloaded as a CSV.
- **Share images can stay cached up to 10 minutes** after a stub is deleted (ADR-013 §18).
- **Supabase Free has no backups** of its own and pauses after about 7 idle days. The nightly backup workflow and the nightly sync cover both. Move to Supabase Pro once real users arrive.

## Test status

Only numbers written in files in this repo are given here. Nothing below is a fresh run by the writer.

| When | What | Result | Source |
|---|---|---|---|
| 2026-09-28, commit `06e1627` | Full gate before the close-out | 535 unit tests, lint, typecheck, build and format green. **E2E: 212 passed, 8 skipped** | `.clearpath/log.md` (line 48) |
| 2026-09-28 | Where to watch E2E, full suite run | 210 passed, 10 skipped (7.5 min) | `docs/08-clearpath/QA_VERIFICATION.md` §8 |
| 2026-10-03 | Close-out backend | 651 unit tests, lint, typecheck, build, format green | `.clearpath/log.md` (line 58) |
| 2026-10-04 | Security review gate (with frontend work in progress) | Unit: 665 of 667 on the first run; the 2 failures were an in-progress frontend test and passed on re-run. Lint, typecheck, build pass. Format check failed on 3 frontend files at that time | `docs/09-closeout/SECURITY_REVIEW.md` |
| Close-out | Full E2E with the new specs (`analytics`, `brand`, `imports`, `season`, `seo-status`, `share`) | **Unverified**: the spec files exist in `e2e/`; no final result is written down yet (C-18) | — |
| Any time | Live services (real Supabase, TMDB, OMDb), real phones, Lighthouse | **Blocked** here: no keys, no network, no devices. Covered by LAUNCH.md Steps 16 to 19 | `QA_VERIFICATION.md` §5, §8 |

— clearpath: mode=build · evidence=labeled · verify=n/a
   memory=unchanged · unverified=C-18 final gate numbers; Supabase signing-keys menu name (F12)
