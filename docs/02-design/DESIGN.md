# Stubbed — Design System & Screen Specs

Author: UI/UX Designer · Date: 2026-09-26 · Status: **v1.0, ready for System Design / Architect / FE**
Inputs: `docs/00-orchestrator/BRIEF.md`, `docs/01-product/PRD.md` (story IDs referenced as `A1`, `C1-AC1`, …), `research.md`, `naming.md`
Prototype: `docs/02-design/prototype.html` (self-contained; open in any browser. Routes: `#/` home, `#/title/dune-part-two` detail, `#/u/maya` wallet)

---

## 0. TL;DR for engineers

| Decision | Value |
|---|---|
| Theme | **Dark only in MVP** (`color-scheme: dark`). Light theme is out of scope; tokens are named semantically so it can be added later. |
| Fonts | **Bricolage Grotesque** (display, 500–800), **Geist** (UI, 400–700), **Geist Mono** (ticket print, 400–600). All from Google Fonts, `display=swap`. |
| Accent | **`#FF5B3A` "Usher red"**, used only for the primary CTA, focus rings, stamps and counts. Ink text on it (6.4:1). |
| Signature component | **Ticket card**: poster + perforated tear-off **stub** (paper `#EFE9DE`), CSS-mask notches. Vertical (stub at bottom) in grids; horizontal (stub on right) in lists. |
| Signature interaction | **Stub it**: optimistic write, stub tears off and flies into the wallet icon (1000 ms), a stamp lands, toast with Undo. Reduced motion: cross-fade only. |
| Adaptive background | Server extracts a **palette + 8×12 LQIP** from the TMDB `w92` poster at ingest. The client paints tint gradients + blurred LQIP + a fixed scrim. Contrast is guaranteed by clamping the tint luminance (§4). |
| Grid | 4 / 8 / 12 columns · gutters 16 / 32 / 60 px · max content 1320 px · breakpoints 640, 900, 1200. |

---

## 1. Principles

1. **The ticket is the interface.** Every title, everywhere, is a ticket. The stub carries the facts (rating, year, type). The poster carries the vibe. If a screen shows a title without a ticket, it has to justify it.
2. **Two taps, zero doubt.** "Stub it" is always visible, always the brightest thing on the screen, and always reversible (Undo toast, 5 s).
3. **The poster sets the mood, the scrim sets the rules.** Backgrounds adapt to the focused title, but text never sits on an unclamped colour. Contrast is computed, not eyeballed.
4. **Loud type, quiet chrome.** Big, tight display type and a single accent. Everything else is greys, glass and paper. Grain adds texture instead of more colour.
5. **Play, but never block.** Micro-interactions last under 1 s, never gate input, and all of them collapse to a fade under `prefers-reduced-motion`.
6. **Honest by design.** Sources are labelled at the point of use ("TMDB", "IMDb via OMDb", "From TMDB"). We never imply we post to IMDb.

---

## 2. Design tokens

All tokens are CSS custom properties on `:root`. The names below are the contract; the Architect may map them into Tailwind (`theme.extend.colors.bg = 'var(--bg)'`, etc.).

### 2.1 Colour

| Token | Value | Use | Contrast notes (WCAG 2.1) |
|---|---|---|---|
| `--bg` | `#0B0B0D` | Page base, behind every adaptive layer | — |
| `--surface` | `#16161A` | Cards, sheets, menus | `--fg-3` on it: 5.0:1 |
| `--surface-2` | `#1D1D22` | Inputs, hover surfaces | `--fg-3`: 4.6:1 |
| `--surface-3` | `#26262C` | Skeletons, avatars, empty stars | decorative |
| `--line` / `--line-2` | `rgba(255,255,255,.08)` / `.14` | Hairlines / control borders | Control borders pair with a text label (1.4.11 met by label + focus ring) |
| `--glass` | `rgba(22,22,26,.62)` + `backdrop-filter: blur(10–18px)` | Score chips, composer, stats over adaptive bg | Treat as `--surface` for contrast (worst case is lighter than it, see §4) |
| `--fg` | `#F4F1EA` | Primary text | 17.7:1 on `--bg`; ≥ 9.8:1 on worst-case adaptive bg |
| `--fg-2` | `#BDB8AE` | Secondary text, meta | 9.9:1 on `--bg`; ≥ 5.6:1 on worst-case adaptive bg |
| `--fg-3` | `#8A857C` | Tertiary (timestamps, counters) — **solid surfaces only** | 5.4:1 on `--bg`; **never** place directly on the adaptive background |
| `--paper` | `#EFE9DE` | Ticket stub, torn stubs, diary rows | — |
| `--paper-2` / `--paper-3` | `#E3DCCD` / `#D6CEBD` | Stacked stub layers (rewatches) | decorative |
| `--ink` | `#141210` | Text on paper | 16:1 on paper |
| `--ink-2` | `#5E584F` | Secondary text on paper (mono print) | 5.8:1 on paper |
| `--perf` | `rgba(20,18,16,.26)` | Perforation dashes | decorative |
| `--accent` | `#FF5B3A` | Primary CTA fill, focus ring, active tab bar, stars | Ink on accent 6.4:1. As text on dark bg: large/UI only (≥ 3.6:1 worst case) |
| `--accent-press` | `#E84A2A` | Pressed CTA | — |
| `--on-accent` | `#0B0B0D` | Text/icons on accent | 6.4:1 |
| `--stamp` | `#B02E17` | "N× stubbed" stamp, count pill, Undo link on light toast | 5.3:1 on paper |
| `--ok` / `--warn` / `--danger` | `#5ED39A` / `#F5C451` / `#FF6B6B` | Success, demo pill, errors | all ≥ 7:1 on `--bg` |
| `--tint-1` / `--tint-2` | per title (clamped) | Adaptive background (see §4) | Y ≤ 0.06 / ≤ 0.02 by construction |

Rules: accent appears at most **once per viewport as a filled element** (the primary CTA). Everything else that uses accent is a line, a star or a small count.

### 2.2 Typography

