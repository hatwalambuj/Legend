# ADR-012: Where to watch (provider availability, clickable service icons)

Status: **Accepted** · Date: 2026-09-27 · Decider: Architect (final call)
Inputs: PRD §13 (W1–W8) and D16, DESIGN §7.4.2 (+ §3.3, §8, §11), research.md §14, ADR-001 §A3 (`TRUSTED_PROXY`),
ADR-002 (nightly job), ADR-003 (curation, keyset), ADR-006 (demo mode), ADR-007 (images), ADR-011 §1 (dry run spends nothing).
Observed in repo: enrich call `src/server/jobs/enrich.ts:1-4`; enrich TTL `SYNC_ENRICH_TTL_DAYS=30` (`src/server/env.ts:90`);
job throttle 10 req/s (`scripts/sync-catalog.ts:230,311`); `profiles` is **publicly readable**
(`supabase/migrations/20260926000000_init.sql:632`); CSP `img-src 'self' data: blob: https://image.tmdb.org` (`next.config.ts:16`).
Labels: **Observed**, **Inferred**, **Unverified** (ClearPath evidence protocol).

This is the build spec. Task ids (W-xx) are in WORK_SPLIT §6. Contract shapes are in API_CONTRACT v1.5 §1b, §5.21, §5.22.
**Sequencing:** no W task starts before M1 has merged (M1 is editing `types.ts`, `contracts.ts`, `dal.ts`, `ports.ts`,
`env.ts`, `sync-catalog.ts`, the auth routes and `/me/settings`).

## 1. Data source

**Decision: TMDB `watch/providers` (JustWatch data), fetched only by the nightly job. Never at request time.**

