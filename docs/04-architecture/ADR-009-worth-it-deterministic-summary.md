# ADR-009: "Worth it?" — a deterministic decision summary (no AI)

- Status: **Accepted** · Date: 2026-09-26 · Decider: Architect (final call)
- Inputs: PRD D14, D15, §4.2, stories A7, A8, F1–F5; DESIGN §7.4.1; BRIEF "No AI at runtime or in batch jobs"

## Context
Every title page answers "Should I watch this tonight?" in about five seconds: hook, up to 3 vibe tags, time
commitment, certification, a verdict word, and (P1) "If you liked…". The ticket stub also prints the time
commitment. The founder's constraint: the app and its jobs run with **no AI/LLM access** — everything is
built from stored data, rules and templates. The data must also exist offline in demo mode.

## Options
| | A. Compute on read from stored fields (chosen) | B. Precompute the whole block nightly | C. LLM text |
|---|---|---|---|
| Rule/mapping change | Instant, no re-sync | Needs a full re-run | — |
| Uses live stats (Stubbed ratings ≥ 5) | Yes | Stale until next night | — |
| Demo parity | Same pure function over fixtures | Needs a fixture-side precompute | — |
| Allowed | Yes | Yes | **No** (D15; also TMDB terms forbid AI use of TMDB content) |

## Decision

### 1. Storage (on `catalog_index`, filled by the nightly **enrich** step; fixtures in demo mode)
`episode_count`, `episode_runtime`, `series_status`, `tagline`, `certification` (region
`CERTIFICATION_REGION`, default US), `keywords text[]` (TMDB keyword **names**, lowercased),
`recommendation_keys text[]`, `pitch_hook` (**ours**, ≤ 120 chars, never written by the sync), `enriched_at`.
Existing `runtime_minutes`, `season_count` and `imdb_id` are filled by the same step.
- One TMDB call per new or stale row: `GET /{type}/{id}?append_to_response=external_ids,keywords,
  recommendations,similar,release_dates|content_ratings`, mapped by the pure `mapTmdbEnrichment()`
  (`src/server/jobs/enrich.ts`) and written with `rpc('catalog_set_enrichment')`. Order and TTL:
  `rpc('catalog_enrich_due', {p_limit: SYNC_ENRICH_MAX=3000, p_ttl_days: SYNC_ENRICH_TTL_DAYS=30})`.
  At ~10 req/s, 3,000 rows take ~5 minutes; the first ~15k backfill spreads over ~5 nights.
- Everything the block needs is on the index row, so "Worth it?" still renders when TMDB detail is down
  (`detailStatus: 'index_only'`).

### 2. Computation (pure, isomorphic, in `src/lib`)
- `src/lib/worth-it.ts` — `buildWorthIt(input)` (DAL), `ticketTimeLabel(summary)` (ticket stubs, F2),
  `pickHook`, `timeCommitment`, `verdictFor`, `pickLikeCandidates`, `metaDescription`.
- `src/lib/vibes.ts` — the **versioned vibe mapping table** (`VIBE_MAPPING_VERSION`): genre weights plus an
  **allowlist** of keyword names. A vibe needs a score ≥ 2; max 3, strongest first, ties by a fixed order.
  Spoiler guard: `SPOILER_PATTERNS` (twist, death, ending, reveal, betrayal, identity…) — tests reject any
  allowlisted keyword that matches, and runtime skips matching keywords defensively (F1-AC5).
- Rules exactly as PRD §4.2:
  - **Hook**: our `pitch_hook` → TMDB tagline (≤ 120) → first overview sentence (word-boundary cut, "…") →
    template "A {year} {genre} {movie|series} from {director}.". Sources `stubbed | tmdb_tagline |
    tmdb_overview | template`; the two TMDB sources get a "FROM TMDB" label.
  - **Time**: movie `2H 46M` + `SHORT ONE` (< 95 min) / `LONG ONE` (> 150 min). TV
    `4 SEASONS · 36 EPS · ~55 MIN · ≈33 H · ENDED` + `ONE-WEEKEND BINGE` (≤ 8 h) / `BIG COMMITMENT` (> 40 h);
    unknown episode length omits per-episode and total. Ticket: `2024 · 2H 46M`, `2022 · 4 SEASONS · ≈33H`,
    `2022 · 4 SEASONS`, or the year alone.
  - **Verdict**: TMDB always, IMDb if known, Stubbed if ≥ 5 ratings. ≥ 2 sources and a spread ≥ 1.5 →
    "Split opinions" + "{higher} rates it higher than {lower}". Otherwise the mean: ≥ 8.0 Widely loved,
    ≥ 7.3 Well liked, ≥ 6.5 Solid pick, else Mixed reviews. Arithmetic in integer tenths (exact
    thresholds). **No number is ever output.**
  - **If you liked…**: `recommendation_keys` resolved through the catalogue, listed only, most popular
    first, ≤ 6. The public payload is session-free; a private island may prefer one the user has stubbed.
  - **Meta**: `"{hook} {time} · {verdict}"`, ≤ 160 chars (F5).
- `dal.getTitle()` computes `TitleDetail.worthIt` on every read (cheap; microseconds) from the index row,
  `TitleStats` and the recommended titles. Pages never compute it themselves.

### 3. Ownership
`src/lib/worth-it.ts` and `src/lib/vibes.ts` are **Backend-owned** (they may tune thresholds, copy and the
mapping table) but their **exported signatures and the `WorthIt` types in `src/lib/types.ts` are frozen**.
Frontend imports only `ticketTimeLabel` (and types) and renders `TitleDetail.worthIt` as given.
Tests: `tests/lib/worth-it.test.ts` (rules + fixture coverage), `tests/server/jobs.test.ts` (TMDB mapping).

### 4. Demo fixtures (`scripts/fixtures/pitch.source.ts`)
Hand-written original hooks for 69 of 71 titles; The Godfather (→ tagline) and Paterson (→ first overview
sentence) exercise the fallback chain. US certifications (two titles have none → chip hidden), keywords
(some deliberately spoilery, e.g. "twist ending", to prove they never surface), episode runtimes and series
status for every show except Avatar: The Last Airbender (unknown → F2-AC1), and recommendations within the
fixture set. Verdict coverage: Widely loved (most), Well liked (EEAAO, Arrival…), Solid pick (Barbie,
Paterson…), Split opinions (Transformers: five low Stubbed ratings vs IMDb 7.0), Mixed reviews (Twilight,
unlisted).

## Consequences
- $0 and offline-safe; the output is predictable and unit-tested. Weakness: some fallback hooks are bland —
  fixed by hand-written `pitch_hook`s for the most-viewed titles (a service-role editorial task).
- One extra TMDB call per new/stale title per 30 days — well within TMDB limits.
- Adding a new vibe or keyword is a one-line, reviewable change to `vibes.ts`, applied instantly on read.
