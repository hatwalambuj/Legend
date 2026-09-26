# ADR-008: No third-party posting; show IMDb rating everywhere

- Status: Accepted (founder decision, 2026-09-26)
- Supersedes: the external-sync parts of ADR-004 and API_CONTRACT §5.13

## Context
The founder removed the requirement to post reviews or ratings to IMDb or any other service,
and asked for the IMDb rating to be visible on screen.

## Decision
1. Reviews and ratings are stored only in Stubbed's database. There is no IMDb copy-and-open assist,
   no Trakt or TMDB write sync, and no `imdbSharedAt` / `imdb_shared_at` field.
2. Remove: `POST /api/reviews/{id}/imdb-shared`, `sync_accounts`, `sync_jobs`, `reviews.source = 'trakt'`,
   `FEATURE_TRAKT_SYNC` and `TRAKT_*` env vars, the `traktSync` capability flag, and the `imdb-assist` test id.
3. IMDb rating (and vote count) is read from OMDb by the nightly job for every listed title that has an `imdb_id`,
   stored with the catalog row, and returned in every title payload (`imdbRating: number | null`).
   OMDb free tier is 1,000 calls/day, so refresh is staggered: new titles first, then the oldest ratings, 7-day TTL.
4. UI: every ticket stub shows `TMDB x.x` plus an `IMDb x.x` chip; the detail page shows both score blocks.
   When `imdbRating` is null the chip is hidden, never shown as 0.
5. Demo fixtures include real IMDb ids and IMDb ratings for all titles.

## Consequences
- Less code, fewer secrets, no OAuth, no outbox worker, and no legal risk from automating third-party sites.
- The Letterboxd CSV / JSON export remains as the user's way to take their data elsewhere.
