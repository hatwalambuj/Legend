# Stubbed: PM gap review (phase 7)

Product Manager · 2026-09-26 · Branch `claude/movie-app-multi-agent-d2x9zd`
Inputs: `docs/00-orchestrator/BRIEF.md` (incl. the founder scope change), `docs/01-product/PRD.md` v1.1, `docs/05-review/REVIEW.md`,
`docs/06-qa/QA_REPORT.md` (151 E2E green, BUG-03 open, observations O1 to O6).

## 1. Verdict

**The MVP is feature-complete and good. It is not ready for a public launch yet.** Every founder ask is built. The ticket, stub and wallet
idea works and is the best part of the product. It feels premium and nothing else in this space looks like it. Of the 32 rows in §4,
26 PASS, 4 are PARTIAL (A5, B3, E1, password reset), 1 FAILS (A7-AC1: IMDb chip missing on wallet stubs) and 1 is NOT VERIFIED (E3 performance).
What stands between this build and a credible public launch is a short list:

- one mobile UX problem on the most important screen (title page at 375 px);
- one gap in a founder ask (the IMDb chip is missing from wallet stubs);
- three go-live traps (the first nightly sync is likely to abort, a public demo URL is unsafe, and Supabase will not send auth emails);
- a minimum of trust features (delete account, contact/report, "notes are public" hint);
- a setup guide the founder can actually follow.

All of these are small. See **§6 MUST FIX NOW** (8 items). After those, run one engineering loop plus a staging smoke test on real keys, then launch.

## 2. How this review was done

- **QA results were reused, not rebuilt.** I read the 151-test matrix and the `docs/06-qa/screenshots/qa-*.png` set (home, browse, title,
  wallet, diary, sheets, auth, settings, 404 at 1440 and 375).
- **My own walk:** `npm run build && npx next start -p 3200` in demo mode (`CATALOG_MODE=fixtures DATA_MODE=local IMAGE_MODE=off
  DEMO_RESET_ON_BOOT=true DEMO_TODAY=2026-09-26`, data dir in the session scratchpad). I used Playwright scripts with Chromium from
  `/opt/pw-browsers`. I did not run `playwright install`. The scripts stay in the scratchpad and are not part of the repo.
  - **First-time Gen-Z user, 375 px (Pixel 7 touch):** home → browse → first ticket → Stub it (signed out) → create an account in the sheet →
    the stub resumes → wallet → You → settings.
  - **Returning rewatcher, 1440 px (`@dev`) and 375 px (`@maya`):** sign in from the header → header search "office" → The Office (×4) →
    Stub again (×5) → profile wallet / diary → search "transformers" (Split opinions) and "twilight" (Not in Stubbed) → stub-details sheet →
    same-day "Stub again today?" → review update → Bluey (no IMDb) → 404 → horizontal-scroll check on 6 screens.
  - `curl` status and timing checks for 404 and slug-redirect behaviour.