| Token | Font / weight | Size / line-height / tracking | Use |
|---|---|---|---|
| `display-xl` | Bricolage 800 | `clamp(44px, 9vw, 120px)` / .88 / −0.055em | Home hero |
| `display-l` | Bricolage 800 | `clamp(44px, 8vw, 104px)` / .88 / −0.05em | Title-detail name, profile name (`clamp(36px,6vw,72px)`) |
| `h2` | Bricolage 750 | `clamp(24px, 3.2vw, 36px)` / 1 / −0.035em | Section headers |
| `h3` | Bricolage 750 | 22–26px / 1.1 / −0.03em | Month headers, empty-state titles, sheet titles |
| `score` | Bricolage 800 | 28px (card) · 34px (detail ticket) · 30px (score chip) / 1 / −0.04em | Ratings |
| `body-l` | Geist 400 | 18px / 1.55 | Overview |
| `body` | Geist 400 | 16px / 1.5 | Default |
| `ui` | Geist 500–650 | 14–15px / 1.2 | Buttons, tabs, stub title |
| `caption` | Geist 400 | 12–13px / 1.35 | Timestamps, helper text |
| `print` | Geist Mono 500 | 9.5–12px / 1.2 / +0.08 to +0.14em, UPPERCASE | Eyebrows, ticket serials, stub meta, counters |

Minimum rendered size is 12px for readable text. The only exception is the 9.5–10.5px mono print on stubs (`ADMIT ONE`, serial), which is decorative and duplicated in the accessible name.
Numerals: `font-variant-numeric: tabular-nums` on counters and dates.

### 2.3 Spacing (4-pt)
`--s-1 4` · `--s-2 8` · `--s-3 12` · `--s-4 16` · `--s-5 20` · `--s-6 24` · `--s-8 32` · `--s-10 40` · `--s-14 56` · `--s-18 72` · `--s-24 96` (px).
Section rhythm: 40px between sections on mobile, 56–72px on desktop.

### 2.4 Radii
`--r-xs 6` (tags) · `--r-sm 10` (inputs, diary rows) · `--r-md 14` (**ticket**, score chips) · `--r-lg 20` (composer, empty states) · `--r-xl 28` (sheets) · `--r-pill 999` (buttons, chips, segmented).
`--notch`: 9px (grid card) · 12px (detail ticket, mobile) · 14px (detail ticket, desktop) · 8px (horizontal diary row).

### 2.5 Elevation
Tickets use `filter: drop-shadow(0 18px 28px rgba(0,0,0,.45)) drop-shadow(0 2px 4px rgba(0,0,0,.35))` on a wrapper, **not** `box-shadow` (the mask would clip it). Sheets and toasts use `0 16px 40px rgba(0,0,0,.5)`. There are no other elevation levels.

### 2.6 Motion

| Token | Value | Use |
|---|---|---|
| `--d-1` | 120 ms | Press scale, hover colour |
| `--d-2` | 200 ms | Toggles, tabs, toast out |
| `--d-3` | 320 ms | Card lift, sheet in, toast in |
| `--d-4` | 560 ms | Stamp land, view enter |
| `--d-5` | 900 ms | Background cross-fade |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Default |
| `--ease-snap` | `cubic-bezier(.3,1.5,.5,1)` | Overshoot: stamp, badge bump, toast in |
| `--ease-tear` | `cubic-bezier(.55,0,.75,.05)` | Accelerating peel/rip |

`prefers-reduced-motion: reduce` sets all durations to ~1 ms, disables the fly-to-wallet clone, shimmer and hover lifts, and keeps colour/opacity changes. Nothing important is conveyed by motion alone.

### 2.7 Texture
Grain is an inline SVG `feTurbulence` data URI (no request), `opacity: .07`, `mix-blend-mode: overlay` over the page, and `soft-light` over posters. It is static (not animated) so it adds no CPU cost.

### 2.8 Layout grid & breakpoints

| Range | Name | Columns | Outer gutter | Column gap | Card grid | Nav |
|---|---|---|---|---|---|---|
| < 640 (design at **375**) | mobile | 4 | 16 | 12 | 2 cards | Bottom tab bar (4 items) + slim header |
| 640–899 | tablet | 8 | 32 | 18 | 3 cards | Bottom tab bar |
| 900–1199 | laptop | 12 | 32 | 24 | 4 cards | Top nav + header search |
| ≥ 1200 (design at **1440**) | desktop | 12 | 60 | 24 | 5 cards (6 at ≥ 1380) | Top nav + header search |

Max content width 1320px (at 1440 that gives 60px margins). Header height 64 (mobile) / 72 (desktop). No page ever scrolls horizontally (A1-AC3); rails scroll inside themselves.

---

## 3. The ticket card

### 3.1 Anatomy (vertical, grid variant)

```
 ┌──────────────────────────────┐  ← radius 14, paper-backed
 │ [MOVIE]            [2× STUBBED]│  ← type pill (glass) · stamp (only if stubbed)
 │                              │
 │        POSTER  (2:3)         │  ← TMDB w342 (grid) / w500 (detail); CSS art in prototype
 │                              │
 │  DUNE                        │
 │  PART TWO                    │
 ◖- - - - - - - - - - - - - - - -◗ ← perforation: 2px dashed --perf + notches (radius --notch)
 │ Dune: Part Two               │  ← stub title, Geist 650 15px, 1 line ellipsis
 │ 8.2 TMDB              2024   │  ← score (Bricolage 800 28) · meta (mono: year / MOVIE|SHOW)
 │                       MOVIE  │
 │ ADMIT ONE        [✓ 2×]      │  ← serial print · quick action (Stub it / N×)
 └──────────────────────────────┘
          stub height: 118px grid · 126px rail · 132/150px detail
```

