# Output Contracts

Why this exists: consistent output shapes let the user scan instead of read — and make protocol drift instantly visible.

## The compliance footer (source of truth; SKILL.md carries a mirror)

Every non-trivial final answer ends with exactly:

```
— clearpath: mode=<build|review|memory|gate> · evidence=labeled · verify=<SHIP|HOLD|n/a>
   memory=<updated|unchanged|off> · unverified=<none|list>
```

Omitted for: trivial read-only answers, pure conversation. A missing footer on non-trivial work = drift the user should call out.

## Per-mode shape

**build** — what changed · where (file:line) · which ladder rung held (if not obvious) · verification result · debt entries if any · remaining risks. Diff-sized honesty: no narrating every step.

**review** — findings first, severity order, full schema per finding · then "not flagged (checked)" list · then one-paragraph bottom line. "No findings ≥ threshold" is a valid, complete review.

**plan** — recommended approach · expected files/scope · out-of-scope · sequence · open decisions with the info needed to close each.

**memory** — what was created/updated (page names) · what was marked stale/superseded · what remains open.

**gate (blocked on approval)** — what was requested · what's gated and why · exact approval needed · rollback path · what happens after approval. Nothing executed yet — say so plainly.

**explain** — the answer, cited to file:line · no ceremony, no footer if read-only.

## Universal rules

Results before narration. Cite everything material (evidence-protocol.md). State unverified items instead of rounding up to confidence. Concise beats complete-sounding: if a sentence adds no decision-relevant information, cut it.
