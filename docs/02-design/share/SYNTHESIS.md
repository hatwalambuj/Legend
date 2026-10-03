# Share ticket (C-08) — arena synthesis

Arena: 3 candidates (C1 literal ticket · opus, C2 poster-first editorial · sonnet, C3 stub collection · opus), judge on sonnet.
Judge scores (brand / shareability / Satori viability / correctness-privacy / maintainability):
C1 23 · C3 19 · C2 16. Orchestrator's own read agreed.

## Base: C1 "Literal ticket"
Only candidate that is the DESIGN §3 ticket itself and was rendered through the repo's `next/og` for all 10 cases
(first, rewatch, review, spoiler, no-poster × story 1080×1920 / og 1200×630). Base code: `ShareCard.base.tsx`, spec: `base-design.md`.

## Grafts (frontend-dev implements into src per ADR-013 C-08)
1. From C3: for rewatches (stub #≥2) a big Bricolage numeral headline above the ticket — "3×" + "THIRD WATCH · @handle".
2. From C2: safe frame — keep all content inside y 250…1580 on the story (top 250 / bottom 340 clear for IG/TikTok UI).
3. From C2: tiered title sizes by length (≤14 chars / ≤28 / longer) with 2-line clamp + ellipsis.
4. From C2: review quote rules — collapse whitespace, cap 140 chars with "…", omit if spoiler-flagged or empty, never fall
   back to another review; star rating rendered in ink on paper (AA).
5. Fix in C1: move the short link up out of the reply-bar zone (≤ y 1580 with the safe frame).

## Rejected
- C3 fanned stack of other recent titles: leaks unrelated watch history into a single share and needs extra queries.
- C3 streak chip: no streak model exists; revisit with analytics.
- C3 "IMDb via OMDb" credit wording on image: keep the plain "IMDb" chip label; source credit stays on About.
- C2 fake notch circles over a scrim: fragile; C1's transparent SVG silhouette kept.

## Fonts
Satori cannot read the repo's variable woff2. Ship static TTFs (Geist Regular from `next`; optional static cuts of
Bricolage/Geist Mono later via fonttools instancer, subsetted to drop GSUB features that crash Satori).

## Verification (by orchestrator after frontend lands)
Render all cases via the real route in demo mode; check safe frame, AA contrast, no spoiler text, TMDB credit only when a
poster is drawn, no network fetch at render time.