- Per title: `GET /3/{movie|tv}/{id}/watch/providers` → `{ id, results: { [ISO-3166-1]: { link, flatrate?, free?, ads?, rent?, buy? } } }`,
  each array item `{ provider_id, provider_name, logo_path, display_priority }` (Observed in search extracts of the TMDB reference and
  TMDBLib issue #361, which confirms `free` and `ads` exist; lower `display_priority` = shown first).
- **Append:** `watch/providers` is a valid `append_to_response` value on the movie and TV detail endpoints (Observed: search extracts of
  TMDB's "Append To Response" guide and SDKs that call `details(id, [..., "watch/providers"])`). The appended object comes back under the
  literal key **`"watch/providers"`** (Inferred from TMDB's rule that each appended namespace is returned as a key of the same name;
  developer.themoviedb.org and themoviedb.org were egress-blocked on 2026-09-27, so W-02 **must** pin this with a recorded fixture and the
  mapper reads `raw['watch/providers']`, tolerating absence as "not fetched", never as "no providers").
- Enrich call becomes
  `GET /3/{type}/{id}?append_to_response=external_ids,keywords,recommendations,similar,release_dates|content_ratings,watch/providers`.
  Six appended namespaces, within TMDB's documented limit of 20 (Inferred).
- **Provider list** (names, logos, per-region priority, for chips and as a name fallback):
  `GET /3/watch/providers/{movie|tv}?watch_region={R}` → `{ results: [{ provider_id, provider_name, logo_path, display_priorities: {R: n}, display_priority }] }`
  (Observed: field names in search extracts). 2 calls × `WATCH_REGIONS` (10) = **20 calls a week**.
- **We ignore the upstream `link` string.** The "All options" URL is derived by us (§6.3), so no URL from an API response is ever
  rendered as an `href`. TMDB's documented pattern is `https://www.themoviedb.org/{movie|tv}/{id}/watch?locale={R}` (Inferred from
  observed `link` values in extracts; W-02 asserts the fixture `link` equals our derived URL, and logs a mismatch count per run).
- Rejected (PRD §13.1, unchanged): JustWatch API (partners only), JustWatch GraphQL (scraping), Watchmode / Streaming Availability
  as primary (free caps ~2.5–3k/month). A deep-link enricher stays v2 behind `DEEPLINK_PROVIDER=none` (not built now).

## 2. Mapping (pure, deterministic)

`mapTmdbWatch(raw, regions): WatchStore | null` in `src/server/jobs/watch-map.ts`:
1. `raw['watch/providers']` missing or not an object → `null` (not fetched; do not touch stored data).
2. Keep only `results[R]` for `R ∈ WATCH_REGIONS`. Types: `flatrate→s`, `free→f`, `ads→a`, `rent→r`, `buy→b`. Unknown keys dropped.
3. Per type: drop items with non-integer or ≤ 0 `provider_id`; dedupe by id (keep lowest priority); sort by `display_priority` asc,
   then `provider_id` asc; cap 30. Store ids only.
4. A region whose five lists are all empty is **omitted**. An omitted supported region after a successful fetch means "none in R".
5. Side output: `{ provider_id, provider_name ≤ 80 chars, logo_path }` for every seen provider (upserted into `watch_provider`, §3).
   `logo_path` must match `^/[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg)$`, else stored as null.

Rent + Buy merge, grouping and caps happen at **read** time (§6.1), not in storage, so config changes need no re-fetch.

## 3. Storage (migration `supabase/migrations/20260928120000_where_to_watch.sql`, new file, after M1-04)

```sql
alter table public.catalog_index
  add column watch            jsonb,        -- {"US":{"s":[8,337],"f":[],"a":[73],"r":[2,3],"b":[2,3,10]}, ...}; null = never fetched
  add column watch_checked_at timestamptz,  -- last successful watch fetch (enrich or watch step); null = never
  add column watch_tags       text[] not null default '{}';  -- 'US:8' for every provider in s|f|a of region US (P1 filter)
alter table public.catalog_index add constraint catalog_watch_shape
  check (watch is null or (jsonb_typeof(watch) = 'object' and pg_column_size(watch) <= 4096));
create index catalog_watch_due  on public.catalog_index (watch_checked_at nulls first, id) where source_status = 'active';
create index catalog_watch_tags on public.catalog_index using gin (watch_tags) where is_listed;   -- W7 browse chips

create table public.watch_provider (
  provider_id  integer primary key check (provider_id > 0),
  name         text not null check (char_length(name) between 1 and 80),
  logo_path    text check (logo_path is null or logo_path ~ '^/[A-Za-z0-9_-]+\.(png|jpg|jpeg|svg)$'),
  priorities   jsonb not null default '{}'::jsonb,   -- {"US": 1, "GB": 3} from the weekly list sync
  updated_at   timestamptz not null default now()
);

-- Per-user preference. NOT on profiles: profiles is public-read (init.sql:632) and a country is personal.
create table public.user_settings (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  watch_region text check (watch_region is null or watch_region ~ '^[A-Z]{2}$'),
  updated_at   timestamptz not null default now()
);
```
- **RLS**: `watch_provider` enable RLS, `select to anon, authenticated using (true)`, revoke insert/update/delete from anon,
  authenticated. `user_settings` enable RLS, owner-only: `select|insert|update to authenticated using/with check (user_id = (select auth.uid()))`,
  nothing for anon; `grant select, insert, update (watch_region, updated_at)`; deletion cascades from `auth.users` (ADR-010, `DELETE /api/me`
  and the JSON export include it). The new `catalog_index` columns inherit the existing public read and the existing write revoke.
- **RPCs** (security definer, `set search_path = public`, `execute` revoked from public/anon/authenticated like `catalog_set_enrichment`):
  - `catalog_set_watch(p_rows jsonb) returns integer`: rows `{ id, watch, providers:[{provider_id,name,logo_path}] }`; sets `watch`,
    `watch_checked_at = now()`, recomputes `watch_tags` from `s|f|a`; upserts `watch_provider` name/logo (priorities untouched).
  - `catalog_watch_due(p_limit int, p_ttl_days int default 7, p_hot_days int default 1, p_hot_top int default 50) returns table(id, media_type, tmdb_id)`
    `stable`: active rows where `watch_checked_at is null`, or **hot** and older than `p_hot_days`, or older than `p_ttl_days`.
    Hot = `is_listed` and (top `p_hot_top` by `popularity` per `media_type`, or `release_date >= current_date - 60`), which covers the
    trending and new rails. Order: never-checked, hot, oldest, `is_listed desc`, `popularity desc`, `id`.
  - `watch_provider_set_priorities(p_rows jsonb)`: `[{provider_id, name, logo_path, priorities}]` upsert.
  - `catalog_set_enrichment` is **unchanged**; enrich passes the watch part through `catalog_set_watch` in the same batch.
- **Size** (Inferred): median ~200 B of `watch` + ~150 B of tags per title; 15k titles ≈ 5–8 MB with indexes. Fits Supabase Free (500 MB).
- `tests/db/migrations.test.ts` asserts: RLS on both tables, owner-only `user_settings`, no anon write, RPC execute revoked, check constraints.

## 4. Refresh cadence and rate limits

| Step (nightly job, after enrich, before imdb) | Calls | Budget env (default) |
|---|---|---|
| enrich (existing) now appends `watch/providers` | 0 extra: same call | `SYNC_ENRICH_MAX` (3000) |
| **watch** (new): `catalog_watch_due` minus ids enriched this run → `GET /3/{type}/{id}/watch/providers` | ≈ 15k / 7 + hot ≈ **2.2–2.4k/night** | `SYNC_WATCH_MAX` (3000), `SYNC_WATCH_TTL_DAYS` (7), `SYNC_WATCH_HOT_DAYS` (1) |
| **provider list** (new): when `max(watch_provider.updated_at)` of priorities is > 7 days old | 20/week | — |

- Shares the job's 10 req/s throttle, 429 `Retry-After` honouring and backoff. ~2.4k calls ≈ 4 min. TMDB has a per-IP rate limit and no
  daily quota (Observed, ADR-011 §1 table); 10 req/s is far under it. No request-time TMDB calls for watch data, ever.
- A failed fetch leaves the stored data and `watch_checked_at` untouched (the stale guard handles long outages).
- **Dry run** (ADR-011 §1): `catalog_watch_due` read only, print `watch due`; **0** watch or provider-list calls, 0 writes.
- **Fixtures mode** (`--from-fixtures`): loads §8 into the tables, no network.
- `sync_runs.stats` gains `{ watch: { due, fetched, failed, regionsNone } }`.

## 5. Region resolution

`resolveWatchRegion(input) → WatchRegionInfo` in `src/server/region.ts` (pure; one wrapper reads `headers()`/`cookies()`):

1. **Explicit** (API only): `?region=` on `/api/titles/.../watch` and `/api/catalog`. `^[A-Za-z]{2}$`, upper-cased, `UK→GB`; else `400`.
2. **Setting**: cookie `stubbed_region` (value `^[A-Z]{2}$`). The profile setting (`user_settings.watch_region`) reaches SSR **only through
   this cookie**: the cookie is set by `PUT /api/me/watch-region`, and re-set on sign-in and `/auth/callback` from `user_settings`. SSR never
   reads the session to find a region (API_CONTRACT §1 rule 1).
3. **Trusted geo header**: only when `WATCH_GEO_HEADER` is set **and** `TRUSTED_PROXY ≠ none` (ADR-001 §A3); otherwise a client-sent header of that
   name is ignored (W3-AC2). Valid examples: `x-vercel-ip-country` with `TRUSTED_PROXY=vercel`, `cf-ipcountry` with `cloudflare`. Values
   `XX`, `T1`, `A1`, `A2`, `EU`, `AP` are treated as absent. **Default: unset.** We never store or log IPs or the header value.
4. **`Accept-Language`**: parse ≤ 10 entries, sort by `q` (stable), take the **first** tag with a 2-letter region subtag
   (`en-GB`→GB, `hi-IN`→IN, `zh-Hant-TW`→TW; `es-419` and bare `en` give none).
5. **Default** `WATCH_REGION_DEFAULT` (US).

The first source that yields a code wins and is the `requested` region. If it is not in `WATCH_REGIONS`, the result is
`{ region: default, requested, fallback: true }` and the UI shows "Showing: United States · Change" (W3-AC4). Output also carries
`source: 'query'|'setting'|'geo'|'accept_language'|'default'`. Env (in `src/server/env.ts`, all optional, demo needs none — W8-AC1):
`WATCH_REGION_DEFAULT=US`, `WATCH_REGIONS=US,GB,IN,CA,AU,DE,FR,ES,BR,MX` (each must exist in `src/lib/regions.ts`, default must be in the list,
else boot fails with a clear message), `WATCH_GEO_HEADER=` (off).

Region names come from the static map `src/lib/regions.ts` (`{ code, name }`, no `Intl` at render, so SSR and hydration agree).

## 6. Read path and caching

### 6.1 Composition
- Cached layers (catalog data cache 1 h, title data cache 24 h, degraded last-good LRU) hold the **region-agnostic** `watch` jsonb and
  `watch_checked_at` only. `buildTitleWatch(store, checkedAt, region, title, now, providers)` in `src/server/watch.ts` runs **per request,
  uncached and pure**:
  - `checkedAt` null or older than 30 days, `degraded === 'catalog'`, or `store` null → `TitleDetail.watch = null` (block not rendered, W4-AC2).
  - Region absent from `store` → `status: 'none'` (W4-AC1). Otherwise `status: 'available'`.
  - Groups in fixed order `stream, free, ads, rent, buy`, empty ones dropped. A provider in both `r` and `b` stays in rent with
    `alsoBuy: true` and leaves buy; if every rent provider is also a buy provider, the rent group's `type` becomes `rent_buy` and `alsoBuy`
    flags are cleared. The server returns full lists; the UI caps at 6 and renders "+N" (W1-AC3).
  - Names/logos from `watch_provider` (in-process map, refreshed at most hourly; data-cache tag `watch-providers`). Unknown id → skip it.
- `dal.getTitle(mediaType, tmdbId, { region })` gains the optional third argument; the title page calls `await dal.getWatchRegion()` (reads
  `stubbed_region` cookie, geo header when trusted, `Accept-Language`) then passes it. Pages stay dynamic SSR (ADR-001); their HTML is
  `private` by Next default for dynamic routes, and must not become `public`.

### 6.2 Caching (no personalisation leak)
| Response | `Cache-Control` | Why it is safe |
|---|---|---|
| Title page HTML | dynamic, `private, no-store` (Next default) | Reads the region cookie and `Accept-Language`; never shared |
| `GET /api/titles/{type}/{id}/watch?region=GB` | `public, s-maxage=3600, stale-while-revalidate=86400` | Region is **required in the URL**; the handler reads **no** cookie or `Accept-Language`, so the URL fully keys the response; no `Set-Cookie` |
| `GET /api/catalog?...&region=US` (W7) | as today (`public, s-maxage=3600…`) | Same rule: region only from the query |
| `PUT /api/me/watch-region` | `private, no-store`, `Vary: Cookie` | Sets the cookie; never public |

Revalidation: the job's existing `catalog` tag revalidate covers catalog rows; add tag `watch-providers` after the provider-list step.
Stale guard is computed with the request's `now`, so a cached row can age out without revalidation.

### 6.3 Links (`src/lib/provider-links.ts`, versioned config, client-safe, owned by Architect; backend lands the file)

```ts
export const PROVIDER_LINKS_VERSION = '2026-09-27.1';
export interface ProviderLink {
  home: string;                                   // https homepage, required
  search?: string;                                // https template with exactly one {title}, in a query value or one path segment
  byRegion?: Partial<Record<string, { home: string; search?: string }>>;
  monogram?: string;                              // ≤ 2 chars for the demo / no-logo tile
  tile?: `#${string}`;                            // tile background for the monogram (demo only)
}
export const PROVIDER_LINKS: Record<number, ProviderLink>;
export const PROVIDER_LINK_HOSTS: ReadonlySet<string>;   // derived from the config at module load, exact host match
export function providerHref(providerId: number, title: string, region: string, mediaType: MediaType, tmdbId: number):
  { href: string; kind: 'search' | 'home' | 'tmdb' };
