# ADR-007: Images and poster palette extraction

Status: **Accepted** · Date: 2026-09-26 · Decider: Architect
Inputs: DESIGN §3.3, §4 (adaptive background, contrast guarantee), SYSTEM_DESIGN §10

## Decision

### Delivery
- Posters and backdrops are **hot-linked from `https://image.tmdb.org/t/p/{size}{path}`**. There is no proxy and no Vercel optimisation (`images.unoptimized: true`). Sizes: grid `w185`/`w342` srcset, detail `w500`, backdrop and OG `w780`/`w1280`, extraction `w92`.
- Components **never hard-code the host**. They call `tmdbImage(path, size, mode.images)` / `posterSrcSet()` from `src/lib/images.ts`. That returns `null` when `IMAGE_MODE=off` or the path is null.
- **Fallback is mandatory.** When the URL is null **or the `<img>` fires `onError`**, render the generated poster: `posterFallbackStyle(palette)` (a gradient from the precomputed palette) with the title set in Bricolage 800 plus grain. Never show a broken-image icon. This matters here: the container cannot reach `image.tmdb.org`, while a deployed demo in a real browser shows the real posters from the fixtures' real `poster_path`s.
- Always set `width`/`height` (CLS < 0.1). Use `loading="lazy"` except the LCP poster (`fetchpriority="high"`). Add `<link rel="preconnect" href="https://image.tmdb.org">` only when `mode.images === 'tmdb'`.
- The privacy policy discloses that hot-linking exposes viewer IPs to TMDB's CDN.

### Palette: computed once, never on the hot path
- **Live:** the nightly job (`scripts/sync-catalog.ts`, step 7) processes rows with `needs_palette = true` (new rows or a changed `poster_path`):
  1. Fetch the `w92` poster, then `sharp().resize(24, 36, {fit:'fill'}).removeAlpha().raw()`.
  2. `extractColors()` builds a 4-bit histogram, skips near-black and near-white pixels, and weights by chroma. That gives `vibrant` and `base`.
  3. `tintsFrom()` clamps `tint1` to Y ≤ 0.06 and `tint2` to Y ≤ 0.02 (`clampY` multiplies by 0.9, **checking the rounded colour each step**).
  4. LQIP via `sharp().resize(8,12).webp({quality:40})`, stored as a base64 data URI.
  5. The result is stored as `catalog_index.palette jsonb = {vibrant, base, tint1, tint2, lqip, v:1}` (the `Palette` type).
  Throughput is 30 concurrent downloads. The first run handles about 15k posters (about 75 MB); later nights handle tens.
- **Fixtures:** the container cannot download posters, so `scripts/build-fixtures.ts` uses hand-picked `[vibrant, base]` per title. It runs the **same** `tintsFrom()` clamp and renders the LQIP with sharp from a gradient of those colours. Output is deterministic and committed.
- **All pure colour maths lives in `src/lib/palette.ts`**, which is isomorphic and unit-tested:
  - every fixture palette is clamped
  - the DESIGN §4.4 worst-case composite keeps `--fg-2` at ≥ 4.5:1
  - bright posters (Severance) clamp correctly
- **No palette yet** (a lazily inserted title): `paletteOrDefault(null, genreIds)` returns the genre default tints (DESIGN §4.3), and the row keeps `needs_palette = true` for the next run.
- The client **never** extracts colours (no canvas, no CORS dependency).

### Adaptive background (Frontend)
The CSS layer stack follows DESIGN §4.1:
- `--tint-1`/`--tint-2` come from `adaptiveBgVars(palette)` and are SSR'd inline on the title page, so the first paint is already tinted.
- The blurred LQIP layer sits over the tints, with a scrim of at least 0.60 and static grain.
- Tints cross-fade over 900 ms when the focused title changes (hover or focus on browse, debounced 140 ms).

## Consequences
- Zero image bandwidth cost for us, zero layout shift from the adaptive background, and no client JS for colour.
- If TMDB changes a poster, the new palette arrives the next night (the old one stays usable).
- `v` in the palette lets a future algorithm change trigger a full recompute (`needs_palette = true where palette->>'v' <> '2'`).
