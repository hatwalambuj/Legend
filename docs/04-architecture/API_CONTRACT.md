# Stubbed — API contract

Status: **Frozen v1.6** (v1.6 = 2026-10-03, ADR-013 close-out: §1c, §5.3/5.4/5.15 `region` + `watchHint`, §5.7/5.8 `season`, §5.17 `avatarColor`, §5.18 sign-up `ref`, §5.24–§5.27 events/log/imports, §5.28 share/OG routes, 413 `payload_too_large`, real 404/308 on pages; v1.5 = 2026-09-27, ADR-012 "Where to watch": `TitleDetail.watch`, `GET /api/titles/{type}/{id}/watch`, `PUT /api/me/watch-region`, `stubbed_region` cookie, `SessionUser.watchRegion`, `AppMode.watchRegions`, P1 `region`/`provider` on the catalogue; lands after M1 as W-00; v1.4 = 2026-09-27, ADR-010/011: honest `/api/health`, `TitleDetail.degraded`, confirm-email-safe sign-up, `PUT /api/auth/password`, `reauth_required`; ADR-008 no third-party posting + IMDb everywhere; ADR-009 "Worth it?"; v1.2 = reviewer decisions on the phase-4 change requests, see `docs/05-review/REVIEW.md` §3; v1.3 = GAP review MUST FIX #4/#5: `DELETE /api/me`, `AppMode.demoResets`, seeded-only dev links in a public demo, contact config) · Owner: Architect · Date: 2026-09-26
Source of truth in code (keep in sync; a change needs both):
- `src/lib/types.ts` (domain types)
- `src/lib/contracts.ts` (zod request schemas + response types)
- `src/lib/errors.ts` (error model)
- `src/lib/data-access.ts` (server read interface for pages)
- `src/lib/api-client.ts` (typed browser client)
- `src/lib/format.ts` (score/count display rules, IMDb chip visibility, ticket accessible name)
- `src/lib/provider-links.ts` + `src/lib/regions.ts` (v1.5, ADR-012: link config and builder, supported-region names)
- v1.6 (ADR-013): `src/lib/brand.ts`, `src/lib/share.ts`, `src/lib/avatar.ts`, `src/lib/analytics.ts` (allowlist + client queue), `src/lib/report-error.ts`, `src/lib/import/*` (client-safe parsers)
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
`fetchedAt`, **`degraded: null | 'community' | 'catalog'`** (v1.4, ADR-011 §4: `catalog` = our DB was unreachable and the page
is built from a last-good copy or from TMDB, IMDb chip hidden, stubs/reviews paused; `community` = only community stats are
missing; the page shows `data-testid="degraded-banner"`) and **`worthIt: WorthIt`** (ADR-009):

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

## 1b. Where to watch (v1.5, ADR-012)
`TitleDetail.watch: TitleWatch | null`. **null = do not render the block** (never fetched, older than 30 days, or `degraded === 'catalog'`;
SSR decides, so no CLS). Built per request for one region; all `href`s are built on the server (ADR-012 §6.3).

```ts
type WatchOfferType = 'stream' | 'free' | 'ads' | 'rent' | 'buy';
type WatchGroupType = WatchOfferType | 'rent_buy';           // rent_buy = every rent provider is also a buy provider
type WatchLinkKind  = 'search' | 'home' | 'tmdb';
type WatchRegionSource = 'query' | 'setting' | 'geo' | 'accept_language' | 'default';

interface WatchRegionInfo {
  region: string;              // ISO 3166-1 alpha-2, always in AppMode.watchRegions
  regionName: string;          // "United States" (src/lib/regions.ts)
  requested: string | null;    // what the winning source asked for (may be unsupported)
  fallback: boolean;           // true → UI shows "Showing: United States · Change" (W3-AC4)
  source: WatchRegionSource;
}
interface WatchProviderItem {
  providerId: number;
  name: string;                // "Netflix"
  logoPath: string | null;     // TMDB path → providerLogoUrl() (w92); null → monogram tile
  monogram: string;            // ≤ 2 chars, always present
  tile: string | null;         // monogram background (demo), null → --surface-2
  href: string;                // https only; allowlisted host; no tracking params
  linkKind: WatchLinkKind;
  alsoBuy?: true;              // only inside a 'rent' group: sub-caption "RENT · BUY"
}
interface WatchGroup { type: WatchGroupType; providers: WatchProviderItem[] }  // full list, UI caps at 6 + "+N"
interface TitleWatch extends WatchRegionInfo {
  status: 'available' | 'none';   // none → "Not streaming in {Region} right now" (groups = [])
  groups: WatchGroup[];           // fixed order stream, free, ads, rent|rent_buy, buy; empty groups omitted
  allOptionsHref: string;         // https://www.themoviedb.org/{type}/{id}/watch?locale={region}
  checkedAt: string;              // ISO-8601 UTC → "CHECKED SEP 27, 2026"
}
```
UI accessible name per tile: `Open {name} ({type label}) — opens in a new tab` (W5-AC1). Links: `target="_blank" rel="noopener noreferrer"`.
`AppMode.watchRegions: { code: string; name: string }[]` feeds the region `<select>`. `SessionUser.watchRegion: string | null`.

## 1c. Close-out additions (v1.6, ADR-013)
```ts
type AvatarColor = 'sunset' | 'ocean' | 'forest' | 'grape' | 'ember' | 'steel' | 'rose' | 'gold';
interface WatchHint { providerId: number; name: string; logoPath: string | null; monogram: string; tile: string | null }
// TitleSummary.watchHint?: WatchHint | null   — absent unless the list call had `region`; null = nothing to stream / stale (>30 d)
// Stub.season: number | null                    — TV only, 1..200; DiaryEntry/WalletItem inherit it
// PublicProfile.avatarColor: AvatarColor | null — null = handle-derived colour (also in Review.author)
interface WatchProviderChip { providerId: number; name: string; logoPath: string | null; monogram: string; count: number }
interface StubShareCard {                         // never note / review text / spoiler content
  stubId: string; number: number; watchedOn: IsoDate; season: number | null;
  title: Pick<TitleSummary, 'key' | 'mediaType' | 'title' | 'year' | 'voteAverage' | 'imdbRating' | 'posterPath' | 'palette'>;
  handle: string; displayName: string; avatarColor: AvatarColor | null; profileUrl: string;
}
type ImportSource = 'letterboxd' | 'imdb' | 'tvtime';
interface ImportRow { ref: string; mediaType?: MediaType; tmdbId?: number; imdbId?: string; title?: string; year?: number;
  watchedOn?: IsoDate | null; rating10?: number | null; rewatch?: boolean; review?: string; hasReview?: boolean;
  isSpoiler?: boolean; season?: number | null }
type AnalyticsEventName = 'signup_completed' | 'stub_created' | 'stub_again' | 'review_saved' | 'watchlist_added'
  | 'export_downloaded' | 'import_completed' | 'share_generated' | 'worth_it_viewed' | 'provider_clicked';
```
`ticketAccessibleName()` appends `", on {name}"` when `watchHint` is set; `seasonLabel(3)` → `"S03"`; copy uses `BRAND_NAME`.

## 2. Error model
Every non-2xx response has the body `ApiErrorBody`:
```json
{ "error": { "code": "validation_failed", "message": "Please check the highlighted fields.", "fields": { "handle": "3–20 characters: a–z, 0–9 and _" } } }
```
| code | HTTP | When |
|---|---|---|
| `validation_failed` | 400 | zod failure on query/body. `fields` maps field → message |
| `invalid_credentials` | 401 | Wrong email or password, always generic: "That email and password don't match." |
| `reauth_required` | 401 | v1.4: `PUT /api/auth/password` with a session older than 10 min: "Sign in again to change your password." |
| `unauthenticated` | 401 | The endpoint needs a session |
| `forbidden` | 403 | Cross-origin mutation, bad revalidate secret |
| `not_found` | 404 | Unknown title, stub, review or handle (also used for other users' rows, so existence is never leaked) |
| `email_taken` / `handle_taken` / `conflict` | 409 | Sign-up duplicates, other uniqueness violations |
| `unsupported_media_type` | 415 | Mutation without `Content-Type: application/json` |
| `payload_too_large` | 413 | v1.6: body or row count over the route limit (imports, `/api/events`, `/api/log`) |
| `rate_limited` | 429 | 30 stubs/min, 10 reviews/min. `retryAfter` (seconds) + `Retry-After` header |
| `not_implemented` | 501 | Scaffold placeholder, gone at MVP |
| `upstream_unavailable` | 503 | Only where degradation is impossible. Title pages reach it only when **both** our DB and TMDB fail (ADR-011 §4) |
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
| `GET /api/titles/{type}/{id}/watch?region=` | `public, s-maxage=3600, stale-while-revalidate=86400` | v1.5: `region` is required and is the **only** region input (no cookie, no `Accept-Language`, no `Set-Cookie`), so the URL keys the cache |
| `GET /api/watch/providers?region=` (P1) | `public, s-maxage=3600, stale-while-revalidate=86400` | Tag `watch-providers` |
| `GET /api/catalog?region=…&provider=…`, `GET /api/search?region=…` | unchanged (`region` is in the URL) | v1.6: never read the cookie; region echo in body |
| `/title/{type}/{slug}/opengraph-image` | `public, s-maxage=86400, stale-while-revalidate=604800` | v1.6 (ADR-013 C-08): `revalidate = 86400`, no `Set-Cookie` |
| `/share/stub/{id}/opengraph-image`, `/share/stub/{id}/story` | `public, s-maxage=600` (no swr) | v1.6: a deleted stub disappears within 10 min |
| `POST /api/events`, `POST /api/log`, `/api/me/imports/**` | `private, no-store` | v1.6 |
| `GET`/`HEAD /api/health` | `no-store` | v1.4: never cached at any layer; the probe bypasses the data cache (ADR-011 §3) |
| Everything under `/api/me/**`, `/api/auth/**`, all mutations, all errors | `private, no-store` + `Vary: Cookie` | A response that reads the cookie is **never** public |
| Pages | Dynamic SSR (ADR-001), `private`. The title page reads the `stubbed_region` cookie and `Accept-Language` (ADR-012 §5), never the session. TMDB detail data-cached 24 h (tag `title:{key}`), catalogue data-cached 1 h (tag `catalog`) | Invariant: never `Set-Cookie` on a public response |
| Hashed static assets | `public, max-age=31536000, immutable` | Next default |

## 5. Route handlers

### 5.1 `GET /api/health` · `HEAD /api/health` (v1.4, ADR-011 §3)
Query: `strict=1` (optional) → a `degraded` result returns 503 instead of 200. No auth, never reads or sets cookies,
`Cache-Control: no-store`, per-IP limit 60/min (`429`). `HEAD` returns the same status with no body.

```ts
interface HealthResponse {
  ok: boolean;                                   // status === 'ok' (kept for v1.3 clients)
  status: 'ok' | 'degraded' | 'down';
  mode: { catalog; data; isDemo };
  catalogCount: number | null;                   // listed titles; null when down
  lastSyncAt: string | null;                     // last FULL sync (discover applied, status ok); F1
  syncAgeHours: number | null;                   // rounded to 0.1
  checks: { db: 'ok' | 'fail' | 'skipped'; sync: 'ok' | 'stale' | 'never' | 'unknown' | 'skipped' };
  reasons: ('db_unreachable' | 'sync_never' | 'sync_stale' | 'catalog_empty')[];
}
```
| Condition | HTTP | `status` |
|---|---|---|
| Demo mode | 200 | `ok` (`checks` = `skipped`) |
| Live, DB probe fails or exceeds 3 s | **503** | `down` |
| Live, no full sync, sync older than `HEALTH_MAX_SYNC_AGE_HOURS` (36), or 0 listed titles | 200 (**503** with `strict=1`) | `degraded` |
| Live, all good | 200 | `ok` |

The body never contains error messages, hosts or stack traces. Used by Playwright `webServer` (demo → always 200) and by
two free uptime monitors (default URL = "site down", `?strict=1` = "sync stale"); the monitor also keeps Supabase Free awake.

### 5.2 `GET /api/me`
→ `200 MeResponse` `{ session: Session | null, mode: AppMode, stubCount: number }`. Private. This powers the header (avatar, wallet badge) and the demo pill. `stubCount` is the signed-in user's total stubs (0 when signed out), so the wallet badge needs no diary paging (v1.2).
v1.5: `session.user.watchRegion` (`string | null`) and `mode.watchRegions`. When `watchRegion` is set and differs from a page's `TitleWatch.region` (cookie missing or stale, e.g. another device), the island calls `PUT /api/me/watch-region` once to heal the cookie (ADR-012 §7).
`mode.demoResets` (v1.3, optional) is `true` when demo data is not durable (a production/public demo opted in with `DEMO_MODE_PUBLIC=true`, `DEMO_RESET_ON_BOOT`, an in-memory store or Vercel's `/tmp`): the pill then reads **"Demo: data resets"**. Pages get the same object from `dal.getMode()`.

### 5.2a `DELETE /api/me` 🔒 (v1.3, GAP-06)
Body `deleteAccountSchema` `{ confirm: "DELETE" }` (JSON, same origin; `api.deleteAccount()` sends it). → `204` and the session cookies are cleared.
Erases the account and everything it owns: profile, stubs, reviews (incl. stub-linked ones), watchlist and rate-limit events; community stats of the affected titles drop accordingly. Live: service-role `auth.admin.deleteUser` (hard delete) after re-validating the caller's JWT, then the `on delete cascade` chain from `auth.users`; needs `SUPABASE_SERVICE_ROLE_KEY` on the server. Demo: one store mutation. The email and handle can be reused afterwards.
Errors: `401` signed out · `400 validation_failed` without the exact confirm body · `403` cross-origin, or for the shared seeded demo accounts ("Demo accounts can't be deleted. Create your own to try it.") · `415` non-JSON. Irreversible: the UI must confirm first.

### 5.3 `GET /api/catalog`
Query `catalogQuerySchema`:

| param | values | default |
|---|---|---|
| `type` | `all \| movie \| tv` | `all` |
| `sort` | `release_desc \| release_asc \| rating_desc \| rating_asc \| popularity_desc` | `release_desc` |
| `genre` | `18,35` (P1) | — |
| `cursor` | opaque | — |
| `limit` | 1..50 | 20 |

v1.6 (ADR-013 C-01/C-02, built): `region` is also accepted by §5.4 search and §5.15 watchlist; the response echoes `region` when given. Unsupported region → default region. A `provider` with no rows → empty page (200).
P1 (v1.5, W7, ADR-012 §9): `region` (`^[A-Z]{2}$`) and `provider` (TMDB provider id). `provider` without `region` → `400`. With `region`, items carry `watchHint: { providerId, name, logoPath } | null`; without it, `watchHint` is absent.

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
{ mediaType: 'movie'|'tv', tmdbId: number, watchedOn?: 'YYYY-MM-DD' /* default today */, watchedWhere?: 'cinema'|'streaming'|'tv'|'other'|null, note?: string /* ≤280 */, season?: number|null /* v1.6: TV only, 1..200, ≤ seasonCount when known */ }
```
→ `201 StubMutationResponse { stub: Stub, state: TitleState }`.
Errors:
- `400` with `fields.watchedOn` for a future date or a date before Jan 1 of (release year − 1). "Future" means after **server today (UTC) + 1 day**: users ahead of UTC can log their local today (v1.2; the DB trigger uses the same slack)
- `404` for an unknown title
- `429` when over the rate limit
- `400` with `fields.season` (v1.6): season on a movie, or above the show's `seasonCount`

A same-day duplicate **is allowed** (a double feature). The UI confirms first using `state.hasStubToday` (C3-AC3).

### 5.8 `PATCH /api/stubs/{id}` 🔒
Body `updateStubSchema` (any of `watchedOn`, `watchedWhere`, `note`, `season` (v1.6, null clears); at least one). → `200 StubMutationResponse`. `watchedOn` follows the §5.7 rules. Someone else's stub or an unknown id gives `404`.

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
- `json`: `application/json` `{ exportedAt, profile, stubs, reviews, watchlist }` (movies and TV). v1.6: stubs carry `season`.
- Rate limit: 1 per 10 min per user **per format** (so "CSV" and "JSON" can both be downloaded once), otherwise `429` with `Retry-After`.

### 5.17 `PATCH /api/me/profile` 🔒
Body `updateProfileSchema` (`displayName` 1..50, `bio` ≤ 160, `avatarUrl` URL | null, v1.6 `avatarColor` `AvatarColor` | null). → `200 ProfileResponse`. The handle is immutable.

### 5.18 Auth
| Route | Body | Success | Errors |
|---|---|---|---|
| `POST /api/auth/signup` | `signUpSchema` `{ email, password (8..72), handle, displayName?, ref?: 'share' }` (v1.6: `ref` only feeds the anonymous `signup_completed` dim) | `201 AuthResponse { session }` and sets the session cookie. v1.4: when the Supabase "Confirm email" setting is ON, `202 AuthResponse { session: null, confirmEmail: true }` and no cookie (UI: "Check your inbox to finish signing up"; ADR-010 ID-1). Demo mode never returns 202 | `400` fields, `409 email_taken`, `409 handle_taken` |
| `POST /api/auth/signin` | `signInSchema` `{ email, password }` | `200 AuthResponse` and sets the cookie | `401 invalid_credentials` (generic) |
| `POST /api/auth/signout` | `{}` | `204` and clears the cookie | — |
| `PUT /api/auth/password` 🔒 (v1.4) | `setPasswordSchema` `{ password (8..72) }` | `204`. Live: Supabase `updateUser({ password })`; demo: re-hash in the store. Other sessions stay valid (ADR-010 ID-2) | `400` fields, `401 unauthenticated`, `401 reauth_required` (last sign-in > 10 min ago), `429` (5 per 10 min per user) |
| `POST /api/auth/magic-link` | `magicLinkSchema` `{ email, next? }` | `202 MagicLinkResponse { sent: true, devLink? }` (`devLink` in demo mode only; it points at the origin the request used. On a production demo (`DEMO_DEV_LINKS` defaults to `seeded`) only the seeded `@demo.stubbed.app` accounts get one, v1.3) | `400`, `429`. Never reveals whether the email exists |
| `GET /api/auth/handle-available?handle=` | — | `200 { available, reason? }` | — |
| `GET /auth/callback?code=&next=` (demo: `demo_token=`) | — | `302` to `safeNext(next)` after the code exchange, with a **relative** `Location` (the browser stays on the host it used; `safeNext` guarantees a same-origin path) | `302 /signin?error=callback&next=…` |

After a successful sign-up or sign-in the client navigates to `safeNext(next)` and replays the pending action (B2-AC3).

### 5.19 `POST /api/revalidate` (job only)
Header `x-revalidate-secret: $REVALIDATE_SECRET`, body `{ tags: string[] }` → `200 { revalidated }`. Otherwise `403`.

### 5.21 `GET /api/titles/{movie|tv}/{tmdbId}/watch?region=GB` (v1.5, ADR-012)
Region switcher reads. Query `watchQuerySchema` `{ region }`: 2 letters, upper-cased, `UK→GB`; missing or malformed → `400 validation_failed`.
An unsupported region answers with the default region and `fallback: true` (200). → `200 TitleWatchResponse { watch: TitleWatch | null }`
(`null` = hide the block, same rules as §1b). Unknown type or id → `404`. No auth, no cookies read or set. Client: `api.titleWatch(key, region)`.
On `ApiError` or a 1.5 s timeout the UI shows `wtw-error` with Retry (DESIGN §7.4.2).

### 5.22 `PUT /api/me/watch-region` (v1.5, ADR-012 §7) 🔒-soft
Body `setWatchRegionSchema` `{ region: string | null }` (null = automatic; a non-null value must be in `WATCH_REGIONS`, else `400` with
`fields.region`). Works signed out (cookie only) and signed in (also upserts `user_settings`). → `200 SetWatchRegionResponse { region: string | null }`
and `Set-Cookie: stubbed_region=…; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly; Secure` (cleared with `Max-Age=0` for null).
`private, no-store`. Same-origin + JSON rules; `429` over 30/min per IP. Client: `api.setWatchRegion(region)`. Sign-in and `/auth/callback`
also set this cookie from `user_settings` when a value exists.

### 5.23 `GET /api/watch/providers?region=US` (P1, W7)
→ `200 { region, providers: { providerId, name, logoPath, monogram, count }[] }`: at most 6, by TMDB priority in the region, `count ≥ 1` listed titles.

### 5.24 `POST /api/events` (v1.6, ADR-013 C-09)
Body `trackEventsSchema` `{ events: { name: 'share_generated'|'worth_it_viewed'|'provider_clicked', dim: string }[] /* 1..20 */ }`, ≤ 8 KB; `dim` validated per event (ADR-013 C-09 table).
→ `204`. No auth, never reads the session, stores no IP/user id/URL; `Sec-GPC: 1` → `204` and nothing recorded. Errors: `400` (server-only event name, bad dim), `413`, `415`, `403` cross-origin, `429` (60/min per IP, in-memory). Client: `trackEvent()` (beacon, batched); callers ignore failures.
Server-emitted events (`signup_completed`, `stub_created`, `stub_again`, `review_saved`, `watchlist_added`, `export_downloaded`, `import_completed`) are recorded inside their routes after the response (`after()`); they are not accepted here.

### 5.25 `POST /api/log` (v1.6, ADR-013 C-13)
Body `clientLogSchema` `{ kind: 'boundary'|'global'|'unhandled'|'rejection', message: string ≤300, digest?: ≤64, stack?: ≤2000, path: string ≤200 }`, ≤ 4 KB.
→ `204`; written as one redacted JSON line `client_error` to server logs (no third party, no IP, UA family only). Errors: `400`, `413`, `415`, `403`, `429` (10/min per IP, 300/min per process). Client: `reportError()`; never retried.

### 5.26 `POST /api/me/imports/preview` 🔒 (v1.6, ADR-013 C-11)
Body `importPreviewSchema` `{ source: ImportSource, rows: ImportRow[] /* ≤ 20000; review bodies omitted, hasReview instead */ }`, ≤ 4 MB.
→ `200 ImportPreviewResponse { counts: { total, matched, duplicate, notInStubbed, invalid }, sample: { ref, title: TitleSummary, watchedOn, rating10, season }[] /* ≤ 50 */, unmatched: { ref, title, year, reason: 'not_in_stubbed'|'invalid' }[] /* ≤ 500 */ }`. Writes nothing. Matching uses only our catalogue (tmdbId → imdbId → normalised title + year ±1 + type); no outbound call.
Errors: `400`, `401`, `413 payload_too_large`, `415`, `403`, `429` (20 previews/h per user).

### 5.27 `POST /api/me/imports` 🔒 (v1.6)
Body `importCommitSchema` `{ source, importId: uuid, final: boolean, options: { createStubs: boolean, ratings: boolean, reviews: boolean }, rows: ImportRow[] /* ≤ 1000 */ }`, ≤ 1 MB.
Re-matches server-side (stateless). Idempotent: `(user, import_key)` unique, so a re-sent chunk creates nothing new. Never overwrites an existing review. Stubs get `source='import'`.
→ `200 ImportCommitResponse { created: { stubs, reviews }, skipped: { duplicate, notInStubbed, invalid, existingReview } }`. `final: true` records `import_completed`.
Errors: `400`, `401`, `413`, `415`, `403`, `429` (`IMPORT_MAX_ROWS_PER_DAY` rows per 24 h, `Retry-After`). Client: `api.importPreview()`, `api.importCommit()`; UI sends chunks of 500.

### 5.28 Share and image routes (v1.6, ADR-013 C-07/C-08; not under `/api`)
| Route | Returns | Notes |
|---|---|---|
| `GET /title/{type}/{slug}/opengraph-image` | `image/png` 1200×630 | File convention → page `og:image`/`twitter:image`; unknown title → 404; poster fetch ≤ 1.5 s else palette fallback |
| `GET /share/stub/{id}` | HTML | Public landing (ticket + "Stub it"), `noindex`, canonical = title page; 404 unless `isProfileShareable` |
| `GET /share/stub/{id}/opengraph-image` | `image/png` 1200×630 | Same 404 rules |
| `GET /share/stub/{id}/story[?download=1]` | `image/png` **1080×1920** | `download=1` → `Content-Disposition: attachment` |
Never render `note`, review text or spoiler content; never `Set-Cookie`. Shared URLs carry `?ref=share` (`shareData()`, `src/lib/share.ts`).

### 5.20 Contact and report (v1.3, GAP-06; no route)
`src/lib/contact.ts` (client-safe): `CONTACT_EMAIL` from `NEXT_PUBLIC_CONTACT_EMAIL` (placeholder `contact@example.com` when unset or invalid), `contactHref()` for the footer "Contact" link and `reportReviewHref({ id, titleKey })` for "Report" on other people's reviews (a `mailto:` with the review id in subject and body).

## 6. `DataAccess` (server, for pages): `src/lib/data-access.ts`
| Method | Returns | Notes |
|---|---|---|
| `getMode()` | `AppMode` | Pass `mode.images` and `mode.isDemo` down as props |
| `listCatalog(CatalogQuery)` | `Page<TitleSummary>` + `total` | Browse grid (first page SSR, then `api.catalog` for "Load more"). v1.6: `query.region` → `watchHint`; `query.provider` filter. `listTrending`, `searchCatalog`, `myWatchlist` take `{ region? }` too |
| `listTrending(type, limit=10)` | `TitleSummary[]` | Home rail |
| `searchCatalog(q, type?, limit?)` | `SearchResult` | `/search?q=` page |
| `getWatchRegion()` | `WatchRegionInfo` | v1.5: reads `stubbed_region`, the trusted geo header (only when `WATCH_GEO_HEADER` and `TRUSTED_PROXY≠none`) and `Accept-Language`; never the session |
| `getTitle(mediaType, tmdbId, opts?: { region?: WatchRegionInfo })` | `TitleDetail \| null` | v1.5: `watch` is built for `opts.region` (default region when omitted). `null` → `notFound()`. `detailStatus` drives the "may be out of date" / "More details unavailable" notes. `isListed=false` → "This title dropped below our 6.5 bar". Includes `worthIt` (always present, even when `detailStatus='index_only'`) |
| `getTitleStats(key)` | `TitleStats` | `ratingAvg10` is null below 5 ratings |
| `listTitleReviews(key, {sort, cursor, limit})` | `Page<Review>` | The user's own review is pinned client-side from `TitleState.myReview` |
| `getProfile(handle)` | `ProfilePage \| null` | Header, stats, palette for `/u/{handle}` |
| `listWallet(handle, …)` | `Page<WalletItem>` | One per title, stacked for rewatches |
| `listDiary(handle, {type,…})` | `Page<DiaryEntry>` | Public diary tab |
| `listProfileReviews(handle, …)` | `Page<ReviewWithTitle>` | |
| `resolveTitle(mediaType, tmdbId)` | `{ slug } \| null` | v1.6: index read only (same fallbacks as `getTitle`, `cache()`-deduped); decides 404/308 before Suspense |
| `listWatchProviders(region)` | `WatchProviderChip[]` | v1.6: browse chips (≤ 6, count ≥ 1) |
| `getStubShare(id)` | `StubShareCard \| null` | v1.6: null unless the stub exists and `isProfileShareable` |
| `getSession()` | `Session \| null` | Owner-only pages (`/me/*`) |
| `myTitleStates(keys)` | `Record<TitleKey, TitleState>` | Owner-only pages |
| `myWatchlist(…)` | `Page<TitleSummary>` | Throws `unauthenticated` → redirect to `/signin?next=` |

## 7. Pages and URL state (Frontend)
| Route | Data | URL state |
|---|---|---|
| `/` | `listTrending`, `listCatalog` | `?type=&sort=` (the home browse section) |
| `/browse` | `listCatalog` | `?type=movie\|tv&sort=…&cursor=` (use `browseHref`) |
| `/search` | `searchCatalog` | `?q=&type=` |
| `/title/{movie\|tv}/{tmdbId}-{slug}` | `getWatchRegion`, `getTitle`, `getTitleStats`, `listTitleReviews` | A wrong slug with the right id → `permanentRedirect` to the canonical `titleHref()`. Unknown → 404. `generateMetadata` uses `worthIt.metaDescription` for description + `og:description` |
| v1.6 status rule | — | Title and profile pages resolve existence **before** any Suspense boundary: unknown → real **404**, wrong slug / non-lowercase handle → real **308** (query kept). No `loading.tsx` on those routes (ADR-013 C-03) |
| `/share/stub/{id}` | `getStubShare` | v1.6 |
| `/me/import` | `getSession` | v1.6, owner-only |
| `/u/{handle}` | `getProfile`, `listWallet`, `listDiary`, `listProfileReviews` | `?tab=wallet\|diary\|reviews\|watchlist` |
| `/me/stubs` | `getSession`, `listDiary(session.handle)` | `?type=` |
| `/me/settings` | `getSession` | — |
| `/signin`, `/signup` | — | `?next=&action=` |
| `/about` | — | — |

## 8. QA hooks (`data-testid`), from DESIGN §11
`ticket-{key}` (for example `ticket-movie:693134`), `stub-button`, `stub-count`, `tmdb-rating`, `imdb-rating` (the IMDb chip on a stub and the detail IMDb score chip; absent when `imdbRating` is null), `ticket-time`, `sort-select`, `type-filter`, `search-input`, `review-composer`, `review-card`, `spoiler-toggle`, `demo-pill`, `toast`, `auth-sheet`, `load-more`, `diary-row`, `wallet-stub`, and for "Worth it?" (DESIGN §7.4.1): `worth-it`, `worth-it-hook`, `worth-it-vibes`, `worth-it-time`, `worth-it-cert`, `worth-it-verdict`, `worth-it-like`, and for "Where to watch" (DESIGN §7.4.2, v1.5): `where-to-watch`, `wtw-region`, `wtw-group-stream|free|ads|rent|buy` (a `rent_buy` group uses `wtw-group-rent`), `wtw-provider-{providerId}`, `wtw-more`, `wtw-skeleton`, `wtw-empty`, `wtw-error`, `wtw-attribution`, `wtw-all-options`, `wtw-checked`, P1 `ticket-providers`, `provider-filter`, `provider-chip-{providerId}`. v1.6 (ADR-013): `share-button`, `share-fallback`, `share-story`, `stub-season`, `avatar-color-{key}`, `import-file`, `import-preview`, `import-progress`, `import-summary`.

There is deliberately **no** `imdb-assist` (or any "post to…") hook: gap review checks its absence (PRD D3).
