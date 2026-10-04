---
type: meta
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: session
confidence: high
---
# Log (append-only)

## 2026-09-27 — memory initialized
- what: .clearpath/ scaffold created via bootstrap
- verification: see meta/verification.md

## 2026-09-27 · ClearPath init + context import
- what: bootstrapped `.clearpath/`, imported decisions, issues, reviews from docs/00-08; adapter appended to CLAUDE.md.
- why: founder asked to use ClearPath memory to maintain overall context.
- verification: memory_lint.py (see below), HEAD 8f05df682bbd.

## 2026-09-27 · Architect: identity, $0 hosting, ops specs
- what: ADR-010-identity (new), ADR-011-operations-free-tier (new), ADR-001 Amendment A ($0 hard constraint, verified free-alternatives matrix, TRUSTED_PROXY), API_CONTRACT v1.4, WORK_SPLIT §5 M1 task list; pointer notes in ADR-002/005/008. Docs only.
- why: founder updates 2026-09-27 (identity table, free-of-cost DB/server, ops hardening).
- verification: web-checked free tiers (sources in ADR-001 §A4); code facts cited file:line; no build run (docs only).

## 2026-09-27 · M1 + where-to-watch wave
- done: ADR-010 identity, ADR-001 $0 hard rule + free alternates, ADR-011 ops, ADR-012 where-to-watch, API v1.5, WORK_SPLIT §5/§6; PRD §13 + DESIGN §7.4.2 (where to watch).
- interrupted: backend M1 and QA flake runs stopped on a usage limit; partial work snapshot 55d0243; both relaunched to resume.

## 2026-09-27 · M1 complete
- backend + frontend M1 tasks implemented; e2e harness fix (no server reuse); ClearPath M1 code review SHIP (M1-CR-1 fixed).
- verification: lint/typecheck/338 unit/build/format green; 169 E2E passed (reviewer run). HEAD 3d279b102c50e01b68045bd3563b4a7c72007d8a.
- open: stub-count race (founder decision), M1-15 logo, M1-17 staging smoke.

## 2026-09-27 · Where to watch backend W-00…W-07
- done: shared types/contracts/api-client/provider-links/regions/analytics (W-00); migration 20260928120000_where_to_watch.sql, not applied (W-01); watch-map + enrich append (W-02); watch step + weekly provider list (W-03); region resolution + env (W-04); buildTitleWatch + dal wiring (W-05); watch.json 20 titles × US/GB/IN (W-06); watch + watch-region routes, sign-in/callback cookie, export/delete (W-07).
- deviations: `AppMode.watchRegions?` / `SessionUser.watchRegion?` optional (frontend literals untouched, same precedent as `degraded?`); SYNC_WATCH_* live under `env.watch.sync` (frozen tests/lib/env.test.ts); `watch_provider.priorities_at` column added; user_settings writes via invoker RPC `user_settings_set_watch_region`.
- unverified: TMDB append key "watch/providers" (fixture is reconstructed shape, not a live recording); provider ids/templates (W2-AC5).
- verification: lint, typecheck, 511 unit, build, format:check green. No commit.

## 2026-09-27 · Where to watch frontend W-10…W-12
- done: WhereToWatch (+css, test), ProviderTile (tile, logo/monogram fallback, 16px ProviderMark, test), WatchRegionSelect (pill + Settings row, css, test); title page slot (under stubbed line, above Worth it?; hidden when watch null); Settings "Where to watch" region; About JustWatch credit; Ticket optional `hint`/`title.watchHint` → `ticket-providers` (grid/rail only).
- deviations: title page honours `?region=` (switcher writes it via history.replaceState; ADR-012 §5 says query is API-only) — needs arch-review sign-off; setWatchRegion is called signed out too (cookie, W3-AC3); e2e/title.spec.ts F1 (QA-owned) now skips `where-to-watch` between stub line and slip.
- verification: lint, typecheck, 531 unit, build, format:check, 169 E2E green. Screenshots docs/02-design/w2w-app-375.png, -1440.png. No commit.

## 2026-09-28 · Where to watch + race fix
- stub-count race fixed (orchestrator-approved), where-to-watch backend/frontend/review/E2E done; orchestrator fixed QA-WTW-1/2 directly.
- verification: lint/typecheck/535 unit/build/format green; full E2E 212 passed, 8 skipped. HEAD 06e1627082bc240fb33c0d5e17c90fdeb0226f03.

## 2026-10-03 · Close-out started
- founder: close everything except founder inputs; deploy all roles + reviewer; use arena + clearpath.
- created FOUNDER_INPUTS (F1–F10 with workarounds), CLOSEOUT_BOARD (C-01…C-18), roles devops-release/security-reviewer/tech-writer.

## 2026-10-03 · Close-out backend (ADR-013, WORK_SPLIT §7)
- done: C-00 shared layer (types/contracts/errors 413/api-client/data-access/format/routes/analytics + brand/share/avatar/report-error, guards, og fonts, next.config tracing); C-01a/02a/03a/05/06/08a/09a/10a/11a/12a/13a; 6 new migrations 20261003090000…095000 (not applied).
- deviations: import 24 h budget counts imported stubs in SQL (consume_rate_limit can't sum rows); catalog_enrich_due now returns is_listed (drop+create); PublicProfile/SessionUser.avatarColor optional in type; watchHint via `catalog.storedWatch` + in-process row memo (no extra round trip in live lists).
- pending: C-15a guard waits for FE C-15b. Deploy order: apply migrations before deploying (profile selects avatar_color).
- verification: lint, typecheck, 651 unit, build, format:check green. No commit.

## 2026-10-04 · Close-out frontend (resumed from 6e1754f)
- done: C-01b (Ticket reads watchHint, logo aria-hidden, region on SSR lists + Load more), C-02b ProviderFilter chips (links, ?provider= keeps type/sort), C-07 ShareButton test, C-08b src/og/ShareCard.tsx (C1 base + grafts 1/2/3/5) + render.tsx, title opengraph-image, /share/stub/[id] page + og + story route, demo renders docs/02-design/share/final-*.png, C-11b /me/import + ImportFlow, C-15b BRAND_NAME sweep + C-15a guard in tests/lib/guards.test.ts.
- earlier (6e1754f): C-03b, C-04, C-09b, C-10b StubSheet/Diary, C-12b, C-13b, C-07 placements.
- blocked (contract): WalletItem has no stub id/season → wallet-stub Share/Story/S03 not possible; diary row has them.
- deviations: one src/og/ShareCard.tsx (not Title/Story/StubCard files); review-quote graft unused (no review share route); ogText() strips glyphs outside Latin so next/og never fetches Google fonts; ticket-providers keeps role/label alongside aria-hidden for the pre-ADR W7-AC1 E2E until C-Q1.
- 2026-10-04 backend: unblocked wallet share — WalletItem.latestStubId/latestSeason (contract v1.6.1, migration 20261004090000, not applied); WalletStub shows S03 + Share stub + owner Story image. Gates green.
