# Stubbed — API contract

Status: **Frozen v1.2** (ADR-008 no third-party posting + IMDb everywhere; ADR-009 "Worth it?"; v1.2 = reviewer decisions on the phase-4 change requests, see `docs/05-review/REVIEW.md` §3) · Owner: Architect · Date: 2026-09-26
Source of truth in code (keep in sync; a change needs both):
- `src/lib/types.ts` (domain types)
- `src/lib/contracts.ts` (zod request schemas + response types)
- `src/lib/errors.ts` (error model)
- `src/lib/data-access.ts` (server read interface for pages)
- `src/lib/api-client.ts` (typed browser client)
- `src/lib/format.ts` (score/count display rules, IMDb chip visibility, ticket accessible name)
- `src/lib/worth-it.ts` + `src/lib/vibes.ts` ("Worth it?" rules; signatures frozen, Backend tunes the rules)

---

## 1. Two ways in

| Caller | Uses | For |
|---|---|---|
| **Pages / layouts (React Server Components)** | `import { dal } from '@/server/dal'` (the `DataAccess` interface, §6) | All **reads** needed to render HTML. No HTTP hop. |
| **Client components** | `import { api } from '@/lib/api-client'` → Route Handlers under `/api/**` (§5) | All **mutations**, plus client-side reads: personal state, "Load more", search-as-you-type, reviews tab switching. |

Rules:
1. **Public HTML never reads the session cookie.** Personal bits (stub count, "Stub again", watchlist state, own review, header avatar) are client islands filled from `GET /api/me` and `GET /api/me/title-states`. `dal.getSession()` and `dal.my*()` exist for owner-only pages (`/me/*`), which are private by nature.
2. Pages never mutate. Components never import `@/server/**` (ESLint enforces this).
3. All inputs are validated with the zod schemas in `contracts.ts`. All outputs use the types in `types.ts`. Dates are `YYYY-MM-DD`, timestamps are ISO-8601 UTC. User ratings are `rating10` 1..10. The title identity is `TitleKey` = `"movie:693134"`.

## 1a. Title payloads (every list and page)
`TitleSummary` is the shape of **every** title in every response: catalogue pages, trending, search,
watchlist, wallet (`WalletItem.title`), diary (`DiaryEntry.title`), profile reviews, "If you liked…".
`TitleDetail extends TitleSummary`. Fields that matter for the contract:

| Field | Type | Notes |
|---|---|---|
| `voteAverage`, `voteCount` | number | TMDB. The big score on every stub. Decides curation and the rating sort |
| `imdbRating` | `number \| null` | IMDb 1.0–10.0 via OMDb, cached nightly (ADR-008). **null → hide the IMDb chip** (never 0 / "N/A") |
| `imdbVotes` | `number \| null` | Shown on the detail score chip ("684k votes") |
| `imdbId` | `string \| null` | For the read-only IMDb link (`imdbTitleHref`) |
| `runtimeMinutes` | `number \| null` | Movies |
| `seasonCount`, `episodeCount`, `episodeRuntimeMinutes` | `number \| null` | TV. Ticket time line via `ticketTimeLabel()` (F2) |
| `palette`, `posterPath`, `backdropPath` | | ADR-007 |
| `isListed` | boolean | false = hysteresis title reachable by URL ("BELOW 6.5 NOW") |

`TitleDetail` adds `overview`, `tagline`, `directors`, `cast`, `trailer`, `tmdbReviews`, `detailStatus`,
`fetchedAt` and **`worthIt: WorthIt`** (ADR-009):

