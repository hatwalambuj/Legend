# Stubbed — QA report (phase 6)

QA Engineer · 2026-09-26 · Branch `claude/movie-app-multi-agent-d2x9zd` · Scope: every MVP user story in
`docs/01-product/PRD.md` §6 (Epics A–F), checked in a real Chromium against the **production build in demo mode**.

## 1. Verdict

**Ready for PM gap review.** 151 E2E tests pass (3 skipped by design: they apply to one viewport only) on
desktop 1440 px and mobile 375 px touch. QA found **9 bugs** and fixed 8 of them with small changes. The one
still open (BUG-03, soft 404s caused by streaming) is low severity and needs an architecture decision.
Six more observations are listed in §5; none of them blocks release.

End state (run from a cold server, fresh demo data):
`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check && npm run test:e2e` → **all green**
(unit tests: 38 files, 248 tests; E2E: 151 passed, 3 skipped, about 5.5 min).

## 2. Environment

| Item | Value |
|---|---|
| App | `npm run build && next start -p 3100` (Next 16.3.6, React 19), started by Playwright `webServer` |
| Mode | Demo with zero API keys. `CATALOG_MODE=fixtures`, `DATA_MODE=local`, `IMAGE_MODE=off` (ADR-006/007: generated posters, no `image.tmdb.org`), `DEMO_RESET_ON_BOOT=true`, `DEMO_DATA_DIR=.data/e2e`, `DEMO_TODAY=2026-09-26` |
| Browser | Chromium from `/opt/pw-browsers` (chromium-1194). `@playwright/test` 1.56.1. `playwright install` was never run |
| Projects | `desktop`: Desktop Chrome at 1440×900 · `mobile`: Pixel 7 emulation (isMobile, hasTouch) at **375×812** (was 412 px; changed so the run matches PRD A1-AC3) |
| Workers | 1, `fullyParallel: false`, retries 0 locally / 1 on CI |
| a11y | axe-core 4.13.0, injected with `page.evaluate`. It was already in `node_modules` through `eslint-plugin-jsx-a11y`. **It is now pinned as a devDependency** (`axe-core@4.13.0`, exact; nothing new was downloaded). `@axe-core/playwright` was not added |
| Server network guard | `e2e/support/net-guard.cjs` is preloaded into `next start` only, through `NODE_OPTIONS` in the webServer command. It records every non-loopback TCP connect and DNS lookup to `.data/e2e-net.jsonl`. It only observes and never blocks |

### Harness guarantees (`e2e/support/fixtures.ts`)
- **Every test fails on any browser console error or uncaught page error.** A test can allow-list one expected pattern, for example the 401 from a deliberately wrong password or the real 404 document.
- **Every test fails on any browser request to a host other than the app.** This checks zero third-party network in demo mode.
- `page.goto` / `page.reload` wait until React's streamed hidden `<div hidden id="S:0">` has been revealed (see §6).
- Tests that write data use **fresh accounts** created through the API. API sign-ups spread over fake `X-Forwarded-For` IPs so the per-IP auth limiter never trips. Desktop and mobile write to **different titles** (`perProject`). As a result the suite can be re-run against a warm server: it was run about 6 times against the same server without a reset.

## 3. Test matrix (story → spec → result, desktop + mobile)

PASS means every AC listed passed on both projects, unless the row says otherwise.

