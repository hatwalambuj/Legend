---
type: issue
status: active
created: 2026-09-27
updated: 2026-09-27
verified_against: 3d279b102c50e01b68045bd3563b4a7c72007d8a
source: docs/08-clearpath/QA_VERIFICATION.md §6a
confidence: high
---
# stub-count-race

status: open — awaiting founder decision (QA edit to src/ was blocked by permission system; not applied)

After sign-up, AppProvider flush() title-states GET can overwrite a newer stub POST (count 1 → 0). Same pattern for loadWalletCount badge. Repro: e2e/auth.spec.ts:206. Proposed patch in QA §6a.