export function tmdbWatchHref(mediaType: MediaType, tmdbId: number, region: string): string;
// = `https://www.themoviedb.org/${mediaType}/${tmdbId}/watch?locale=${region}`
```
Rules for `providerHref`: pick `byRegion[region] ?? entry`; if `search` exists, substitute `encodeURIComponent(title.trim().slice(0, 100))`,
else `home`; parse with `new URL()`; **reject** (→ `tmdbWatchHref`, `kind:'tmdb'`) unless protocol is `https:`, no username/password/port,
host ∈ `PROVIDER_LINK_HOSTS`, and no query key matching `/^(utm_|tag$|affid|aff_|ref$|ref_|campaign|clickid|gclid|fbclid)/i`. Unknown
provider id → `tmdb`. `href`s are built **on the server** into `TitleWatch`, so the client never builds URLs. No user data, region cookie,
or session in any URL. No custom schemes.

Initial entries (ids Inferred from TMDB; every template **Unverified** until QA's W2-AC5 device check; the provider-list sync logs config
ids TMDB does not return; a template that fails the check is deleted, leaving `home`):

| id | Provider | home | search |
|---|---|---|---|
| 8, 1796 | Netflix / Netflix with Ads | https://www.netflix.com/ | https://www.netflix.com/search?q={title} |
| 9, 119 | Amazon Prime Video | https://www.primevideo.com/ | https://www.primevideo.com/search/?phrase={title} |
| 10 | Amazon Video | https://www.amazon.com/ (GB `amazon.co.uk`, IN `amazon.in`) | — |
| 337 | Disney Plus | https://www.disneyplus.com/ | — |
| 1899 | Max / HBO Max | https://www.hbomax.com/ | — |
| 15 | Hulu | https://www.hulu.com/ | — |
| 350, 2 | Apple TV+ / Apple TV | https://tv.apple.com/ | https://tv.apple.com/search?term={title} |
| 3 | Google Play Movies | https://play.google.com/store/movies | https://play.google.com/store/search?q={title}&c=movies |
| 531 | Paramount Plus | https://www.paramountplus.com/ | — |
| 386 | Peacock | https://www.peacocktv.com/ | — |
| 73 | Tubi | https://tubitv.com/ | https://tubitv.com/search/{title} |
| 300 | Pluto TV | https://pluto.tv/ | — |
| 38 | BBC iPlayer | https://www.bbc.co.uk/iplayer | https://www.bbc.co.uk/iplayer/search?q={title} |
| 39 | NOW | https://www.nowtv.com/ | — |
| 2336, 122 | JioHotstar | https://www.hotstar.com/ | — |
| 192 | YouTube | https://www.youtube.com/ | https://www.youtube.com/results?search_query={title} |

Markup (frontend): `<a href target="_blank" rel="noopener noreferrer">`; the global `Referrer-Policy` stays. The About page lists JustWatch.

### 6.4 Logos
- Real mode: `providerLogoUrl(path)` in `src/lib/images.ts` → `https://image.tmdb.org/t/p/w92{path}`; rendered at 44×44 with explicit
  `width`/`height`, `loading="lazy"`, `decoding="async"`, `alt=""` (W5-AC1, W8-AC3). Same host as posters → **CSP `img-src` unchanged**.