| Story / AC | Spec (test) | Result |
|---|---|---|
| **A1** browse grid: poster, title, year, type, TMDB, IMDb, time (AC1) | `browse` "grid shows ticket cards…" | PASS |
| **A1-AC2** ≥ 6.5 + vote floor, every sort × type × page (API walk) | `browse` "API: every listed title clears…" | PASS |
| A1-AC2 edge cases: Twilight 6.4/13k, Tampopo 8.0/150, Pachinko TV 8.0/99, Bake Off (Reality), Zombieland all **absent**; Paterson 6.5/200 and Emily in Paris 6.5/100 **present** | `browse` (API + UI after Load more) | PASS |
| **A1-AC3** logged-out, 375 + 1440, no horizontal scroll | `browse`, `platform` "every screen" (17 public + 6 owner screens) | PASS |
| **A2-AC1** four sort options | `browse` "sort control…" | PASS |
| **A2-AC2** order correct across page boundaries | `browse` "API order is a correct total order…" ×4 sorts × 3 types, page size 5; UI Load-more list = API list | PASS |
| **A2-AC3** sort in URL, shared link reproduces the view | `browse` "sort control…" | PASS |
| **A2-AC4** rating ties → vote count desc → title; release ties → title | `browse` "tie-breaks…" (8.7 cluster; Paterson before Emily in Paris at 6.5; Dune/Shōgun and Barbie/Oppenheimer on the same date) | PASS |
| **A3** All / Movies / Shows in URL (AC1); shows sort by first-air date (AC2) | `browse` "type filter…" | PASS |
| Load more: no dupes or gaps; no-JS link carries the cursor; tampered cursor → page 1 | `browse` "Load more…" | PASS |
| **A4-AC1** partial, case- and accent-insensitive (`shogun`, `AMELIE`, `spider`), year + type shown | `search` (API, search page, desktop combobox with ↑/↓/Enter/Esc) | PASS |
| **A4-AC2** "Not in Stubbed — we only list titles rated 6.5+" | `search` (page empty state + header combobox copy) | PASS |
| **A5-AC1** detail: poster, title, year, runtime/seasons, genres, overview, director/creator, cast, trailer, TMDB + votes, IMDb, Stubbed, Worth it? | `title` "Dune: Part Two shows every detail field…", "Bluey…" | PASS |
| **A5-AC2** background derived from the poster palette (follows client navigation) | `title` "A5-AC2…" | PASS · contrast: see §5 O4 |
| **A5-AC3 / F5** `<title>`, `description` = `og:description` = "{hook} {time} · {verdict}" ≤ 160, `og:title`, `og:type` | `title` "A5-AC3 / F5…" | PASS (no `og:image` when `IMAGE_MODE=off`, by design) |
| **A5-AC4** unknown ids show a 404 page with a way back | `title` "wrong slug… 404…" | PASS for the UI · **HTTP status is 200 (noindex)**, see BUG-03 |
| Canonical slug redirect (contract §7) | same | PASS in the browser · no HTTP 308, see BUG-03 |
| **A6-AC1** Stubbed reviews (avatar, handle, stars, date, text, STUB #2, EDITED), sort Highest, TMDB tab (attributed, read-only) | `title` "Stubbed reviews list…" | PASS |
| **A6-AC2** spoiler blurred (CSS blur + `aria-hidden`) until "Show spoiler" | `title` "A6-AC2…", `reviews` "a spoiler review is blurred for everyone else" | PASS |
| **A6-AC3** empty state + "Be the first to review" | `title` "Bluey…" | PASS |
| **A7-AC1** IMDb chip on grid and rail stubs | `browse` "A7…", "home…" | PASS |
| **A7-AC2** detail chip: rating, "690k votes", "IMDb rating · via OMDb", read-only link to the real `tt` id | `title` "Dune…" | PASS |
| **A7-AC3** Bluey (no IMDb id): chip, link and "IMDb" text hidden, never 0 or N/A | `browse` "A7…", `title` "Bluey…" | PASS |
| **A7-AC5** Zombieland (TMDB 6.4 / IMDb 7.5) not in browse or search, still reachable by URL | `browse` "A7-AC5…" | PASS |
| **A7-AC6** ticket accessible name has both scores ("…rated 8.1 on TMDB and 8.5 on IMDb"); TMDB only for Bluey | `browse` "A7…" | PASS |
| **A8-AC1** "Stubbed 8.4 · 5 ratings" (Dune); "1 rating · average unlocks at 5" (Past Lives); **hidden with none** (Bluey) | `title` | PASS **after fix BUG-01** |
| **A8-AC2** average follows save, edit and delete (unlocks at 5) | `reviews` "average unlocks at 5…" | PASS |
| **A8-AC3** "You rated ★★★★½" | `reviews` | PASS **after fix BUG-02** |
| **B1-AC1** inline validation (email, 8+ password, handle rule), live handle availability | `auth` "inline validation…" | PASS |
| **B1-AC2** duplicate email / handle errors | same | PASS |
| **B1-AC3** after sign-up: signed in and on the page you came from (sheet and `/signup?next=`) | `auth` | PASS |
| **B2-AC1** one generic error for a wrong password and for an unknown email | `auth` | PASS |
| **B2-AC2** session survives reload; sign-out clears it (API `/api/me`, `/me/stubs` → sign-in) | `auth` | PASS |
| Magic link (demo dev link) → signed in → `next`; broken link explains itself | `auth` | PASS |
| Open redirect (R11): `//evil.com`, `/\t/evil.com`, `/\evil.com`, `https://evil.com`, `/%09/evil.com`, `/\n/evil.com` → always same-origin | `auth` "a broken magic link…" | PASS |
| **B2-AC3** pending action resumes after auth: Stub it (sign-up in sheet), Watchlist, Review (composer focused), `/signin?next=…&action=stub` | `auth` (3 tests) | PASS |
| **B3-AC1** `/u/dev`: name, avatar, bio, 12 total / 6 in 2026 / 6 rewatches / ×4 The Office; wallet stacks (×4, ×3), diary 12 rows (Twilight kept), reviews 4 | `profile` | PASS |
| **B3-AC2** owner edits name and bio, handle immutable (UI + API) | `profile` | PASS |
| **C1-AC1/2** one-tap stub: optimistic count, "1× STUBBED · Last stub…", stamp, toast + Undo, wallet badge; grid quick action "✓ 1×" | `stubs` | PASS |
| **C2-AC1** details sheet: date max today / min Jan 1 of (year − 1) with inline errors; Where (4 options); note ≤ 280 with counter; long-press opens the sheet | `stubs` | PASS · server allows today + 1 (contract v1.2), and future or too-early dates → 400 |
| **C3-AC1/2** "Stub again", "N× stubbed"; every stub is its own diary row (#1/#2/#3, own dates); count = rows | `stubs` | PASS |
| **C3-AC3** second same-day stub asks "Stub again today?" (Cancel keeps the count, confirm adds one) | `stubs` | PASS (confirm focus fixed, BUG-06) |
| **C4-AC1** edit date, where and note; delete with confirmation (Cancel focused); counts update | `stubs` "edit and delete stubs…" | PASS **after fix BUG-05** (wallet badge) |
| **C5-AC1/2** `/me/stubs` newest first, grouped by month with counts, Movies/Shows filter with the "N STUBS" total; empty-state CTA | `stubs` | PASS |
| **C6-AC1** watchlist add/remove; stubbing a watchlisted title offers "Remove"; list is private to the owner | `stubs` "C6…" | PASS |
| **D1-AC1** stars required (0.5–5, keyboard ←/→/Home/End), text ≤ 5,000 with counter, spoiler switch | `reviews` | PASS |
| **D1-AC2** one review per user: the form edits it; a second PUT → 200, still one row | `reviews` | PASS |
| **D1-AC3** saved review at the top, "EDITED" after a change | `reviews` | PASS |
| **D1-AC4** "Add a stub too?" → Add stub creates one | `reviews` | PASS |
| **D2-AC1** delete removes the review from the title page, the profile and visitors' view | `reviews` | PASS |
| Review ↔ stub link kept on edit ("STUB #2", R11) | `profile` "R11…" | PASS |
| **D3-AC1** no "post to IMDb/Trakt/TMDB" control, test id, route or field | `title` "D3…" | PASS |
| **D4-AC1/2** Letterboxd CSV (exact header, CRLF, RFC 4180 quoting, movies only, `Rewatch=true` after the first, rating/review on the latest stub) + JSON; 1 per 10 min per format → 429 + Retry-After; 401 signed out | `profile` "D4…" | PASS |
| **E1** footer TMDB logo + notice, "IMDb ratings via OMDb" on every page | `platform` | PASS |
| **E2** demo pill on every page; data persists across reloads | `platform`, `stubs` | PASS |
| **E4** keyboard: skip link → main; tab to ticket (visible ring) → Enter; Stub it reachable; auth sheet traps focus, Esc closes, focus returns; every control has a name, every image has alt; reduced motion collapses animations | `platform` "E4…" | PASS |
| E4 / WCAG 2.1 A+AA (axe): 11 public pages + 3 signed-in pages, zero serious or critical findings | `platform` "axe…" | PASS **after fixes BUG-07/08/09** |
| **E5** CSP (`default-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`); no secrets in client JS; httpOnly + SameSite=Lax session cookie; cross-origin POST → 403; review HTML rendered as text; 30 stubs/min then 429 | `platform` "E5…", `reviews` | PASS |
| **F1-AC1–3** slip directly under the action row; line order hook → vibes → time → cert → verdict → like; hook ≤ 120, ≤ 3 vibes, verdict ≤ 3 words + source line | `title` "F1…" | PASS |
| **F1-AC4** "FROM TMDB" on the Godfather and Paterson (tagline/overview hooks); none on hand-written hooks; missing cert hidden (Seven Samurai) | `title` | PASS |
| **F2-AC1** ticket time: `2024 · 2H 46M`, `2018 · 3 SEASONS · ≈18H`, unknown episode length `2005 · 3 SEASONS` | `browse` "A7…" | PASS |
| **F3-AC1–4** Widely loved (Dune), Well liked (Arrival), Solid pick (Barbie), Split opinions + reason (Transformers), Mixed reviews (Twilight); source line names only the sources used (Stubbed only at 5+); no number in the verdict; no blended score (8.3) anywhere | `title` "F3…", "Dune…" | PASS |
| **F4** every fixture renders a full block offline | covered by F1/F3 + the zero-network checks | PASS |
| **ADR-006 §4** the server makes **zero outbound requests** (pages, search, auth, stubs, reviews, watchlist, export, magic link) | `platform` "the demo server makes no outbound network requests" (net guard log: only `armed` lines) | PASS |
| Browser makes zero third-party requests on every test | auto fixture | PASS |
| Mobile shell: tab bar Discover/Search/Wallet/You (≥ 44 px targets, badge), bottom-sheet auth | `platform` "mobile shell" | PASS |

## 4. Bugs found

| # | Sev | Area / AC | Repro | Status |
|---|---|---|---|---|
| BUG-01 | M | Title detail, A8-AC1 | Open `/title/tv/82728-bluey` (0 ratings). The Stubbed chip reads "0 STUBBED reviews · avg unlocks at 5", but the AC says hide it. With 1–4 ratings the copy counted *reviews* and said "avg", not "N ratings · average unlocks at 5" | **Fixed**: `src/components/ScoreChips.tsx` hides the chip at `ratingCount === 0` and uses `ratingCount` + the PRD copy. A unit test was added and one assertion updated in `ScoreChips.test.tsx` |
| BUG-02 | M | Title detail, A8-AC3 | Sign in, rate a title, stay on its page. There was no "You rated ★★★★½" anywhere | **Fixed**: `src/components/TitleActions.tsx` adds a line under the stub line (`data-testid="my-rating"`, stars `role="img"` labelled "4.5 out of 5 stars"), fed from `TitleState.myReview` |
| BUG-03 | L (SEO) | A5-AC4, contract §7 | `curl -i /title/movie/999999999` and `/u/nobody` → **200** with `<meta name="robots" content="noindex">` and the 404 UI. `curl -i /title/movie/693134-wrong-slug` → **200** with a meta-refresh/RSC redirect, not a 308. Cause: the root `app/loading.tsx` (and route-level `loading.tsx`) makes every page stream, so the status is committed before `notFound()` / `permanentRedirect()` run. This is documented Next 16 behaviour (`node_modules/next/dist/docs/01-app/02-guides/streaming.md` "Status codes") | **Open**. Users see the right page and search engines get noindex. For real 404/308 status codes, do the existence and slug check in `src/proxy.ts` (fast index lookup) or drop `loading.tsx` from the title and profile routes. That needs an Architect/FE decision, not a one-line fix. The E2E test accepts 200 + noindex or 404 |
| BUG-04 | M | All segmented controls (A3 type filter, C2 "Where", review source tabs, diary filter) | On mobile, tap "Streaming" in the stub sheet, or tap "All" in `/me/stubs`: the selected pill turns blank (text colour = background). On desktop, hovering the selected option does the same. `.seg > button:hover { color: var(--fg) }` (0,2,1) beat `.seg > [aria-pressed='true']` (0,2,0), and touch keeps `:hover` after a tap. Seen in the first-run screenshots `qa-stub-sheet-375.png` / `qa-my-stubs-375.png` | **Fixed**: `src/app/globals.css` element-qualifies the selected selectors so they win over `:hover`. A regression check (hovered selected segment: colour ≠ background) is in `browse` "type filter…" |
| BUG-05 | L | C4 / header wallet badge | Delete a stub from `/me/stubs`: the diary and "N STUBS" update, but the header or tab-bar wallet badge keeps the old count until a full reload (`router.refresh()` doesn't re-read `/api/me`) | **Fixed**: `AppContextValue.refreshWallet()` (`src/hooks/useApp.ts`, `AppProvider.tsx`, `test-utils.tsx`) is called by `DiaryRowMenu` after a delete |
| BUG-06 | L (a11y) | C3-AC3 confirm | Stub twice on the same day: "Stub again today?" opens with **Cancel** focused, although reviewer fix #17 says non-destructive confirms focus the confirm button. React's `autoFocus` fires before `Sheet` calls `showModal()`, which then focuses the first button | **Fixed**: `src/components/ConfirmDialog.tsx` focuses through refs in an effect that runs after the dialog opens (Cancel for destructive, confirm otherwise). Verified for both the stub and delete dialogs |
| BUG-07 | M (axe serious) | Title detail at 375 px | axe `scrollable-region-focusable`: the horizontally scrolling "Top cast" list can't be reached by keyboard | **Fixed**: `src/components/CastList.tsx` makes the list focusable (`tabIndex=0`) and names it after its heading |
| BUG-08 | L (a11y) | Demo pill, certification chip | axe `aria-prohibited-attr`: `aria-label` on a generic `<span>` (screen readers may ignore it) | **Fixed**: `DemoPill` gets `role="note"`; the cert chip gets `role="img"` + `aria-label="Rated PG-13"` (`WorthIt.tsx`) |
| BUG-09 | L (a11y, axe moderate) | Home, `/search` | axe `landmark-unique`: the browse toolbar region had the same name as its section ("Browse"), and `/search` had two unnamed `search` landmarks | **Fixed**: toolbar region named "Sort and filter" (`BrowseToolbar.tsx`), header search named "Quick search" (`HeaderSearch.tsx`) |

## 5. Observations (not fixed; for PM / Architect)

| # | Observation |
|---|---|
| O1 | `GET /api/catalog?sort=nope` → **400** `validation_failed` (API_CONTRACT §2). ADR-003 §2 says "unknown sort/type values fall back to the defaults, never an error". Pages do fall back (`/browse?sort=nope` shows the default view), but the ADR and the contract disagree for the API |
| O2 | Editing a review on a title the user never stubbed shows "Review saved. Add a stub too?" again instead of "Review updated". This is consistent with D1-AC4, but it repeats on every edit |
| O3 | With `IMAGE_MODE=off` (E2E) there is no `og:image`, because `tmdbImage()` returns null. In real image mode the w780 poster is used. A5-AC3 can only be fully checked with images on |
| O4 | axe reports `color-contrast` as **incomplete** (it can't tell) for text on the poster-tinted gradient backgrounds, so the 4.5:1 part of A5-AC2 can't be machine-verified there. Screenshots look fine (scrim ≥ .60, ADR-007). Text on solid surfaces (tickets, slip, chips) passes axe |
| O5 | The 404 page's CTA is "Back to Discover" (`/`). A5-AC4 says "a link back to browse". Discover hosts the browse grid, so QA accepts it; the PM may want the literal wording |
| O6 | Known residual risks still hold: R6 (a 429 on `<a download>` saves the JSON error as a file) and R10 ("On Stubbed · N" doesn't count a just-posted first review until reload; E2E asserts after reload) |

## 6. Flakiness notes and how the suite handles them

- **Streaming double DOM.** Right after `load`, React 19 may still hold the page inside `<div hidden id="S:0">` and reveal it a moment later (reveal throttling). Strict locators such as `getByTestId('sort-select')` then briefly match 2 elements (4 of 6 repeats failed before the guard). The fixture's `page.goto` / `page.reload` now wait until no `div[hidden][id^="S:"]` remains. No recurrence since (browse spec with `--repeat-each 2`, plus every later full run).
- **Spoiler un-blur is a CSS transition.** The test polls until the computed `filter` becomes `none` instead of reading it once.
- **Toasts** stack up to 2 and live 2.6–5 s. Assertions target a toast by its text and take `.last()` when two can match.
- **Re-runs on a warm server** accumulate data (extra reviews on the same titles). The affected assertions compare against live API counts: "On Stubbed · N" and the A8 average, which the test builds up to 4 background ratings and then computes from all ratings.
- **Rate limits.** Auth is per IP (50 sign-ups per 10 min in demo mode) and stubs are 30/min per user. API sign-ups use random `X-Forwarded-For` IPs, and the rate-limit test uses its own account.
- The one "Internal error: step id not found" line seen once from Playwright 1.56 was a reporter artefact while a teardown assertion failed. It has not come back since that assertion was fixed.
- Final numbers: several full runs, 0 flaky, 0 retries used.

## 7. Files

- Specs: `e2e/browse.spec.ts`, `e2e/search.spec.ts`, `e2e/title.spec.ts`, `e2e/auth.spec.ts`, `e2e/stubs.spec.ts`,
  `e2e/reviews.spec.ts`, `e2e/profile.spec.ts`, `e2e/platform.spec.ts`, `e2e/smoke.spec.ts` (Architect, kept).
- Support: `e2e/support/fixtures.ts` (guards, helpers), `e2e/support/net-guard.cjs` (server outbound recorder).
- Config: `playwright.config.ts` (mobile 375 px; net guard on `next start`; `E2E_NET_LOG`), `package.json` (+ `axe-core` devDependency, pinned).
- App fixes: `src/components/ScoreChips.tsx` (+ test), `TitleActions.tsx`, `ConfirmDialog.tsx`, `DiaryRowMenu.tsx`,
  `AppProvider.tsx`, `CastList.tsx`, `DemoPill.tsx`, `WorthIt.tsx`, `BrowseToolbar.tsx`, `HeaderSearch.tsx`,
  `test-utils.tsx`, `src/hooks/useApp.ts`, `src/app/globals.css`.
- Screenshots (`docs/06-qa/screenshots/qa-*-{1440,375}.png`): home, browse, browse-shows-rating-asc, grid-stubbed,
  search, search-not-in-stubbed, title-dune(-full), title-bluey, title-hysteresis, worth-it-split, spoiler-blurred,
  stub-toast, stub-sheet, stubbed-average, review-composer, signin, signin-error, signup-validation, my-stubs,
  profile-wallet / -diary / -reviews / -owner, settings, settings-export, about, 404; mobile-only: auth-sheet,
  tabbar, title-after-resume. (The `frontend-*.png` files are from phase 4b.)
