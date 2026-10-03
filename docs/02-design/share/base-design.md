# C-08 Share ticket — candidate 1 "Literal ticket"

The share image **is** a physical cinema ticket. Cream paper (`--paper #EFE9DE`), the poster printed as the ticket's art
panel, two punched notches, a dashed perforation, a torn edge where it came off the roll, `ADMIT ONE`, a serial, and the
red `N× STUBBED` rubber stamp. Everything is lifted from DESIGN §2–§3. Only the scale changes: the in-app 14px radius
and 12px notch become 28/28 at 760px wide.

Sources: DESIGN.md §2.1 tokens, §3.1 anatomy, §3.5 share brief, §4 palette/contrast, §8 attribution; PRD §5 v1
"Share ticket images", §8 loop 1, F5 (Observed). Files: `ShareCard.tsx` (renderer), `preview.html` (1:1 mock).

---

## 1. Shared rules

| Rule | Value |
|---|---|
| Fonts (local TTF, passed in) | Bricolage Grotesque 800 (display), Geist 400/600 (UI), Geist Mono 500/700 (print). Satori ships no woff2 or variable fonts, so we need **static TTF instances** cut from `src/app/fonts/*-Variable.woff2`. Both are OFL. See §8. |
| Paper | `#EFE9DE` body. Rewatch layers `#E3DCCD` / `#D6CEBD`. |
| Ink on paper | `#141210` (16:1), `#5E584F` print (5.8:1), stamp `#B02E17` (5.3:1). |
| Ground | `#0B0B0D` plus palette tints (§5). Only `--fg #F4F1EA` and `--fg-2 #BDB8AE` sit on the ground. |
| Accent `#FF5B3A` | One use only: the dot in the wordmark. Stamps and stars use `--stamp`, because accent on paper is about 2.5:1. |
| Glyphs | Use only Latin-1 plus `– … ' ' " "`. Stars, the IMDb mark and the stub icon are inline SVG/divs, so Satori never falls back to fetching an emoji or a font (that would be a network call at render time). The serial prints `N°` rather than `№`, because U+2116 is not guaranteed in Geist Mono (Unverified). |
| Ticket silhouette | One inline SVG data-URI per format: the paper path with rounded corners, true **transparent notches**, the torn edge, the perforation dashes and the drop shadow. Text and poster are Satori layers on top. This avoids depending on Satori's `mask-image`. |
| Attribution | `POSTER: TMDB` (mono, `--fg-2`) whenever a TMDB poster is drawn. It is dropped for the palette fallback. The TMDB and IMDb labels stay next to their numbers (DESIGN §8). No other third-party marks. |

---

## 2. Story — 1080 × 1920 (stub share, first watch)

Safe zones: IG/TikTok UI covers about y 0–200 (progress bar and avatar) and y 1720–1920 (reply bar). Everything the
viewer must read sits in **y 200–1700**. The wordmark and short link sit in the overlap bands, because they repeat
the link sticker the user adds.

```
y   72 ┌ Stubbed• (Bricolage 800 40, x 80)            JUST STUBBED (mono 500 20, fg-2, right x 1000) ┐
   200 │        ╭──────────────── ticket 760 × 1436, x 160–920 ────────────────╮
   220 │        │ ┌──── art panel 720 × 1080 (2:3), inset 20, r 14 ────┐       │
   244 │        │ │ [MOVIE] pill             [1× STUBBED] stamp ↻4°     │       │
       │        │ │                POSTER (objectFit cover)             │       │
  1300 │        │ └─────────────────────────────────────────────────────┘       │
  1320 │        ◖ - - - - - - - - perforation 3px, dash 14/10 - - - - - - - - - ◗  notches r 28
  1348 │        │ ADMIT ONE  N° 01200                         STUB #1          │  mono 500 20, +.14em, ink-2
  1384 │        │ Dune: Part Two                                                │  Bricolage 800 56 / −.035em (steps §6)
  1466 │        │ 8.2 TMDB   [IMDb 8.5]                        2024 / MOVIE    │  score Bricolage 800 88; meta mono 22
       │        │                                              2H 46M          │
  1572 │        │ @maya                                 WATCHED 03 OCT 2026     │  Geist 600 24 ink · mono 500 20 ink-2
  1620 │        ╰╲╱╲╱╲╱╲╱╲╱╲╱╲╱╲╱  torn edge, teeth 20 wide × 16 deep  ╲╱╲╱╲╱╲╱╲╱╯ 1636
  1668 │                         POSTER: TMDB  (mono 500 18, fg-2, centre)
  1756 └              stubbed.app/s/k3x9q  (mono 500 30, fg, centre)                                  ┘
```

