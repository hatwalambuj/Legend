---
type: decision
status: active
created: 2026-09-28
updated: 2026-09-28
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: docs/04-architecture/ADR-012-where-to-watch.md
confidence: high
---
# 008-where-to-watch

Streaming availability from TMDB watch/providers (JustWatch data, "Data by JustWatch" credit), refreshed in the nightly enrich call. Tiles open the provider's search/home via an allowlisted https link table (no affiliate, no app-only schemes, TMDB `link` never rendered). Region: `?region=` → saved setting / country-code cookie → trusted geo header → Accept-Language → US. Amendment 1 (reviewer, orchestrator-confirmed): title page reads `?region=` (private, no-store, canonical has no query); signed-out choice stored as HttpOnly country-code cookie.
