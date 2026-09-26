# ADR-008: No third-party posting; show the IMDb rating everywhere

- Status: **Accepted** (founder decision, 2026-09-26; implementation details decided by the Architect)
- Supersedes: ADR-004 §4, §7 and §8, and the old API_CONTRACT §5.13
- Related: ADR-009 ("Worth it?"), PRD §4.1 "Ratings we show", PRD D3 (retired), A7

## Context
The founder removed the requirement to post reviews or ratings to IMDb or any other service,
and asked for the IMDb rating to be visible on screen.

## Decision

### 1. Nothing is ever posted to a third party
Reviews and ratings are stored only in Stubbed's database. There is no IMDb copy-and-open assist, no
Trakt or TMDB write sync, no outbox, and no `imdbSharedAt` / `imdb_shared_at` field. Removed from code,
schema, env and docs:
- `POST /api/reviews/{id}/imdb-shared`, `imdbSharedSchema`, `api.setImdbShared`
- tables `sync_accounts`, `sync_jobs`, `rating_enrichment`; the value `stubs.source = 'trakt'`
- env `FEATURE_TRAKT_SYNC`, `TRAKT_*`, `SYNC_TOKEN_ENC_KEY`, `FEATURE_OMDB_BADGE`
- `AppMode.features` (`traktSync`, `omdbBadge`), the `SyncAdapter` port and `Container.sync`
- the `imdb-assist` test id

`tests/lib/guards.test.ts` fails the build if any of these names come back into `src/`, `scripts/`,
`e2e/` or `.github/`. The user's own export (Letterboxd CSV / JSON, API_CONTRACT §5.16) remains the way to
take data elsewhere.

### 2. IMDb rating: stored on the catalogue row, returned in every title payload
- Columns on `catalog_index`: `imdb_rating numeric(3,1)` (1.0–10.0), `imdb_votes integer`,
  `imdb_checked_at timestamptz` (last OMDb lookup; null = never).
- `TitleSummary` (so every list, rail, search result, diary row, wallet item and title page) carries
  `imdbRating: number | null` and `imdbVotes: number | null`.
- **The request path never calls OMDb.** Only the nightly job does (`src/server/providers/omdb.ts`,
  `src/server/jobs/imdb-refresh.ts`). A title inserted during the day shows no IMDb chip until the next night.
- An `imdb_id` change (enrich step or staging apply) resets the three columns, so the rating is re-fetched first.
- OMDb `"N/A"` or an unknown id is stored as `imdb_rating = null` **and** `imdb_checked_at = now()`, so it
  is not retried before its TTL.

### 3. OMDb refresh: rolling, tiered, within 1,000 calls/day (final call)
The free OMDb key allows 1,000 calls/day. At ~12–15k titles a flat 7-day TTL would need ~2,000 calls/day,
so a 7-day TTL for everything is **not achievable on the free tier**. Decision:

| Tier | Which rows | Refresh | ~Calls/night at 15k titles |
|---|---|---|---|
| 1 | Never checked (new titles, changed `imdb_id`) — listed first, most popular first | next night | 20–50 (first run: backfill over ~2 weeks) |
| 2 | "Hot": the `OMDB_HOT_COUNT` (1,000) most popular **listed** titles | every `OMDB_HOT_TTL_DAYS` (7) | ~145 |
| 3 | Everything else with an `imdb_id` (incl. unlisted, hysteresis) | every `OMDB_TTL_DAYS` (30) | ~470 |

- Budget `OMDB_DAILY_BUDGET` = **900** calls/night (100 calls of headroom for manual runs and retries).
  Tiers 1–3 total ≈ 650/night in steady state, so the budget is never the bottleneck after the backfill.
- Ordering lives in SQL (`public.catalog_imdb_due(p_limit, p_hot_ttl_days, p_ttl_days, p_hot_count)`);
  writes go through `public.catalog_set_imdb(p_rows)`. Both are service-role only.
- The job stops cleanly on OMDb's "Request limit reached!" and resumes the next night.
- IMDb ratings move slowly; a 30-day-old rating on a long-tail title is invisible to users. The UI does not
  show the age of the IMDb rating.
- **Paid option (not required):** an OMDb Patreon key (from ~$1/month, 100k calls/day) needs only
  `OMDB_DAILY_BUDGET=20000` and `OMDB_TTL_DAYS=7` — no code change. Revisit when going commercial (the free
  key is CC BY-NC, like the rest of the MVP stack).

### 4. UI rules (frozen helpers in `src/lib/format.ts`)
- Every ticket stub shows `TMDB x.x` plus an `IMDb x.x` chip; the detail page shows both score chips
  (IMDb chip label `IMDb rating · via OMDb`, `IMDB_SOURCE_LABEL`).
- Components render `titleScores(title)`; it returns TMDB always and IMDb **only when `imdbRating` is a
  positive number**. Null is hidden, never shown as 0, "N/A" or an empty chip (A7-AC3).
- Accessible name: `ticketAccessibleName()` → "Dune: Part Two, movie, 2024, rated 8.1 on TMDB and 8.5 on IMDb".
- Colours: `--imdb` / `--on-imdb` tokens (brand yellow, black text). DESIGN §8 open item: if IMDb's brand
  rules disallow the yellow mark, the tokens switch to a neutral outlined label without component changes.
- The IMDb chip may link out to `imdbTitleHref(imdbId)` (read-only link, `rel="noopener"`).
- IMDb never affects curation or the rating sort (PRD §4.1, A7-AC5). Only TMDB decides.

### 5. Demo fixtures
Every fixture title with an `imdbId` carries its real IMDb rating and an approximate vote count (best-known
values, mid-2026). One deliberate exception: **Bluey** has no `imdbId`, so the hidden-chip path is visible
in demo mode (A7-AC3). Zombieland (TMDB adjusted to 6.4, IMDb 7.5) proves IMDb never changes membership
(A7-AC5). Tests: `tests/lib/format.test.ts`.

## Consequences
- Less code, fewer secrets, no OAuth, no outbox worker, and no legal risk from automating third-party sites.
- The nightly job gains two steps (enrich, IMDb), both idempotent and resumable.
- Long-tail IMDb values can be up to ~30 days old on the free key. Accepted.
