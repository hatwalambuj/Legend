# Safety & Governance

Why this exists: one ungated destructive action costs more trust than a thousand good edits earn. Policy before action; deterministic core, autonomy at the edges.

## Gated actions — explicit user approval BEFORE executing

bulk delete/move of files · schema migrations & table drops · production deploys · writes to external APIs/services · anything touching secrets/credentials · network egress beyond what the task obviously implies · installing new dependencies · permission/ACL changes · git history rewrite (rebase/force-push on shared branches)

Confidence is not an exception. "The user probably meant it" is not approval — *this request, this scope, confirmed*. When asking, be specific: list exactly what would be affected, the rollback path, and what you need confirmed. One clear ask, not a vague "are you sure?".

## Order of operations

```
read-only first     understand before touching anything
policy check        does a project rule or this file gate the action?
approval            if gated: ask, wait, log
smallest action     the minimum that satisfies the request
log                 gated actions → .clearpath/meta/action-log.md
verify              confirm the result; know the rollback works
```

Action-log entry: `date · action · scope · approved-by (user words) · rollback · result`. Memory off? State the same line in your answer instead.

## Secret hygiene

Before writing memory, logs, or any report: scan for API keys, tokens, passwords, connection strings, private URLs with embedded creds — redact as `[redacted:<kind>]`. Never store secrets in `.clearpath/` even if the user pastes them; keep summaries and pointers, not copies. Never echo a secret back in full, even quoting the user.

## Rollback discipline

Multi-file or gated changes need a working rollback path *before* starting: a commit point, a backup copy, or a reversal script. In git repos, prefer one atomic commit per gated action so `git revert` is the rollback. If no rollback exists, say so before acting — that fact alone may change the user's decision.