- `logoPath: null` (demo always, real when TMDB has none, or `AppMode.images === 'off'`) → CSS monogram tile from `monogram`/`tile`
  (fallback: first letter of the name on `--surface-2`). No network in demo (W6-AC3).
- JustWatch attribution: text "Data by JustWatch" linking `https://www.justwatch.com/` with `rel="noopener noreferrer"` on every block
  (`data-testid="wtw-attribution"`), plus About/Credits. A JustWatch logo, if used, is a local file in `public/` as supplied (no new CSP host).
  Text satisfies TMDB's "reference or logo" rule (Observed, research §14).

## 7. Region preference endpoint and cookie
- `PUT /api/me/watch-region` body `{ region: 'GB' | null }` (null = "automatic"). Signed out: cookie only. Signed in: upsert
  `user_settings` through the RLS client, then set the cookie. Cookie `stubbed_region=GB; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly;
  Secure` (Secure per `isSecureRequest`); `null` clears it. Same-origin + JSON rules apply; per-IP limit 30/min.
- `Session.user.watchRegion: string | null` (from `user_settings`) is exposed via `GET /api/me`; if it differs from the SSR region the client
  island calls `PUT` once to heal the cookie and refetches the block (covers sign-in on another device).
- Demo: `user_settings` lives in the memory store; seeded accounts have none.

