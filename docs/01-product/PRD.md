# Stubbed — Product Requirements Document (PRD)

Author: Product Manager · Date: 2026-09-26 · Status: **v1.2 — adds "Where to watch" (founder scope 2026-09-27, §13) on top of the ADR-008 scope change**
Inputs: `docs/00-orchestrator/BRIEF.md` · `docs/04-architecture/ADR-008-scope-change-no-third-party-posting.md` · Evidence: `docs/01-product/research.md` · Name: `docs/01-product/naming.md`

---

## 1. Vision
**Stubbed is the collectible diary for movies and TV. Every watch earns a ticket stub, and the catalogue only includes the good stuff (rated 6.5 or higher).**

Letterboxd owns film diaries but has no TV. Serializd has TV but no film. TV Time shut down on 2026-07-15 and stranded about 25M users. Trakt is powerful but utilitarian, and it is getting paywalled. Stubbed covers **movies and shows in one place**, logging takes **one tap**, and the output is an object people want to **share**: a ticket.

Positioning line: *"Proof you watched."*

### Design principles (these become product rules)
1. **Two taps to stub.** Logging must be faster than posting a Story.
2. **Curated, not exhaustive.** Browse shows only titles with a TMDB rating of 6.5 or higher and a minimum number of votes.
3. **Your data is yours.** Stubs and reviews live in our DB, and you can export them (Letterboxd CSV, JSON) at any time.
4. **Read from others, write only to ourselves.** We read catalogue data (TMDB) and IMDb ratings (via OMDb), but reviews and ratings are stored only in our DB. We never post to IMDb, Trakt, TMDB or anyone else (ADR-008).
5. **Works offline and in demo mode.** Every screen must work with bundled fixtures and no API keys (a build constraint in BRIEF.md).
6. **Help people decide.** Every title answers "Is this worth my time?" in five seconds (the "Worth it?" block, §5 and §6 Epic F).

## 2. Personas

| Persona | Snapshot | Needs | Frustrations today |
|---|---|---|---|
| **Maya, 20, "the Story poster"** (primary) | A university student who watches 2–3 films a month plus 2 shows at a time. Discovers titles through TikTok edits. | Log fast. Look cool doing it. Have something to post. | Letterboxd has no TV. Her TV Time history is gone. The IMDb app feels like a shopping site. |
| **Dev, 24, "the rewatcher"** | Rewatches comfort shows and favourite films yearly, and cares about counts ("7th time watching The Office"). | Stub counts per title, rewatch dates, and a sense of ritual. | Most apps treat "watched" as a boolean. |
| **Priya, 27, "the reviewer"** | Writes thoughtful reviews and checks IMDb scores out of habit. | One good place to write, seeing her rating next to TMDB and IMDb, and taking her data with her if she leaves. | Her reviews are scattered across apps; most diary apps don't show the IMDb number she trusts. |
| **Leo, 17–19, "the browser"** (logged-out) | Opens a friend's shared link. | "Is this worth my 2 hours?", "Where can I watch it?", reviews. | Too many mediocre titles. Ad-heavy sites. |

## 3. Jobs to be done
- **J1** — When I finish something, I want to record it in seconds, so that I have proof and a history.
- **J2** — When I'm deciding what to watch, I want only titles that are actually good, sorted by what's new or what's best, so that I don't waste an evening.
- **J3** — When I loved (or hated) something, I want to write a review and see what others thought, so that I can process it and join the conversation.
- **J4** — When I rewatch something, I want it to count, so that my history reflects how much it means to me.
- **J5** — When I've watched a lot, I want a beautiful artefact of my taste, so that I can share my identity (a ticket, a recap).
- **J6** — When I already have history elsewhere (IMDb, Letterboxd, TV Time), I want to bring it in and take it out as files, so that I'm not locked in. (We never post to other services.)
- **J7** — When I'm scrolling titles, I want a quick, spoiler-free "should I watch this?" answer (what it is, the vibe, how long it takes, how well liked it is), so that I can decide without reading reviews or watching a trailer.

## 4. Key scope decisions (explicit)

| # | Decision | Rationale (see research.md) |
|---|---|---|
| D1 | **The MVP covers movies and TV shows.** TV is tracked at **show level**; seasons and episodes are v1. | The brief requires shows. Show-level keeps the MVP small while still beating Letterboxd on TV. |
| D2 | **Primary data source: TMDB API.** It is free for non-commercial use with attribution, has TV, images and reviews, and has high limits. | IMDb's API is read-only and costs about $150k a year. IMDb's datasets forbid building an online database. OMDb has a 1,000/day cap. |
| D3 | **The catalogue rule is TMDB `vote_average ≥ 6.5` plus a vote floor: movies `vote_count ≥ 200`, TV `vote_count ≥ 100`.** All three values are env config. | Without a floor, titles with 5 votes and a 9.0 average flood the list. TMDB's own Top Rated uses about 200. TV gets fewer votes. The expected catalogue is about 10–15k titles (to verify on first ingest). |
| D4 | **Retention rule (hysteresis)**: a title that drops below the rule is hidden from browse and search but stays reachable by URL and in users' diaries. | Users' history must never lose items. |
| D5 | **Sorting**: release date (newest or oldest) and rating (highest or lowest). Popularity is the default for the home page only. Type filter: All, Movies, Shows. Optional genre and year filters are MVP-nice (P1). | This is the brief's requirement. Rating sort is always combined with the vote floor. |
| D6 | **Ratings shown** (full spec in §4.1): the TMDB score (primary, 0–10, with vote count), the **IMDb rating via OMDb (P0, MVP)** on every ticket stub and on the detail page, the Stubbed community average once a title has 5 or more user ratings, and the user's own star rating. Only TMDB drives the ≥ 6.5 rule and the rating sort. | Founder scope change (ADR-008). OMDb is CC BY-NC and non-commercial, the same as our TMDB tier. |
| D7 | **Accounts**: email and password, plus magic link and Google OAuth (P1). In demo mode, auth runs locally. | This is a brief requirement, and the Architect picks the provider. |
| D8 | **Stubs**: a stub is one watch event (`title`, `watched_on` date defaulting to today, optional `where` (cinema, streaming, TV, other), optional note). **You can add multiple stubs per title** (rewatches). The stub count is shown on the title and in the diary. | This is the brand mechanic. "Watched" is not a boolean. |
| D9 | **Reviews**: one review per user per title, which can be edited. It has a rating (0.5–5 stars in half steps, stored as 1–10), text (up to 5,000 characters), and a spoiler flag. It can optionally be linked to a specific stub ("reviewed on rewatch #2"). Reviews are **stored only in our DB**. | Our DB is the only place we fully control. The 1–10 storage maps cleanly to the Letterboxd `Rating10` export column and to the 0–10 scale of TMDB and IMDb. |
| D10 | **No posting to third parties, in any release** (ADR-008). There is no "Also post on IMDb" assist, no Trakt sync, no TMDB rating push, and no sync tables, outbox, flags or env vars for it. Portability is file-based only: a **Letterboxd-format CSV and JSON export** (MVP) and file imports (v1). | Founder decision, 2026-09-26. It also removes third-party account connections, their secrets, a sync worker and the legal risk of automating third-party sites (research.md §1–§6). |
| D11 | **Community reviews** on the detail page: Stubbed user reviews come first, then **TMDB reviews** (attributed and read-only). | Gives content from day 1 (cold start). |
| D12 | **Public by default**: browsing, title pages and public profiles need no login. Writing needs login. | "Open by URL" is in the brief, and it drives the share loop and SEO. |
| D13 | **Commercial status**: the MVP is **non-commercial** (no ads, no paid tier). | Keeps us inside the TMDB free tier, OMDb CC BY-NC and Vercel Hobby. Monetisation triggers TMDB commercial (about $149/month) and a hosting upgrade (see §10). |
| D14 | **"Worth it?" decision summary** on every title (full spec in §4.2). It is **deterministic**: assembled by rules and templates from TMDB fields, the IMDb rating and our own community data, with hand-written hooks in demo fixtures. | Founder request (J7). Deterministic output is free, testable, offline-safe and licence-clean. |
| D15 | **Hard constraint: no AI/LLM anywhere.** The app runs on its own server with no AI or LLM access, not at runtime and not in the nightly job. Every feature, including "Worth it?", must be built from stored data plus rules and templates. | Founder constraint, 2026-09-26. |
| D16 | **Where to watch (M2)**: every title page shows the services it is on in the user's region, as logo icons grouped by Stream, Free, Free with ads, Rent and Buy. Data comes from TMDB `watch/providers` (JustWatch data, credited on the block). A tap on an icon opens that service (its search for the title, or its homepage) in a new tab or the installed app. "All options" opens the TMDB watch page, which has exact-title links. No affiliate links, no tracking parameters. Full spec in §13. | Founder request, 2026-09-27. TMDB is $0 and covered by our key; JustWatch's own API is contract-only; exact-title deep links need a third-party enricher (research §14). |

