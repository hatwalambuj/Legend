---
type: decision
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: docs/04-architecture/ADR-002-catalog-sourcing.md
confidence: high
---
# 002-hybrid-catalog

Hybrid data: nightly curated catalog_index (~10-15k rows) + live TMDB detail cached 24h; user data in DB. Answers founder "why DB vs real-time".

Source: `docs/04-architecture/ADR-002-catalog-sourcing.md`

Amended by ADR-011 (guard abort scope, dry-run, recheck cap).
