# Deterministic Review

Why this exists: review misses come from fuzzy scope, and review noise comes from fuzzy rules. Decide both mechanically before any judgment happens.

## 1. Scope — decide before reading

- Review **changed code only** (the diff and what it directly touches), unless the user explicitly asked for a whole-repo audit.
- Enumerate the exact files in scope; on large change sets, show the list first (preview) so the user can correct it — zero judgment spent yet.
- Group related files (a handler + its test + its schema) and review groups together; cross-file bugs live in the seams.
- Skip entirely: closed/merged work, generated files, lockfiles, vendored code, trivial automated changes. Say what you skipped.

## 2. Rules — resolve before judging

Match rules to files first-match-wins, in precedence order: user's instruction → project rules (`.clearpath/meta/rules.md`, `AGENTS.md`/`CLAUDE.md`) → user preferences → the per-type defaults below.

| File type | Default focus |
|---|---|
| backend (java/go/py/rb…) | null/nil derefs, injection, N+1, thread/async safety, resource leaks |
| js/ts/react | XSS, unhandled async rejections, state bugs, missing empty-state guards |
| c/c++ | alloc/free pairing, buffer bounds, RAII, const correctness |
| SQL / query builders / ORM xml | injection, missing where-clause, full scans |
| package manifests | wildcard/latest versions, unneeded new deps |
| config / .properties / env | typos, duplicate keys, secrets committed |

## 3. Findings — structured or they don't exist

Every finding carries all fields:

```
id · severity (critical|high|medium|low) · category · file · line
evidence (quote or Observed cite) · confidence 0–100 · recommendation · status
```

- Deduplicate by root cause — one cause, one finding, even if it surfaces in five places (list the places).
- Anchor line numbers to the diff hunk you quote; if you can't locate it, it isn't a finding.
- Emit findings in severity order, findings before any prose. Machine-readable list if the user asks (`--format json` equivalent).