### 4.1 Ratings we show (answers the founder's "What kind of rating are we showing and why?")

**In plain words:** we show up to four numbers, and each has one job. **TMDB** is the number we *use*: it decides what gets into Stubbed (6.5 or higher) and how "Rating" sorts. **IMDb** is the number people *recognise*, so we show it right next to TMDB as a second opinion. **Stubbed** is what *our community* thinks, shown once enough people have rated. **Your stars** are *your* memory of the title. Only TMDB changes what you see in browse.

| Rating | Scale and format | Source and freshness | Where it appears | Why it's there |
|---|---|---|---|---|
| **TMDB score** | 0–10, one decimal, plus vote count ("8.2 · 6.9k votes") | TMDB `vote_average` and `vote_count`, refreshed for every catalogue title by the nightly job | Ticket stub on every card (big number, labelled `TMDB`); detail score chip with vote count; ticket accessible name | It is the **rule-maker**. TMDB is our licensed primary source, every listed title has it by definition, it comes with a vote count (which powers the vote floor and the tie-break), and it refreshes nightly. |
| **IMDb rating** (P0, MVP) | 0–10, one decimal, plus vote count on detail ("8.5 · 612k votes") | OMDb `imdbRating` / `imdbVotes`, looked up by `imdb_id`, cached in our DB and refreshed by the nightly job (new titles first, then oldest). Label: "IMDb rating · via OMDb" | Ticket stub on every card as an `IMDb x.x` chip next to the TMDB score; detail score chip with vote count. **Hidden when null**, never shown as 0 or "N/A" | It is the **trust signal**. It is the rating most people already know ("what's it on IMDb?"), and the founder asked for it. It gives a second, independent opinion next to TMDB. |
| **Stubbed community average** | 0–10, one decimal (the mean of users' `rating_10`), plus "N ratings" | Our DB, updated when a review is saved, edited or deleted | Detail score chip only, **once 5 or more users have rated**. With 1–4 ratings the chip reads "N ratings · average unlocks at 5" | It is **our own voice**, and it grows with the network. The minimum of 5 stops one or two ratings (or a friend brigade) from looking like consensus. It is shown on the same 0–10 scale as TMDB and IMDb so the three numbers can be compared at a glance. |
| **Your rating** | 0.5–5 stars in half steps (stored as 1–10) | The user's own review (D9) | Your review card, the detail page ("You rated ★★★★½"), your profile and diary, the export (`Rating10`), and the v1 share ticket | It is **personal memory and identity**. It is entered as stars because stars are faster and friendlier to tap; it is never mixed into the catalogue rule. |

**Why show TMDB and IMDb separately? Decision: one primary number (TMDB) plus one secondary chip (IMDb), both always labelled with their source, and never blended into one score.**

| Option | Verdict | Why |
|---|---|---|
| One blended "Stubbed score" | **Rejected** | It would be our invention: no user can check it anywhere, and it would move whenever either source moves. It breaks attribution, because TMDB and OMDb/IMDb each have to be credited as the source of the number shown, and a blend belongs to neither. It is undefined for titles with no IMDb rating, so the "same" score would mean different things on different tickets. |
| Two equal numbers | **Rejected** | Two equal-weight numbers on a 118px mobile stub fight for attention. It would also hide which number the catalogue actually uses. |
| **TMDB primary + IMDb secondary** | **Chosen** | TMDB is the number that decides what is listed and how "Rating" sorts, and every listed title has it, so it must be the big number, or the sort order would look wrong. IMDb is the number people recognise and trust, so it sits right next to it as a compact `IMDb x.x` chip that can simply disappear when a title has no IMDb rating, without leaving a hole in the layout. Separate labels are transparent ("this is TMDB's number, that is IMDb's") and meet both attribution requirements. When the two disagree, the "Worth it?" verdict says so in words ("Split opinions"), without inventing a number. |

**Which rating drives the ≥ 6.5 rule and the rating sort: TMDB only.** Reasons:
1. **Discovery.** The nightly job finds candidates with TMDB `discover` (rating and vote-count filters). IMDb ratings can only be looked up one title at a time *after* we already know the title, and the OMDb free key allows 1,000 lookups a day. We cannot scan the whole IMDb universe to find titles that TMDB rates under 6.5 but IMDb rates higher.
2. **Coverage.** Every TMDB title has a TMDB score, but not every one has an `imdb_id` or an IMDb rating (this is more common for TV and non-English titles). A rule or a sort that depends on missing data is undefined, and nulls break stable page-by-page sorting (A2-AC2).
3. **Freshness.** TMDB is refreshed nightly for every title. At 1,000 OMDb calls a day, a full refresh of about 12k titles takes about 12 days on the free key, so IMDb values can lag by up to two weeks.
4. **Licence and dependency risk.** TMDB is our licensed, official source. OMDb is a small community-run service (CC BY-NC). IMDb's own datasets would give full coverage, but their licence forbids building an online database from them (research.md §1.3). A core product rule must not depend on the least reliable source.
5. **Explainability.** One number, one source, one rule: "TMDB 6.5 or higher". Users and QA can check it.

**Decision: the 6.5 cut does not consider IMDb in MVP or v1.** IMDb is display-only. To keep the decision honest, the nightly job logs a **disagreement report**: listed titles where the IMDb and TMDB scores differ by 1.0 or more, and listed titles whose IMDb rating is below 6.0. The PM reviews it monthly. We will revisit in v2 only if more than 5% of listed titles show a big disagreement. There is no "Sort by IMDb rating" in MVP; if users ask for it, v1 can add it with nulls last.

### 4.2 "Worth it?" — the decision summary on every title (D14, Epic F)

**Job (J7):** "Should I watch this tonight?" answered in about five seconds, spoiler-free, without reading reviews. Name in the UI: **"Worth it?"** (internal name: `pitch`). It matches the question visitors actually ask (Leo, the SEO loop "Is X worth watching?") and it reads well on a ticket.

**What it contains (in this order):**

| # | Line | Content and rule | Data source | Limit | Release |
|---|---|---|---|---|---|
| 1 | **Hook** | One spoiler-free sentence about the premise. Priority: (a) our own hand-written hook (`pitch_hook`) if present; (b) TMDB `tagline` if it is non-empty and 120 characters or fewer; (c) the first sentence of TMDB `overview`, cut at a word boundary with "…"; (d) otherwise a template from structured fields: "A {year} {genre 1} {movie|series} from {director or creator}." (b) and (c) carry a small "From TMDB" label. | Our editorial field; TMDB `tagline` and `overview` | 120 characters, 2 lines max | MVP |
| 2 | **Vibe tags** | Up to 3 mood tags, such as `Feel-good`, `Mind-bending`, `Slow burn`, `Edge-of-your-seat`, `Tearjerker`, `Cosy`, `Dark`, `Funny`, `Epic`, `Based on a true story`, `Family-friendly`, `Bingeable`. They come from a versioned **mapping table we own** (TMDB genre ids and an **allowlist** of TMDB keyword ids mapped to about 20 vibes). Keywords that could spoil (for example "twist ending" or a character's death) are never on the allowlist. Ordered by mapping weight. | TMDB `genres` and `keywords`, via our mapping | 3 tags, 18 characters each | MVP |
| 3 | **Time commitment** | Movie: runtime ("2h 46m"), with "Short one" under 95 min and "Long one" over 150 min. Show: "4 seasons · 36 eps · ~55 min each · ≈ 33 h", plus the status (Ended, Returning, Limited series), with "One-weekend binge" for 8 h or less in total and "Big commitment" for more than 40 h. The episode length uses TMDB `episode_run_time`, then `last_episode_to_air.runtime`; if both are missing, the per-episode length and the total are omitted. | TMDB `runtime`, `number_of_seasons`, `number_of_episodes`, `episode_run_time`, `status`, `type` | 1 line | MVP |
| 4 | **Certification** | The age rating for the region, for example `PG-13` or `TV-MA`. MVP region is US (configurable); per-user region comes in v1. Hidden if missing. Detailed content notes (violence, and so on) are v2. | TMDB `release_dates` (movies) and `content_ratings` (TV) | 1 chip | MVP |
| 5 | **Verdict** | A consensus word built from the ratings in §4.1 (TMDB, IMDb, and Stubbed when there are 5 or more ratings), all on 0–10. If there are 2 or more sources and the highest minus the lowest is 1.5 or more, it reads **"Split opinions"** with a sub-line such as "IMDb rates it higher than TMDB". Otherwise it uses the mean *m*: *m* ≥ 8.0 **"Widely loved"**, 7.3 ≤ *m* < 8.0 **"Well liked"**, 6.5 ≤ *m* < 7.3 **"Solid pick"**, *m* < 6.5 **"Mixed reviews"** (only reachable for hysteresis titles, D4). Sub-line: "Based on TMDB, IMDb and 12 Stubbed ratings". It **never shows a new blended number**, so it can't be confused with the real scores. | Derived from §4.1 | 3 words + 1 source line | MVP |
| 6 | **If you liked…** | "If you liked *Arrival*". It uses TMDB `recommendations` (falling back to `similar`) filtered to our curated catalogue. If the logged-in user has stubbed one of them, prefer it ("You stubbed *Arrival*"); otherwise use the most popular. Hidden if there is no match. | TMDB `recommendations` / `similar`, our catalogue, the user's stubs | 1 title | MVP-nice (P1) |

**Where it shows:**
- **Title detail page (MVP, P0)**: the full block, directly under the action row and above the overview. The full overview stays below it.
- **Ticket card (MVP, P0)**: only the **time commitment**, printed on the stub's mono meta line (`2024 · 2H 46M`, or `2022 · 4 SEASONS · ≈33H`). The type is already on the poster pill. The card has no room for the hook or tags, and a busier stub would weaken the ticket.
- **SEO and link previews (MVP, P0)**: `meta description` and `og:description` read "{hook} {time} · {verdict}", 160 characters max. This feeds the SEO and share loops (§8).
- **Quick-peek sheet (v1)**: the full block in a bottom sheet from a card's `⋯` menu, with [Stub it], [Watchlist] and [Open]. It is v1 because long-press is already taken by the stub details sheet (C2), and the peek needs its own interaction design.

**Source decision: deterministic rules and templates only, in every release (D15).** Every line above is built from data we already store (TMDB fields, the three ratings, our stubs and our own mapping table) plus fixed rules and sentence templates. There is no generated text. Why this is also the better product choice:
- **Cost**: about $0. The nightly job makes one extra TMDB call per new or changed title (append `keywords`, `release_dates` or `content_ratings`, and `recommendations`).
- **Licence**: displaying TMDB text and fields with attribution is standard use of the free non-commercial tier, with the same 6-month cache cap as the catalogue. (Re-verify that shortening the overview to its first sentence is fine.) TMDB's API terms also separately prohibit using TMDB content "in connection with … a machine learning or artificial intelligence based application" without written permission, so the deterministic approach is the clean one anyway.
- **Quality and spoilers**: the output is predictable and testable. Taglines and premise sentences are marketing copy, so spoiler risk is low, and tags can't spoil because keywords are allowlisted. The weakness is that some hooks are bland; hand-written `pitch_hook` overrides fix the most-viewed titles (seed the top 100 by popularity before launch).
- An LLM-generated summary was **ruled out by the founder** (no AI/LLM access on our server, at runtime or in the nightly job).

**Demo mode:** every fixture title carries a **hand-written original hook** (we write it, so there is no licence question), its vibe tags, runtime or season/episode data, certification, recommendations limited to the fixture set, and real TMDB and IMDb ratings. The block needs no network calls.

**Suggested data (the Architect decides the schema):** on the title row, `tagline`, `pitch_hook` (nullable, ours), `vibes[]` (computed by the nightly job from genres and keywords), `certification`, `runtime` / `number_of_seasons` / `number_of_episodes` / `episode_runtime` / `status`, `recommendation_ids[]`, and `imdb_rating` / `imdb_votes` / `imdb_fetched_at` (ADR-008). The verdict is computed on read.

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
  - The **IMDb rating and vote count (P0)**, the Stubbed community average (5+ ratings), your own rating, and your stub count (§4.1).
  - The **"Worth it?" block** (P0): hook, vibe tags, time commitment, certification, verdict; "If you liked…" is P1 (§4.2).
- Every ticket stub shows the TMDB score, an `IMDb x.x` chip (hidden when there is no IMDb rating) and the time commitment.
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
- Reviews and ratings are saved only in Stubbed. There is no posting to IMDb or any other service (D10).

**Data portability**
- Export my data (the only way data leaves Stubbed) as Letterboxd-import CSV (`tmdbID, imdbID, Title, Year, Rating10, WatchedDate, Rewatch, Review`) and as JSON.

**Platform**
- Responsive mobile and desktop layouts, meeting the WCAG 2.1 AA baseline.
- SEO-friendly title pages (SSR or SSG, OG tags).
- TMDB, JustWatch-ready and IMDb/OMDb attribution on an About or Credits page and in the footer.
- **Demo mode**: when API keys are absent, the app automatically uses bundled seed data (at least 60 titles, a mix of movies and shows across genres, years and ratings, including some near the 6.5 threshold, plus a few sample users with stubs and reviews) and local auth and storage. Fixtures carry **real IMDb ids and IMDb ratings** and a full "Worth it?" data set per title (§4.2).
- **Nightly job**: TMDB catalogue refresh, OMDb IMDb-rating refresh (staggered, ADR-008), "Worth it?" fields (keywords → vibes, certification, episode data, recommendations), and the rating disagreement report (§4.1). No AI/LLM calls (D15).

### M2 addition — Where to watch (founder scope 2026-09-27; spec and stories in §13)
- Title detail page: a "Where to watch" block for the user's region, with provider logos grouped as Stream, Free, Free with ads, Rent and Buy. Each logo is a link that opens the service. An "All options" link goes to the TMDB watch page. It carries "Data by JustWatch" attribution.
- Region comes from the user's setting, then a trusted geo header, then `Accept-Language`, then `WATCH_REGION_DEFAULT` (US). It can be changed on the block and in Settings.
- Data is fetched in the nightly enrich call we already make (no extra TMDB calls) and is dated on screen. When there is no data, the block shows "Not streaming in {region} right now" and offers Watchlist.
- Demo mode: about 20 fixture titles carry realistic providers for US, GB and IN, with offline logo tiles.
- P1, planned for the same milestone if capacity allows (otherwise M3): one "On {service}" logo on the ticket stub, and "On Netflix"-style filter chips in browse.

### v1 (next 1–2 cycles after MVP)
- **TV depth**: seasons and episodes. Stub an episode, auto-progress "next episode", and show a progress bar per show.
- **Share ticket images**: generate a story-sized (1080×1920) and square PNG of a stub or review ticket, with the poster-tinted design and handle. Use the Web Share API with a download fallback. Each image carries a watermark and a short link.
- **Social follow**: follow users, a friends activity feed, "friends who stubbed this" on the title page, and review likes.
- **Lists**: custom ordered lists (public or private) and a "Top 4" profile showcase.
- **Where to watch**: pulled forward to M2 (§13). v1 keeps any P1 items that did not ship in M2 (the stub logo, browse chips) and adds "My services" (P2).
- **Weekly streaks**: "stubbed something N weeks in a row" with 1 free "intermission" (freeze) a month. There are no daily streaks.
- **Imports (file upload only, no account connections)**: IMDb ratings CSV, Letterboxd export ZIP or CSV, and **TV Time export** (to capture displaced users).
- **"Worth it?" quick-peek sheet** from a card's `⋯` menu, per-user region for certification, and a "Where to watch" line in the block.
- **PWA**: installable, offline shell, with queued stubs that sync when back online.
- Email or push notifications: a new review on a title you stubbed, and a friend follows you.

### v2 (scale and delight)
- **Stubbed Recap** (a Wrapped-style yearly recap, published early December; avoid the word "Wrapped", which is Spotify's brand): total stubs, hours watched, top genres, most-rewatched title, "your cinema age", a first and last stub of the year, and a story carousel of shareable cards. A monthly mini-recap follows later.
- **Recommendations**: "because you stubbed X" (content-based on genres, keywords and cast from the cached catalogue), then collaborative filtering once there is enough data. Everything stays inside the ≥6.5 catalogue.
- **i18n**: UI strings externalised from MVP day 1. Launch with en, then es, pt-BR, hi and de. Use TMDB `language` for localised titles and overviews, and region-aware release dates.
- Exact-title deep links through an optional, env-gated enricher (Watchmode or Streaming Availability free tier, on view, cached; §13.4). Only if free and the licence has been checked.
- "Worth it?" v2: community content notes ("what to know before watching") and a "Comfort rewatch" vibe derived from our rewatch data. Rules only (D15).
- Badges and achievements (for example "Criterion Kid", "Anime Arc").
- Moderation tooling (report review, shadow-hide, rate limits), and verified critics.
- Native wrappers (Capacitor) if PWA install rates are low.

### Out of scope (all releases unless revisited)
- Posting reviews, ratings or watch history to IMDb, Trakt, TMDB, Simkl or any other third party, manually assisted or automated (ADR-008).
- Any AI/LLM feature or AI-generated text (D15).
- Hosting or streaming video.
- Scraping any site.
- Showing titles below the rule in browse.
- Ads before a commercial TMDB licence is in place.

## 6. User stories and acceptance criteria (MVP)
IDs are stable. The PM gap review (Mode B) will mark each one PASS or FAIL. "Given demo mode" means the checks must pass with no API keys.

### Epic A — Browse and discover
**A1. Browse curated catalogue.** As a visitor, I want to browse movies and shows so that I can find something good.
- AC1: `/browse` (or home) shows a grid of ticket-shaped cards with poster, title, year, type badge (Movie or Show), the TMDB score, the IMDb chip (A7) and the time commitment (F2).
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
- AC1: `/title/{movie|tv}/{id}-{slug}` shows poster, backdrop, title, year, runtime (movie) or seasons count (show), genres, overview, director or creators, top cast, TMDB score and vote count, the IMDb score block (A7), the community and own ratings (A8) and the "Worth it?" block (F1).
- AC2: The page background derives from the poster (dominant colour or blurred poster), and text contrast is at least 4.5:1.
- AC3: It has OG meta tags (title, poster image, description), so a pasted link unfurls.
- AC4: Unknown IDs return a 404 page with a link back to browse.

**A6. Read reviews.** As a visitor, I want to read reviews so that I know what people think.
- AC1: The title page lists Stubbed reviews (avatar, handle, stars, date, text) and then attributed TMDB reviews, if any.
- AC2: A review marked as a spoiler is blurred until the user taps "Show spoiler".
- AC3: An empty state appears when there are no reviews, with a "Be the first to review" CTA.

**A7. IMDb rating everywhere (P0, ADR-008).** As a visitor, I want to see the IMDb rating I already know, so that I can trust the pick.
- AC1: Every ticket stub (grid, rail, hero, and row where a score is shown) shows an `IMDb x.x` chip next to the TMDB score when `imdbRating` is not null.
- AC2: The detail page shows an IMDb score chip with the rating, the vote count (for example "612k votes") and the label "IMDb rating · via OMDb".
- AC3: When `imdbRating` is null (no `imdb_id`, or OMDb has no rating), the chip and the detail block are hidden. They are never shown as 0, "N/A" or empty. Demo fixtures include at least one such title.
- AC4: In demo mode, every other fixture shows its real IMDb rating and links to its real IMDb id, with no network call.
- AC5: The IMDb rating never changes catalogue membership or the rating sort (a fixture with TMDB 6.4 and IMDb 7.5 still does not appear in browse).
- AC6: The ticket's accessible name includes both scores, for example "rated 8.2 on TMDB and 8.5 on IMDb".

**A8. Community and own ratings.** As a visitor, I want to see what Stubbed users think, and as a user, my own rating.
- AC1: With 5 or more ratings, the detail page shows "Stubbed x.x" (0–10, one decimal, the mean of `rating_10`) and "N ratings". With 1–4 ratings it reads "N ratings · average unlocks at 5". With none, the chip is hidden.
- AC2: The average updates after a review is saved, edited or deleted.
- AC3: A logged-in user who has rated the title sees "You rated ★★★★½" on the detail page.

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

**D3. Retired (ADR-008).** The "Also post on IMDb" assist was removed. Gap review checks the negative instead:
- AC1: No UI, route, field or test id for posting to IMDb, Trakt or TMDB exists (no `imdb-assist`, no "Also post on IMDb", no `imdb_shared_at`, no sync settings).

**D4. Export (portability).**
- AC1: Settings, then Export, downloads a Letterboxd-format CSV with one row per stub (review and rating attached to the most recent stub, and `Rewatch=true` for every stub after the first) and a JSON file of all user data.
- AC2: The CSV imports into Letterboxd without format errors (columns and date format match the Letterboxd import docs).

### Epic F — "Worth it?" (D14, §4.2)
**F1. Decide from the detail page.** As a visitor, I want a quick spoiler-free summary so that I can decide whether to watch.
- AC1: The detail page shows a "Worth it?" block directly under the action row, with lines in this order: hook, vibe tags, time commitment, certification, verdict, and (P1) "If you liked…".
- AC2: Each line is hidden when its data is missing. The hook falls back tagline → first overview sentence → template (§4.2), so every listed title has a hook.
- AC3: Limits hold: hook 120 characters or fewer (2 lines max at 375 px), at most 3 vibe tags, 1 line of time, 1 certification chip, verdict of 3 words or fewer plus 1 source line, and at most 1 "If you liked" title.
- AC4: A hook taken from TMDB `tagline` or `overview` shows a "From TMDB" label. Hand-written and template hooks show no label.
- AC5: Vibe tags come only from the mapping table's allowlist. No spoiler keyword can produce a tag (unit test on the table).

**F2. Time commitment on the ticket.** As a browser, I want to see how long something takes before I open it.
- AC1: The grid and rail stubs print the time on the mono meta line: movie `2024 · 2H 46M`; show `2022 · 4 SEASONS · ≈33H` (or `4 SEASONS` when the episode length is unknown).
- AC2: If the runtime is missing, the line shows the year only.

**F3. Verdict rules.** As a visitor, I want one honest word about consensus.
- AC1: The verdict follows the §4.2 rules exactly. Examples: TMDB 8.2 and IMDb 8.5 → "Widely loved"; TMDB 7.0 and IMDb 8.6 → "Split opinions" with "IMDb rates it higher than TMDB"; TMDB 6.8 with no IMDb → "Solid pick".
- AC2: The source line names only the sources used, and Stubbed counts only with 5 or more ratings.
- AC3: No blended number is displayed anywhere.
- AC4: Demo fixtures include at least one title for each of the four verdicts.

**F4. Works offline.** Given demo mode, every fixture title renders a complete "Worth it?" block (a hand-written hook, vibes, time, certification, verdict) with no network calls and no AI/LLM calls (D15).

**F5. Link previews.** As a sharer, I want pasted links to say why the title is worth it.
- AC1: `meta description` and `og:description` read "{hook} {time} · {verdict}", 160 characters max.

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
| Decision rate | % of title-page views (with `worth_it_viewed`) that end in Stub it or Watchlist within the session | ≥ 12% (baseline to validate "Worth it?") |
| Share rate (v1) | Share-image generations per WAS | ≥ 0.3 a week |
| K-factor (v1) | New sign-ups from shared links per active user | ≥ 0.2 |
| Quality | Crash-free sessions; p75 LCP | ≥ 99.5%; < 2.5 s |
| Where-to-watch CTR (M2) | Title views with the block visible that end in ≥1 `provider_clicked` | ≥ 8% (baseline) |
| Not-streaming save rate (M2) | "Not streaming" views that end in `watchlist_added` | Tracked |

Instrumentation: privacy-friendly analytics with no third-party ad trackers. Events: `stub_created`, `stub_again`, `review_saved`, `worth_it_viewed` (block at least 50% visible for 1 s), `watchlist_added`, `export_downloaded`, `share_generated`, `signup_completed`, `provider_clicked` (M2: `provider_id`, `type`, `region`, `link_kind`; no user id and no URL).

## 8. Growth loops
1. **Ticket share loop (v1, designed for in MVP)**: stub, then a gorgeous ticket card, then an IG or TikTok Story, then friends tap the short link and land on the public title page (logged-out friendly), then "Stub it", then sign up. The MVP must already make public title and profile pages beautiful and OG-unfurlable.
2. **Wrapped loop (v2)**: the annual recap is shared in December, which brings a spike of sign-ups ("what's your cinema age?").
3. **SEO loop**: SSR title pages ("Is *X* worth watching?" plus review content) bring search visitors, who become readers and then writers. The curated rating gives the pages a quality angle.
4. **Migration loop (v1)**: "Bring your TV Time / Letterboxd / IMDb history" means a user can import in minutes, has an instant rich profile, and shares it. This is timely because TV Time shut down in July 2026.
5. **Social loop (v1)**: follows, a friend feed and "friends who stubbed this" bring notifications and return visits.

## 9. Risks and mitigations

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| OMDb quota or availability (1,000 calls/day free; a community-run service) | Medium / Low | The IMDb chip is display-only and hides when null, so an outage never breaks browse. Staggered refresh (new titles first); a full cycle takes about 12 days on the free key. If fresher data is needed, a low OMDb Patreon tier (Pro is about $10/month for 250k calls/day) is enough. |
| Bland or spoilery "Worth it?" hooks | Medium / Medium | Taglines first, allowlisted vibe keywords, hand-written overrides for the top 100 titles, and a v1 "Report spoiler" action on the hook. |
| TMDB terms change, or we become commercial | Medium / High | Put all catalogue access behind a provider interface. Cache at most 6 months. Budget about $149/month for a commercial licence before any monetisation. Keep IMDb, OMDb and Watchmode as optional enrichers. |
| Supabase free project pauses after 7 days idle | Medium / Medium | A scheduled keep-alive ping, or Neon (scale-to-zero, no pause). The Architect decides. |
| Vercel Hobby bans commercial use | Certain if we monetise | Stay non-commercial in the MVP. The move path is Vercel Pro ($20/month) or Cloudflare Pages (free tier allows commercial use). |
| Vote-floor makes the catalogue too small or too large | Medium / Medium | Floors are env-configurable. Log catalogue counts on each ingest and alert if movies fall under 5k or rise over 25k. |
| Rating flicker (titles crossing 6.5) | Medium / Low | Hysteresis rule D4. |
| Name conflict ("AMC Stubs") | Medium / High | Trademark search before public launch. Fallback name "Punched" (naming.md). |
| Review spam or abuse | Medium / Medium | Rate limits, report button (v1), and email verification before a user's first public review in real mode. |
| Demo-mode drift (app works only with fixtures) | Medium / High | QA runs demo mode. Provider contract tests with recorded TMDB fixtures. Same code paths behind an interface. |
| Where-to-watch data is stale or wrong (the catalogue changes daily; JustWatch through TMDB) | High / Medium | Show a "Checked {date}" line and "Availability can change". Refresh trending and new titles daily and everything else weekly. Hide the block when data is older than 30 days. "All options" always links to the live TMDB page (§13). |
| Provider link templates break or land on a login wall | Medium / Low | Keep the provider links as versioned config with a fallback to the homepage, then to the TMDB page. QA checks the top 15 links by hand each release. The label says "Open in Netflix", never "Play". |
| Commercial launch changes where-to-watch terms (JustWatch data through TMDB) | Medium / High | Covered by D13 (non-commercial). Before any monetisation, re-check TMDB commercial terms and whether JustWatch needs its own agreement (Unverified). |
| Poster-adaptive backgrounds hurt readability | Medium / Medium | Enforce a 4.5:1 contrast check, and add a dark scrim over blurred posters. |

## 10. Scalability path
- **Stage 0 (MVP, 0–10k users)**: free tiers (a Vercel Hobby or Cloudflare Pages front end, and a Supabase or Neon Postgres). A nightly TMDB catalogue sync (about 10–15k rows) and CDN-cached SSR title pages (revalidate daily). Images are hot-linked from `image.tmdb.org`.
- **Stage 1 (10k–100k)**: move to paid tiers (Supabase Pro at $25/month or Neon Launch, plus Vercel Pro or Cloudflare). Add read replicas or a pooled connection (PgBouncer). Queue background jobs for catalogue refresh, share-image rendering and Recap. Add full-text search in Postgres (pg_trgm, unaccent).
- **Stage 2 (100k–1M)**: a denormalised activity feed (fan-out on write for follows), a dedicated search (Meilisearch or Typesense), object storage for generated share images with a CDN, event analytics in a warehouse, and a TMDB commercial licence. Precompute Wrapped offline in batches.
- **Data model is ready for this from day 1**: `titles(id, media_type, tmdb_id, imdb_id, …)`, `stubs(user_id, title_id, watched_on, where, note, created_at)` (append-only, many per title), `reviews(user_id, title_id UNIQUE, rating_10, body, spoiler, stub_id?)`. Titles carry `imdb_rating`, `imdb_votes`, `imdb_fetched_at` and the "Worth it?" fields (§4.2). There are no sync tables (ADR-008). Season and episode FKs are nullable on stubs for v1.
- **i18n-ready from MVP**: all UI strings go through a translation function. Dates and numbers are formatted per locale. TMDB content is requested with `language`.

## 11. Founder questions — answers
1. **"Why put everything in a DB — can't we get it real-time?"** Your accounts, stubs and reviews **must** be stored by us, because no movie API will hold them (IMDb and TMDB accept no reviews). For the catalogue, we *can* call TMDB live. But the curated rule (≥ 6.5 plus a vote floor), stable sorting across pages, searching only good titles, joining stub counts, and demo mode with no network all work much better on a small cached index (about 10–15k titles, refreshed nightly, which the TMDB licence allows for up to 6 months). The PM recommendation is a **hybrid**: cache the list and sort fields, and fetch heavy details live with short caching. **The Architect makes the final call** (ADR).
2. **"Reviews saved directly to IMDb and our DB."** Superseded by the founder scope change (ADR-008): reviews and ratings are saved **only in our DB**, and nothing is posted to IMDb or any other service. For the record, posting directly to IMDb was never legitimately possible (read-only, enterprise-priced API; the Conditions of Use ban robots). Users can take their data elsewhere through the Letterboxd CSV and JSON export.
3. **"What kind of rating are we showing and why?"** See §4.1. TMDB (the rule-maker, shown big), IMDb via OMDb (the number people trust, shown as a chip), the Stubbed average (our community, from 5 ratings), and your own stars. Only TMDB decides the 6.5 cut and the rating sort.
4. **"Why show TMDB and IMDb separately?"** See §4.1: one primary number (TMDB) plus a secondary IMDb chip, each labelled with its source, and never a blended score.
5. **"A small summary that helps me decide whether to watch."** See §4.2: the "Worth it?" block, built by rules and templates (no AI, D15).

## 12. Open items for downstream agents
- **Design**:
  - The ticket card must work for both movies and shows (for a show, print "S·E" or "Seasons" where a movie ticket shows seat and row).
  - Design the tear-off animation for "Stub it" and the "N× stubbed" badge.
  - Show the demo-data pill.
  - Make a share-ticket layout (1080×1920) even though sharing ships in v1, so the MVP ticket looks the same.
- **System design / Architect**:
  - Decide on the hybrid cache.
  - Choose the auth and DB provider (Supabase vs Neon plus auth library).
  - Define the provider interface (`CatalogProvider`: tmdb | fixtures; `RatingEnricher`: omdb | fixtures | none). There is no sync adapter (ADR-008).
  - Env vars: `TMDB_API_KEY` (or `TMDB_READ_TOKEN`), `OMDB_API_KEY`, `CATALOG_MIN_RATING=6.5`, `CATALOG_MIN_VOTES_MOVIE=200`, `CATALOG_MIN_VOTES_TV=100`, and a region for certification (default US). No `TRAKT_*` or sync flags.
  - "Worth it?" (§4.2): store its fields on the title row, own the vibe mapping table as versioned config, compute the verdict on read, and extend the nightly job. No AI/LLM calls anywhere (D15).
- **Design**: add the IMDb chip to every ticket stub and the "Worth it?" block to the detail page (DESIGN.md §7.4.1); remove the IMDb assist.
- **QA**: seed data must include the threshold edge cases from A1-AC2, a fixture with TMDB 6.4 and IMDb 7.5 (A7-AC5), a title with more than 1 stub, a spoiler review, a title without an IMDb rating (A7-AC3), a title with 5 or more Stubbed ratings (A8-AC1), one title per verdict (F3-AC4), a show with unknown episode length (F2-AC1), and a title with no tagline (F1-AC2).

## 13. Where to watch (founder scope 2026-09-27, M2)

Founder ask: "If a title is available on any OTT/streaming service, show it there, with icons, and make them clickable so they open the service automatically." Evidence: research.md §14. Labels: **Observed** (source extract or repo file:line), **Inferred**, **Assumed**, **Unverified**.

### 13.1 Source decision
- **M2 source: TMDB `watch/providers` (JustWatch data).** It costs $0, uses the TMDB key we already have and falls under the same non-commercial terms (D2, D13). It gives provider lists per region with logos, `display_priority`, and one `link` per title and region (Observed, research §14).
- **No extra API calls.** The nightly enrich already makes one TMDB detail call per title with `append_to_response` (Observed: `src/server/jobs/enrich.ts:1-4`). We add `watch/providers` to that call (Inferred: TMDB supports it as an append; the architect must confirm). The provider list (names, logos, priority) comes from TMDB's provider-list endpoints once a week.
- **Rejected for M2**: the JustWatch API (contract only, partners only; Observed). Scraping JustWatch GraphQL (against the no-scraping rule). Watchmode and Streaming Availability are free but capped at about 2.5–3k calls a month against a catalogue of about 10–15k titles, and their caching and affiliate terms are Unverified. They stay optional exact-title enrichers (§13.4).
- **Attribution (hard requirement)**: TMDB expects a JustWatch reference or logo on each media item that shows this data (Observed). The block carries "Data by JustWatch" with the JustWatch logo or wordmark on every title page, and the About/Credits page lists it too.

### 13.2 What "opens the service automatically" means (honest version)
Each provider icon resolves its link in this order:
1. **Exact-title deep link** (v2, only when an enricher is on): opens the title itself. On phones, an `https://` deep link opens the installed app when the service registers it as a Universal Link / App Link (Inferred; Unverified per service).
2. **Provider link template** (M2 default): from a curated, versioned `provider-links` config keyed by TMDB `provider_id`. It holds the service's **search URL with the title filled in** where one is known (for example Netflix `https://www.netflix.com/search?q={title}`, Unverified), and **otherwise the service's homepage**. It opens in a new tab on desktop. On mobile, the app opens if the service claims that URL (Unverified per service). The user may land on a login or profile picker first.
3. **TMDB watch page** (`link`, the fallback for unknown providers): the correct title and region, with JustWatch's exact-title links, so it is one tap more (Observed: this is how TMDB describes the link).

A separate "All options" text link on the block always goes to (3). Copy says **"Open in {Service}"**, never "Play" or "Watch now", because we cannot promise playback. No custom URL schemes (`nflx://`), because they fail silently when the app is missing. No affiliate or UTM parameters. Links use `rel="noopener noreferrer"`, so no referrer is sent.

**Honest summary for the founder:** in M2, tapping the Netflix icon opens Netflix (the app on a phone where Netflix supports it) at a search for the title, or at its homepage. Landing on the exact title page in one tap needs a deep-link enricher (v2, optional, free-tier capped). Until then, "All options" gets there in two taps.

### 13.3 Rules
- **Region** (in this order): the user's saved setting (profile, or a cookie when signed out) → a trusted geo header, only when our reverse proxy sets it (for example `CF-IPCountry` behind the optional Cloudflare proxy; the header name is config and is off by default, because the own-server profile is not settled; see NEXT_PHASE_PLAN L-7) → the region subtag of `Accept-Language` (`en-GB` → GB; a bare `en` gives no region) → `WATCH_REGION_DEFAULT` = US. We never store IPs. Supported regions are config (`WATCH_REGIONS`, proposed `US,GB,IN,CA,AU,DE,FR,ES,BR,MX`). An unsupported region falls back to the default, with a visible "Showing: United States · Change".
- **Types and order**: Stream (`flatrate`) → Free (`free`) → Free with ads (`ads`) → Rent → Buy. Inside each type, sort by TMDB `display_priority`. A provider that has both rent and buy shows once, labelled "Rent · Buy". Show at most 6 icons per type, then "+N" (which expands the list).
- **Freshness**: store only the supported regions, compacted as `{type, provider_id}` lists plus the TMDB link (Inferred: under 1 KB per title, about 15 MB for 15k titles, which fits Supabase Free). Refresh titles on the home rails (trending, new) daily, and every other title in the weekly enrich cycle. Title pages keep their daily revalidation. The block shows "Checked {date} · Availability can change". It is **hidden when the data is older than 30 days or was never fetched**, because showing nothing beats showing something wrong.
- **Unavailable**: if the region has no providers, the block says "Not streaming in {Region} right now", with Add to Watchlist, a region switcher and the "All options" link. We never show a fake "not available anywhere".
- **Where it shows**: M2 puts the block **on the detail page only** (and in the "Worth it?" line "Streaming on Netflix" once v1 adds it). P1: **one** logo on the ticket stub, for the top Stream or Free provider in the user's region. It is decorative, not a link, because the stub is one link target and a nested link fails accessibility. P1: "On {Service}" filter chips in browse for the top 6 providers in the region. Design owns the visuals (docs/02-design).

### 13.4 Later (not M2)
- v1: "My services". Pick your subscriptions; your services come first and browse can filter by them.
- v2: an optional exact-title deep-link enricher, `DEEPLINK_PROVIDER=none|watchmode|sa` (default `none`). It runs on view, with a 7-day cache and a monthly budget guard under the free cap. It adds that API's required attribution. It ships only after its terms are read on the primary page (caching, affiliate links, non-commercial).

### 13.5 User stories — Epic W (Where to watch)
**W1. See where to watch.** As a visitor, I want to see which services have this title in my country, so that I can start watching.
- AC1: Given demo mode and region US, the title page for a fixture with providers shows a "Where to watch" block, with logos grouped under visible text headings Stream / Free / Free with ads / Rent / Buy. Empty groups are hidden.
- AC2: Groups follow the order in §13.3. Inside a group, providers are sorted by `display_priority`. A provider with both rent and buy shows once, as "Rent · Buy".
- AC3: More than 6 providers in a group gives "+N", which expands to the full list.
- AC4: The block shows "Data by JustWatch" (logo or wordmark) and "Checked {date} · Availability can change". The About page lists JustWatch.

**W2. Open the service.** As a viewer, I want to tap a service icon and land in that service.
- AC1: Every icon is an `<a href>` built from `provider-links` (search URL with the URL-encoded title, or the homepage). A provider missing from the config uses the TMDB watch `link`.
- AC2: Links have `target="_blank"` and `rel="noopener noreferrer"`. The URL carries no affiliate, UTM or user parameters. It is a plain `https://` URL, never a custom scheme.
- AC3: A separate "All options" link opens the TMDB watch page for the same title and region.
- AC4: Clicking fires one `provider_clicked {provider_id, type, region, link_kind: search|home|tmdb}` first-party event, with no user id and no URL, and does not delay navigation.
- AC5 (manual, real mode, before release): QA opens the top 15 provider links in desktop Chrome and on an iOS and an Android phone, and records for each whether it opens the app, the site, search results or a login. Any broken template falls back to the homepage.

**W3. Right region.** As a user abroad, I want my country's services, not the US list.
- AC1: With no setting, `Accept-Language: en-GB,en;q=0.8` gives GB, and `hi-IN` gives IN. A bare `en`, or no header, gives `WATCH_REGION_DEFAULT` (US).
- AC2: A trusted geo header is read only when `WATCH_GEO_HEADER` is set. A client-sent header with that name is ignored when the setting is off.
- AC3: The region switcher on the block (and in Settings) changes the list without a full page reload. It persists in the profile when signed in, or in a cookie when signed out, and survives a reload.
- AC4: An unsupported region shows the default region's list with "Showing: United States · Change".

**W4. Not streaming.** AC1: A fixture with no providers in the region shows "Not streaming in {Region} right now", with Add to Watchlist, the region switcher and "All options". AC2: A fixture whose data is older than 30 days, or that has none, hides the block completely, and there is no layout shift (CLS < 0.1).

**W5. Accessible.** AC1: Each icon's accessible name is "Open {Service} ({type}) — opens in a new tab". Logos have `alt=""` because the name is in text. AC2: Targets are at least 44×44 px, keyboard-reachable in visual order, and have a visible focus ring. AC3: Type is shown by text headings, not colour alone. AC4: Axe finds no serious or critical issues on the block.

**W6. Demo fixtures (offline).** AC1: With no env keys and no network, **20 fixture titles** carry providers for US, GB and IN. The data is realistic but illustrative, dated `2026-09`, and labelled as demo data (Assumed, not live). AC2: The set includes: 8 or more titles on a major subscription service (Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu, JioHotstar); 2 or more free or ad-supported titles (for example Tubi, Pluto TV); 2 or more rent/buy-only titles (Apple TV, Google Play, Amazon Video); 1 title with more than 6 providers in one group; 1 title with no US providers (W4-AC1); 1 title with stale data (W4-AC2); 1 title that differs between US and IN; 5 or more shows. AC3: Logos are bundled local tiles (a monogram on the brand colour) so nothing is fetched from `image.tmdb.org` in demo. Real mode uses TMDB `logo_path`. AC4: Clicking a demo link goes to the configured real URL (not intercepted); QA asserts `href` only.

**W7. Stub logo and browse chips (P1).** AC1: The ticket stub shows at most one logo, for the top Stream or Free provider in the region. It is not a link, and its label is "On {Service}". AC2: Browse shows "On {Service}" chips for the top 6 providers in the region. Selecting one filters the grid with the ≥ 6.5 rule still applied, and combines with sort and type. AC3: No chip for a provider with 0 titles.

**W8. Guardrails.** AC1: No new env var is required in demo mode. `TMDB_*` alone turns on real data. AC2: A unit or guard test makes sure provider URLs have no `utm_`, `tag=`, `affid` or `ref=` parameters. AC3: The title page p75 LCP stays under 2.5 s. Logos are lazy-loaded at `w92` or smaller (Inferred as a TMDB logo size).

### 13.6 Success metric and risks
- Primary: **Where-to-watch CTR ≥ 8%** of title views where the block is visible (§7). Secondary: the Watchlist save rate from "Not streaming", and the share of titles whose data is under 7 days old (≥ 95%). Guardrail: under 1% of clicks come from `link_kind=tmdb` because of missing templates for the top providers.
- Risks: see §9 (stale data, broken templates, commercial terms). Also, logos are trademarks, so we use only TMDB-supplied logos in real mode and neutral tiles in demo. And a region guessed wrong from `Accept-Language` is fixed by the always-visible region switcher.

### 13.7 Handover
- **Architect** (docs/04-architecture): write an ADR for the where-to-watch data flow (append `watch/providers` to the enrich call; the weekly provider-list sync; storage shape per supported region; a 30-day stale guard; refresh cadence daily for rails and weekly for the rest). Add a `WatchProviders` type and a title-detail contract field. Add the env vars `WATCH_REGION_DEFAULT`, `WATCH_REGIONS`, `WATCH_GEO_HEADER` (default off), and later `DEEPLINK_PROVIDER=none`, all in `.env.example`. Own `provider-links` as versioned config. Confirm with the own-server profile (L-7) whether a geo header can be trusted.
- **Backend**: map the enrich data (`flatrate/free/ads/rent/buy` → our types; merge rent and buy); add a migration (new file) for the provider tables and columns; add the provider-list sync; resolve the region (setting → header → Accept-Language → default); store the region in the profile or a cookie; add the fixture data for W6; add the URL guard test (W8-AC2); add the `provider_clicked` event (with E-M1).
- **Frontend**: build the detail-page block per DESIGN (groups, "+N", attribution, "Checked" line, not-streaming state, region switcher); links per W2; accessibility per W5; no layout shift when hidden. W7 is P1.
- **QA**: add e2e for W1–W6 in demo mode (US/GB/IN through `Accept-Language` and the switcher; stale and empty fixtures; `href`/`rel`/`target` assertions; axe); add a manual device matrix for W2-AC5 before the real-mode release; run the link check on the top 15 templates each release.
