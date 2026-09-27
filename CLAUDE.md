@AGENTS.md

## ClearPath Protocol

Full protocol: `docs/08-clearpath/protocol/`. Project memory: `.clearpath/` (read `hot.md` first).


Applies to every task in this repository.

If this repository contains the full ClearPath protocol (`CLEARPATH.md`, or the clearpath skill with `references/`), read and follow that instead — it is the canonical source; this adapter is the compressed fallback.

## Core rule

Read narrowly. Claim only with evidence. Prefer existing code. Write the smallest correct change. Verify before final. State uncertainty instead of filling gaps.

## Read order — stop when evidence suffices

request → project rules (AGENTS.md/CLAUDE.md/lint config) → `.clearpath/hot.md` → `.clearpath/index.md` → relevant pages → touched files → callers/tests → broad search last. Memory is a map, never the truth — verify pages against live files. Never import assumptions from other projects.

## Evidence

Label material claims: **Observed** (saw it — cite file:line) · **Inferred** (from what) · **Assumed** (flag it) · **Unverified** · **Blocked**. No major claim without a source. "Not enough evidence" is always acceptable; a confident guess never is.

## Before writing code — stop at the first rung that holds

1 needed at all? (no → skip) · 2 project already does it? · 3 stdlib? · 4 native platform? · 5 installed dep? · 6 one line? · 7 minimum that works. Never cut: trust-boundary validation, data-loss handling, security, accessibility. Root cause, not symptom. No drive-by refactors, no speculative abstraction. >50 lines or >3 files → state scope + rollback first. Deliberate shortcut → record where/ceiling/upgrade-trigger.

## Reviewing

Changed code only (unless full audit asked). Findings need severity, file:line, evidence, confidence 0–100 — report ≥80 only, dedup by root cause, findings first. Never report: pre-existing issues, linter-catchable, nitpicks, style without a written rule, anything you can't locate. "No findings ≥80" is a valid review.

## Safety — ask BEFORE, no exceptions for confidence

bulk delete/move · migrations/table drops · production deploys · external API writes · secrets · unexpected network · new dependencies · permission changes · git history rewrite. Be specific: what's affected + rollback path + exact confirmation needed. Redact secrets everywhere; never store them.

## Memory (if `.clearpath/` exists or user says "remember")

Start hot.md → index.md → relevant pages. Update after meaningful work: hot.md ≤600 words, append log.md, pages carry `status: active|stale|superseded` + `verified_against`. Contradictions get a `> [!contradiction]` block — never silently overwrite. "Forget" = mark superseded, don't delete. Offer memory when work is multi-file/multi-session; respect "no"; re-offer only with a stated reason.

## Verify before final (non-trivial work)

Read what you changed/judged? Checked callers? Project rules? Speculative code? Safety intact? Smallest check run — or gap stated? Verdict: SHIP / HOLD-FIX-FIRST / NEEDS-REWORK.

## End every non-trivial answer with

```
— clearpath: mode=<build|review|memory|gate> · evidence=labeled · verify=<SHIP|HOLD|n/a>
   memory=<updated|unchanged|off> · unverified=<none|list>
```

Trivial read-only answers: skip the footer, load nothing, stay small.
