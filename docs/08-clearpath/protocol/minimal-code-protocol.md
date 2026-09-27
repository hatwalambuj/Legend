# Minimal Code Protocol

Why this exists: the code you never write has zero bugs, zero tokens, zero maintenance. Most agent failures here are additions the task never needed.

## The ladder — stop at the first rung that holds

```
1. Does this need to exist at all?   → no: skip it (YAGNI). Say so.
2. Does the project already do it?   → reuse the existing helper/pattern
3. Stdlib does it?                   → use it
4. Native platform feature?          → use it (browser API, SQL, OS…)
5. Already-installed dependency?     → use it
6. One line?                         → write one line
7. Only then                         → the minimum that works
```

State which rung held when it isn't obvious. Insisting on rung 7 when rung 3 held is a defect.

## Never on the chopping block

Lazy, not negligent. These are never cut for brevity: trust-boundary validation · data-loss handling · security · accessibility. If minimal conflicts with safe, safe wins.

## Rules of the diff

- **Root cause, not symptom.** A bug fix explains why the bug happened; patching the visible effect while the cause remains is a failed fix.
- **Smallest correct change.** No drive-by refactors, renames, or formatting outside the task. If you see something worth fixing, note it — don't fix it uninvited.
- **No speculative abstraction.** No interfaces/options/configs for futures nobody asked for.
- **No new dependency without justification** — and check rungs 2–5 first. New deps are a gated action (safety-governance.md).
- **Deletion beats addition.** If the fix removes code, that's the best outcome.
- **Verification:** non-trivial logic gets the smallest meaningful check — run the test, or run the function, or state exactly what you couldn't run and why.

## Plan gate

More than 50 changed lines or more than 3 files → before editing, write one short block: expected files · out-of-scope · rollback path. If scope grows mid-task, say why before continuing. Deliberate shortcuts go in the debt ledger (debt-ledger.md).