| Element | Box (px) | Type | Colour |
|---|---|---|---|
| Wordmark | x 80, y 72, h 48 | Bricolage 800 40, −.035em | fg. The dot is accent (8×8). |
| Eyebrow | right edge x 1000, y 86 | Geist Mono 500 20, +.14em, upper | fg-2 |
| Ticket | x 160, y 200, 760 × 1436 | — | paper, shadow `0 36 56 rgba(0,0,0,.5)` plus `0 4 8 rgba(0,0,0,.35)` (in SVG) |
| Art panel | x 180, y 220, 720 × 1080, r 14 | — | poster `w780` (pre-fetched) or fallback (§7) |
| Type pill | x 204, y 244, h 44, pad 0 16, r 999 | Mono 500 20, +.1em | fg on `rgba(0,0,0,.45)` plus 1px `rgba(255,255,255,.18)` |
| Stamp | right 204, y 248, pad 10 16, border 4, r 8, rotate 4° | Mono 700 30, +.1em | stamp on paper |
| Perforation | y 1320, x 200–880 | 3px, dash 14 / gap 10 | `rgba(20,18,16,.26)` |
| Notches | circles r 28 at (160,1320) and (920,1320) | — | transparent (the ground shows through) |
| Print row | x 200–880, y 1348 | Mono 500 20, +.14em | ink-2. `STUB #N` right-aligned, ink. |
| Title | x 200–880, y 1384, 1 line, ellipsis | Bricolage 800 56/1, −.035em | ink |
| Score | x 200, baseline y ≈ 1546 | Bricolage 800 88/1, −.04em, plus `TMDB` mono 500 20 | ink / ink-2 |
| IMDb chip | after score, gap 28 | yellow block `#F5C518` h 40 r 6 with `IMDb` Geist 600 22 black, plus `8.5` mono 700 30 ink | Omitted when unknown, with no gap left behind |
| Meta | right x 880, 3 lines | Mono 500 22/1.35, +.08em, upper | ink-2 |
| Foot | y 1572 | `@handle` Geist 600 24 ink · date Mono 500 20 ink-2 | — |
| Credit | centre, y 1668 | Mono 500 18, +.12em | fg-2 |
| Short link | centre, y 1756 | Mono 500 30, +.02em | fg |

**Show (TV)**: the print row reads `S01–S04` in place of `ADMIT ONE` (DESIGN §3.1), the pill reads `SHOW`, and the meta reads `2022 / SHOW / 2 SEASONS`. The v1 episode stub reads `S2 · E5`.

---

## 3. Rewatch (N ≥ 2)

- The stamp becomes `N× STUBBED`, and the eyebrow becomes `REWATCHED`, or `REWATCHED · N×` when N ≥ 3.
- `STUB #N` prints in stamp red, not ink. That is the one fact that changed.
- **Stacked paper**: the stub-wallet stack (DESIGN §3.2 `stub/torn`), drawn behind the ticket. Layer 1 is
  `#E3DCCD`, offset (+14, +18) and rotated +1.6°. Layer 2 (only when N ≥ 3) is `#D6CEBD`, offset (−12, +34) and rotated −1.8°.
  Both use the same silhouette SVG, without perforation or shadow. There are never more than 2 layers, whatever N is.
- The foot reads `@maya · 3RD TIME` and `WATCHED 03 OCT 2026`. Ordinals are generated in English.

## 4. Review share (story)

The art panel crops to **720 × 900** (4:5, `objectPosition: top`), so the stub grows to 480. The total ticket height is unchanged.

```
1120 art bottom · 1140 perforation
1168 ADMIT ONE  N° 01200                     REVIEW · STUB #2
1204 Dune: Part Two                                   (Bricolage 800 48)
1270 ★★★★½  4.5/5                                     (5 SVG stars 52px, stamp red; mono 700 28 ink)
1346 "Villeneuve stages sand like scripture. The worm ride alone is worth the ticket."
     (Geist 400 30/1.38 ink, max 4 lines, curly quotes)
1540 TMDB 8.2 · IMDb 8.5 · 2024 · MOVIE              (mono 500 20 ink-2)
1580 @maya                                 WATCHED 03 OCT 2026
```

