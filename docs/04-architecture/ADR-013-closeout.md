# ADR-013: Close-out specs (C-01 … C-15)

Status: **Accepted** · Owner: Architect · Date: 2026-10-03 · Contract: API_CONTRACT **v1.6** · Tasks: WORK_SPLIT §7
Source: `docs/09-closeout/CLOSEOUT_BOARD.md`, `FOUNDER_INPUTS.md`, ARCH_REVIEW AR-5/AR-8, GAP_REVIEW GAP-10/18, NEXT_PHASE_PLAN E-G1/E-T1/E-I1/E-M1/E-S1.

## 0. Global rules (apply to every item)
- **$0, no AI, no third-party posting or tracking.** No new npm dependency (ZIP via the platform's `DecompressionStream`, CSV parser ours,
  OG via the `next/og` that ships with Next). No new outbound host. Only the TMDB poster CDN, which we already use, is read, and only by the OG renderer in live image mode.
- **Imports never call Letterboxd, IMDb or TV Time** (nor TMDB). Matching uses only our `catalog_index`.
- **Analytics** = our own `events` table: daily counters, anonymous (no user id, title key, IP, UA or URL), no cookies, aggregated on write.
- **Errors** = structured JSON lines in our server logs (`console.*` → Vercel/host logs). No Sentry or other vendor. Remove `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`
  from `.env.example` (Observed `.env.example:142-144`). `tests/lib/guards.test.ts` bans `sentry`, `posthog`, `plausible`, `gtag`, `segment`, `mixpanel` in `src/`.
- Demo mode stays zero-env and zero-network. Every new port has a memory implementation.
- Migrations: new files only. Order and names (all `supabase/migrations/`):
  1. `20261003090000_watch_filter.sql` (C-02)
  2. `20261003091000_stub_season.sql` (C-10)
  3. `20261003092000_enrich_core_refresh.sql` (C-06)
  4. `20261003093000_profile_avatar_color.sql` (C-12)
  5. `20261003094000_events.sql` (C-09)
  6. `20261003095000_imports.sql` (C-11; depends on 2)
  Each one is covered in `tests/db/migrations.test.ts` (PGlite) and applied by C-14 `db:apply`.
- New error code `payload_too_large` → **413**, used by imports and by `/api/log` and `/api/events`. Every new route follows API_CONTRACT §2–§4 (same-origin, JSON, `private, no-store` unless stated).
- C-14 (launch kit) is built by devops-release in parallel. **`.env.example` and `package.json` belong to devops-release during close-out.** The new env vars in §16 are sent to them in hand-off notes. BE and FE add no npm scripts (run new scripts with `npx tsx scripts/<x>.ts`).

---

## C-01 · `watchHint` in list APIs + stub logo (W-30 part 1, W7-AC1)
**Data:** no migration. The hint comes from `catalog_index.watch` (already selected by `catalog_page`, which `returns setof catalog_index`) plus the cached `watch_provider` map.
**Types (C-00):** `WatchHint { providerId: number; name: string; logoPath: string | null; monogram: string; tile: string | null }`;
`TitleSummary.watchHint?: WatchHint | null`. The field is absent when the call had no region. It is `null` when the title has nothing to stream in that region or its watch data is stale (> 30 days, same rule as ADR-012 §6).
Pick: the first `s` provider by region priority, else the first `f` provider, else the first `a` provider.
**Server:** `watchHintFor(watch, checkedAt, region, providerMap): WatchHint | null` goes in `src/server/watch.ts`. Lists that take `{ region }`: `catalog`, `trending`, `search`, `myWatchlist`.
**API:** `GET /api/catalog`, `GET /api/search` and `GET /api/me/watchlist` accept an optional `region` (`regionCodeSchema`, unsupported → the default region). Responses echo `region` when it was given.
Cache headers are unchanged (the region is in the URL, so it keys the cache). SSR pages (home, browse, search) pass `dal.getWatchRegion()`. The client "Load more" call resends the echoed `region`.
**UI:** the `Ticket` shows `data-testid="ticket-providers"`: a 20 px provider logo (`providerLogoUrl`, w92) or a monogram tile. It is decorative (`aria-hidden`) and not a link.
`ticketAccessibleName()` appends `", on {name}"` when a hint is present (format.ts, C-00).
**Tests:** unit `watchHintFor` (pick order, stale, none); routes (`region` echo, absent without region); E2E W7-AC1 (a US hint appears for a `watch.json` title; a GB region changes it or removes it; there is no `<a>` inside `ticket-providers`).