- **Zero console errors** in every walk. No horizontal scroll at 375 on `/`, `/browse`, a title page, `/u/maya`, `/me/stubs` or `/search`.
- New screenshots: `docs/07-gap-review/screenshots/pm-*.png` (fold shots at 375, wallet and diary at 1440 and 375, sheets).
- Limit: posters are the generated fallback (`IMAGE_MODE=off`), because the container can't reach `image.tmdb.org`. Real-poster
  backgrounds, `og:image` and live Supabase/TMDB/OMDb behaviour can only be checked on a staging deploy (MUST FIX #8).

## 3. Founder asks: scorecard

| Founder ask | Status | Evidence / note |
|---|---|---|
| Movies **and** shows, with ratings | **Met** | 66 fixture titles, type filter, TMDB score on every ticket |
| Sort by release date and rating | **Met** | 4 sorts, correct across pages and in the URL (QA A2) |
| Only titles rated ≥ 6.5 | **Met** | Plus a vote floor. Twilight 6.4 and Zombieland (TMDB 6.4 / IMDb 7.5) stay out; the copy says "6.5+ only" everywhere |
| Ticket-shaped cards | **Met, strong** | Perforation, notch, ADMIT ONE, S01–S09 season stub, torn wallet stubs with stacked ×N layers |
| "Stubbed" concept, one stub per rewatch | **Met, strong** | "Stub again" and "5× STUBBED"; diary shows #1…#5 per title; wallet stacks; "Stub again today?" for double features |
| Reviews | **Met** | Stars required, text optional, spoiler blur, one per title, EDITED and STUB #2 tags, TMDB reviews attributed |
| Accounts + tracking | **Met in demo, unproven live** | Live Supabase has never run (REVIEW R2) → MUST FIX #8 |
| Minimal Gen-Z "pro" design, poster-based background | **Met, one gap** | The palette-tinted page and tickets look premium. At 375 the title page's first screen is only the poster ticket (GAP-01) |
| IMDb rating on screen | **Mostly met** | On grid, rail, hero, search tickets and the detail chip ("IMDb rating · via OMDb", real tt links), hidden for Bluey. **Missing on wallet stubs** (GAP-02). Live coverage lags about 2 weeks on the free OMDb key (checklist step 3) |
| No posting to third parties | **Met** | No control, route or field for it (QA D3). The server makes zero outbound calls in demo. Composer copy: "Reviews are saved to Stubbed only." |
| "Worth it?" summary | **Met** | Hook, vibes, time, cert, verdict word, source line, "If you liked". Split opinions explained ("IMDb rates it higher than Stubbed users") |
| No AI | **Met** | No AI/LLM dependency in `package.json`; everything is rules and templates (ADR-009) |
| Free tiers (Vercel/Supabase) with a clear setup path | **Partly met** | The architecture fits free tiers. The setup path is incomplete: no Supabase Auth URL or SMTP steps, the sync guard default is a trap, placeholder TMDB logo (GAP-03/05/17) |

## 4. Per-story results

PASS = every AC met. PARTIAL = the story works but one AC is not fully met. FAIL = an AC is not met. NOT VERIFIED = can't be checked in this container.
"QA" means QA's E2E result is reused. "PM" means I re-walked it.

| Story | Result | Notes |
|---|---|---|
| A1 Browse curated catalogue | **PASS** (QA+PM) | No horizontal scroll on 6 screens at 375 (PM). Density at 375 is low: 2 tickets per screen, and the score line sits under the tab bar at the fold (GAP-15) |
| A2 Sort by release date / rating | **PASS** (QA) | |
| A3 Filter by type | **PASS** (QA) | BUG-04 (blank selected pill) fixed by QA |
| A4 Search | **PASS** (QA+PM) | "twilight" → "Not in Stubbed. We only list titles rated 6.5+…" (good copy). Header combobox Enter with no highlighted option goes to `/search?q=` (fine) |
| A5 Title detail | **PARTIAL** | AC1 PASS. AC2 PASS (palette tint; axe can't compute contrast on gradients, O4). AC3 NOT VERIFIED for `og:image` (only exists with real images). **AC4: UI PASS, HTTP returns 200 + noindex instead of 404** (BUG-03). Mobile fold issue: GAP-01 |
| A6 Read reviews | **PASS** (QA) | |
| A7 IMDb rating everywhere | **FAIL (AC1 only)** | AC2–AC6 PASS. **AC1: wallet stubs (`/u/{handle}` Stub wallet tab) show a bare TMDB "8.6" with no label and no IMDb chip** (GAP-02) |
| A8 Community + own rating | **PASS** (QA, after BUG-01/02 fixes) | "You rated ★★★★★" seen on The Office (PM) |
| B1 Sign up | **PASS** (QA+PM) | Sheet copy "Get your first stub / Track every watch. Rewatches count too." is on-brand. The stub resumed after sign-up (PM) |
| B2 Sign in / out, resume | **PASS** (QA+PM) | |
| B3 Profile | **PARTIAL** | AC1 PASS. **AC2: avatar can't be edited** (initials only; the API accepts `avatarUrl` but there's no UI). Low priority (GAP-18) |
| C1 One-tap stub | **PASS** (QA+PM) | Optimistic "1× STUBBED", toast with Undo, wallet badge +1 |
| C2 Stub with details | **PASS** (QA+PM) | The sheet doesn't say notes are public (REVIEW R8 → GAP-09). Date-picker `max` vs UTC (R7) |
| C3 Rewatch | **PASS** (QA+PM) | "Stub again today? … Double feature? It'll count as another watch." Good copy |
| C4 Manage stubs | **PASS** (QA) | |
| C5 My diary | **PASS** (QA+PM) | At 375, titles truncate hard ("Dune: Part T…") and where/note are cut (GAP-13) |
| C6 Watchlist | **PASS** (QA) | |
| D1 Write a review | **PASS** (QA) | O2: "Add a stub too?" repeats on every edit of an unstubbed title (P3) |
| D2 Edit / delete review | **PASS** (QA) | |
| D3 No third-party posting | **PASS** (QA) | |
| D4 Export | **PASS** (QA) | Format checked against the Letterboxd docs; not imported into a real Letterboxd account (do this in the staging smoke). R6: a 429 downloads a JSON error file |
| F1 "Worth it?" on detail | **PASS** (QA+PM) | Sits directly under the actions, but at 375 it starts about 1,060 px down (GAP-01) |
| F2 Time on ticket | **PASS** (QA) | |
| F3 Verdict rules | **PASS** (QA+PM) | |
| F4 Works offline | **PASS** (QA) | |
| F5 Link previews | **PASS** (QA) | Description only; `og:image` needs live images |
| E1 Attribution | **PARTIAL** | Copy PASS. **`public/tmdb-logo.svg` is a placeholder** (the file says so). TMDB's terms require the official logo |
| E2 Demo mode | **PASS** (QA) | Safe locally. **Not safe as a public URL** (GAP-04) |
| E3 Performance | **NOT VERIFIED** | Neither QA nor I measured LCP/CLS on 4G. Local TTFB is 20–30 ms. The home HTML is 185 KB (heavy RSC payload from two full rails). Measure on the Vercel preview |
| E4 Accessibility | **PASS** (QA, after BUG-06–09) | |
| E5 Security / abuse | **PASS** (QA) | |
| MVP scope item "password reset" | **PARTIAL** | Recovery works through a magic link, but you can never set a new password (GAP-07). In live mode it depends on SMTP (GAP-05) |

## 5. Bugs and gaps

Severity: **H** = blocks a credible public launch · **M** = hurts core experience, trust or a founder ask · **L** = polish.

### 5.1 New findings from this review

| ID | Sev | Area | Finding | Recommendation |
|---|---|---|---|---|
| GAP-01 | **H** (UX) | Title page, 375 px | The first screen is only the poster ticket. The `h1` sits at about 683 px, **Stub it at about 937 px and "Worth it?" at about 1,061 px**, but the visible area ends at about 740 px (812 minus the tab bar). The core page misses principle 1 ("two taps to stub") and principle 6 ("decide in 5 seconds"). Screenshot: `pm-title-fold-375.png` | At < 640 px, show a compact hero: poster ticket at about 45% width next to (or above) title, year/time and the TMDB + IMDb chips, with **Stub it + Watchlist visible without scrolling** and the start of "Worth it?" peeking above the fold. Desktop is fine |
| GAP-02 | **M** (founder ask) | Wallet stubs (`WalletStub.tsx:44`) | Torn wallet stubs print `SHOW · 8.6`. The number has no label and no IMDb chip. On *your own* wallet, a bare number reads as **your** rating. This misses the founder's "IMDb rating on every ticket stub, next to the TMDB score" | Print `8.6 TMDB · IMDb 8.9` (IMDb hidden when null, same rules as `Ticket`). Or show the user's own stars when they have rated it and the two chips otherwise. Include both scores in the accessible name |
| GAP-03 | **H** (go-live) | Nightly sync guardrail (`SYNC_GUARD_MIN=5000`, checked **per type** in `checkGuardrails`) | TMDB TV titles with ≥ 100 votes and ≥ 6.5, excluding Talk/News/Reality, are very likely **fewer than 5,000** (the system design estimates 10–15k titles in total, mostly movies). If so, **the very first live sync aborts and the catalogue stays empty**, and every later night aborts too. Not verifiable here (no TMDB network); the first `--dry-run` will tell | Split the guard per type (`SYNC_GUARD_MIN_MOVIE`, `SYNC_GUARD_MIN_TV`) with safe defaults (for example 3,000 / 1,000). Skip the min check on the first run (`last === null`) or make it a warning. Make `--dry-run` print the per-type counts clearly. Update `.env.example`, the workflow and the README |
| GAP-04 | **H** (security, if the demo is public) | Demo mode on a public host | With zero keys (the founder's most likely first Vercel deploy), `/api/auth/magic-link` returns a `devLink` for **any** email, so anyone can sign in as any account (REVIEW R3). On Vercel the store is `/tmp/stubbed-demo`, so accounts and stubs vanish on cold starts and differ between instances. A public URL would look broken and be unsafe | In production builds, demo mode needs an explicit opt-in (for example `DEMO_PUBLIC=true`). When it is on, `devLink` is only returned for the seeded `@demo.stubbed.app` accounts (or turned off), and the pill reads "Demo: data resets". E2E sets the flag. Document "never share a demo URL as the product" |
| GAP-05 | **H** (go-live) | Auth emails in live mode | Supabase's built-in email sender only delivers to **your own project team's addresses, about 2 per hour**. Magic link and "Forgot password?" would silently fail for every real user. The README doesn't mention SMTP | Founder checklist step 4 (custom SMTP, for example Resend's free tier of 3,000/month, 100/day). Add it to the README (MUST FIX #6) |
| GAP-06 | **M→H** (trust/legal) | Settings, reviews | No **delete my account**, no terms or contact, and no way to **report** a review. A public app with user-generated content and emails (GDPR/CCPA erasure) needs a minimum | Settings → "Delete account" (confirm; cascades stubs, reviews, watchlist, profile, auth user). A footer "Contact" link (mailto). A "Report" item on other people's reviews (mailto with the review id is enough for MVP; the founder hides rows in the Supabase table editor). A one-line "13+ only" and terms paragraph on About |
| GAP-07 | M | Settings | No way to set or change a password. After a magic-link login, the user still doesn't know their password | v1: "Set a new password" in Settings (Supabase `updateUser`) |
| GAP-08 | **H** (gate) | Live mode | Never run against real Supabase, TMDB or OMDb (REVIEW R2). E3 performance, `og:image`, real poster backgrounds and the Letterboxd import are also unverified | Staging smoke on a Vercel preview with real keys (MUST FIX #8) |
| GAP-09 | M (privacy) | Stub-details sheet | Notes are public on the diary, but the sheet only says "NOTE (optional)" (REVIEW R8). A user may write something private | Helper text: "Notes show on your public diary." |
| GAP-10 | L (SEO) | BUG-03 | Unknown title or profile → HTTP 200 + noindex. Wrong slug → 200 + client redirect instead of 308 | Next release: existence and slug check in `proxy.ts`, or drop `loading.tsx` on those routes |
| GAP-11 | M (growth) | Whole app | **No share action anywhere.** The growth loop (PRD §8) relies on sharing tickets, but there is no Copy link or Share on titles, profiles or reviews. Share images are v1 | Next release P1: a "Share" button (Web Share API with copy-link fallback) on the title page, the profile wallet and your own review. Then v1 story-sized ticket images |
| GAP-12 | M (TV depth) | Shows | Stubbing a show stubs the **whole show**: 5× The Office means five full runs. Rewatchers of TV watch seasons. The only workaround is the note | Next release: an optional "Season" picker in the stub sheet for shows (prints "S03" on the stub and diary). Episodes stay in v1 |
| GAP-13 | L | Diary 375 | Titles truncate to about 12 characters and where/note are cut | Let the title wrap to 2 lines and move the meta onto its own line |
| GAP-14 | L | Wallet badge | A red count badge showing *total* stubs (11, 13…) reads as "unread notifications" | Use a neutral badge colour, or show it only briefly after a new stub |
| GAP-15 | L | Browse 375 | About 2 tickets per screen; the score row sits under the tab bar at the fold | Consider a shorter poster area on mobile tickets, or a compact list toggle |
| GAP-16 | L | README | The status line still reads "MVP in progress… being built in parallel" | Update in MUST FIX #6 |
| GAP-17 | M (founder ask) | README "Going live" | Missing: Supabase Auth Site URL / Redirect URLs, SMTP, where each env var goes in Vercel vs GitHub, the `production` GitHub environment, first-sync order and guard, backfill timing, the non-commercial licences | MUST FIX #6 (use §8 of this document as the source) |
| GAP-18 | L | Profile | Avatar can't be edited (B3-AC2) | Next: pick an avatar colour or gradient. No uploads in the MVP |

### 5.2 Carried over from QA and Review (still open)

| ID | Sev | Status / decision |
|---|---|---|
| BUG-03 soft 404 / no 308 | L | → GAP-10, next release |
| O1 API `sort=nope` → 400 vs ADR "fallback" | L | Decision: keep 400 for the API (strict contract), fall back on pages. Fix the ADR-003 wording |
| O2 "Add a stub too?" on every edit | L | Show it only on the first save |
| O3 no `og:image` with `IMAGE_MODE=off` | – | By design; check on staging |
| O4 contrast on gradients not machine-verifiable | L | Visual check on staging with real posters (scrim ≥ .60) |
| O5 404 CTA "Back to Discover" | – | Accepted. Discover hosts the browse grid |
| O6 / R6 export 429 saves a JSON error file | L | Next release: a fetch button with a toast |
| R7 date-picker `max` vs UTC | L | Next release |
| R10 "On Stubbed · N" after a first review | L | Next release |
| R1 CSP `unsafe-inline` | L | Next release (nonce CSP) |

## 6. MUST FIX NOW (blocks a credible public MVP launch)

Keep this list closed. Anything not here goes to the next release.

| # | Item | Owner | Size |
|---|---|---|---|
| 1 | **Mobile title page above the fold** (GAP-01): title, both score chips and **Stub it / Watchlist** visible without scrolling at 375×812. The top of "Worth it?" should peek above the fold | FE | S–M |
| 2 | **Wallet stubs show labelled scores with the IMDb chip** (GAP-02). Same null-hides rule; both scores in the accessible name. Add an E2E assertion on `/u/dev` | FE | S |
| 3 | **Sync guardrail can't brick the first live sync** (GAP-03): per-type mins with safe defaults, no min abort on the first run, clear per-type counts in `--dry-run`. Update the env, the workflow and the README | BE | S |
| 4 | **Demo mode is safe if someone deploys it publicly** (GAP-04): opt-in flag in production, and `devLink` only for seeded demo accounts. Pill copy "Demo: data resets" | BE | S |
| 5 | **Trust minimum** (GAP-06 + GAP-09): Delete account in Settings (full cascade in both repos plus the Supabase auth user), footer Contact link, "Report" on others' reviews (mailto with the review id), "13+ / terms" lines on About, "Notes show on your public diary" hint in the stub sheet | FE+BE | M |
| 6 | **A setup guide the founder can follow** (GAP-05/16/17): rewrite README "Going live" from §8 below. Include Supabase Auth URLs and custom SMTP, which variable goes in Vercel vs GitHub Actions, the first dry-run, backfill timing and the licence notes. Fix the stale status line | Architect/docs | S |
| 7 | **Official TMDB logo** replaces `public/tmdb-logo.svg` (E1; TMDB terms). The asset must be downloaded by the founder or an engineer from TMDB's logos page (the container has no network) | Founder → FE | XS |
| 8 | **Staging smoke on real keys before announcing** (GAP-08): Vercel preview + Supabase + TMDB + OMDb. Sign-up → stub → review → export (import the CSV into a real Letterboxd account) → magic-link email arrives → httpOnly `sb-*` cookies → Lighthouse mobile on a title page (E3: LCP < 2.5 s, CLS < 0.1) → `og:image` unfurl → real-poster backgrounds and contrast | Founder + QA | M |

## 7. Next release (prioritised backlog)

| P | Item | Why |
|---|---|---|
| P1 | Share button (Web Share + copy link) on title, wallet and review (GAP-11) | Main growth loop; costs almost nothing |
| P1 | Story-sized share images of a stub/wallet (PRD v1) | Gen-Z distribution; the ticket is the artefact |
| P1 | Season picker for show stubs (GAP-12) | Makes "stub per rewatch" honest for TV |
| P1 | Set / change password in Settings (GAP-07) | Account hygiene |
| P1 | Real 404 / 308 status (GAP-10, BUG-03) | SEO as the catalogue grows |
| P1 | Imports: TV Time export, Letterboxd CSV, IMDb ratings CSV (PRD v1) | TV Time shut down on 2026-07-15; its users are the fastest cohort to win |
| P2 | Where to watch (TMDB/JustWatch providers, attributed) | Top reason people open a title page |
| P2 | Mobile density: shorter ticket poster or list toggle (GAP-15); diary wrap (GAP-13); neutral wallet badge (GAP-14) | Polish |
| P2 | Export button that toasts on 429 (R6); date-picker UTC clamp (R7); "On Stubbed · N" refresh (R10); "Add a stub too?" only once (O2) | Polish |
| P2 | Avatar colour picker (GAP-18) | B3-AC2 completeness |
| P2 | Nonce CSP (R1) | Hardening |
| P3 | Follow and friends feed, lists / Top 4, weekly streaks, PWA (PRD v1) | Retention after launch |
| P3 | Minimal moderation tooling (hide a review from an admin view) instead of editing the table by hand | Needed once reports arrive |

## 8. Founder launch checklist (plain words)

Do these in order. Nothing here needs code changes except where "MUST FIX" is noted.

**0. Name and brand (before spending on anything)**
- Run a trademark clearance search for **"Stubbed"** (USPTO and EUIPO, classes 9, 41, 42). Watch out for **AMC Stubs** (AMC Theatres' loyalty programme) and apps like MyStubs or TicketStub. Use a trademark attorney for a one-off clearance opinion if you can. If it fails, the fallback name is **Punched** (`docs/01-product/naming.md`).
- Register the domain and social handles you want before announcing.

**1. TMDB (the catalogue)**
- Create an account at themoviedb.org → Settings → API → request a **Developer** key (non-commercial). Copy the **API Read Access Token** (the long one). It becomes `TMDB_READ_TOKEN`.
- Download the official TMDB logo from TMDB's "Logos & Attribution" page and replace `public/tmdb-logo.svg` with it (MUST FIX #7). Keep the notice text as it is.
- TMDB's free licence is **non-commercial**: no ads or paid plans without a commercial TMDB licence.

**2. OMDb (the IMDb rating)**
- Get a free key at omdbapi.com/apikey.aspx and click the activation link in the email. It becomes `OMDB_API_KEY`.
- The free key allows 1,000 calls a day and the job uses 900 a night, so it takes **about 2 weeks** before every title shows its IMDb chip. For launch month, consider the OMDb Patreon tier (from about $1/month; raise `OMDB_DAILY_BUDGET` to match) so every chip is there on day one. OMDb data is CC BY-NC (non-commercial).

**3. Supabase (database + accounts)**
- Create a project (pick the region closest to your users) and save the database password.
- Project Settings → API: copy the **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`), the **anon / publishable key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and the **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`). The service_role key is a master key: never paste it anywhere public or into a `NEXT_PUBLIC_` variable.
- Create the tables: either the Supabase CLI (`supabase link` then `supabase db push`), or open the SQL editor and run the three files in `supabase/migrations/` **in name order**.
- Authentication → Providers → Email: turn **Confirm email OFF** for the MVP (as in the README).
- Authentication → URL Configuration: set **Site URL** to your real domain (for example `https://stubbed.app`). Under **Redirect URLs** add `https://stubbed.app/auth/callback` and your Vercel preview pattern (for example `https://*-yourteam.vercel.app/auth/callback`). Without this, magic links fail.
- Authentication → Emails → **SMTP settings: set up custom SMTP.** Supabase's built-in sender only delivers to your own team's addresses, about 2 an hour. Resend's free tier (3,000/month, 100/day) is enough: verify your domain in Resend, then paste its SMTP host, user and password here.
- The free tier pauses a project after 7 days without activity (the nightly job keeps it awake) and has **no backups**. Move to Pro ($25/month) once real users arrive.

**4. Vercel (the website)**
- Import the GitHub repo (framework: Next.js; Node 22 to match `.nvmrc`).
- Project → Settings → Environment Variables. Add for **Production and Preview**:
  `NEXT_PUBLIC_SITE_URL` (your domain), `TMDB_READ_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `REVALIDATE_SECRET` (make one with `openssl rand -hex 32`). `OMDB_API_KEY` is only needed by the nightly job.
- **Do not** set any `DEMO_*` variable, and don't leave `IMAGE_MODE=off`. **Never share a deploy that has no keys**: that is demo mode, and it is not safe as a public site until MUST FIX #4 lands.
- Add your custom domain. Vercel **Hobby is for non-commercial use only**: upgrade to Pro ($20/month) before any ads or payments.

**5. GitHub Actions (the nightly job)**
- Repo → Settings → Environments → create **`production`** (the workflow uses it).
- Settings → Secrets and variables → Actions. Add as **secrets** (repo-level or in the `production` environment): `TMDB_READ_TOKEN`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OMDB_API_KEY`, `REVALIDATE_SECRET`
  (the same value as in Vercel). Add as a **variable**: `NEXT_PUBLIC_SITE_URL`.

**6. First nightly sync**
- Actions → "Nightly catalogue sync" → **Run workflow** with **dry_run = true**. Read the log: it shows how many movies and shows pass the 6.5 rule.
- Until MUST FIX #3 lands: if either number is below 5,000, add the repo variable `SYNC_GUARD_MIN` set to about 80% of the smaller number. Otherwise the real run aborts and the site stays empty.
- Run it again with dry_run = false. Expect browse and search to work after the first night. "Worth it?" details and time lines fill in over **3–5 nights** (3,000 enrichments a night), and IMDb chips over about 2 weeks on the free OMDb key.
- After that it runs by itself every night at 03:17 UTC.

**7. Before telling anyone**
- Do the staging smoke test (MUST FIX #8): sign up, stub, stub again, review, delete a stub, export, import the CSV into your own Letterboxd account, and request a magic link to a Gmail address to check that it arrives.
- Check the About page: TMDB logo, "IMDb ratings via OMDb", privacy text, contact.
- Set up an inbox for the Contact/Report address.

## 9. Sources (new in this review)
- [Supabase: Send emails with custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase: Production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase discussion #15896: change to email rate limits](https://github.com/orgs/supabase/discussions/15896)
- [Resend: pricing / free tier](https://resend.com/docs/knowledge-base/what-is-resend-pricing) · [Resend new free tier](https://resend.com/blog/new-free-tier)
- Licence and quota facts for TMDB, OMDb, IMDb datasets, Vercel Hobby and Supabase Free: `docs/01-product/research.md` (sources cited there).
