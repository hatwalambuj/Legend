---
name: clearpath
description: ClearPath Protocol — portable execution discipline for AI agents doing project work. Use whenever implementing, fixing, debugging, refactoring, reviewing, auditing, planning, or documenting code in any repository — even if the user doesn't name ClearPath. Also use when the user asks to set up, update, recall, or audit project memory ("remember this", "what do you remember", "continue where we left off"), and before any risky action (deleting files, migrations, production deploys, external API writes, secrets). Provides Obsidian-compatible .clearpath/ project memory, evidence-labeled claims, minimal-diff implementation, deterministic high-confidence review, pre-final verification, and safety gates — loading only the protocol the task needs.
---

# ClearPath

```
Read narrowly. Claim only with evidence. Prefer existing code.
Write the smallest correct change. Verify before final.
State uncertainty instead of filling gaps.
```

## Route the task, load only what applies

| Task | Read from `references/` |
|---|---|
| "clearpath init" / "set up clearpath" | init-protocol.md |
| set up / continue / update / audit memory | memory-management.md, memory-integrity.md |
| implement / fix / refactor / debug | minimal-code-protocol.md, evidence-protocol.md |
| taking a deliberate shortcut | debt-ledger.md |
| unfamiliar repo or long session | + context-discipline.md |
| review / audit code | deterministic-review.md, review-protocol.md |
| non-trivial work, before the final answer | verifier-protocol.md |
| destructive / external / secret-touching action | safety-governance.md |
| formatting any non-trivial final answer | output-contracts.md |

Trivial task = read-only or cosmetic only (explaining code, answering a question, comment/typo edits). For those: apply the core rule above, load nothing, skip the footer. Do not tax small tasks. Any change to code behavior — however small — is build mode: label claims and end with the footer.

Lost track mid-session (after compression or ~15 turns)? Re-read this file and `references/_index.md` to re-anchor — that costs ~150 tokens, guessing costs more.

## Always-on rules

- **Profile:** if `.clearpath/meta/config.md` sets `profile: lite|strict`, apply its routing changes (init-protocol.md, Profiles table). Safety gates are never profile-dependent.
- **Precedence:** user's current instruction → project rules (`.clearpath/meta/rules.md`, `AGENTS.md`/`CLAUDE.md`) → user preferences → ClearPath defaults.
- **Plan gate:** >50 changed lines or >3 files → state scope, out-of-scope, and rollback path before editing.
- **Memory nudge:** if `.clearpath/` exists, start from `hot.md` → `index.md` → relevant pages, then verify against live files. If it doesn't and the work is multi-file / multi-session / architectural, offer once to create it (say what you'd save); re-offer only with a stated reason.
- **Safety:** destructive, external, or secret-touching actions need explicit approval first — no exceptions for confidence.
- **Evidence:** label material claims (Observed / Inferred / Assumed / Unverified / Blocked) and cite file:line for anything you assert about code.
- **Footer:** end every non-trivial answer with exactly this compliance footer (its absence signals drift):

```
— clearpath: mode=<build|review|memory|gate> · evidence=labeled · verify=<SHIP|HOLD|n/a>
   memory=<updated|unchanged|off> · unverified=<none|list>
```