- **Quote**: at most 140 characters. Collapse whitespace, cut at the last word boundary at or below 139 characters, then add `…`. The quote is optional. With no text, the stars row moves to y 1300 at 84px and the TMDB line follows it.
- **Spoiler-safe**: when `review.spoiler === true`, the text is **never passed to the renderer**. `ShareCard` takes `quote: null`, and its type has no field that can hold the spoiler body. The quote slot prints `SPOILERS INSIDE — READ IT ON STUBBED` (mono 500 22, ink-2, dashed 2px box). The server builds the props with `review.spoiler ? null : review.body`, and a unit test asserts that a spoiler body never reaches the props.
- **Rating only** (no text): the stars are the hero.
- The eyebrow reads `JUST REVIEWED`.

## 5. Colour derivation (from `titles.palette`, DESIGN §4)

| Layer | Recipe | Bound |
|---|---|---|
| Ground | `#0B0B0D`, `radial(55% 45% at 18% 8%, tint1, transparent 70%)`, `radial(50% 55% at 88% 22%, tint2, transparent 72%)`, `linear(180°, tint2, #0B0B0D 78%)` | tint1 Y ≤ 0.06, tint2 Y ≤ 0.02 (already clamped at ingest) |
| Scrim | `linear(180°, rgba(11,11,13,.35) 0%, .55 60%, .80 100%)` | — |
| Art fallback | `linear(160°, tint1, tint2)` plus `radial(70% 50% at 30% 10%, vibrant @ 35% alpha)` | the title text sits in the bottom 40%, where only tint1/tint2 reach |
| Paper colour strip | none. The paper stays cream on every share, as in the app. | — |

**AA proof (Inferred, worst case, linear light).** The brightest ground pixel is tint1 at Y 0.06 with no scrim.
That gives `--fg` (Y 0.88) (0.88+0.05)/(0.06+0.05) = **8.5:1** and `--fg-2` (Y 0.48) **4.8:1**, both ≥ 4.5 before
the scrim darkens anything. Text on paper uses the fixed ink tokens (5.3–16:1). Text on the art panel (pill and title fallback) sits on its own
`rgba(0,0,0,.45)` pill, or on the tint1→tint2 fallback (white on Y ≤ 0.06 gives ≥ 9.5:1). `ShareCard` re-clamps defensively:
it runs `clampY(tint1, .06)` and `clampY(tint2, .02)` from `src/lib/palette.ts`, so an unclamped palette can never ship.

## 6. Long and missing content

| Case | Behaviour |
|---|---|
| Title length (story) | ≤ 16 chars: 56px · ≤ 24: 46 · ≤ 32: 38 · longer: 38 with a JS-truncated `…`. Always 1 line. The full title is in the art or in the link preview. |
| No IMDb | The chip is not rendered. |
| No year / runtime | That meta line is skipped. The meta block is bottom-aligned so it never leaves a hole. |
| No watch date (imports) | `DATE NOT LOGGED` |
| Handle hidden (user toggle) | The foot prints `ADMIT ONE` in its place. |
| No poster | Palette art (§5) with the title set in Bricolage 800 96/.86 uppercase white, bottom-left inset 48, plus `N° serial` mono at the top. **No TMDB credit.** |
| No palette | Genre default tints (DESIGN §4.3), then `#2a2a33 / #101014`. |
| No poster and no palette | Neutral default plus title type. It still reads as a ticket. |
| Poster fetch fails at render | Never fetched at render. The route pre-fetches `w780` with a 3 s timeout and passes a data URI or `null`. `null` goes to the fallback. |
| Not logged in / no stub | No share is possible. The route returns 404. |

## 7. Link preview og:image — 1200 × 630

A horizontal ticket (DESIGN `ticket/row` scaled up), with the stub on the **right** and the torn edge on the far right.

