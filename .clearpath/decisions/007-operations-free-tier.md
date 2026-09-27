---
type: decision
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 91d9085662416a6cf983f3f92907b4e7f52e40ee
source: docs/04-architecture/ADR-011-operations-free-tier.md
confidence: high
---
# 007-operations-free-tier

ADR-011: dry run = 0 OMDb / 0 TMDB detail / 0 writes (discover pages allowed); guard abort blocks discover/apply only; `/api/health` ok|degraded|down (503 when DB down, `?strict=1` 503 on stale >36 h, no-store); title pages degrade via last-good LRU → TMDB-derived entry + `degraded` banner; keep-alive = uptime monitor on /api/health + anon-key step in nightly workflow; backups = encrypted pg_dump artifact 14 days; F1 migration `20260927000000_ops_health.sql`; F2 recheck cap aborts apply, errors carried forward. Tasks M1-00…M1-17 in WORK_SPLIT §5.

Source: `docs/04-architecture/ADR-011-operations-free-tier.md`