## 8. Demo fixtures (W6)
- `src/fixtures/watch.json`: `{ asOf: "2026-09", note: "Illustrative demo data, not live", providers: [{id,name,monogram,tile}], titles: [{ key, scenario[], ageDays, watch: WatchStore }] }`
  for **20 titles already in `src/fixtures/catalog.json`**, regions US, GB, IN, logos always null.
- `ageDays` (not a date): the memory repo sets `watch_checked_at = now − ageDays` at load, so the stale fixture stays stale and the others stay
  fresh forever (a fixed date would silently hide every block 30 days later). The "Checked" line therefore shows a relative-real date; QA asserts
  the pattern, not the value.
- Required `scenario` tags (each at least once, W6-AC2): `subscription` (≥ 8 titles over Netflix, Prime Video, Disney+, Max, Apple TV+, Hulu,
  JioHotstar), `free_or_ads` (≥ 2, Tubi / Pluto TV), `rent_buy_only` (≥ 2, Apple TV, Google Play, Amazon Video), `many` (> 6 in one group),
  `none_us` (no US providers, has GB), `stale` (`ageDays: 45`), `differs_us_in`, `tv` (≥ 5). QA reads keys by scenario from this file.
- A title not in the file → `watch: null` (block hidden), so every existing E2E stays unchanged.

