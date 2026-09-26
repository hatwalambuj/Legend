# Stubbed — Product Requirements Document (PRD)

Author: Product Manager · Date: 2026-09-26 · Status: **Scoping v1.0, ready for Design and System Design**
Inputs: `docs/00-orchestrator/BRIEF.md` · Evidence: `docs/01-product/research.md` · Name: `docs/01-product/naming.md`

---

## 1. Vision
**Stubbed is the collectible diary for movies and TV. Every watch earns a ticket stub, and the catalogue only includes the good stuff (rated 6.5 or higher).**

Letterboxd owns film diaries but has no TV. Serializd has TV but no film. TV Time shut down on 2026-07-15 and stranded about 25M users. Trakt is powerful but utilitarian, and it is getting paywalled. Stubbed covers **movies and shows in one place**, logging takes **one tap**, and the output is an object people want to **share**: a ticket.

Positioning line: *"Proof you watched."*

### Design principles (these become product rules)
1. **Two taps to stub.** Logging must be faster than posting a Story.
2. **Curated, not exhaustive.** Browse shows only titles with a TMDB rating of 6.5 or higher and a minimum number of votes.
3. **Your data is yours.** Stubs and reviews live in our DB, and you can export them (Letterboxd CSV, JSON) at any time.
4. **Honest integrations.** We never pretend to write to services that don't allow it (IMDb).
5. **Works offline and in demo mode.** Every screen must work with bundled fixtures and no API keys (a build constraint in BRIEF.md).

## 2. Personas

| Persona | Snapshot | Needs | Frustrations today |
|---|---|---|---|
| **Maya, 20, "the Story poster"** (primary) | A university student who watches 2–3 films a month plus 2 shows at a time. Discovers titles through TikTok edits. | Log fast. Look cool doing it. Have something to post. | Letterboxd has no TV. Her TV Time history is gone. The IMDb app feels like a shopping site. |
| **Dev, 24, "the rewatcher"** | Rewatches comfort shows and favourite films yearly, and cares about counts ("7th time watching The Office"). | Stub counts per title, rewatch dates, and a sense of ritual. | Most apps treat "watched" as a boolean. |
| **Priya, 27, "the reviewer"** | Writes thoughtful reviews and already posts on IMDb and Trakt. | One place to write, and a way to get the review onto other platforms without retyping. | No app writes to IMDb, and she copy-pastes everywhere. |
| **Leo, 17–19, "the browser"** (logged-out) | Opens a friend's shared link. | "Is this worth my 2 hours?", "Where can I watch it?", reviews. | Too many mediocre titles. Ad-heavy sites. |

## 3. Jobs to be done
- **J1** — When I finish something, I want to record it in seconds, so that I have proof and a history.
- **J2** — When I'm deciding what to watch, I want only titles that are actually good, sorted by what's new or what's best, so that I don't waste an evening.
- **J3** — When I loved (or hated) something, I want to write a review and see what others thought, so that I can process it and join the conversation.
- **J4** — When I rewatch something, I want it to count, so that my history reflects how much it means to me.
- **J5** — When I've watched a lot, I want a beautiful artefact of my taste, so that I can share my identity (a ticket, a recap).
- **J6** — When I already have reviews elsewhere (IMDb, Trakt, Letterboxd), I want my data to flow in and out, so that I'm not locked in.

## 4. Key scope decisions (explicit)