- **Notches** are cut with a two-layer CSS mask so they are truly transparent over the adaptive background:
  ```css
  .ticket{ --stub-h:118px; --notch:9px;
    mask:
      radial-gradient(circle var(--notch) at 0    calc(100% - var(--stub-h)), #0000 97%, #000) left  / 51% 100% no-repeat,
      radial-gradient(circle var(--notch) at 100% calc(100% - var(--stub-h)), #0000 97%, #000) right / 51% 100% no-repeat; }
  ```
  Horizontal rows use the same trick along the x-axis (`at var(--px) 0` / `at var(--px) 100%`, layers sized `100% 51%`).
- **Perforation**: a 2px dashed line inset `notch + 6px` from each edge.
- **Movie vs show print** (PRD §12): the movie stub prints `ADMIT ONE` (+ `№ 01200` serial on the detail ticket). The show stub prints `S01–S04` (the seasons range, in the spot where a movie ticket has seat/row). v1 episode stubs print `S2 · E5`.
- **Serial number** `№ #####` is derived deterministically from the title id (e.g. a hash mod 100000). It is decorative and stable, so share images match.

### 3.2 Variants

| Variant | Where | Stub position | Notes |
|---|---|---|---|
| `ticket/grid` | Browse grid, watchlist, search | Bottom | Default. Whole poster is a link; stub action is a separate button. |
| `ticket/rail` | "Trending" rail | Bottom | Adds an outlined rank numeral (top right). The stamp is hidden (the numeral owns that corner) and the button shows `N×`. Width 62vw (max 230) on mobile, 250 on desktop, scroll-snap. |
| `ticket/hero` | Title detail | Bottom | Larger notch (12/14), serial shown, sticky on desktop. |
| `ticket/row` | Diary, search results list (optional) | **Right** | 84px tall. Date block · poster thumb · title/meta · where (desktop) · perforation · stub with `#N` (which watch this was). |
| `stub/torn` | Stub wallet | Torn edge on the **left** | Paper with a zig-zag `clip-path` torn edge, colour strip from the palette, title, last date, vertical `ADMIT ONE`. Rewatches stack 1–2 offset paper layers behind plus a `×N` tag. Slight random rotation (−2.8°…+2.4°) that straightens on hover. |
| `ticket/share` (v1, designed now) | Share image 1080×1920 | Bottom | See §3.5. |

### 3.3 States

| State | Visual | Behaviour |
|---|---|---|
| Default | Poster + paper stub, drop shadow | — |
| Hover (pointer) | Lift −4px, rotate −0.4°, 320 ms; **background re-tints to this title after 140 ms** | Reduced motion: no lift, tint still changes (opacity only) |
| Focus-visible | 2px accent outline, 4px offset, around the whole ticket (`:has(:focus-visible)`) | Also re-tints background |
| Pressed (stub button) | Scale .94 | — |
| Not stubbed | Button: ink pill `+ Stub it` (icon-only `+` under 420px) | — |
| Stubbed (N ≥ 1) | Button: stamp-red pill `✓ N×`; paper stamp `N× STUBBED` rotated 4° at poster top right | Button label becomes "Stub again" (C3-AC1) |
| On watchlist | Small bookmark glyph in the type-pill row (grid) / "On watchlist ✓" button (detail) | — |
| Loading | Skeleton: surface block 2:3 with 1.3s shimmer + dashed stub with 3 bars | Shimmer off under reduced motion |
| Image error / no poster | CSS fallback poster: `--tint` gradient + title set in Bricolage 800 on it + grain (same system as the prototype posters) | Never a broken-image icon |
| Hidden by hysteresis (D4) | Reached by URL or diary only: normal ticket plus a mono tag `BELOW 6.5 NOW` on the stub | Not shown in browse/search |

### 3.4 Accessibility markup
```html
<article class="ticket" data-ticket="{id}">
  <a class="ticket__body" href="/title/movie/693134-dune-part-two"
     aria-label="Dune: Part Two, movie, 2024, rated 8.2 on TMDB">
    <img src="…/w342/…" alt="" width="342" height="513" loading="lazy" decoding="async">  <!-- decorative: name is on the link -->
  </a>
  <div class="stub"> … visible title / score / meta (aria-hidden not needed; link name already covers it) …
    <button class="stub-act" aria-label="Stub again: Dune: Part Two (2× stubbed)">✓ 2×</button>
  </div>
</article>
```
The quick-action button has a ≥ 44×44 hit area (a pseudo-element extends the 30px pill). Long-press (550 ms) or the `…` button opens the details sheet (C2).

### 3.5 Share ticket (1080×1920, v1, designed now so the MVP ticket matches)
- Full-bleed adaptive background (same algorithm, rendered server-side at 1080×1920).
- Centered hero ticket at 760px wide: poster (2:3, 760×1140) plus a 300px stub.
- The stub prints the title, the user's star rating (large), `N× STUBBED`, the watch date, `@handle`, and the serial.
- Bottom 160px: "stubbed.app/s/xxxx" short link in mono + Stubbed logo. A small "Poster: TMDB" credit line sits under the ticket.
- Square (1080×1080) variant: horizontal `ticket/row` scaled up with the stub on the right.

---

## 4. Poster-adaptive background

### 4.1 Layer stack (bottom → top), fixed to the viewport, `z-index:-1`
1. `--bg` solid `#0B0B0D`.
2. **Tint layer**: `radial-gradient(55% 45% at 18% 8%, var(--tint-1), transparent 70%)`, `radial-gradient(50% 55% at 88% 22%, var(--tint-2), transparent 72%)`, and `linear-gradient(180deg, var(--tint-2), var(--bg) 78%)`.
3. **Blurred poster layer**: the title's **LQIP** (8×12 WebP data URI, ~300 B, see 4.2) stretched to 120vmax with `filter: blur(72px) saturate(1.25) brightness(.5); opacity: .3`. No network request and no layout shift.
4. **Scrim**: `linear-gradient(180deg, rgba(11,11,13,.60) 0%, rgba(11,11,13,.68) 45%, rgba(11,11,13,.90) 100%)`. **The minimum opacity is 0.60 anywhere text can sit.**
5. **Grain** (static SVG noise, 7%).

