# ADR-002: Catalogue sourcing — "Why put everything in a DB? Can't we get it real-time?"

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect (final call) · **Amended 2026-09-27 by ADR-011**: §1 guard abort blocks discover/apply only (§2 there); dry-run semantics (§1 there); recheck cap (§10 there)
Inputs: SYSTEM_DESIGN §3 (options A/B/C, request-budget maths), PRD D2–D4, research.md §2, §11–12

## The answer for the founder, in plain words
> **We already are real-time where it matters, and we only store the small part that has to be stored.**
>
> - **Your stubs, reviews and accounts are saved in our database the moment you tap.** No movie service will hold them for us. IMDb and TMDB don't accept reviews from apps, so this part has to be ours either way.
> - **Title details** (cast, trailer, synopsis, TMDB reviews) are **fetched live from TMDB** the first time someone opens a title, then kept for 24 hours so the next visitor gets them instantly.
> - **The list of good titles** (the ones rated 6.5 or higher) is **refreshed every night**. Each row holds only what a ticket card and the "Worth it?" summary need: name, year, TMDB and IMDb ratings, runtime, poster, colour, certification, a few keywords. That is about 15,000 rows and about 15 MB, which is legal under TMDB's terms (we may cache up to 6 months; we refresh daily).
>
> Why not ask TMDB for every list, live? Three things break:
> 1. **Correctness.** "All" (movies and shows together) sorted by rating cannot be paged correctly from two separate TMDB lists. Ties would jump between pages. Search would return titles below 6.5 that we would have to hide, leaving half-empty pages.
> 2. **Speed.** A search would be 3–5 TMDB round trips in a row (up to 2 s). From our small list it takes about 20 ms.
> 3. **Reliability.** If TMDB is slow or down, a live-only app is down. With the list stored, browse and search keep working and only the extra details go stale.
>
> Ratings move slowly, so a 24-hour-old score is invisible to users. What we get in return: instant, correct sorting and search, a stub count on every ticket, and an app that survives TMDB outages. It also costs 15× fewer TMDB calls, so we stay a good API citizen on the free tier.

## Context
The PRD requires a curated catalogue (TMDB `vote_average ≥ 6.5` plus vote floors), sorting by release date and rating across movies **and** TV with deterministic tie-breaks (A2-AC4), stable pagination (A2-AC2), search restricted to curated titles (A4), joins with our own data (stub counts, community rating), hysteresis (D4), and a no-network demo mode. SYSTEM_DESIGN evaluated A (pure live), B (curated index + live detail) and C (full mirror).

## Options
| | A. Pure live | **B. Hybrid** | C. Full mirror |
|---|---|---|---|
| Correct "All" sort across pages | No | **Yes** (one `ORDER BY`) | Yes |
| Deterministic ties | No (`discover` takes one sort key) | **Yes** | Yes |
| Search only curated titles | Post-filter, short pages | **Native (pg_trgm)** | Native |
| Survives a TMDB outage | Cached pages only | **Browse/search fully; detail stale** | Fully |
| TMDB calls at 1M MAU | ~7.6M/month | **~0.5M/month** | 1.6M initial + changes |
| Storage | ~0 | **~15 MB index + ~30 MB detail cache** | > 3 GB (past free tier) |
| Demo-mode parity | Must re-implement `discover` | **Same table shape, same semantics** | Same as B |

## Decision
**Option B (hybrid)**, implemented as:
1. **`catalog_index`** (Postgres) holds list, sort and search fields for every title matching the curation rule (ADR-003), plus the precomputed palette (ADR-007). It is refreshed nightly by `scripts/sync-catalog.ts` using `discover` sharded by year. The job stages rows in `catalog_staging`, runs guardrails (count per type within [5k, 25k], delta < 20% from the last good run), then merges in **one transaction** (`catalog_apply_staging`). If guardrails fail, the job aborts and leaves the index untouched.
2. **Title detail is live** with TMDB `append_to_response=credits,videos,external_ids,reviews` and a 2.5 s timeout. The **L1** cache is the Next data cache (24 h, tag `title:{key}`). The **L2** cache is `title_detail_cache` (stale fallback). If both miss, the page renders index-only. **TMDB failure never 500s a page** (`detailStatus: fresh | stale | index_only`).
3. **Hysteresis:** rows are never deleted while they are referenced. Titles that fall below the rule get `is_listed = false` and stay reachable by URL and in diaries ("BELOW 6.5 NOW"). A title opened by URL that is not in the index yet (v1 imports) is **lazily inserted** as unlisted from a live detail fetch.
3a. **Per-title enrichment and IMDb ratings** (ADR-008, ADR-009) run in the same nightly job after the merge: the *enrich* step makes one TMDB detail call per new or 30-day-stale row (imdb_id, runtime, seasons/episodes, certification, keywords, recommendations), and the *IMDb* step refreshes cached OMDb ratings in tiers within 900 calls/night. Neither is ever called while serving a request.
4. **Retention:** detail rows older than 150 days, and unlisted, unreferenced index rows older than 150 days, are purged nightly (`catalog_purge_stale`). That keeps us under TMDB's 6-month rule.
5. The **index lives wherever `DATA_MODE` points** (Supabase table, or bundled fixtures in demo mode). **Detail comes from wherever `CATALOG_MODE` points** (TMDB, or fixtures). ADR-006 covers the demo side.
6. TV `discover` excludes **Talk, News and Reality** genres by default (`CATALOG_EXCLUDE_TV_GENRES=10767,10763,10764`). These are closer to programming than titles you "watch" and "stub". This settles SYSTEM_DESIGN open question 8. It is configurable.

## Consequences
- One scheduled job to operate, and its failure mode is safe: yesterday's index stays.
- A title's rating can be up to 24 h old, which is acceptable (TMDB averages move slowly).
- Sorting, search and pagination are pure SQL (`catalog_page`, `catalog_search`). They are unit-tested against the JS reference implementation on real Postgres (PGlite) in `tests/db/migrations.test.ts`.
- The first ingest downloads about 15k `w92` posters (about 75 MB) for palettes. That load goes to the image CDN, not the API.
- User data is always ours (stubs, reviews, watchlist). That is not an option but a requirement, and it is covered in ADR-004.
