# Review Protocol (high-signal)

Why this exists: a review that cries wolf gets ignored. Every low-confidence or unprovable comment spends the reader's trust. Report less, land more.

## Perspectives — run each pass over the scoped diff

1. **Project-rule compliance** — flag only rules **explicitly written** in project docs (rules.md, AGENTS.md/CLAUDE.md, lint config). Quote the rule. No rule text = no compliance finding.
2. **Bug scan** — defects in *introduced* behavior only. Pre-existing bugs are out of scope unless the change makes them worse (note them separately if serious).
3. **History context** — `git blame`/log on touched lines: does this change fight a deliberate past decision? Cite the commit. No git? Label Blocked and move on.

Platforms with subagents: run passes as independent reviewers and merge. Without: run sequentially — read the diff fresh for each perspective.

## Confidence scoring

Score each finding 0–100 independently: 0 false positive · 25 might be real · 50 real but minor · 75 real and important · 100 certain. **Report only ≥ 80** (project may override in `.clearpath/meta/config.md`). Verify before scoring: re-read the actual code — does the guideline explicitly say this? does the bug actually fire on a reachable input?

## Filtered out — never report

Pre-existing issues not introduced here · looks-like-a-bug-but-isn't (verify first) · pedantic nitpicks · anything a linter/formatter will catch · style not backed by a written project rule · lines with lint-ignore comments · duplicate symptoms of an already-reported cause · anything you cannot locate to file:line.

## Skip conditions

Don't review at all (say why in one line): trivial/automated changes (version bumps, lockfile-only, generated code), already-reviewed unchanged work, drafts explicitly marked not-ready.

## Output

Findings first, severity order, schema from deterministic-review.md. If nothing clears the threshold: say exactly that — "no findings ≥ 80 confidence" — an empty review with a reason beats invented feedback. End with the compliance footer (verify=HOLD if any critical/high finding stands, else SHIP).
