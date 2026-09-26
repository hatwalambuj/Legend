# ADR-004: Reviews, stubs and data portability

Status: **Accepted, partially superseded** · Date: 2026-09-26 · Decider: Architect
Inputs: PRD D8–D11, D3/D4 stories, research.md §1–6, SYSTEM_DESIGN §16

> **Superseded by [ADR-008](ADR-008-scope-change-no-third-party-posting.md) (founder scope change):**
> §4 (IMDb copy-and-open assist), §7 (Trakt sync / outbox) and §8 (optional OMDb badge) are **void**.
> Nothing is posted to any third party; there is no `imdb_shared_at`, no `sync_accounts` / `sync_jobs`,
> no `FEATURE_*` / `TRAKT_*` env. The IMDb rating is now P0 and shown everywhere (ADR-008 §2–§4).
> The superseded text is kept below, struck through, for the decision record only.

## Context
The founder originally asked for reviews "saved directly to IMDb and our DB". Research found that IMDb has
**no write API at any price**, and its Conditions of Use ban automation and scraping. TMDB accepts ratings
but not review text. Trakt accepts comments, ratings and history, but needs a VIP account for API apps.
Letterboxd has no open API but imports CSV. The founder then dropped third-party posting entirely (ADR-008).

## Decision
1. **Our Postgres is the single source of truth** for stubs, reviews and the watchlist — and the only place
   they are written.
2. **Stubs** are append-only watch events: many per title, count = number of rows, `number` = rank by
   (watched_on, created_at). Validation: no future dates, nothing before Jan 1 of (release year − 1),
   note ≤ 280 characters, rate limit 30/min/user (a DB trigger in live mode; the repository check in demo
   mode). `stubs.source` is `'app' | 'import'` (import = the user's own file, v1).
3. **Reviews:** one per (user, title) (`UNIQUE`). Stored `rating_10` is 1..10 (the UI shows half-stars).
   Body ≤ 5000 characters, `is_spoiler`, optional `stub_id` (it must be the same user's stub of the same
   title). `edited_at` is set by a trigger when rating, body or spoiler changes. Rate limit 10/min/user,
   counting inserts and edits. Review text is stored raw and **always rendered as text** (React escaping).
   ESLint bans `dangerouslySetInnerHTML`. OG descriptions never include review text (no spoilers in unfurls).
4. ~~**IMDb: manual assist only.** "Also post on IMDb" copies the text, opens IMDb, and records
   `imdb_shared_at` after the user confirms.~~ **Void (ADR-008).** No IMDb posting of any kind.
5. **Letterboxd:** `GET /api/me/export?format=letterboxd` returns a CSV with columns
   `tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`. There is one row per stub. The review
   and rating go on the most recent stub of the title, and `Rewatch=true` for every stub after the first.
   `format=json` returns all user data. This is the user's own export, not a sync.
6. **TMDB community reviews** are shown read-only on the title page after Stubbed reviews, attributed
   ("From TMDB"). They come from the detail payload.
7. ~~**Trakt (v1), behind `FEATURE_TRAKT_SYNC`**, with `sync_accounts`, an outbox `sync_jobs` and a
   `SyncAdapter` port.~~ **Void (ADR-008).** Removed from schema, env, ports and UI.
8. ~~**IMDb rating badge (P1)** via OMDb behind `FEATURE_OMDB_BADGE`, lazy at request time.~~
   **Replaced (ADR-008 §2–§3):** P0, stored on `catalog_index`, refreshed only by the nightly job.

## Consequences
- Honest UX and no dependency on third-party write terms. The About page explains in plain words that
  Stubbed keeps your reviews and you can export them any time.
- The community average (`title_stats.rating_sum / rating_count`) is trigger-maintained and shown only once
  there are ≥ 5 ratings. It also feeds the "Worth it?" verdict at the same threshold (ADR-009).