## C-02 · Browse "On {Service}" chips + index (W-31/32)
**Migration `20261003090000_watch_filter.sql`:** drop `catalog_page(text,text,jsonb,integer,integer[])` and `catalog_count(text,integer[])`, then recreate both with an extra
`p_watch_tag text default null`. The filter is `p_watch_tag is null or (c.watch_tags @> array[p_watch_tag] and c.watch_checked_at >= now() - interval '30 days')`.
Re-grant to `anon, authenticated`. No overloads. The GIN index `catalog_watch_tags … where is_listed` already exists (Observed `20260928120000_where_to_watch.sql:29`), so no new index.
New RPC `watch_provider_counts(p_region text) returns table(provider_id int, name text, logo_path text, priority int, count int)` (`security invoker`, `stable`): it counts listed rows by tag `p_region || ':%'` with fresh watch data and returns the top 6 by `priorities->>p_region` among those with `count ≥ 1`.
**API:** `GET /api/catalog?region=US&provider=8`: `provider` is an int > 0, and `provider` without `region` → `400 fields.provider`. A provider with no rows in the region → `200` with an empty page.
`GET /api/watch/providers?region=US` (§5.23) uses `public, s-maxage=3600, stale-while-revalidate=86400` and tag `watch-providers`.
**DAL:** `listWatchProviders(region): Promise<WatchProviderChip[]>`. `CatalogQuery.provider?: number`, `CatalogQuery.region?: string`.
**UI:** `ProviderFilter` (`provider-filter`, `provider-chip-{id}`, plus an "All" chip) sits in the browse toolbar. `?provider=` keeps `type`/`sort` and drops `cursor` (`browseHref({…, provider})`, routes.ts C-00).
The chip label is "On {name}". Zero-count chips never render. With no chips (demo region with no data), the row is hidden.
**Tests:** DB (filter + 30-day staleness + order unchanged + count); unit memory repo; E2E W-32 (filter keeps the ≥ 6.5 rule, combines with sort/type, no zero-count chip, logo name).

## C-03 · Real 404 + 308 slug redirect (BUG-03, GAP-10)
**Cause (Observed):** `src/app/loading.tsx` and the route `loading.tsx` files under `title/[type]/[slug]` and `u/[handle]` make Next stream before `notFound()`/`permanentRedirect()` runs. The status is then committed as 200 and the redirect happens client-side
(`node_modules/next/dist/docs/01-app/02-guides/streaming.md` §"The HTTP contract": "place `notFound()` before any `await` or `<Suspense>` boundary").
**Decision:** do the existence and slug check **in the page, before any Suspense boundary**. Not in `proxy.ts`: the proxy docs say "you should not attempt relying on shared modules or globals".
- Delete `src/app/loading.tsx`, `src/app/title/[type]/[slug]/loading.tsx` and `src/app/u/[handle]/loading.tsx`. Add `loading.tsx` to `browse/`, `search/` and `me/stubs/` (those routes have no 404 case) so they keep their skeletons.
- Title page: `const route = await dal.resolveTitle(type, tmdbId)` returns `{ slug } | null`. It is the same `loadEntry` index read and `cache()`-deduped, so `getTitle` reuses it. `null` → `notFound()`. A slug mismatch → `permanentRedirect(titleHref(...) + kept query)`, keeping `region` (QA-WTW-1). Then the body renders inside `<Suspense fallback={<TitleSkeleton/>}>`.
  When the catalogue is degraded (DB down), `resolveTitle` follows `loadEntry`'s fallbacks. If it throws `upstream_unavailable`, the page error boundary handles it as today.
- Profile: `const page = await dal.getProfile(handle)` comes first. `null` → `notFound()`. A non-lowercase handle → `permanentRedirect('/u/' + lower)`. The tabs render inside `<Suspense>`.
- `generateMetadata` never calls `notFound()` or `redirect()` (streaming metadata must not decide the status).
**Tests:** E2E with `request.get(..., { maxRedirects: 0 })`: unknown title → 404, unknown handle → 404, wrong slug → 308 with `Location` = canonical (+ `?region=`), `/u/Alice` → 308. Replace the soft-404 acceptance at `e2e/title.spec.ts:88-94` and `e2e/clearpath.spec.ts:69-77`. Check that known routes still show a skeleton on client navigation.

## C-04 · R10 "On Stubbed · N" goes up after a first review
**FE only** (`src/components/Reviews.tsx`). After `api.upsertReview` resolves with `created === true` and the review is not already in the server list, `stubbedCount += 1`. An edit leaves N unchanged and a delete keeps the F4 logic.
The count label uses `BRAND_NAME` (C-15). **Tests:** component test (create → +1, edit → +0, delete → −1); E2E in `reviews.spec.ts`.

