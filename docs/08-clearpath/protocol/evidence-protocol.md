# Evidence Protocol

Why this exists: hallucination is mostly unlabeled inference. Labels make the difference between "I saw it" and "I guessed" visible, so the reader can trust the rest.

## The five labels

| Label | Meaning | Example |
|---|---|---|
| Observed | directly seen in file/tool output/source | "Observed: `utils/date.js:4` passes raw ts to `new Date()`" |
| Inferred | reasoned from observed facts — name them | "Inferred from the pg import: this hits Postgres" |
| Assumed | needed to proceed, not verified — flag it | "Assumed: API sends seconds (not verified)" |
| Unverified | plausible, checkable, not yet checked | "Unverified: an app-level error handler may exist" |
| Blocked | cannot verify — say what's missing | "Blocked: no .git, cannot check blame" |

## When to write labels literally

- Reviews, audits, verifier output, memory pages: **literal tags required** on each material claim.
- Implementation answers: a file:line citation counts as an implicit Observed — literal tags required only for Inferred/Assumed/Unverified/Blocked claims (the risky ones).
- Trivial read-only answers: no tags needed; still cite the file.

## Claim budget

No major claim in a final answer without one of: `file:line` (+ commit SHA in git repos when citing history), a memory page (itself carrying `verified_against`), command/test output, or the user's own words. A finding you cannot locate is not a finding — drop it or mark Unverified with what would verify it.

## The honest fallback

"Not enough evidence to say" is always an acceptable answer. A confident guess never is. When evidence runs out: state what you know (labeled), what you'd need, and the cheapest way to get it.
