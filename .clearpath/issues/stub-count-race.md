---
type: issue
status: active
created: 2026-09-27
updated: 2026-09-28
verified_against: 06e1627082bc240fb33c0d5e17c90fdeb0226f03
source: docs/08-clearpath/QA_VERIFICATION.md §6a
confidence: high
---
# stub-count-race

status: closed (06e1627082bc240fb33c0d5e17c90fdeb0226f03) — fixed, auth.spec 100/100

After sign-up, AppProvider flush() title-states GET can overwrite a newer stub POST (count 1 → 0). Same pattern for loadWalletCount badge. Repro: e2e/auth.spec.ts:206. Proposed patch in QA §6a.