| # | Decision | Rationale (see research.md) |
|---|---|---|
| D1 | **The MVP covers movies and TV shows.** TV is tracked at **show level**; seasons and episodes are v1. | The brief requires shows. Show-level keeps the MVP small while still beating Letterboxd on TV. |
| D2 | **Primary data source: TMDB API.** It is free for non-commercial use with attribution, has TV, images and reviews, and has high limits. | IMDb's API is read-only and costs about $150k a year. IMDb's datasets forbid building an online database. OMDb has a 1,000/day cap. |
| D3 | **The catalogue rule is TMDB `vote_average ≥ 6.5` plus a vote floor: movies `vote_count ≥ 200`, TV `vote_count ≥ 100`.** All three values are env config. | Without a floor, titles with 5 votes and a 9.0 average flood the list. TMDB's own Top Rated uses about 200. TV gets fewer votes. The expected catalogue is about 10–15k titles (to verify on first ingest). |
| D4 | **Retention rule (hysteresis)**: a title that drops below the rule is hidden from browse and search but stays reachable by URL and in users' diaries. | Users' history must never lose items. |
| D5 | **Sorting**: release date (newest or oldest) and rating (highest or lowest). Popularity is the default for the home page only. Type filter: All, Movies, Shows. Optional genre and year filters are MVP-nice (P1). | This is the brief's requirement. Rating sort is always combined with the vote floor. |
| D6 | **Ratings shown**: the TMDB score (primary, 0–10, with vote count). The **IMDb rating badge through OMDb** is optional (P1), fetched lazily, cached for 7 days or more, and labelled "IMDb". The Stubbed community average appears once a title has 5 or more user ratings. | This is legally clean. OMDb is CC BY-NC and non-commercial, the same as our TMDB tier. |
| D7 | **Accounts**: email and password, plus magic link and Google OAuth (P1). In demo mode, auth runs locally. | This is a brief requirement, and the Architect picks the provider. |
| D8 | **Stubs**: a stub is one watch event (`title`, `watched_on` date defaulting to today, optional `where` (cinema, streaming, TV, other), optional note). **You can add multiple stubs per title** (rewatches). The stub count is shown on the title and in the diary. | This is the brand mechanic. "Watched" is not a boolean. |
| D9 | **Reviews**: one review per user per title, which can be edited. It has a rating (0.5–5 stars in half steps, stored as 1–10), text (up to 5,000 characters), and a spoiler flag. It can optionally be linked to a specific stub ("reviewed on rewatch #2"). Reviews are **stored in our DB (source of truth)**. | Our DB is the only place we fully control. The 1–10 storage maps cleanly to TMDB, Trakt, Letterboxd `Rating10` and IMDb. |
| D10 | **Outbound review sync**: IMDb has **no write route** (no API, and scraping or automation is banned), so the MVP ships a **manual "Also post on IMDb" assist** (copy the text plus a deep link) and a **Letterboxd-format CSV export**. **v1**: a Trakt sync adapter (history, ratings, and review as comment, text of 200 words or more counting as a review) and a TMDB rating push. Both are opt-in and behind feature flags. **v2**: Simkl. | This is the honest result from research.md sections 1, 2 and 4–6. Trakt is the only mainstream write target for review text, but it now needs VIP to own an API app and free users get one connected app, so it is not a launch dependency. |
| D11 | **Community reviews** on the detail page: Stubbed user reviews come first, then **TMDB reviews** (attributed and read-only). | Gives content from day 1 (cold start). |
| D12 | **Public by default**: browsing, title pages and public profiles need no login. Writing needs login. | "Open by URL" is in the brief, and it drives the share loop and SEO. |
| D13 | **Commercial status**: the MVP is **non-commercial** (no ads, no paid tier). | Keeps us inside the TMDB free tier, OMDb CC BY-NC and Vercel Hobby. Monetisation triggers TMDB commercial (about $149/month) and a hosting upgrade (see §10). |

## 5. Scope by release

### MVP (this build)
**Browse and discover**
- Home: a trending or popular rail plus "New & good" (sorted by release date), with tabs for All, Movies and Shows.
- Browse grid of **ticket cards** with sort (release date, rating; asc and desc), type filter, and infinite scroll or pagination.
- Search inside the curated catalogue (title, with year shown).
- Title detail page:
  - Backdrop and poster, with the **background adapting to the poster colour**.
  - Title, year, runtime or seasons, genres, overview, and director or creators.
  - The top 6 cast members, trailer link (if available), TMDB score and vote count.
  - The IMDb badge (P1) and your stub count.
  - Reviews (Stubbed, then TMDB).