```
     ┌──────────────────────────── ground (same palette recipe) ─────────────────────────────┐
  44 │  ╭──────────── ticket 1080 × 500, x 60–1140, y 44–544 ─────────────────◠──────────╮   │
     │  │ ┌ art 300×460 ┐  ADMIT ONE  N° 01200                         ┊ [3× STUBBED]   ╲  │
     │  │ │ x 80, y 64  │  Dune: Part Two          (Bricolage 800 64/1, 2 lines)       ┊  STUB         ╱ │
     │  │ │  2:3 poster │  2024 · MOVIE · 2H 46M   (mono 500 22 ink-2)          ┊  #3   (B 800 96)╲ │
     │  │ │             │  8.2 TMDB  [IMDb 8.5]    (score B 800 72)              ┊               ╱  │
     │  │ │             │  @maya  WATCHED 03 OCT 2026 (Geist 600 24 / mono 18)┊ ADMIT ONE      ╲ │
     │  │ └─────────────┘                                               ┊ stubbed.app•   ╱  │
 544 │  ╰─────────────────────────────────────────────────────────────◡──────────╯   │
 586 │  POSTER: TMDB (mono 500 16, fg-2, x 60)                    stubbed.app/s/k3x9q (mono 500 20, fg, right x 1140) │
     └────────────────────────────────────────────────────────────────────────────────────────┘
```

| Element | Box | Notes |
|---|---|---|
| Ticket | x 60, y 44, 1080 × 500, r 24 | Notches r 24 at (x 860, top) and (x 860, bottom). Vertical perforation x 860, y 36–464. Torn right edge, teeth 20 tall × 14 deep. |
| Art | x 80, y 64, 300 × 460 (≈2:3), r 12 | Poster or fallback. |
| Body | x 412–828 | Print row y 84 · title y 118 (64/1, max 2 lines; >28 chars → 52) · meta · score row · foot pinned to bottom y 500. |
| Stub | x 884–1104 | Stamp at the top (rotate 4°) · `STUB` mono 500 20 plus `#N` Bricolage 800 96 · `ADMIT ONE` / `S01–S04` · wordmark at the bottom. |
| Review OG | The score row becomes 5 stars (40px) plus `4.5/5`, and the eyebrow becomes `REVIEWED`. **No quote on OG** (no room for 140 chars at AA sizes, and `og:description` carries the text, spoiler rule included). |
| Rewatch OG | `#N` in stamp red, stamp `N×`, one paper layer peeking 10px below the ticket (offset y +10, rotate +0.8°). |

The F5 `og:description` stays text and is not part of this image.

## 8. Implementation notes

- `ShareCard.tsx` exports `ShareStory`, `ShareOg`, `renderShareImage(props, format, fonts)` and `loadShareFonts(dir)`.
  It needs the **Node runtime** (for `fs`). The route is `app/s/[code]/opengraph-image.tsx` plus `/api/share/[stubId]?f=story`.
- Fonts: about 5 TTFs at roughly 60–110 KB each. Cut them once with `fonttools varLib.instancer` (`wght=800` etc.) and subset them to Latin plus `– … ' ' " " × · °`.
  Keep the total under the 500 KB bundle cap (Observed: next docs `image-response.md`). Shortcut: Latin subset only. Ceiling:
  non-Latin titles render in the fallback. Upgrade trigger: the first non-Latin locale.
- Cache: key the PNG by `(stubId, rewatchN, reviewUpdatedAt, palette.v)`, with `Cache-Control: public, max-age=31536000, immutable`
  on a versioned URL. An edited review creates a new URL.
- Analytics: `share_generated { format, kind: stub|rewatch|review }`, with no user id (PRD §9).

## 9. Accessibility

- The image is not the only carrier of information. The Web Share payload text is `"I stubbed Dune: Part Two (2024) — stubbed.app/s/k3x9q"`.
  The in-app preview `<img alt>` reads the same, plus the star rating ("rated 4.5 of 5").
- Minimum text in the image is 18px at 1080 width. That is about 6.5pt on a 390pt phone, which is decorative print only, matching DESIGN §2.2. Every fact that matters is ≥ 20px.
- No information is carried by colour alone. The rewatch shows `N×` and `#N` as text, not just red.

## 10. Verification (done for this candidate)

- `ShareCard.tsx` was rendered through the repo's own `next/og` ImageResponse (Satori + resvg, via esbuild in the scratchpad)
  for 5 story and 5 OG cases. The PNGs are in `renders/`. They used the bundled Geist-Regular for every family, because static TTF
  instances are not in the repo yet, so the weights and display face in the PNGs are not final.
- `preview.html` is generated from the same JSX with `react-dom/server` and uses the repo's variable woff2 fonts through `file://`.
  It was checked in Chromium headless. Nothing loads from the network.
- Not verified: `tsc` against the app tsconfig, glyph coverage of the final subset fonts, and the real TMDB poster crop.
