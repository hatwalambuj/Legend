# ADR-003: Curation rule, sort semantics and keyset pagination

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect
Inputs: PRD D3–D5, A1–A4; research.md §12; SYSTEM_DESIGN §3.4, §18 (#5, #8)

## Context
The brief promises "top-rated titles only: rating ≥ 6.5". Without a vote floor, titles with a handful of votes and a 9.0 average flood the list. Sort order has to be correct across page boundaries and identical in live (Postgres) and demo (JS) modes. Pages have to be shareable by URL.

## Decision

### 1. Curation rule: one function, configurable
`src/lib/curation.ts → isListed()` is the **only** implementation. The sync job uses it to compute `is_listed`, and demo mode applies it to fixtures at load time. A title is listed when **all** of these hold:

| Condition | Default | Env |
|---|---|---|
| `round(vote_average, 1) ≥ minRating` (inclusive, one-decimal like `numeric(3,1)`) | 6.5 | `CATALOG_MIN_RATING` |
| movie `vote_count ≥` | 200 | `CATALOG_MIN_VOTES_MOVIE` |
| TV `vote_count ≥` | 100 | `CATALOG_MIN_VOTES_TV` |
| TV genres not in the exclusion list | Talk 10767, News 10763, Reality 10764 | `CATALOG_EXCLUDE_TV_GENRES` |
| not adult, has a release/first-air date, and that date is not in the future | — | — |
| **Hysteresis:** a previously listed title stays listed down to `keepRating` | = minRating (off) | `CATALOG_KEEP_RATING` |

Listing only controls **browse and search**. Unlisted rows remain reachable by URL and in diaries (PRD D4). The fixtures include every boundary: 6.4 with high votes (out), 8.0 with 150 votes (out), TV 8.0 with 99 votes (out), Reality (out), and exactly 6.5/200 and 6.5/100 (in).

### 2. Sort semantics: total orders
Every sort ends in the unique `title_key` (`"movie:603"`, compared bytewise), so no two rows ever tie. The spec lives in `src/lib/catalog-order.ts`, and SQL `public.catalog_page()` mirrors it:

| `sort=` | Order | Notes |
|---|---|---|
| `release_desc` (**default**) | release_date DESC, sort_title ASC, key ASC | TV uses first-air date (A3-AC2) |
| `release_asc` | release_date ASC, sort_title ASC, key ASC | |
| `rating_desc` | vote_average DESC, **vote_count DESC**, sort_title ASC, key ASC | A2-AC4 |
| `rating_asc` | vote_average ASC, **vote_count DESC**, sort_title ASC, key ASC | more-voted first among equals |
| `popularity_desc` | popularity DESC, key ASC | home "Trending" rail only, not in the browse UI |

`sort_title = normalizeSearch(title)` (lowercased, diacritics stripped) is stored in a `COLLATE "C"` column, so JS `<` and Postgres agree. Unknown `sort`/`type` values fall back to the defaults. They never produce an error or reach SQL, because they come from an allowlist and the SQL fragments are fixed.

### 3. Pagination: keyset with an opaque cursor
- `?cursor=` is `base64url(JSON {s: sort, t: [last row's sort tuple]})`. The API returns `nextCursor` (null on the last page) plus `total` (a count over the same filter).
- Why keyset rather than offset: results stay stable while the nightly sync changes ratings, it is O(limit) at any depth, and it matches the SQL indexes one to one (a partial index per sort, for all types and per type).
- A cursor minted for another sort, or a malformed one, is ignored and the list restarts at page 1. It never errors.
- **URL state (A2-AC3, A3-AC1):** `/browse?type=movie|tv&sort=…` (defaults dropped, stable param order via `browseHref`). "Load more" fetches `/api/catalog?…&cursor=` and appends. The same cursor also works as a plain link (`/browse?…&cursor=…`), so pagination works without JS and a shared link reproduces the view from that point.
- `limit` defaults to 20, max 50.

### 4. Search
Search runs on the normalised `search_text` (`title + original_title`): a partial, case- and accent-insensitive match ("shogun" finds "Shōgun", "amelie" finds "Amélie"), listed titles only. Ordering is prefix match first, then trigram similarity, then popularity. Zero hits gives `notInCatalog: true`, and the UI shows "Not in Stubbed — we only list titles rated 6.5+". That is never an error (A4-AC2).

## Consequences
- Parity between SQL and JS is enforced by `tests/db/migrations.test.ts`, which walks every sort × type through `catalog_page()` on PGlite and compares with `paginate()`.
- Changing a tie-break is a breaking change to cursors. Bump the cursor format and treat old cursors as page 1 (already the behaviour for malformed ones).
- Genre filters (P1) are already supported by `catalog_page(p_genre_ids)` and `?genre=18,35`.