**Accounts and profile**
- Sign up, sign in, sign out, and password reset (via magic link in real mode; trivial in demo mode).
- Profile: unique handle, display name, avatar (initials or generated by default), and short bio.
- A public profile page `/u/{handle}` showing total stubs, a recent stubs strip, and reviews.

**Stubs (tracking)**
- "Stub it" on a card or detail page adds a stub dated today in one tap. A long press or "…" opens a date, where-watched and note picker.
- Add another stub for a rewatch. The count badge reads "3× stubbed".
- Delete or edit a stub.
- My Stubs (diary): a reverse-chronological list grouped by month, filterable by movies or shows, with counts.
- Watchlist ("Want to watch") as a separate list. It is not a stub.

**Reviews**
- Write, edit and delete your review (rating, text, spoiler flag).
- Spoiler text is blurred until tapped.
- Review list on the title page, sortable by newest or highest rated.
- "Also post on IMDb" copies the review text to the clipboard and opens the IMDb title page, then asks "Did you post it?" to mark it as shared (manual).

**Data portability**
- Export my data as Letterboxd-import CSV (`tmdbID, imdbID, Title, Year, Rating10, WatchedDate, Rewatch, Review`) and as JSON.

**Platform**
- Responsive mobile and desktop layouts, meeting the WCAG 2.1 AA baseline.
- SEO-friendly title pages (SSR or SSG, OG tags).
- TMDB, JustWatch-ready and IMDb/OMDb attribution on an About or Credits page and in the footer.
- **Demo mode**: when API keys are absent, the app automatically uses bundled seed data (at least 60 titles, a mix of movies and shows across genres, years and ratings, including some near the 6.5 threshold, plus a few sample users with stubs and reviews) and local auth and storage.

### v1 (next 1–2 cycles after MVP)
- **TV depth**: seasons and episodes. Stub an episode, auto-progress "next episode", and show a progress bar per show.
- **Share ticket images**: generate a story-sized (1080×1920) and square PNG of a stub or review ticket, with the poster-tinted design and handle. Use the Web Share API with a download fallback. Each image carries a watermark and a short link.
- **Social follow**: follow users, a friends activity feed, "friends who stubbed this" on the title page, and review likes.
- **Lists**: custom ordered lists (public or private) and a "Top 4" profile showcase.
- **Where to watch**: TMDB watch/providers per region (JustWatch data, attributed on each item). Region is auto-detected and can be overridden.
- **Weekly streaks**: "stubbed something N weeks in a row" with 1 free "intermission" (freeze) a month. There are no daily streaks.
- **Imports**: IMDb ratings CSV, Letterboxd export ZIP or CSV, **TV Time export** (to capture displaced users), and Trakt.
- **Outbound sync adapters** (opt-in, feature-flagged): Trakt (history as plays, ratings, review as comment) and TMDB rating push.
- **PWA**: installable, offline shell, with queued stubs that sync when back online.
- Email or push notifications: a new review on a title you stubbed, and a friend follows you.

