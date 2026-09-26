# ADR-004: Reviews, stubs and external sync (IMDb, Trakt, Letterboxd)

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect
Inputs: PRD D8–D11, D3/D4 stories, research.md §1–6, SYSTEM_DESIGN §16

## Context
The founder asked for reviews "saved directly to IMDb and our DB". Research found that IMDb has **no write API at any price**, and its Conditions of Use ban automation and scraping. TMDB accepts ratings but not review text. Trakt accepts comments (≥ 200 words counts as a review), ratings and history, but creating an API app now needs a Trakt VIP account and free users can connect only one app. Letterboxd has no open API but imports CSV.

## Decision
1. **Our Postgres is the single source of truth** for stubs, reviews and the watchlist. External systems are only ever *copies*, so a failed sync never blocks or rolls back a local save.
2. **Stubs** are append-only watch events: many per title, count = number of rows, `number` = rank by (watched_on, created_at). Validation: no future dates, nothing before Jan 1 of (release year − 1), note ≤ 280 characters, rate limit 30/min/user (a DB trigger in live mode; the repository check in demo mode).
3. **Reviews:** one per (user, title) (`UNIQUE`). Stored `rating_10` is 1..10 (the UI shows half-stars). Body ≤ 5000 characters, `is_spoiler`, optional `stub_id` (it must be the same user's stub of the same title). `edited_at` is set by a trigger when rating, body or spoiler changes. Rate limit 10/min/user, counting inserts and edits. Review text is stored raw and **always rendered as text** (React escaping). ESLint bans `dangerouslySetInnerHTML`. OG descriptions never include review text (no spoilers in unfurls).
4. **IMDb: manual assist only, and this is final.** "Also post on IMDb" appears only when `imdbId` exists. It copies the text, opens `https://www.imdb.com/title/{imdbId}/reviews/` in a new tab, and asks "Did you post it?". Only an explicit "Yes" calls `POST /api/reviews/{id}/imdb-shared {shared:true}`, which sets `imdb_shared_at`. We never claim a post automatically.
5. **Letterboxd:** `GET /api/me/export?format=letterboxd` returns a CSV with columns `tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`. There is one row per stub. The review and rating go on the most recent stub of the title, and `Rewatch=true` for every stub after the first. `format=json` returns all user data.
6. **TMDB community reviews** are shown read-only on the title page after Stubbed reviews, attributed ("From TMDB"). They come from the detail payload.
7. **Trakt (v1), behind `FEATURE_TRAKT_SYNC=false`.** The schema already has `sync_accounts` (tokens encrypted at app level with AES-GCM using `SYNC_TOKEN_ENC_KEY`, never readable by API roles) and an **outbox** `sync_jobs` (idempotency key `provider:entity:id:updated_at`). A worker (GitHub Actions every 15 min, later a queue) drains it at ≤ 1 POST/s per user with 429 backoff. The feature only activates when the flag **and** credentials **and** live data mode are all present (`AppMode.features.traktSync`). The MVP UI shows "Connected services — coming soon".
8. **IMDb rating badge (P1)** via OMDb behind `FEATURE_OMDB_BADGE` + `OMDB_API_KEY`: lazy, cached 7 days, stops at 900 calls/day, labelled "IMDb rating · via OMDb".

## Consequences
- Honest UX. The About page explains "Why we can't post to IMDb for you".
- No launch dependency on Trakt's changing terms. When the adapter lands, it plugs into `SyncAdapter` (`src/server/ports.ts`) without touching the write path.
- The community average (`title_stats.rating_sum / rating_count`) is trigger-maintained and shown only once there are ≥ 5 ratings.