```ts
worthIt: {
  hook: { text: string /* ≤120 */, source: 'stubbed' | 'tmdb_tagline' | 'tmdb_overview' | 'template' } | null,
  vibes: { id: VibeId, label: string /* ≤18 */ }[],            // 0–3
  time: { totalMinutes: number | null, badge: 'short_one' | 'long_one' | 'weekend_binge' | 'big_commitment' | null,
          label: string /* "2H 46M · LONG ONE" */, ariaLabel: string } | null,
  certification: string | null,                                   // "PG-13", "TV-MA"
  verdict: { key: VerdictKey, word: string, sourceLine: string, splitNote: string | null,
             sources: ('tmdb' | 'imdb' | 'stubbed')[] },           // never a number
  likeCandidates: TitleSummary[],                                  // P1, listed only, ≤6, most popular first
  metaDescription: string,                                         // ≤160, for <meta> + og:description (F5)
}
```
UI rules: render `titleScores(title)` for score chips (TMDB always, IMDb only when known); show "FROM TMDB"
when `hook.source` starts with `tmdb_`; hide any missing line; never print a blended number. Everything
is computed by rules on the server — **no AI/LLM** (PRD D15).

## 2. Error model
Every non-2xx response has the body `ApiErrorBody`:
```json
{ "error": { "code": "validation_failed", "message": "Please check the highlighted fields.", "fields": { "handle": "3–20 characters: a–z, 0–9 and _" } } }
```
| code | HTTP | When |
|---|---|---|
| `validation_failed` | 400 | zod failure on query/body. `fields` maps field → message |
| `invalid_credentials` | 401 | Wrong email or password, always generic: "That email and password don't match." |
| `unauthenticated` | 401 | The endpoint needs a session |
| `forbidden` | 403 | Cross-origin mutation, bad revalidate secret |
| `not_found` | 404 | Unknown title, stub, review or handle (also used for other users' rows, so existence is never leaked) |
| `email_taken` / `handle_taken` / `conflict` | 409 | Sign-up duplicates, other uniqueness violations |
| `unsupported_media_type` | 415 | Mutation without `Content-Type: application/json` |
| `rate_limited` | 429 | 30 stubs/min, 10 reviews/min. `retryAfter` (seconds) + `Retry-After` header |
| `not_implemented` | 501 | Scaffold placeholder, gone at MVP |
| `upstream_unavailable` | 503 | Only where degradation is impossible (never for title pages) |
| `internal` | 500 | Anything unexpected (logged server-side, generic message) |

The client gets `ApiError { status, code, message, fields?, retryAfter? }` thrown from `api.*`. Map `code` to copy with `ERROR_COPY` (errors.ts) and DESIGN §10.

## 3. Conventions
- **Auth:** a cookie session (Supabase cookies in live mode, `stubbed_demo_session` in demo mode). There are no bearer tokens in the browser. Endpoints marked 🔒 return `401 unauthenticated` when signed out.
- **CSRF:** every mutation (POST/PUT/PATCH/DELETE) must be same-origin (`Origin` host = `Host`), and every mutation with a body must send `Content-Type: application/json`. `api-client` does both.
- **Ownership:** the user id always comes from the session, **never** from the body.
- **Pagination:** keyset. `?cursor=<opaque>&limit=<1..50, default 20>` → `{ items, nextCursor: string|null, total? }`. Pass `nextCursor` back unchanged. An unknown, stale or tampered cursor restarts from the first page (ADR-003), never an error. `total` is present on the catalogue (§5.3) and the diary (§5.10).
- **Idempotency:** `PUT /api/reviews` (upsert) and `PUT/DELETE /api/watchlist/...` are idempotent. `POST /api/stubs` is **not** (each call is one more watch).

## 4. Caching headers
| Response | `Cache-Control` | Notes |
|---|---|---|
| `GET /api/catalog` | `public, s-maxage=3600, stale-while-revalidate=86400` | Tag `catalog` revalidated by the nightly sync |
| `GET /api/search` | `public, s-maxage=300, stale-while-revalidate=3600` | |
| `GET /api/titles/{type}/{id}/reviews` | `public, s-maxage=60, stale-while-revalidate=300` | |
| Everything under `/api/me/**`, `/api/auth/**`, all mutations, all errors | `private, no-store` + `Vary: Cookie` | A response that reads the cookie is **never** public |
| Pages | Dynamic SSR (ADR-001). TMDB detail data-cached 24 h (tag `title:{key}`), catalogue data-cached 1 h (tag `catalog`) | Invariant: never `Set-Cookie` on a public response |
| Hashed static assets | `public, max-age=31536000, immutable` | Next default |

## 5. Route handlers

### 5.1 `GET /api/health`
→ `200 HealthResponse` `{ ok, mode: {catalog, data, isDemo}, catalogCount, lastSyncAt }`. Used by Playwright `webServer` and uptime checks.

### 5.2 `GET /api/me`
→ `200 MeResponse` `{ session: Session | null, mode: AppMode, stubCount: number }`. Private. This powers the header (avatar, wallet badge) and the demo pill. `stubCount` is the signed-in user's total stubs (0 when signed out), so the wallet badge needs no diary paging (v1.2).

### 5.3 `GET /api/catalog`
Query `catalogQuerySchema`:

| param | values | default |
|---|---|---|
| `type` | `all \| movie \| tv` | `all` |
| `sort` | `release_desc \| release_asc \| rating_desc \| rating_asc \| popularity_desc` | `release_desc` |
| `genre` | `18,35` (P1) | — |
| `cursor` | opaque | — |
| `limit` | 1..50 | 20 |

→ `200 Page<TitleSummary>` with `total`. Listed titles only. Order per ADR-003. Every item carries `imdbRating`/`imdbVotes` (§1a).

### 5.4 `GET /api/search?q=&type=&limit=`
`q` is 1..100 characters. → `200 SearchResult { query, items: TitleSummary[], notInCatalog }`. `notInCatalog: true` when nothing curated matched: show "Not in Stubbed — we only list titles rated 6.5+" (not an error).

### 5.5 `GET /api/titles/{movie|tv}/{tmdbId}/reviews?sort=newest|highest&cursor=&limit=`
→ `200 Page<Review>`: Stubbed reviews only (TMDB reviews are in `TitleDetail.tmdbReviews`). Unknown type or id gives `404`.

### 5.6 `GET /api/me/title-states?keys=movie:1,tv:2` 🔒-soft
Up to 60 keys. → `200 { states: Record<TitleKey, TitleState> }`. When signed out it returns `{ states: {} }` (not 401), so islands can call it blindly.
`TitleState = { stubCount, lastWatchedOn, hasStubToday, watchlisted, myReview }`.

### 5.7 `POST /api/stubs` 🔒
Body `createStubSchema`:
```ts
{ mediaType: 'movie'|'tv', tmdbId: number, watchedOn?: 'YYYY-MM-DD' /* default today */, watchedWhere?: 'cinema'|'streaming'|'tv'|'other'|null, note?: string /* ≤280 */ }
```
→ `201 StubMutationResponse { stub: Stub, state: TitleState }`.
Errors:
- `400` with `fields.watchedOn` for a future date or a date before Jan 1 of (release year − 1). "Future" means after **server today (UTC) + 1 day**: users ahead of UTC can log their local today (v1.2; the DB trigger uses the same slack)
- `404` for an unknown title
- `429` when over the rate limit

A same-day duplicate **is allowed** (a double feature). The UI confirms first using `state.hasStubToday` (C3-AC3).

### 5.8 `PATCH /api/stubs/{id}` 🔒
Body `updateStubSchema` (any of `watchedOn`, `watchedWhere`, `note`; at least one). → `200 StubMutationResponse`. `watchedOn` follows the §5.7 rules. Someone else's stub or an unknown id gives `404`.

### 5.9 `DELETE /api/stubs/{id}` 🔒
→ `200 StubDeleteResponse { state }`. This is also the **Undo** of a just-created stub.

### 5.10 `GET /api/me/stubs?type=&cursor=&limit=` 🔒
The diary. → `200 DiaryResponse` = `Page<DiaryEntry> & { total }`, ordered newest first (`watchedOn DESC, createdAt DESC, id ASC`). `total` counts every stub matching `type` (not just the page; v1.2). The UI groups by month.

### 5.11 `PUT /api/reviews` 🔒
Body `upsertReviewSchema`:
```ts
{ mediaType, tmdbId, rating10: 1..10, body?: string /* ≤5000, default '' */, isSpoiler?: boolean, stubId?: uuid|null }
```
→ `201` (created) or `200` (updated) with `ReviewUpsertResponse { review, created, suggestStub }`. `suggestStub` is true when the user has no stub for the title (D1-AC4). `429` applies when over the review rate limit (inserts and content edits count; a re-save or stub re-link does not). A `stubId` that is not the user's stub of that title gives `400`. The upsert replaces `stubId`: an omitted `stubId` unlinks the stub, so editors resend the current one.

### 5.12 `DELETE /api/reviews/{id}` 🔒
→ `204`. Someone else's review gives `404`.

### 5.13 *(removed — ADR-008)*
There is no endpoint, field or UI for posting to IMDb, Trakt, TMDB or any other service. Numbering is kept
stable so references to §5.14–§5.19 stay valid.

### 5.14 `PUT /api/watchlist/{movie|tv}/{tmdbId}` 🔒 · `DELETE` (same path) 🔒
PUT takes body `{}`. → `200 WatchlistResponse { watchlisted }`. Both are idempotent.

### 5.15 `GET /api/me/watchlist?cursor=&limit=` 🔒
→ `200 Page<TitleSummary>`, newest added first.

### 5.16 `GET /api/me/export?format=letterboxd|json` 🔒
→ `200` attachment, `private, no-store`.
- `letterboxd`: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="stubbed-letterboxd-YYYY-MM-DD.csv"`, columns `tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`. **Movies only** (Letterboxd is a film service and matches `tmdbID` as a TMDB *movie* id; TV ids collide with movie ids, and TV stubs are in the JSON export). There is one row per stub, oldest first. The rating and review go on the most recent stub of each title, `Rewatch=true` for every stub after the first, and dates are `YYYY-MM-DD`. A reviewed movie that was never stubbed gets **one row with an empty `WatchedDate`** (Letterboxd imports it as a rating/review), so no data is dropped. RFC 4180 quoting, CRLF line ends.
- `json`: `application/json` `{ exportedAt, profile, stubs, reviews, watchlist }` (movies and TV).
- Rate limit: 1 per 10 min per user **per format** (so "CSV" and "JSON" can both be downloaded once), otherwise `429` with `Retry-After`.

### 5.17 `PATCH /api/me/profile` 🔒
Body `updateProfileSchema` (`displayName` 1..50, `bio` ≤ 160, `avatarUrl` URL | null). → `200 ProfileResponse`. The handle is immutable.

### 5.18 Auth
| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /api/auth/signup` | `signUpSchema` `{ email, password (8..72), handle, displayName? }` | `201 AuthResponse { session }` and sets the session cookie | `400` fields, `409 email_taken`, `409 handle_taken` |
| `POST /api/auth/signin` | `signInSchema` `{ email, password }` | `200 AuthResponse` and sets the cookie | `401 invalid_credentials` (generic) |
| `POST /api/auth/signout` | `{}` | `204` and clears the cookie | — |
| `POST /api/auth/magic-link` | `magicLinkSchema` `{ email, next? }` | `202 MagicLinkResponse { sent: true, devLink? }` (`devLink` in demo mode only; it points at the origin the request used) | `400`, `429`. Never reveals whether the email exists |
| `GET /api/auth/handle-available?handle=` | — | `200 { available, reason? }` | — |
| `GET /auth/callback?code=&next=` (demo: `demo_token=`) | — | `302` to `safeNext(next)` after the code exchange, with a **relative** `Location` (the browser stays on the host it used; `safeNext` guarantees a same-origin path) | `302 /signin?error=callback&next=…` |

After a successful sign-up or sign-in the client navigates to `safeNext(next)` and replays the pending action (B2-AC3).

### 5.19 `POST /api/revalidate` (job only)
Header `x-revalidate-secret: $REVALIDATE_SECRET`, body `{ tags: string[] }` → `200 { revalidated }`. Otherwise `403`.

## 6. `DataAccess` (server, for pages): `src/lib/data-access.ts`
| Method | Returns | Notes |
|---|---|---|
| `getMode()` | `AppMode` | Pass `mode.images` and `mode.isDemo` down as props |
| `listCatalog(CatalogQuery)` | `Page<TitleSummary>` + `total` | Browse grid (first page SSR, then `api.catalog` for "Load more") |
| `listTrending(type, limit=10)` | `TitleSummary[]` | Home rail |
| `searchCatalog(q, type?, limit?)` | `SearchResult` | `/search?q=` page |
| `getTitle(mediaType, tmdbId)` | `TitleDetail \| null` | `null` → `notFound()`. `detailStatus` drives the "may be out of date" / "More details unavailable" notes. `isListed=false` → "This title dropped below our 6.5 bar". Includes `worthIt` (always present, even when `detailStatus='index_only'`) |
| `getTitleStats(key)` | `TitleStats` | `ratingAvg10` is null below 5 ratings |
| `listTitleReviews(key, {sort, cursor, limit})` | `Page<Review>` | The user's own review is pinned client-side from `TitleState.myReview` |
| `getProfile(handle)` | `ProfilePage \| null` | Header, stats, palette for `/u/{handle}` |
| `listWallet(handle, …)` | `Page<WalletItem>` | One per title, stacked for rewatches |
| `listDiary(handle, {type,…})` | `Page<DiaryEntry>` | Public diary tab |
| `listProfileReviews(handle, …)` | `Page<ReviewWithTitle>` | |
| `getSession()` | `Session \| null` | Owner-only pages (`/me/*`) |
| `myTitleStates(keys)` | `Record<TitleKey, TitleState>` | Owner-only pages |
| `myWatchlist(…)` | `Page<TitleSummary>` | Throws `unauthenticated` → redirect to `/signin?next=` |

## 7. Pages and URL state (Frontend)
| Route | Data | URL state |
|---|---|---|
| `/` | `listTrending`, `listCatalog` | `?type=&sort=` (the home browse section) |
| `/browse` | `listCatalog` | `?type=movie\|tv&sort=…&cursor=` (use `browseHref`) |
| `/search` | `searchCatalog` | `?q=&type=` |
| `/title/{movie\|tv}/{tmdbId}-{slug}` | `getTitle`, `getTitleStats`, `listTitleReviews` | A wrong slug with the right id → `permanentRedirect` to the canonical `titleHref()`. Unknown → 404. `generateMetadata` uses `worthIt.metaDescription` for description + `og:description` |
| `/u/{handle}` | `getProfile`, `listWallet`, `listDiary`, `listProfileReviews` | `?tab=wallet\|diary\|reviews\|watchlist` |
| `/me/stubs` | `getSession`, `listDiary(session.handle)` | `?type=` |
| `/me/settings` | `getSession` | — |
| `/signin`, `/signup` | — | `?next=&action=` |
| `/about` | — | — |

## 8. QA hooks (`data-testid`), from DESIGN §11
`ticket-{key}` (for example `ticket-movie:693134`), `stub-button`, `stub-count`, `tmdb-rating`, `imdb-rating` (the IMDb chip on a stub and the detail IMDb score chip; absent when `imdbRating` is null), `ticket-time`, `sort-select`, `type-filter`, `search-input`, `review-composer`, `review-card`, `spoiler-toggle`, `demo-pill`, `toast`, `auth-sheet`, `load-more`, `diary-row`, `wallet-stub`, and for "Worth it?" (DESIGN §7.4.1): `worth-it`, `worth-it-hook`, `worth-it-vibes`, `worth-it-time`, `worth-it-cert`, `worth-it-verdict`, `worth-it-like`.

There is deliberately **no** `imdb-assist` (or any "post to…") hook: gap review checks its absence (PRD D3).