Layers 2 and 3 live in two stacked `bg__layer` elements that **cross-fade over 900 ms** when the focused title changes. Pages update `<meta name="theme-color">` to `--tint-2` as well.

**What counts as the "focused title"?**
- Title detail: that title (it is SSR'd into the HTML as inline CSS vars, so the first paint already has the right tint).
- Home/browse: the hovered or keyboard-focused ticket (debounced 140 ms). On touch devices, it is the rail card nearest the left snap edge once scrolling settles (120 ms). Otherwise, it is the #1 trending title.
- Profile: the most recently stubbed title.

### 4.2 Dominant-colour extraction (server-side, preferred)
Run it **once per title at catalogue ingest** (the nightly TMDB sync, or the fixture build script for demo mode). Store the result on the `titles` row. The client never computes colours.

1. Fetch the **smallest poster**: `https://image.tmdb.org/t/p/w92{poster_path}` (about 3–6 KB).
2. Decode it with **`sharp`** (Node) and resize to 24×36 (`fit: 'fill'`, `.removeAlpha().raw()`).
3. **Quantise**: bucket pixels into a 4-bits-per-channel histogram (4,096 bins). Skip near-black (Y < 0.02) and near-white (Y > 0.9) pixels. Weight each pixel by `0.3 + chroma` so saturated colours win.
   - `vibrant` = the mean colour of the heaviest bin.
   - `base` = the mean of all pixels, which is the "mood" colour.
   - `node-vibrant` (Vibrant / DarkMuted swatches) is an acceptable drop-in if the Architect prefers a library.
4. **Clamp for contrast.** This is the load-bearing step:
   - `tint1 = clampY(vibrant, 0.06)` and `tint2 = clampY(base, 0.02)`, where `clampY` multiplies R, G and B by 0.9 until the WCAG relative luminance is at or below the target. This keeps the hue and darkens it.
   - Also cap OKLCH chroma at 0.16 to avoid neon mud.
5. **LQIP**: `sharp(buf).resize(8,12).webp({quality:40})`, then base64 it (about 200–350 bytes).
6. Persist `titles.palette jsonb = { "vibrant":"#c8671f", "base":"#4a1d0b", "tint1":"#6b3710", "tint2":"#2a1006", "lqip":"data:image/webp;base64,…", "v":1 }`. The `v` field lets a later algorithm change trigger recomputation.
7. **Fixtures:** the demo seed ships this same JSON for every title, precomputed by the same script at build time, so demo mode never needs the network.

Reference (pseudo-TypeScript, not app code):
```ts
const img = await sharp(await fetchBuf(`${TMDB_IMG}/w92${posterPath}`)).resize(24, 36, { fit: 'fill' }).removeAlpha().raw().toBuffer();
const bins = new Map<number, { w: number; r: number; g: number; b: number }>();
for (let i = 0; i < img.length; i += 3) {
  const [r, g, b] = [img[i], img[i + 1], img[i + 2]];
  const y = relLum(r, g, b); if (y < 0.02 || y > 0.9) continue;
  const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
  const w = 0.3 + chroma(r, g, b);            // 0..1
  const e = bins.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
  e.w += w; e.r += r * w; e.g += g * w; e.b += b * w; bins.set(key, e);
}
const top = [...bins.values()].sort((a, b) => b.w - a.w)[0];
const vibrant = hex(top.r / top.w, top.g / top.w, top.b / top.w);
const tint1 = clampY(vibrant, 0.06), tint2 = clampY(base, 0.02);
```

### 4.3 Fallbacks
- **No palette yet** (a new title before the next sync): SSR uses a genre default (for example Sci-Fi `#1c2a4a/#0b1020`, Drama `#3a2a2a/#140c0c`, Animation `#2a3a4a/#0c141c`, Comedy `#4a3a1c/#1c140a`, anything else `#2a2a33/#101014`). The blurred poster layer then uses the real `w92` image as a CSS background with the same filter, which costs one small request.
- **No poster at all**: tint defaults only, no poster layer.
- **CSS-only progressive option** (no server step): the blurred `<img>` alone with `filter: blur(72px) brightness(.5)` plus the scrim is still contrast-safe, because the scrim and brightness bound it (see 4.4). Only the gradient tint is lost.
- **Future**: `color-mix()` / `contrast-color()` are not relied on. They are optional enhancements only.

### 4.4 Contrast guarantee (A5-AC2: ≥ 4.5:1)
This is a conservative worst case computed in linear light. Actual sRGB-space compositing comes out darker still.
- The tint layer has Y ≤ 0.06.
- The poster layer's brightest possible pixel after `brightness(.5)` is sRGB 0.5, which is Y ≈ 0.214, at opacity 0.3.
- Before the scrim: Y ≤ 0.3 × 0.214 + 0.7 × 0.06 = 0.106. After the scrim at ≥ 0.60 of `#0B0B0D`: **Y ≤ 0.045**.
- Resulting contrast:
  - `--fg` ≥ 9.8:1.
  - `--fg-2` ≥ 5.6:1.
  - `--accent` ≥ 3.6:1, so it is allowed only for large text and UI components.
  - `--fg-3` is **not allowed** directly on the adaptive background.
- **Guard rails**:
  - (a) a unit test runs `clampY` against every fixture palette.
  - (b) a Playwright check samples the rendered background behind `h1` on three fixture titles (bright ones: Severance, Aftersun, Interstellar) and asserts ≥ 4.5:1 with `--fg-2`.
  - (c) a dev-only runtime `console.warn` fires if a palette arrives unclamped.
- Glass panels (`--glass`) and paper stubs carry their own background, so their text contrast does not depend on the tint.

---

## 5. The Stub interaction

### 5.1 Flow (C1, C3)
1. Tap **Stub it** (detail CTA or the card quick action).
   - If logged out, open the auth sheet and **resume the stub after login** (B2-AC3).
2. **Optimistic**: increment the count, swap the label to "Stub again", and fire the POST in the background.
3. **Feedback** (in parallel):
   - Haptic: `navigator.vibrate(14)` on the first stub and `[10,40,18]` on a rewatch. Feature-detect it; iOS gets no vibration, so the visual shake stands in.
   - Tear animation (5.2).
   - The stamp `N× STUBBED` lands (560 ms, `--ease-snap`, from 2.1× scale and −24°).
   - The wallet badge bumps.
4. **Toast** (bottom center, above the tab bar): **"3× stubbed · Dune: Part Two"** with **[Undo]** for 5 s. Undo deletes that stub row and reverses the count.
   - If the title is on the watchlist, the toast instead asks: "Stubbed Dune: Part Two. Remove it from your watchlist?" **[Remove]** (C6-AC1).
5. **Same-day rewatch** (C3-AC3): if a stub already exists for today, show a confirm sheet first: "**Stub again today?** Double feature? It'll count as another watch." [Cancel] [Stub again].
6. **Failure**: roll the count back, shake the ticket once, and show the toast "Couldn't save that stub. Try again." with [Retry]. Rate limited (E5): "Easy — that's a lot of stubs in a minute. Try again shortly."

### 5.2 Tear animation timeline (1000 ms, WAAPI on a fixed-position clone of the stub)

| t | What happens | Easing |
|---|---|---|
| 0–140 ms | **Grip + peel**: the clone rotates −4° around its top-left and nudges down 4px. The source ticket does a 360 ms micro-shake. | `--ease-out` |
| 140–380 ms | **Rip + drop**: the clone falls 34px and swings to +8°. Its top edge is a zig-zag `clip-path`, which reads as torn. | `--ease-tear` |
| 380–1000 ms | **Fly to wallet**: the clone translates to the wallet icon (top nav on desktop, tab bar on mobile), scales to 0.12 and fades to 0.35. | `cubic-bezier(.5,0,.2,1)` |
| 1000 ms | The clone is removed and the wallet badge bumps 1 → 1.5 → 1 (360 ms, snap). | `--ease-snap` |

The real stub never leaves the card: it re-renders instantly with the new count and stamp, so the card is never empty. Under **reduced motion**, there is no clone, shake or bump. The stamp and label change with a 1 ms transition, and the toast still appears.

### 5.3 Stub with details (C2)
The `…` button (detail page) or a 550 ms long-press on the card quick action opens a sheet. On mobile it is a bottom sheet; at ≥ 640 px it is a centered 440px dialog. It contains:
- **Watched on**: a date input. It defaults to today; `max` = today, `min` = Jan 1 of (release year − 1).
- **Where**: a segmented control (Cinema · Streaming · TV · Other).
- **Note**: up to 280 characters, with a counter.
- Buttons: [Cancel] and [Stub it] (primary).

The sheet uses a native `<dialog>`, which provides the focus trap, Esc to close, and focus return to the trigger.

### 5.4 Count language
- **0**: "Stub it", with the line "Not stubbed yet. One tap when you've watched it."
- **1+**: "Stub again". The stamp and pill read "N× STUBBED" / "N×", with the line "Last stub Sep 12, 2026".
- In the diary, each row shows `#N`, meaning which watch this was.
- On the profile: "×7 · The Bear · most stubbed".

---

## 6. Component inventory

| Component | Spec |
|---|---|
| **Button** | Pill. 44px default, 56px `lg` (the detail CTA), 36px `sm` (inside forms only, 44px hit area kept via padding). Variants: `primary` (accent), `ghost` (6% white with a `--line-2` border), `icon`. Press state scales to .97. |
| **Segmented control** | A pill track with an active segment in `--fg` bg and `--bg` text. `role=group` and `aria-pressed` on each button. Used for type filter (All/Movies/Shows), review source, and where-watched. |
| **Sort select** | Native `<select>` in a pill, with a chevron pseudo-element. Options exactly as in A2-AC1: "Release date · newest", "Release date · oldest", "Rating · highest", "Rating · lowest". The value syncs to `?sort=`. |
| **Chip** | 28px outline pill, used for genres. |
| **Tag** | 20px mono label with a 5px radius. Examples: `STUB #2`, `EDITED`, `IMDb ✓` (yellow), `BELOW 6.5 NOW`. |
| **Score chip** | Glass panel with a big number and a two-line source label: `TMDB · 6.9k votes`, `IMDb 8.5 · IMDb rating via OMDb` (P1), and `Stubbed` (the community average appears only once there are 5+ ratings; before that it reads "N reviews · avg unlocks at 5"). |
| **Star input** | 5 stars × 2 half-hit targets (10 radios, `role=radiogroup`). Arrow keys step by half-stars. Required (D1-AC1). It shows "4.5/5" beside the stars, and the value is stored as 1–10. |
| **Review card** | Avatar (gradient initials), `@handle`, stars, date, tags, body (max 68ch). Spoiler reviews render the body with `filter: blur(7px)`, `user-select:none`, and `aria-hidden` on the blurred text, plus a "Show spoiler" button (A6-AC2). |
| **Toast** | Light (`--fg` bg, `--bg` text) for maximum pop on dark screens. Includes a ticket icon, a message, and an optional action in `--stamp`. `role=status`. At most 2 stacked. Duration 2.6 s, or 5 s with an action. |
| **Sheet / dialog** | Native `<dialog>`. Bottom sheet on mobile (with a grab handle); centered dialog at ≥ 640. Backdrop: 55% black with 4px blur. |
| **Tabs** | Profile sections, using `role=tablist`. The active tab gets a 2px accent underline. |
| **Demo pill** | Mono 11px "● DEMO DATA" in `--warn` on 10% warn, shown in the header on every page when fixture mode is active (E2). Its tooltip reads "No API keys found — running on bundled demo data". |
| **Avatar** | Circle. Default is a 135° gradient between two colours hashed from the handle, with initials in ink. |
| **Empty state** | Dashed `--line-2` border, `--r-lg`, an outline ghost-ticket icon, an h3, one line of copy, and one CTA. |
| **Skeleton** | Same geometry as the real component, `--surface`/`--surface-3`, with a 1.3 s shimmer. |
| **Attribution block** | See §8. |

---

## 7. Screens

For each screen: routes, layouts at mobile 375 and desktop 1440, and states. "Adaptive bg" means the background from §4.

### 7.1 Home / Discover — `/` (A1, A3, D5)
- **375**:
  - Header (logo, demo pill, avatar).
  - Hero: eyebrow "MOVIES + SHOWS · RATED 6.5 AND UP", display-xl "Only the *good* stuff." ("good" is outlined), and a subline.
  - "Trending this week" rail of `ticket/rail` cards (62vw, snap). This is the popularity sort, home only.
  - "Browse" section: search field (full width), segmented All/Movies/Shows (full width), sort select (full width), and a result count "14 titles · 6.5+ only" in mono. None of these are sticky on mobile, to save vertical space.
  - 2-column `ticket/grid`.
  - Bottom tab bar: Discover · Search · Wallet (with count badge) · You.
- **1440**:
  - Top nav (Discover · Now showing · Stub wallet + badge), a 420px header search, and the demo pill.
  - The hero runs across 12 columns at 120px.
  - The rail shows 5 visible cards (250px).
  - The toolbar is **sticky under the header** (glass) and holds the segment, sort and count on one row.
  - Grid: 5 columns (6 at ≥ 1380), 24px gap.
- The adaptive bg follows hover/focus.
- **URL state**: `?type=movie|tv&sort=release_desc|release_asc|rating_desc|rating_asc&page=N` (A2-AC3, A3-AC1). Pagination is infinite scroll with a "Load more" button as the fallback, plus `page` in the URL.
- **States**:
  - Loading: skeleton rail of 6 plus a skeleton grid of 10.
  - Empty filter: "Nothing here yet. Try All or a different sort." [Reset filters].
  - Error: "The projector jammed. We couldn't load titles." [Try again]. The last good results stay visible if cached.
  - Offline: a banner reading "You're offline — showing what we saved."

### 7.2 Filters + sort
- Type filter and sort are always visible (no hidden filter drawer in the MVP).
- P1 genre and year filters: a "Filters" ghost button opens a sheet with multi-select genre chips and a year-range pair of selects, plus [Clear] and [Show N titles]. On desktop the same sheet renders as a 360px popover anchored to the button. The active filter count shows on the button ("Filters · 2").
- The rating sort shows a mono hint: "Ties broken by vote count" (A2-AC4).

### 7.3 Search — header field (desktop) · Search tab (mobile)
- Desktop: typing opens a 480px dropdown under the header field with up to 6 results as `ticket/row` compact rows (thumb, title, year, type, rating), and "See all results" at the bottom. Keyboard: ↑↓ to move, Enter to open, Esc to close; it follows the combobox ARIA pattern.
- Mobile: the Search tab opens a full-screen view with an auto-focused field, recent searches (local), and results as a 2-column grid.
- Matching is accent- and case-insensitive ("shogun" finds "Shōgun").
- **Not in catalogue** (A4-AC2): empty state "**Not in Stubbed** — we only list titles rated 6.5+." [Clear search]. It is never styled as an error.
- Loading: 3 skeleton rows after 150 ms (no flash for fast responses).

### 7.4 Title detail — `/title/{movie|tv}/{id}-{slug}` (A5, A6, C1–C3, D1–D3)
- **375** (single column):
  - Breadcrumb.
  - `ticket/hero` centered at 58vw (max 250).
  - Eyebrow "MOVIE · 2024 · 2H 46M" (a show reads "SHOW · 2022 · 4 SEASONS"), then the display-l title and genre chips.
  - Score chips (wrap).
  - **Action row**: [Stub it] (primary, lg, grows to fill), [⋯] (details sheet), [Watchlist].
  - Stubbed line: "2× STUBBED · Last stub Sep 12, 2026".
  - Overview (body-l).
  - Facts grid, 2×2: Director / Creators, Released / First aired, Runtime / Seasons, Trailer.
  - Top cast: a horizontal scroll of 6 (64px initials or TMDB `w185` profile images).
  - Reviews.
  - Footer.
- **1440** (12 columns):
  - The ticket spans columns 1–4 (max 380px) and is **sticky** 24px under the header.
  - The info spans columns 6–12, with the title at up to 104px.
  - Facts become a 4-across row.
  - Reviews continue in the right column.
- The adaptive bg is SSR'd from `palette`.
- **States**:
  - Loading: ticket skeleton, 3 text bars, and a disabled CTA.
  - 404 (A5-AC4): a centred empty state, "This ticket doesn't exist", [Back to Discover], on a neutral tint.
  - Title below the rule (D4): a notice under the eyebrow: "This title dropped below our 6.5 bar. Your stubs are safe."
  - No IMDb ID: the IMDb chip and the IMDb assist are hidden (D3-AC1).
- **SEO/OG** (A5-AC3): `og:image` is the poster `w780`, or the v1 share ticket.

### 7.5 Reviews (on the title page) + composer (D1–D3)
- Header "Reviews". A segmented control switches "On Stubbed · N" / "From TMDB · N", and a sort select offers Newest / Highest rated.
- **Composer** (logged-in; logged-out users see "Sign in to review" with the same frame):
  - "Write a review" or "Your review" (edit mode, prefilled per D1-AC2).
  - Star input (required), textarea (5,000 max, with a counter "108 / 5,000"), and a "Contains spoilers" switch.
  - [Post review] or [Update review].
  - Saving with no stubs triggers the toast "Review saved. Add a stub too?" [Add stub] (D1-AC4, default action).
  - **"Also post on IMDb" block** (inside the composer, under the form, dashed border; only when `imdb_id` exists):
    - Button: `[IMDb] Also post on IMDb ↗` (ghost, sm).
    - Helper copy, verbatim from D3-AC3: *"IMDb doesn't allow apps to post for you. We've copied your review — paste it on IMDb."*
    - On click:
      1. `navigator.clipboard.writeText(body)`. On failure, select the textarea and toast "Press Ctrl/⌘+C, then paste on IMDb."
      2. Toast "Copied. Paste it on IMDb."
      3. `window.open('https://www.imdb.com/title/{imdb_id}/reviews/', '_blank', 'noopener')`.
      4. Reveal the inline row "Did you post it?" [Yes, mark as posted] [Not yet].
    - **Yes** stores `imdb_shared_at` and shows the tag `IMDb ✓` on the review (D3-AC4). The app never sets it automatically.
    - If the body is empty, the button toasts "Write something first — we copy your text for you."
    - Analytics: `imdb_assist_clicked`.
- **List**: Stubbed reviews first, the user's own review pinned at the top (D1-AC3, with the `EDITED` tag if changed), and `STUB #N` if the review is linked to a stub. The TMDB tab lists read-only reviews with a TMDB mark and author name, followed by the line "Reviews from TMDB community members. Read-only."
- **Empty** (A6-AC3): "No reviews yet. Be the first to review {title}. Stars are enough — words optional." [Be the first to review] focuses the composer.
- **Delete** (D2): the owner gets a "⋯" menu with Edit and Delete. Delete asks "Delete your review? This can't be undone." [Cancel] [Delete] (danger).

### 7.6 Auth — sheet over the current page, plus `/signin` and `/signup` fallbacks (B1, B2)
- **375**: a bottom sheet (full-height on small screens).
- **1440**: a centered 440px dialog over the dimmed, still-tinted page. Direct URLs render the same card centered on the default tint.
- **Sign up**:
  - Title "Get your first stub".
  - Fields: email, password (show/hide; the hint "8+ characters" shows on focus), handle with an `@` prefix, live availability ("@maya is taken"), and the rule "3–20 · a–z, 0–9, _".
  - [Create account] (primary, full width).
  - "or" divider, then [Continue with Google] (P1) and [Email me a magic link].
  - Footer: "Already stubbing? Sign in".
- **Sign in**: email, password, [Sign in], "Forgot password?" (which sends a magic link). An error sits above the button (generic, B2-AC1): "That email and password don't match." `aria-live=assertive`.
- **Inline validation**:
  - Errors run on blur, then live after the first error.
  - Error text is `--danger` with an icon, linked by `aria-describedby`.
  - Duplicate email: "An account with that email already exists. Sign in instead?"
- **Resume**: after auth, close the sheet and replay the pending action (stub, review, watchlist) with its normal feedback. The flow returns to the originating URL (B1-AC3).
- **Demo mode**: a banner inside the sheet reads "Demo mode — accounts are stored in this browser only."

### 7.7 Profile / Stub wallet — `/u/{handle}` (B3, C5)
- **Header**:
  - 84px gradient avatar, display-l name, `@handle · stubbing since 2022` (mono).
  - Bio.
  - Owner-only [Edit profile] ghost button, which opens a sheet with display name, bio (160 characters) and avatar (upload, or regenerate the gradient). The handle is read-only (B3-AC2).
- **Stats** (glass tiles): Total stubs · Stubs in {year} · Rewatches · "×7 · The Bear most stubbed".
  - 375: 2×2 grid under the header.
  - 1440: 4 across, right-aligned beside the name.
- **Tabs**: Stub wallet · Diary · Reviews · Watchlist (Watchlist is visible to the owner only).
  - **Wallet**: a grid of `stub/torn` (2 / 3 / 4 / 5 columns), one per title, newest first, stacked for rewatches. Tap goes to the title page.
  - **Diary**: see 7.8.
  - **Reviews**: review cards, each with a title link eyebrow.
  - **Watchlist**: a `ticket/grid`.
- The adaptive bg uses the latest stub's title.
- **Share** (v1): a [Share wallet] button that generates a 1080×1920 "wallet" image.
- **States**:
  - Empty wallet: "Your wallet is empty. Every watch earns a stub. Find something good and tap Stub it." [Browse 6.5+ titles]. Viewers of someone else's empty profile see "@maya hasn't stubbed anything yet."
  - Unknown handle: 404 "No one's holding that ticket."
  - Loading: 8 torn-stub skeletons.

### 7.8 Watch history / My stubs — `/me/stubs` (C4, C5) (also the "Diary" tab)
- Filter: segmented All / Movies / Shows, plus the count "20 stubs".
- Groups by month: "September 2026 · 4 stubs" (h3 with a mono count).
- Rows are `ticket/row`:
  - **375**: date (day number plus weekday), 44px thumb, title + "MOVIE · 2024 · REWATCH", perforation, and a 92px stub showing `#3 STUB`.
  - **1440**: adds a "where" column (STREAMING, CINEMA…) and a note preview, and widens the stub to 110px.
- The row menu (⋯ on hover/focus; swipe-left reveals it on mobile) offers Edit (the same sheet as C2, prefilled) and Delete. Delete asks "Delete this stub? Dune: Part Two will show 2× stubbed." (C4-AC1).
- **Export** lives in Settings (Export: [Letterboxd CSV] [JSON], D4). The diary shows a small link "Export my stubs".
- **Empty** (C5-AC2): "No stubs yet. Your diary fills up one watch at a time." [Browse titles].

### 7.9 Supporting pages
- **Settings** `/me/settings`: profile, account (email, password), **Export** (two buttons plus the one-line explanation "Letterboxd CSV imports straight into Letterboxd"), Connected services (v1 Trakt, shown disabled with "Coming soon"), and Sign out.
- **About / Credits** `/about`: mission, the full TMDB notice and logo, the OMDb credit, JustWatch (v1), a statement on "Why we can't post to IMDb for you" (plain language, from PRD §11), and a data/privacy summary.
- **404**: a ticket-shaped empty state reading "Wrong screen. This ticket doesn't exist." [Back to Discover].

---

## 8. Attribution placement (required)

| Where | What |
|---|---|
| **Global footer (every page)** | The official **TMDB logo** (download from TMDB's "Logos & Attribution" page and use as supplied. The prototype's teal gradient pill is a placeholder, not a redraw to ship). Next to it: "This product uses the TMDB API but is not endorsed or certified by TMDB." Also "IMDb ratings via OMDb." Links: About · Credits · Export my data · Privacy. The TMDB logo is smaller than the Stubbed logo (per TMDB guidance). |
| **About / Credits page** | The full notice and logo with a link to themoviedb.org, the OMDb credit, and v1 JustWatch. |
| **Title page score chip** | The source label "TMDB" printed on the chip. The IMDb chip reads "IMDb rating · via OMDb" (E1). |
| **Ticket stub** | The label "TMDB" next to every score. |
| **TMDB reviews** | A TMDB mark plus "review" on every item, and a footer line "Reviews from TMDB community members. Read-only." |
| **Share images (v1)** | "Poster: TMDB" micro-credit. |
| **Where to watch (v1)** | "Powered by JustWatch" on the module. |

Open item for the Architect/legal: confirm that IMDb's brand rules allow the yellow "IMDb" chip. If not, fall back to a neutral outlined text label "IMDb".

---

## 9. Accessibility (WCAG 2.1 AA baseline, E4)

- **Contrast**: the §2.1 table and the §4.4 guarantee. Text on paper uses `--ink` / `--ink-2` only.
- **Keyboard**:
  - Every ticket is one Tab stop for the link and one for the stub button.
  - Rails are reachable by Tab; the focused card scrolls into view (`scroll-margin`).
  - The star input uses arrow keys.
  - Sheets are native `<dialog>` (focus trap, Esc, focus return).
  - Skip link: "Skip to content".
- **Focus**: 2px `--accent` outline at 3–4px offset, never removed. Tickets use `:has(:focus-visible)` to ring the whole card.
- **Names**:
  - Ticket link: "{title}, {movie|show}, {year}, rated {x} on TMDB".
  - Stub button: "Stub it: {title}" or "Stub again: {title} (N× stubbed)".
  - Poster `<img alt="">` is decorative (the name is on the link). On the detail page the poster `alt` is "Poster for {title}".
- **Live regions**: toasts use `role=status`; the result count and stub line use `aria-live=polite`; auth errors use `assertive`.
- **Motion**: `prefers-reduced-motion` is fully honoured (§2.6, §5.2). Haptics are only an enhancement.
- **Targets**: ≥ 44×44px (hit-area pseudo-elements on small pills). Bottom tab items are 48px tall with safe-area padding.
- **Spoilers**: blurred text is `aria-hidden="true"` until revealed, so screen readers don't leak it. The button is announced as "Show spoiler".
- **Zoom/reflow**: layouts reflow at 320px width and 200% zoom without horizontal scroll. Display type uses `clamp()` and `text-wrap: balance`.
- **Language**: `lang="en"`, and all strings go through i18n keys (PRD §10). Avoid text baked into images, except that share images get localised at render time.

---

## 10. Copy tone

**Voice**: a friend who works at the indie cinema. Confident, short, a little cheeky, never snarky about someone's taste. Use the verbs "stub", "stubbed" and "stub again". Sentence case everywhere, except MONO PRINT on tickets. No exclamation marks in errors. "Stubbed. Painless." energy.

| Moment | Copy |
|---|---|
| Hero | "Only the good stuff." / "Every title here clears 6.5 on TMDB. Watch it, stub it, keep the proof." |
| Primary CTA | "Stub it" → "Stub again" |
| Stub toast | "**3× stubbed** · Dune: Part Two" [Undo] |
| Same-day | "Stub again today? Double feature? It'll count as another watch." |
| Not stubbed | "Not stubbed yet. One tap when you've watched it." |
| Search miss | "Not in Stubbed — we only list titles rated 6.5+." |
| Empty wallet | "Your wallet is empty. Every watch earns a stub." |
| Empty reviews | "No reviews yet. Be the first to review {title}. Stars are enough — words optional." |
| IMDb assist | "IMDb doesn't allow apps to post for you. We've copied your review — paste it on IMDb." / "Did you post it?" |
| Review needs rating | "Pick a star rating first — half stars are fine." |
| Network error | "The projector jammed. We couldn't load titles." [Try again] |
| Stub failed | "Couldn't save that stub. Try again." [Retry] |
| Rate limit | "Easy — that's a lot of stubs in a minute. Try again shortly." |
| Below threshold | "This title dropped below our 6.5 bar. Your stubs are safe." |
| 404 | "Wrong screen. This ticket doesn't exist." |
| Demo pill | "DEMO DATA" — tooltip "No API keys found — running on bundled demo data" |
| Sign-up title | "Get your first stub" |

---

## 11. Handoff notes

- **Hooks for QA**: the prototype uses `data-ticket`, `data-stub`, `data-focus` and `data-count`. Keep equivalent `data-testid`s in the app: `ticket-{id}`, `stub-button`, `stub-count`, `sort-select`, `type-filter`, `review-composer`, `imdb-assist`, `demo-pill`, `toast`.
- **CSS**: tokens as custom properties in a global stylesheet. The ticket mask and adaptive background are plain CSS with no JS dependency (JS only swaps the `--tint-*` vars and the LQIP). Tailwind is fine; keep the mask and keyframes in a component CSS module.
- **Images** (E3): TMDB `w342` in grids (`w185` for rows), `w500` for the detail ticket, `w780` backdrop / OG, `w92` for extraction only. Always set `width`/`height` so CLS stays < 0.1. The adaptive bg uses the inline LQIP, so it causes zero CLS and zero requests.
- **Performance**: `drop-shadow` filters on up to about 30 visible tickets are fine. Beyond that, virtualise the grid. Use `content-visibility:auto` on off-screen grid rows.
- **Fonts**: preconnect to fonts.gstatic.com and subset to Latin + Latin-ext. The fallback stack is system-ui, and the layout must not depend on font metrics (set `size-adjust` fallbacks via `next/font` or equivalent).
- **Prototype fidelity**: posters in `prototype.html` are CSS art stand-ins, because external images can't load in the build container. Reviews and overviews are placeholder copy. Palette values are hand-picked to mimic the extraction output.