## 9. P1: browse filter and stub hint (W7)
- `GET /api/catalog?provider=8&region=US` → rows where `watch_tags @> array['US:8']` (GIN index, §3), ≥ 6.5 rule and ADR-003 order unchanged;
  `provider` without `region` → `400`. RPC change is a **separate** migration (`..._watch_filter.sql`): drop and recreate `catalog_page` /
  `catalog_count` with an extra `p_watch_tag text default null` (no overloads).
- `GET /api/watch/providers?region=US` → top 6 providers by `priorities->R` that have ≥ 1 listed title (W7-AC3), `public, s-maxage=3600`.
- Stub hint: `TitleSummary.watchHint: { providerId, name, logoPath } | null` only when the list call has `region`; top `s` then `f` provider.

## 10. Security checklist (code-reviewer gate)
1. No `href` from upstream data; all from `provider-links` or `tmdbWatchHref`; unit guard test over **every** config entry and region override
   (https, allowlisted host, one `{title}`, banned params absent, W8-AC2) plus hostile titles (`"a&b"`, `"x/../y"`, `"https://evil"`, `"%00"`, emoji).
2. Links `target="_blank" rel="noopener noreferrer"`; no `javascript:`/custom schemes; open redirect impossible (we have no redirect route).
3. Region inputs strictly `^[A-Z]{2}$` after normalisation; never reflected unescaped; the geo header is ignored unless trusted.
4. Public responses never read cookies or `Accept-Language`, never `Set-Cookie`.
5. `user_settings` owner-only; not in public profile payloads.
6. CSP unchanged (`img-src` already allows `image.tmdb.org`); no third-party script, pixel or beacon. `provider_clicked`
   (`{provider_id, type, region, link_kind}`, no user id, no URL) goes through `trackEvent()` in `src/lib/analytics.ts`, a no-op until E-M1 adds a
   first-party endpoint; it must not delay navigation (fire-and-forget, never `preventDefault`).

## 11. Consequences
- One more job step (~4 min) and ~8 MB of storage, $0. Title pages add no network calls.
- Availability can be up to 7 days old (1 day for rail titles); hidden after 30 days. Copy "Availability can change" covers it.
- Exact-title one-tap deep links remain out of scope (v2 enricher). Founder expectation is set in PRD §13.2.

## Amendment 1 (2026-09-28, code review of a1b98af..92b871d)

Accepted deviations and one fix, recorded by the code-reviewer (details: docs/08-clearpath/CODE_REVIEW.md, "Where to watch review").

1. **Title page reads `?region=`** (deviation from §5.1 "API only"). Accepted. The block's switcher writes `?region=GB` with
   `history.replaceState`, so a reload or shared link shows what the user picked (W3-AC3). Safe for caching because the title page is
   `force-dynamic` and `private, no-store` (§6.2); no shared cache stores it, so no `Vary` is needed. SEO-neutral because
   `alternates.canonical` is `titleHref(t)` with no query, so `?region=` variants fold into one canonical URL. The value goes through
   `normalizeRegionCode` and an unsupported code gets `fallback: true`, so it is never reflected unvalidated. Precedence on the page:
   query → cookie → geo (trusted) → Accept-Language → default.
2. **`PUT /api/me/watch-region` when signed out** (from the block's switcher). Accepted, as §7 and W3-AC3 intend. It stores only
   `stubbed_region=<ISO code>` (HttpOnly, SameSite=Lax, Secure per request, Path=/, 1 year). No identifier, no server-side row, and
   it is not readable by scripts. It is a functional preference, not tracking. The About privacy summary now says so (ADR-010 ID-6).
3. **Fix: `catalog_watch_shape` cap raised from 4 KB to 32 KB, and `catalog_set_watch` skips oversized rows.** `pg_column_size` of
   uncompressed jsonb is about 14 B per stored id. Ten regions of a well-covered title (~33 ids each) came to 4.6 KB (measured in
   PGlite), so the old cap failed the RPC batch and, through `rpc()`, the whole nightly run. 32 KB covers the mapper worst case
   (5 types × 30 ids × 10 regions ≈ 19 KB). A row that is still too big is skipped: it keeps its old data and stays due. §3's size estimate
   (~200 B median) was low; storage is still well within the Free tier. Migration 20260928120000 had not been applied, so it was edited in place.