## C-05 · AR-5 local session check with `getClaims()`
**BE:** `src/server/auth/supabase.ts` `getSession()` changes from `auth.getUser()` to `auth.getClaims()` and uses `claims.sub`, then the `profiles` select (no session when the profile is missing, e.g. a deleted user).
`src/proxy.ts` calls `auth.getClaims()` instead of `getUser()`. It still refreshes cookies through `setAll`.
`deleteAccount` keeps `getUser()` (server-side revocation check before a destructive action). `updatePassword` already uses `getClaims`.
**Behaviour (Observed `auth-js/GoTrueClient.d.ts:2500-2507`):** with asymmetric signing keys the JWT is verified locally against the cached JWKS. With the legacy HS256 secret, `getClaims` still calls the Auth server, so there is no regression.
Founder step (optional, add to F4): in the Supabase dashboard, turn on "JWT signing keys: asymmetric". Trade-off: a session that is revoked elsewhere stays valid until its access token expires (≤ 1 h). This is acceptable because only the profile row decides access to data.
**Tests:** `src/server/auth/supabase.test.ts`: `getSession` uses `getClaims` and never `getUser`; no profile → null; a claims error → null. Proxy test: one `getClaims` call and zero `getUser` calls.

## C-06 · AR-8 refresh referenced unlisted rows (TMDB 6-month rule)
**Migration `20261003092000_enrich_core_refresh.sql`:**
- `create or replace catalog_set_enrichment(p_rows jsonb)` (same signature). It accepts an optional `core` object per row: `{ title, original_title, slug, sort_title, search_text, overview_short, release_date, vote_average, vote_count, popularity, poster_path, backdrop_path, genre_ids, genres }`.
  Core fields apply **only when `not c.is_listed`** (discover owns listed rows) and set `synced_at = now()`. It never sets `is_listed` and never touches `pitch_hook`.
- `create or replace catalog_enrich_due(...)`: prepend the order key `(not c.is_listed and c.synced_at < now() - interval '120 days') desc` so stale unlisted rows go first within `SYNC_ENRICH_MAX`.
- New `catalog_mark_gone(p_ids bigint[])` sets `source_status = 'gone'` when the TMDB detail call returns 404. It is revoked from `anon`/`authenticated`, like the other job RPCs.
**Job:** `src/server/jobs/enrich.ts` maps the core fields from the detail response it already fetches. `sync_runs.stats.enrich.unlisted_refreshed` is a counter. Dry-run makes 0 writes.
ADR-002 §4 is amended by this item: "referenced unlisted rows are re-synced at most every 120 days via enrich".
**Tests:** DB (an unlisted row's core fields change and `synced_at` moves; a listed row's core is untouched; `is_listed` stays false); unit mapper; `sync-dry-run` stays at zero writes.

## C-07 · Share: Web Share + copy link (title, wallet, review, stub)
**Lib (C-00):** `src/lib/share.ts`:
`shareData(target: ShareTarget, siteUrl: string): { url: string; title: string; text: string }` with
`ShareTarget = { kind: 'title'; title: TitleSummary } | { kind: 'wallet'; handle: string; displayName: string } | { kind: 'review'; title: TitleSummary; rating10: number } | { kind: 'stub'; stubId: string; title: TitleSummary }`.
The URL is absolute (`NEXT_PUBLIC_SITE_URL`) and gets `?ref=share`. Review URLs point at the title page. **The text never contains a review body, a stub note or `isSpoiler` content.** It holds only the title, year and rating (e.g. "8/10").
**UI:** `ShareButton` (`share-button`) uses `navigator.share` when `navigator.canShare?.(data) !== false`, and ignores `AbortError`. Otherwise it copies with `navigator.clipboard.writeText` and shows the toast "Link copied". If that also fails, it opens `Sheet` with a selected read-only input (`share-fallback`).
Placement: the title page actions (works signed out), the profile wallet tab header, own review cards, and the menus of the owner's wallet stub and diary row ("Share stub" → `/share/stub/{id}`).
It is keyboard-operable with the accessible name "Share {thing}". It calls `trackEvent('share_generated', { surface, method })` with method `native|copy|fallback|story`.
**Ref capture:** on load, `AppProvider` copies `ref=share` into `sessionStorage['stubbed_ref']`. This is first-party, not a cookie, and expires with the tab. `signUpSchema.ref?: 'share'` is sent by `AuthForm`.
**Tests:** unit `shareData` (no body or note, `?ref=share`, absolute); component (native path, copy path, fallback); E2E (stub `navigator.share` undefined → clipboard toast; `context.grantPermissions(['clipboard-read'])` to read the clipboard).

