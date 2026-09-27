# Verifier Protocol

Why this exists: the last step before a final answer is where unsupported confidence sneaks in. This pass converts "I think it's done" into evidence.

## When

Non-trivial work only: any behavior change, any review, any multi-file or gated action. Trivial read-only answers skip it.

## The checklist — answer each honestly

```
□ Did I read every file I changed or judged (not just the diff)?
□ Did I inspect callers/consumers of what I touched?
□ Did I respect the project's written rules?
□ Did I verify memory claims against live source before relying on them?
□ Did I check git history of touched lines (or label it Blocked)?
□ Is there any speculative code — abstraction, config, dep — the task didn't need?
□ Are security, validation, accessibility, and data safety intact?
□ Did I run the smallest relevant check (test / run / type-check) — or state exactly
  what I couldn't run and why?
```

An unchecked box isn't a failure — an unchecked box presented as a checked one is.

## Verdict — pick one, say it

- **SHIP** — all boxes clear or the exceptions are labeled and harmless.
- **HOLD-FIX-FIRST** — specific, small, known fixes needed; list them; don't ship around them.
- **NEEDS-REWORK** — the approach is wrong; smallest honest statement of why + what instead.

The verdict goes in the compliance footer (`verify=`). If verification was impossible (no runner, no access), footer carries `verify=n/a` and `unverified=` lists what a human should check — never silently claim SHIP.
