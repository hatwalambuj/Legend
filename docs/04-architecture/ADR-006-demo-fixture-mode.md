# ADR-006: Demo / fixture mode (zero env vars, zero network)

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect
Inputs: BRIEF environment constraints, PRD E2, SYSTEM_DESIGN §15

## Context
The build container can reach only the npm registry. QA runs Playwright here against the app, and no credentials exist yet. The app must boot with **no env vars and no network**: browse seed titles, sign up, stub, review, and keep that data across reloads. It must also exercise the **same code paths** as live mode. Two agents (FE, BE) build in parallel and need a working data layer from day one.

## Options for the demo data layer
| | Repository interface + in-memory store persisted to a JSON file | PGlite (WASM Postgres) running the real migrations | SQLite (better-sqlite3) |
|---|---|---|---|
| Parity with live SQL | Semantics shared via `src/lib` (curation, order, cursor, text), with parity **tested** against real SQL | Highest (same SQL) | Dialect shim |
| Robustness in `next build` / `next start` / Vercel | Plain JS, no native or WASM bundling, works with the read-only FS via `/tmp` | WASM + extension bundles in server chunks; several concurrent route workers opening one data dir is fragile | Native module, not on Vercel |
| Work for BE | Small: array filters | Must also emulate `auth.uid()`/RLS, and still needs a local auth provider | Medium |
| Speed of first FE screen | Immediate (already wired) | After BE ports all queries | After shim |

**Verified:** PGlite 0.5.8 installs from npm and works here. Our full migration (pg_trgm, citext, RLS, triggers, plpgsql) applies cleanly, and RLS behaves correctly under `set role`.

## Decision
1. **Runtime demo store = in-memory repositories persisted to a JSON file** (`src/server/repositories/memory/*`), behind the same ports as Supabase (`src/server/ports.ts`), selected once in `src/server/container.ts`.
   - Seeded from `src/fixtures/seed.json`. The catalogue is read-only from `src/fixtures/catalog.json`.
   - Write-through to `<DEMO_DATA_DIR>/db.json` (default `.data/demo`, `/tmp/stubbed-demo` on Vercel) using tmp-file + rename. Before every read, an mtime check reloads the store if another worker wrote it.
   - `DEMO_PERSIST=memory` for unit tests. `DEMO_RESET_ON_BOOT=true` for E2E. `npm run demo:reset`.
2. **PGlite is used in tests only** (`tests/db/migrations.test.ts`). It proves the SQL schema, RLS and triggers, and that **SQL ordering/pagination equals the JS reference implementation** for every sort and type. That gives us parity without shipping WASM Postgres in the app.
3. **Mode resolution** (`src/server/env.ts`, resolved once, logged at boot, exposed as `AppMode`):
   - `CATALOG_MODE=auto|fixtures|tmdb`: `auto` means tmdb if `TMDB_READ_TOKEN`/`TMDB_API_KEY` is set. This controls title **detail**.
   - `DATA_MODE=auto|local|supabase`: `auto` means supabase if URL and anon key are set. This controls the **index and user data** (including auth).
   - **Partial config fails fast** (URL without key, `CATALOG_MODE=tmdb` without a key). Absent config means demo, never "half live".
   - `isDemo` = either side is non-live. That shows the "● DEMO DATA" pill (`data-testid="demo-pill"`) on every page.
   - Demo works in production builds too (a deployed demo with zero env vars is a feature). The pill makes it explicit.
4. **Zero network in demo mode:** no server code path calls TMDB, OMDb or Supabase when their mode is off (providers are not even constructed). The only external requests are **browser** `<img>` loads from `image.tmdb.org`, and `IMAGE_MODE=off` disables those too (ADR-007). Playwright sets it for a clean console.
5. **Local auth** as in ADR-005: scrypt, signed httpOnly cookie, seed accounts with password `stubbed-demo`.
6. **Seed content** (`scripts/fixtures/*.source.ts` → `npm run fixtures:build` → `src/fixtures/*.json`, deterministic):
   - **71 real titles** (43 movies, 28 shows; 66 listed), 1942–2024, across genres.
   - Real TMDB ids, IMDb ids, **real IMDb ratings + approximate vote counts** (ADR-008), poster/backdrop paths, runtimes and seasons. Realistic `vote_average`/`vote_count`/`popularity` snapshots.
   - **"Worth it?" data** for every title (`pitch.source.ts`, ADR-009): hand-written hooks, US certifications, keywords, episode runtimes, series status, recommendations.
   - Short original overviews, cast, directors/creators, some trailer keys, a few TMDB-style reviews.
   - A precomputed palette with LQIP per title.
   - **Edge cases:** Twilight 6.4 with 13k votes (out, but dev has a stub on it, so it shows as hysteresis; verdict "Mixed reviews"), Tampopo 8.0 with 150 votes (out), Pachinko TV 8.0 with 99 votes (out), Great British Bake Off (Reality, out), Paterson exactly 6.5/200 (in), Emily in Paris exactly 6.5/100 (in), **Zombieland** TMDB 6.4 / IMDb 7.5 (out: IMDb never changes membership; also no poster → generated poster), **Bluey** with no IMDb id (IMDb chip hidden), **Avatar: The Last Airbender** with unknown episode length, The Godfather / Paterson without a hand-written hook (fallback chain), Seven Samurai / Tampopo without a certification.
   - **Users:** maya, dev, priya, sam, jun, leo (leo is empty). 35 stubs (dev: The Office ×4, Interstellar ×3), 22 reviews on 14 titles, including a **spoiler** (Succession), one **linked to stub #2** (Dune: Part Two), **5 ratings on Dune: Part Two** so the community average unlocks, and **5 low ratings on Transformers** so its verdict is "Split opinions". Watchlist items for maya and dev.
   - Dates assume `DEMO_TODAY=2026-09-26`.
7. **Shared semantics live in `src/lib`** (frozen): `curation.ts`, `catalog-order.ts` (order + cursor + reference `paginate`), `text.ts` (normalisation), `palette.ts`. Both implementations call them, so demo and live cannot drift silently.

## Consequences
- Frontend gets real catalogue data through `@/server/dal` immediately. Mutations return `501 not_implemented` until Backend fills the memory repositories, and the contract (validation, error shape) is already live.
- On Vercel, demo writes live in `/tmp` per instance. They are ephemeral, may differ between instances, and are acceptable for a demo that labels itself as one.
- The JSON store is O(n) per query. That is fine for demo sizes (hundreds of rows) and not meant for production.
- Keeping two implementations means every new repository method needs both a memory and a Supabase version, plus a shared contract test (Backend owns `src/server/**/*.test.ts`).