## C-08 · Story share image + `og:image` (plumbing only; the visual design comes from the UX arena)
**Routes (FE own the JSX, BE own the data and assets):**
| Route | Size | Content type | Cache |
|---|---|---|---|
| `src/app/title/[type]/[slug]/opengraph-image.tsx` (file convention → auto `og:image` + `twitter:image`) | 1200×630 | `image/png` | `export const revalidate = 86400`; `ImageResponse` `headers: Cache-Control: public, s-maxage=86400, stale-while-revalidate=604800` |
| `src/app/share/stub/[id]/page.tsx` (landing: ticket + "Stub it" CTA; `robots: noindex`; canonical = title page) | – | HTML | dynamic, `private` (like other pages) |
| `src/app/share/stub/[id]/opengraph-image.tsx` | 1200×630 | `image/png` | `public, s-maxage=600` (no swr: a deleted stub disappears within 10 min) |
| `src/app/share/stub/[id]/story/route.tsx` (`GET`, `?download=1` → `Content-Disposition: attachment; filename="{brand}-stub-{n}.png"`) | **1080×1920** | `image/png` | `public, s-maxage=600` |
`generateMetadata` on the title page must **not** set `openGraph.images` (the file convention wins; this closes A5-AC3 / F5).
**Data (BE, C-00 types):** `dal.getStubShare(id): Promise<StubShareCard | null>`, with
`StubShareCard { stubId; number; watchedOn; season: number | null; title: Pick<TitleSummary, 'key'|'mediaType'|'title'|'year'|'voteAverage'|'imdbRating'|'posterPath'|'palette'>; handle; displayName; avatarColor: AvatarColor | null; profileUrl /* "{host}/u/{handle}" printed */ }`.
**It never includes `note`, any review text or `isSpoiler` content.** `null` (→ 404) applies when: the id is not a uuid, the stub is missing or deleted, the owner is gone, or `isProfileShareable(profile)` is false.
That predicate lives in `src/server/share.ts`. Today it returns `true` for every existing profile, because all profiles are public-read per ADR-005. A future private-profile flag only changes this function. The stub share routes go through it, and so does nothing else.
**Assets (BE, `src/server/og-assets.ts`):**
- Fonts: `loadOgFonts()` reads `src/og/fonts/Geist-Regular.ttf`, copied from `node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf` (126 KB, OFL; copy its `LICENSE`). It reads the file once at module scope with `readFile(join(process.cwd(), …))`.
  `next/og` accepts only ttf/otf/woff (Observed `image-response.md:52`), and our `src/app/fonts/*` are woff2, so they can't be used.
  Optional: if `src/og/fonts/BricolageGrotesque-Bold.ttf` exists (added later by anyone with network access; OFL), the loader adds it as the display face. Otherwise Geist is used at display sizes.
  `next.config.ts` gets `outputFileTracingIncludes: { '/title/[type]/[slug]/opengraph-image': ['./src/og/fonts/**'], '/share/stub/[id]/**': ['./src/og/fonts/**'] }`.
- Poster: `loadPosterDataUrl(posterPath, mode)` returns `string | null`. In demo or placeholder image mode it returns `null` and makes no request. In live mode it fetches `https://image.tmdb.org/t/p/w500{path}` with `AbortSignal.timeout(1500)` and a 1.5 MB cap, and returns `null` on any failure.
- **Palette fallback:** `null` poster → the card renders `paletteOrDefault(title.palette)` as a gradient plus the title text. It must always render. The TMDB attribution line is always on the image (AC3). The IMDb chip appears only when `imdbRating != null`.
**JSX (FE + UX arena):** `src/og/TitleCard.tsx`, `src/og/StoryCard.tsx`, `src/og/StubCard.tsx` use only flexbox/absolute positioning (satori subset) and `BRAND_NAME`. Keep the bundle under 500 KB.
**UI:** an owner-only "Story image" action (`share-story`) on wallet stubs and diary rows. It tries `navigator.share({ files: [png] })` when `canShare({files})`, else downloads `story?download=1`.
**Tests:** route tests (story PNG is 1080×1920: read the IHDR bytes; title OG is 1200×630; unknown stub → 404; the response has no `Set-Cookie`; the fallback works with `posterPath: null`; no fetch in demo mode, checked with a spied `fetch`); E2E `share.spec.ts` (`og:image` meta present; story link downloads).
p95 target < 800 ms on a warm instance (NEXT_PHASE_PLAN G1.2 AC5). Not gated in CI.