### v2 (scale and delight)
- **Stubbed Recap** (a Wrapped-style yearly recap, published early December; avoid the word "Wrapped", which is Spotify's brand): total stubs, hours watched, top genres, most-rewatched title, "your cinema age", a first and last stub of the year, and a story carousel of shareable cards. A monthly mini-recap follows later.
- **Recommendations**: "because you stubbed X" (content-based on genres, keywords and cast from the cached catalogue), then collaborative filtering once there is enough data. Everything stays inside the ≥6.5 catalogue.
- **i18n**: UI strings externalised from MVP day 1. Launch with en, then es, pt-BR, hi and de. Use TMDB `language` for localised titles and overviews, and region-aware release dates.
- Simkl sync adapter. Watchmode deeplinks if needed.
- Badges and achievements (for example "Criterion Kid", "Anime Arc").
- Moderation tooling (report review, shadow-hide, rate limits), and verified critics.
- Native wrappers (Capacitor) if PWA install rates are low.

### Out of scope (all releases unless revisited)
- Writing to IMDb by any automated means.
- Hosting or streaming video.
- Scraping any site.
- Showing titles below the rule in browse.
- Ads before a commercial TMDB licence is in place.

## 6. User stories and acceptance criteria (MVP)
IDs are stable. The PM gap review (Mode B) will mark each one PASS or FAIL. "Given demo mode" means the checks must pass with no API keys.

### Epic A — Browse and discover
**A1. Browse curated catalogue.** As a visitor, I want to browse movies and shows so that I can find something good.
- AC1: `/browse` (or home) shows a grid of ticket-shaped cards with poster, title, year, type badge (Movie or Show) and rating.
- AC2: No title with a TMDB rating below 6.5 or below the vote floor appears (demo seed includes titles at 6.4 with a high vote count and at 8.0 with a low vote count; neither may appear).
- AC3: It works logged-out, on 375 px mobile and 1440 px desktop, with no horizontal scroll.

**A2. Sort by release date and rating.** As a visitor, I want to sort so that I see what's newest or best.
- AC1: Sort control options: Release date (newest), Release date (oldest), Rating (highest), Rating (lowest).
- AC2: The order is correct across page boundaries (page 2 continues page 1's order).
- AC3: The selected sort is kept in the URL (`?sort=release_desc` etc.), so a shared link reproduces the view.
- AC4: Rating ties break by vote count (desc), then title.

**A3. Filter by type.** As a visitor, I want All, Movies or Shows so that I get only what I'm in the mood for.
- AC1: A segmented control filters the grid, and the value is reflected in the URL (`?type=movie|tv`).
- AC2: Shows use first-air date as their "release date" for sorting.

**A4. Search.** As a visitor, I want to search by title so that I can jump to something specific.
- AC1: Search returns curated titles matching a partial title (case- and accent-insensitive), showing the year and type.
- AC2: Searching for a title outside the curated catalogue shows "Not in Stubbed — we only list titles rated 6.5+", not an error.

**A5. Title detail.** As a visitor, I want details so that I can decide whether to watch.
- AC1: `/title/{movie|tv}/{id}-{slug}` shows poster, backdrop, title, year, runtime (movie) or seasons count (show), genres, overview, director or creators, top cast, TMDB score and vote count.
- AC2: The page background derives from the poster (dominant colour or blurred poster), and text contrast is at least 4.5:1.
- AC3: It has OG meta tags (title, poster image, description), so a pasted link unfurls.
- AC4: Unknown IDs return a 404 page with a link back to browse.

**A6. Read reviews.** As a visitor, I want to read reviews so that I know what people think.
- AC1: The title page lists Stubbed reviews (avatar, handle, stars, date, text) and then attributed TMDB reviews, if any.
- AC2: A review marked as a spoiler is blurred until the user taps "Show spoiler".
- AC3: An empty state appears when there are no reviews, with a "Be the first to review" CTA.

### Epic B — Accounts
**B1. Sign up.** As a visitor, I want an account so that I can track and review.
- AC1: Sign up with email, password (8 characters or more) and a unique handle (3–20 characters, `[a-z0-9_]`). Validation errors appear inline.
- AC2: A duplicate email or handle shows a clear error.
- AC3: After sign-up the user is logged in and returned to the page they came from.

**B2. Sign in and out.**
- AC1: Wrong credentials show a generic error that doesn't reveal whether the email exists.
- AC2: The session persists across reloads. Signing out clears it.
- AC3: Protected actions (Stub it, Review, Watchlist) prompt a login when logged out and resume the action after login.

**B3. Profile.** As a user, I want a public profile so that I can show my taste.
- AC1: `/u/{handle}` shows display name, avatar, bio, total stubs, stubs this year, recent stubs, and reviews.
- AC2: The owner can edit display name, bio and avatar. The handle can't be edited in the MVP.

### Epic C — Stubs
**C1. Add a stub in one tap.** As a user, I want to mark something watched quickly.
- AC1: "Stub it" on the title page (and card quick-action) creates a stub dated today. The UI updates optimistically and shows a tear-off animation and a toast with "Undo".
- AC2: The stub count on that title increments.

**C2. Stub with details.** As a user, I want to set the date or where I watched it.
- AC1: A secondary action opens a sheet with a date picker (no future dates, and nothing earlier than the release year minus 1), where (Cinema, Streaming, TV, Other), and a note (up to 280 characters).

**C3. Rewatch (multiple stubs).** As a rewatcher, I want every watch to count.
- AC1: A title that already has a stub shows "Stub again" and "N× stubbed".
- AC2: Each stub appears separately in the diary with its own date. The count equals the number of stub rows.
- AC3: Two stubs on the same date are allowed (double feature), but the second one asks "Stub again today?".

**C4. Manage stubs.**
- AC1: The user can edit a stub's date, where and note, and delete a stub (with confirmation). The count updates.

**C5. My diary.** As a user, I want to see everything I've stubbed.
- AC1: `/me/stubs` lists stubs newest first, grouped by month, with a Movies/Shows filter and per-title counts.
- AC2: The empty state has a CTA to browse.

**C6. Watchlist.**
- AC1: Add or remove a title from "Want to watch". Stubbing a watchlisted title offers to remove it from the watchlist.

### Epic D — Reviews
**D1. Write a review.** As a user, I want to rate and review a title.
- AC1: The form has a star rating (0.5–5 in half-steps, required), text (optional, up to 5,000 characters, with a counter) and a spoiler toggle.
- AC2: One review per user per title. If one exists, the form edits it.
- AC3: Saving shows the review at the top of the title's Stubbed reviews with an "Edited" marker if changed.
- AC4: Reviewing a title with no stubs offers "Add a stub too?" (default yes).

**D2. Edit and delete a review.**
- AC1: The owner can edit or delete. A deleted review disappears from the title page and profile.

**D3. "Also post on IMDb" (manual assist).** As a reviewer, I want to get my review onto IMDb without retyping.
- AC1: This action appears only when the title has an IMDb ID.
- AC2: Clicking it copies the review text to the clipboard (shows a "Copied" toast) and opens the IMDb title page in a new tab.
- AC3: Copy under the button reads: "IMDb doesn't allow apps to post for you. We've copied your review — paste it on IMDb."
- AC4: The user can mark it "Posted on IMDb". This is stored as a flag with a timestamp and shows a small IMDb chip on the review. It is never claimed automatically.

**D4. Export (portability).**
- AC1: Settings, then Export, downloads a Letterboxd-format CSV with one row per stub (review and rating attached to the most recent stub, and `Rewatch=true` for every stub after the first) and a JSON file of all user data.
- AC2: The CSV imports into Letterboxd without format errors (columns and date format match the Letterboxd import docs).

### Epic E — Platform and trust
**E1. Attribution**: the footer and About page show the TMDB logo with "This product uses the TMDB API but is not endorsed or certified by TMDB". The IMDb badge carries an "IMDb rating via OMDb" label.
**E2. Demo mode**: with no env keys, the app boots, browse shows seed titles, sign-up works locally, and stubs and reviews persist across reloads (local DB or storage). A subtle "Demo data" pill is visible.
**E3. Performance**: on the mobile 4G profile, title page LCP is under 2.5 s, browse's first contentful render is under 1.5 s, and CLS is under 0.1. Images are served in appropriate TMDB sizes (`w342` grid, `w780` backdrop mobile).
**E4. Accessibility**: all interactive elements are keyboard-reachable, the ticket cards have meaningful alt text and labels, and animations respect `prefers-reduced-motion`.
**E5. Security and abuse**: rate limits are 30 stubs and 10 reviews per user per minute. Review text is sanitised (no HTML execution). Passwords are handled only by the auth provider. No secrets are in the client bundle.

## 7. Success metrics

| Metric | Definition | MVP target (first 90 days) |
|---|---|---|
| **North star: weekly stubbers** | Users who add 1 or more stubs in a week | 1,000 WAS by day 90 |
| Activation | % of sign-ups who add 3 or more stubs within 24 h | ≥ 40% |
| Time to first stub | From landing to the first stub (logged-in) | Median < 60 s |
| Retention | Users stubbing in week 4 / users active in week 1 | ≥ 25% |
| Review rate | Reviews divided by stubs | ≥ 10% |
| Rewatch share | % of stubs that are rewatches | Tracked (validates the stub mechanic) |
| Share rate (v1) | Share-image generations per WAS | ≥ 0.3 a week |
| K-factor (v1) | New sign-ups from shared links per active user | ≥ 0.2 |
| Quality | Crash-free sessions; p75 LCP | ≥ 99.5%; < 2.5 s |

Instrumentation: privacy-friendly analytics with no third-party ad trackers. Events: `stub_created`, `stub_again`, `review_saved`, `imdb_assist_clicked`, `export_downloaded`, `share_generated`, `signup_completed`.

## 8. Growth loops
1. **Ticket share loop (v1, designed for in MVP)**: stub, then a gorgeous ticket card, then an IG or TikTok Story, then friends tap the short link and land on the public title page (logged-out friendly), then "Stub it", then sign up. The MVP must already make public title and profile pages beautiful and OG-unfurlable.
2. **Wrapped loop (v2)**: the annual recap is shared in December, which brings a spike of sign-ups ("what's your cinema age?").
3. **SEO loop**: SSR title pages ("Is *X* worth watching?" plus review content) bring search visitors, who become readers and then writers. The curated rating gives the pages a quality angle.
4. **Migration loop (v1)**: "Bring your TV Time / Letterboxd / IMDb history" means a user can import in minutes, has an instant rich profile, and shares it. This is timely because TV Time shut down in July 2026.
5. **Social loop (v1)**: follows, a friend feed and "friends who stubbed this" bring notifications and return visits.

## 9. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Founder expects reviews to post to IMDb automatically | High / Medium | Be clear in the UI and docs that IMDb forbids it. Ship the manual assist and Letterboxd export. Offer Trakt sync in v1. |
| TMDB terms change, or we become commercial | Medium / High | Put all catalogue access behind a provider interface. Cache at most 6 months. Budget about $149/month for a commercial licence before any monetisation. Keep IMDb, OMDb and Watchmode as optional enrichers. |
| Trakt tightens further (VIP-only API, one-app limit) | High / Low (not a launch dependency) | Adapter pattern, opt-in only, and Simkl as an alternative. Our DB stays the source of truth. |
| Supabase free project pauses after 7 days idle | Medium / Medium | A scheduled keep-alive ping, or Neon (scale-to-zero, no pause). The Architect decides. |
| Vercel Hobby bans commercial use | Certain if we monetise | Stay non-commercial in the MVP. The move path is Vercel Pro ($20/month) or Cloudflare Pages (free tier allows commercial use). |
| Vote-floor makes the catalogue too small or too large | Medium / Medium | Floors are env-configurable. Log catalogue counts on each ingest and alert if movies fall under 5k or rise over 25k. |
| Rating flicker (titles crossing 6.5) | Medium / Low | Hysteresis rule D4. |
| Name conflict ("AMC Stubs") | Medium / High | Trademark search before public launch. Fallback name "Punched" (naming.md). |
| Review spam or abuse | Medium / Medium | Rate limits, report button (v1), and email verification before a user's first public review in real mode. |
| Demo-mode drift (app works only with fixtures) | Medium / High | QA runs demo mode. Provider contract tests with recorded TMDB fixtures. Same code paths behind an interface. |
| Poster-adaptive backgrounds hurt readability | Medium / Medium | Enforce a 4.5:1 contrast check, and add a dark scrim over blurred posters. |

## 10. Scalability path
- **Stage 0 (MVP, 0–10k users)**: free tiers (a Vercel Hobby or Cloudflare Pages front end, and a Supabase or Neon Postgres). A nightly TMDB catalogue sync (about 10–15k rows) and CDN-cached SSR title pages (revalidate daily). Images are hot-linked from `image.tmdb.org`.
- **Stage 1 (10k–100k)**: move to paid tiers (Supabase Pro at $25/month or Neon Launch, plus Vercel Pro or Cloudflare). Add read replicas or a pooled connection (PgBouncer). Queue background jobs for sync, share-image rendering and Wrapped. Add full-text search in Postgres (pg_trgm, unaccent).
- **Stage 2 (100k–1M)**: a denormalised activity feed (fan-out on write for follows), a dedicated search (Meilisearch or Typesense), object storage for generated share images with a CDN, event analytics in a warehouse, and a TMDB commercial licence. Precompute Wrapped offline in batches.
- **Data model is ready for this from day 1**: `titles(id, media_type, tmdb_id, imdb_id, …)`, `stubs(user_id, title_id, watched_on, where, note, created_at)` (append-only, many per title), `reviews(user_id, title_id UNIQUE, rating_10, body, spoiler, stub_id?, imdb_shared_at?)`, `sync_accounts(user_id, provider, tokens…)` and `sync_jobs(provider, entity, status)` for v1 adapters. Season and episode FKs are nullable on stubs for v1.
- **i18n-ready from MVP**: all UI strings go through a translation function. Dates and numbers are formatted per locale. TMDB content is requested with `language`.

## 11. Founder questions — answers
1. **"Why put everything in a DB — can't we get it real-time?"** Your accounts, stubs and reviews **must** be stored by us, because no movie API will hold them (IMDb and TMDB accept no reviews). For the catalogue, we *can* call TMDB live. But the curated rule (≥ 6.5 plus a vote floor), stable sorting across pages, searching only good titles, joining stub counts, and demo mode with no network all work much better on a small cached index (about 10–15k titles, refreshed nightly, which the TMDB licence allows for up to 6 months). The PM recommendation is a **hybrid**: cache the list and sort fields, and fetch heavy details live with short caching. **The Architect makes the final call** (ADR).
2. **"Reviews saved directly to IMDb and our DB."** Saving to **our DB: yes**, as the source of truth. Saving **directly to IMDb: not possible legitimately**. IMDb's only API is a read-only enterprise licence (about $150k a year through AWS), and its Conditions of Use ban robots and scraping, so automating the user's IMDb session would break IMDb's terms and put the user's account at risk. What we ship instead:
   - MVP: one-tap "Also post on IMDb" (copy the text plus a deep link), and a Letterboxd-compatible export.
   - v1: opt-in **Trakt** sync, the only major service whose API accepts review text (as comments, with 200 words or more flagged as a review), plus ratings and watch history. Also a TMDB rating push (TMDB accepts ratings, but not reviews).

## 12. Open items for downstream agents
- **Design**:
  - The ticket card must work for both movies and shows (for a show, print "S·E" or "Seasons" where a movie ticket shows seat and row).
  - Design the tear-off animation for "Stub it" and the "N× stubbed" badge.
  - Show the demo-data pill.
  - Make a share-ticket layout (1080×1920) even though sharing ships in v1, so the MVP ticket looks the same.
- **System design / Architect**:
  - Decide on the hybrid cache.
  - Choose the auth and DB provider (Supabase vs Neon plus auth library).
  - Define the provider interface (`CatalogProvider`: tmdb | fixtures; `RatingEnricher`: omdb | none; `SyncAdapter`: trakt | tmdb | none).
  - Env vars: `TMDB_API_KEY` (or `TMDB_READ_TOKEN`), `OMDB_API_KEY`, `CATALOG_MIN_RATING=6.5`, `CATALOG_MIN_VOTES_MOVIE=200`, `CATALOG_MIN_VOTES_TV=100`, and v1: `TRAKT_CLIENT_ID` / `TRAKT_CLIENT_SECRET`.
- **QA**: seed data must include the threshold edge cases from A1-AC2, a title with more than 1 stub, a spoiler review, and a title without an IMDb ID (D3-AC1).