## C-09 · First-party, privacy-safe analytics
**Migration `20261003094000_events.sql`:**
```sql
create table public.events (
  day   date   not null,
  name  text   not null check (name ~ '^[a-z_]{3,40}$'),
  dim   text   not null default '' check (char_length(dim) <= 80),
  count bigint not null default 0 check (count >= 0),
  primary key (day, name, dim)
);
alter table public.events enable row level security;          -- no policies: no anon/auth access
revoke all on public.events from anon, authenticated;
-- p_rows = [{ name, dim, n }]; upsert-add into today's (UTC) bucket; ≤ 50 rows per call
create function public.events_track(p_rows jsonb) returns integer language plpgsql security definer set search_path = public …;
create function public.events_purge(p_days int default 400) returns integer …;   -- nightly job
create view public.metrics_weekly with (security_invoker = true) as …;            -- see below
revoke execute on function public.events_track(jsonb), public.events_purge(int) from public, anon, authenticated;
revoke all on public.metrics_weekly from anon, authenticated;
```
`metrics_weekly` (ISO week): WAS = distinct `stubs.user_id` with `source='app'`; activation = profiles created that week with ≥ 3 stubs within 24 h; median signup → first stub; review rate = reviews ÷ stubs; rewatch share; plus `sum(events.count)` per event name.
It is computed from tables we already hold, so nothing new about a person is stored. The **service role only** reads it, through `npx tsx scripts/metrics.ts` (prints 8 weeks).
**Writes:** `src/server/events.ts` `recordEvent(name, dim?)` uses `after()` from `next/server` (never delays the response). Live: `events_track` with the **service-role** client (server only). If `SUPABASE_SERVICE_ROLE_KEY` is missing, it drops and logs once. Demo: memory store counter.
**Event allowlist** (`ANALYTICS_EVENTS` in `src/lib/analytics.ts`, C-00; the dim is validated by a per-event zod schema and is never free text):
| Event (PRD §7) | Emitted by | `dim` |
|---|---|---|
| `signup_completed` | server `POST /api/auth/signup` (201/202) | `share` \| `` (from `ref`) |
| `stub_created` / `stub_again` | server `POST /api/stubs` (`stub_again` also when `stub.number > 1`) | `` |
| `review_saved` | server `PUT /api/reviews` (create or content change) | `new` \| `edit` |
| `watchlist_added` | server `PUT /api/watchlist/...` (only when newly added) | `` |
| `export_downloaded` | server export route (200) | `letterboxd` \| `json` |
| `import_completed` | server imports commit (final chunk) | `letterboxd` \| `imdb` \| `tvtime` |
| `share_generated` | client | `{title\|wallet\|review\|stub}:{native\|copy\|fallback\|story}` |
| `worth_it_viewed` | client (≥ 50 % visible for 1 s, once per page view) | verdict key |
| `provider_clicked` | client (ADR-012) | `{group}:{region}:{providerId}:{linkKind}` |
**Client:** `trackEvent()` (implemented in C-00, signature unchanged) queues events. It flushes on `pagehide`/`visibilitychange=hidden` or after 5 s using `navigator.sendBeacon('/api/events', new Blob([json], {type:'application/json'}))`, with `fetch(…, {keepalive:true})` as the fallback.
It is a no-op when `navigator.globalPrivacyControl === true` or `doNotTrack === '1'`, and it never throws.
**API `POST /api/events`:** body `{ events: { name, dim }[] }` with 1..20 items and ≤ 8 KB; only the 3 client events are accepted, others → `400`. Response `204`, `private, no-store`.
Same-origin + JSON. A `Sec-GPC: 1` header → `204` with nothing recorded. Rate limit: 60/min per IP via `MemoryRateLimiter`. The key is a salted in-memory hash and is never stored or logged. Over the limit → `429`, which the client ignores.
**UI:** About gets a "What we count" paragraph (anonymous daily counts, no cookies, no IP, honours GPC/DNT). `WorthIt` gets the visibility observer.
**Tests:** unit (each event fires once per action; client events batch; GPC → no send; dim validation); DB (upsert adds; anon can't select or execute); route (`400` for a server-only event, `204`, `429`); E2E `analytics.spec.ts` (intercept `/api/events`; no request to any non-origin host on any page).

## C-10 · Season picker for show stubs
**Migration `20261003091000_stub_season.sql`:** the column already exists (Observed `init.sql:181` `season_number smallint`).
- `alter table stubs add constraint stubs_season_range check (season_number is null or season_number between 1 and 200)`.
- `stubs_before_write`: `season_number` not null on a movie → `raise 'season_on_movie'` (22023).
- `create or replace view stub_details`: append `s.season_number as season` at the **end** (column append only).
- Drop and recreate `stub_insert(text,date,text,text)` as `stub_insert(p_title_key, p_watched_on, p_watched_where, p_note, p_season smallint default null)` with the same grants and no overload.
**Contract:** `Stub.season: number | null`. `createStubSchema.season` and `updateStubSchema.season` take an int 1..200 or null (the PATCH may clear it). Server checks: `season` on a movie → `400 fields.season`; `season > seasonCount` when `seasonCount` is known → `400 fields.season`.
Export: the JSON export gets `season`. The Letterboxd CSV is unchanged (movies only).
**UI:** `StubSheet` for TV shows an optional `<select>` "Season" (`stub-season`) with "Whole show" (default) plus `S01..S{seasonCount}`. It is hidden when `seasonCount` is null. Diary row, wallet stub and share images print `S03` via `seasonLabel(n)` (format.ts, C-00).
**Tests:** DB (range check, movie rejected, view column); routes (400 cases); component; E2E `season.spec.ts` (stub a show for S02 → the diary shows "S02"; existing stubs are unchanged).

## C-11 · Imports: Letterboxd, IMDb ratings, TV Time (offline)
**Decision:** files are **parsed in the browser**, so the file never leaves the device. Only normalised rows are uploaded, and the server matches them only against `catalog_index`.
There is no lazy insert of unknown titles: they are reported as "Not in Stubbed" and the user can download them as a CSV. This supersedes NEXT_PHASE_PLAN I1.1 AC4 and needs no TMDB call.
**Parsers (BE, client-safe, pure, `src/lib/import/`):** `csv.ts` (RFC 4180, BOM, CRLF), `zip.ts` (central directory; methods 0 and 8 via `DecompressionStream('deflate-raw')`; rejects encryption and zip64), `letterboxd.ts`, `imdb.ts`, `tvtime.ts`, `index.ts` (`detectAndParse(file): Promise<ParsedImport>`).
Format detection uses header names (case-insensitive aliases). No `fetch` or `@/server` imports (guard test).
| Source | Files and columns | Mapping |
|---|---|---|
| Letterboxd ZIP or CSV | `diary.csv` (`Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date`), `reviews.csv` (+`Review`), `ratings.csv`; also **our own export** (`tmdbID,imdbID,Title,Year,Rating10,WatchedDate,Rewatch,Review`) | Stars 0.5–5 → `rating10 = round(stars×2)`. Movies only. One stub per diary row (`Watched Date`) |
| IMDb `ratings.csv` | `Const,Your Rating,Date Rated,Title,Title Type,Year,…` | `Const` → `imdbId`; type `movie` → movie, `tvSeries`/`tvMiniSeries` → tv, other types → invalid. A stub dated `Date Rated` is optional ("Create stubs" toggle, default on) |
| TV Time ZIP | GDPR export CSVs; header aliases for show name, IMDb/TVDB id, season, episode, watched-at, movie rows | **Unverified format**: a founder sample confirms it (§17 F11). One stub per (show, season) dated at the last episode watched in that season. One stub per movie watch |
Normalised row (`importRowSchema`, C-00): `{ ref: string ≤64, mediaType?: 'movie'|'tv', tmdbId?: int, imdbId?: /^tt\d{7,10}$/, title?: ≤200, year?: 1870..2100, watchedOn?: IsoDate|null, rating10?: 1..10|null, rewatch?: boolean, review?: ≤5000, isSpoiler?: boolean, season?: 1..200|null }`.
**Limits:** the file is ≤ 10 MB (checked before reading). ZIP: ≤ 50 entries, each inflated entry ≤ 20 MB, total inflated ≤ 50 MB (counted while streaming, then abort). ≤ 20,000 rows per import. Past these limits the UI shows a message; the server limits are in the API section.
**Matching (server, `src/server/imports/match.ts`):** `tmdbId`+type → `imdbId` (`catalog_index.imdb_id`) → normalised title (`text.ts` normalisation) + year ±1 + type. Several title matches → the highest `vote_count`. Unlisted index rows count as matched (they can be stubbed today).
Live mode uses the RPC `catalog_match(p_items jsonb)` (`security invoker`, `stable`, ≤ 1000 items per call). Demo uses the memory catalogue.
**Dedupe:** `import_key = sha256(source|titleKey|watchedOn|season|ordinal)` with a unique `(user_id, import_key)`, so re-uploading is idempotent. A stub on the same title and date that already exists (any source) → `duplicate`.
Reviews and ratings are **never overwritten**: an existing review → `skipped.existingReview`. Imported reviews live only in our DB (ADR-008).
**Migration `20261003095000_imports.sql`:**
- `alter table stubs add column import_key text check (import_key is null or char_length(import_key) = 64)`; `create unique index stubs_import_key on stubs (user_id, import_key) where import_key is not null`.
- `stubs_before_write` and `reviews_before_write` (create or replace): when `current_setting('stubbed.bulk_import', true) is distinct from 'on'`, force `new.source := 'app'` and `new.import_key := null` and apply the per-minute limits as today. The stub limit now counts only `source='app'` rows, so an import doesn't lock out normal stubbing.
- `import_apply(p_source text, p_rows jsonb) returns jsonb` (`security invoker`; RLS applies; `user_id = auth.uid()`): ≤ 1000 rows. It calls `consume_rate_limit('import_rows', …)` with a budget of 20,000 rows per 24 h (sum of rows) and `perform set_config('stubbed.bulk_import','on', true)` (transaction-local).
  It inserts stubs `on conflict do nothing` and reviews only where none exist, and returns the counts.
- `catalog_match(p_items jsonb)` as above. `stub_details` is unchanged (`import_key` stays internal).
**API (🔒, JSON, same-origin, `private, no-store`):**
- `POST /api/me/imports/preview` takes `{ source: 'letterboxd'|'imdb'|'tvtime', rows: ImportRow[] /* ≤ 20000, review bodies omitted: hasReview */ }` with a body ≤ 4 MB.
  → `200 ImportPreviewResponse { counts: { total, matched, duplicate, notInStubbed, invalid }, sample: ImportPreviewItem[] /* ≤ 50 matched */, unmatched: { ref, title, year, reason: 'not_in_stubbed'|'invalid' }[] /* ≤ 500 */ }`. Nothing is written.
- `POST /api/me/imports` takes `{ source, importId: uuid, final: boolean, options: { createStubs: boolean, ratings: boolean, reviews: boolean }, rows: ImportRow[] /* ≤ 1000 */ }` with a body ≤ 1 MB.
  It re-matches on the server (stateless, nothing is trusted from the preview). → `200 ImportCommitResponse { created: { stubs, reviews }, skipped: { duplicate, notInStubbed, invalid, existingReview } }`.
- Errors: `400` fields · `401` · `413 payload_too_large` (body, row count) · `429` (budget, `Retry-After`) · `403` cross-origin.
**UI (FE):** page `/me/import` (owner-only, linked from Settings and the empty diary). Steps: pick a source → file input (`.csv,.zip`) → parse with progress → preview (`import-preview`, counts, sample, "Download not imported (.csv)" built in the browser) → toggles → "Import N" (chunks of 500 with a progress bar, `import-progress`) → summary (`import-summary`) with a link to the diary.
Copy: "Your file stays on this device. We only send the matched titles, dates and ratings."
**Tests:** unit parsers with tiny fixtures in `tests/fixtures/imports/` (`letterboxd-diary.csv`, `letterboxd-export.zip` built by a helper, `imdb-ratings.csv`, `tvtime-sample.zip` placeholder from the alias table); zip-bomb and oversize cases; round-trip (our export → import gives the same stubs); DB (`import_apply` idempotent, rate-limit bypass only inside it, app stubs keep their limit); E2E `imports.spec.ts` (upload `setInputFiles` → preview counts → import → diary rows; re-upload → all duplicate).

## C-12 · Avatar colour picker (B3-AC2)
**Migration `20261003093000_profile_avatar_color.sql`:** `alter table profiles add column avatar_color text check (avatar_color is null or avatar_color in ('sunset','ocean','forest','grape','ember','steel','rose','gold'))`.
Extend the column grant: `grant update (display_name, bio, avatar_url, avatar_color) on profiles to authenticated`. `create or replace view review_details`: add `'avatarColor', p.avatar_color` to the `author` jsonb (same column type).
**Contract:** `AvatarColor` union + `AVATAR_COLORS` (`src/lib/avatar.ts`, C-00). `PublicProfile.avatarColor: AvatarColor | null` (null = today's handle-derived colour). `updateProfileSchema.avatarColor?: AvatarColor | null`.
**UI:** Settings `AvatarColorPicker` is `role="radiogroup"` with 8 swatches (`avatar-color-{key}`, accessible names "Sunset" …) and live preview; initials stay. `Avatar` renders the gradient. FE adds `--avatar-{key}-a/-b` to `tokens.css` (waiver, see WORK_SPLIT §7).
**Tests:** DB (grant, check); route; component (keyboard arrows); E2E `profile.spec.ts` (pick → header and `/u/{handle}` show it after reload).

## C-13 · Error tracking without a third party
**Server logger (BE) `src/server/log.ts`:** `log.{info,warn,error}(event: string, fields?: Record<string, unknown>)` writes one JSON line `{ ts, level, event, release, ...fields }`.
`release` = `VERCEL_GIT_COMMIT_SHA[0..7]` or `dev`. `redact()` removes emails, JWT-like tokens, `sb-*` cookie values, `Authorization`, query strings and anything ≥ 2 KB.
Use it in `http.ts` (internal 500s), `dal.ts` degraded logs and jobs. `src/instrumentation.ts` exports `onRequestError(err, request, context)`, which logs `request_error` with `{ routePath: context.routePath, routeType, digest, message }` (never the URL query, headers or body).
**Client (BE lib, FE wiring):** `src/lib/report-error.ts` `reportError({ kind, message, digest?, stack? })` dedupes by `kind+message` per page load, sends at most 5 per page load, uses `sendBeacon('/api/log')` and never throws.
`src/app/error.tsx` and a new `src/app/global-error.tsx` call it in `useEffect`. `AppProvider` adds `window` listeners for `error` and `unhandledrejection`.
**API `POST /api/log`:** body `clientLogSchema { kind: 'boundary'|'global'|'unhandled'|'rejection', message: ≤300, digest?: ≤64, stack?: ≤2000, path: ≤200 /* location.pathname only */ }` with a body ≤ 4 KB.
The server strips the query and hash from `path` again, redacts, and logs `client_error` with `uaFamily` (`chrome|firefox|safari|edge|other`, derived and not stored raw). It never logs the IP. Response `204`.
Rate limits: 10/min per IP (in-memory hashed key, like C-09) and 300/min per process. Over → `429`. `413` over 4 KB. Same-origin + JSON.
**Tests:** unit `redact`, `onRequestError` shape, `reportError` dedupe/cap; route (`204`, `413`, `429`, query stripped); E2E (trigger via `page.evaluate(() => Promise.reject(new Error('x')))`, assert exactly one `/api/log` request and no non-origin request).

## C-14 · Launch kit: reference only
Built by **devops-release** in parallel (`launch:check`, `db:apply`, `smoke:live` + workflow, `check:provider-links`). Contract with this ADR:
`db:apply` applies the 6 migrations above in filename order. `launch:check` validates `NEXT_PUBLIC_BRAND_NAME` (warns while it is the default, F8) and `SUPABASE_SERVICE_ROLE_KEY` (C-09/C-11: analytics write and nothing else new).
`smoke:live` should hit `/title/movie/0-x` (expects 404), a wrong slug (expects 308), `/api/watch/providers?region=US` and a title `opengraph-image` (PNG).

## C-15 · Brand name as config (F8 workaround)
**Lib (C-00):** `src/lib/brand.ts`: `BRAND_NAME` = `process.env.NEXT_PUBLIC_BRAND_NAME` (literal access so Next inlines it), trimmed. It must match `^[\p{L}\p{N} .'&-]{1,24}$`, else `'Stubbed'`. `BRAND_TAGLINE = 'only the good stuff'`.
It is inlined at build time, so a rename means a rebuild (documented).
**Scope:** user-visible copy only: `layout.tsx` metadata (title template, `siteName`), Header logo text and aria, Footer, About, auth copy, "Not in {brand}", "On {brand} · N", empty states, OG images, `ERROR_COPY`/`format.ts` strings (C-00).
**Not renamed:** cookie names (`stubbed_*`), `@demo.stubbed.app`, the reserved handle list, DB names and file names.
**Guard (added by BE after the FE sweep, WORK_SPLIT §7 C-15a):** `tests/lib/guards.test.ts` fails on the string literal `Stubbed` in `src/components/**` and `src/app/**` (allowlist: `brand.ts`, tests).
**Tests:** unit (invalid → default); build with `NEXT_PUBLIC_BRAND_NAME=Reel` renders "Reel" in the header (an E2E project or a unit render). The founder input stays F8.

---

## 16. New env vars (sent to devops-release for `.env.example` and `launch:check`)
| Var | Scope | Default | Item |
|---|---|---|---|
| `NEXT_PUBLIC_BRAND_NAME` | build | `Stubbed` | C-15 |
| `ANALYTICS_ENABLED` | server | `true` (`false` → `/api/events` 204 no-op and `recordEvent` no-op) | C-09 |
| `IMPORT_MAX_ROWS_PER_DAY` | server | `20000` | C-11 |
| *(remove)* `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | – | – | C-13 |

## 17. Founder input added
**F11 (optional):** a real TV Time export ZIP, used to confirm the header aliases (C-11). Until then the parser ships with the documented alias table, and the UI labels TV Time "beta".
**F4 addendum (optional):** turn on asymmetric JWT signing keys (C-05).

## 18. Deliberate shortcuts (ceiling → upgrade trigger)
- Analytics daily buckets only (no funnels by session) → if the PM needs per-session funnels, use a server-side session-less sampling design first, never client IDs.
- OG uses only Geist Regular → add the Bricolage TTF when network is available.
- Share images are cached ≤ 10 min after deletion → if a takedown request arrives, add `revalidatePath` on stub delete.
- Imports skip unknown titles → if "not in Stubbed" is > 20 % for imports, build ADR-002 §3 lazy unlisted insert (TMDB `find`, budgeted).
