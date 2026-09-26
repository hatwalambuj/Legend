---
name: orchestrate
description: Run the Stubbed multi-agent product pipeline (PM → UX → System Design → Architect → FE ∥ BE → Reviewer → QA → PM gap review → loop) with no human in the loop.
---
1. Read `docs/00-orchestrator/BRIEF.md` and `docs/00-orchestrator/RUN_LOG.md` (resume from the last completed phase).
2. For each phase spawn one agent (Agent tool, general-purpose), passing the role file from `.claude/agents/<role>.md` verbatim
   plus the phase task. Frontend and Backend run in parallel on disjoint files from `docs/04-architecture/WORK_SPLIT.md`.
3. After every phase: verify the phase outputs exist, run `npm run lint && npm run typecheck && npm test && npm run build`
   once code exists, commit with message `phase(<n>): <role> — <summary>`, append to RUN_LOG.md, push.
4. After the PM gap review, if the "must fix now" list is non-empty, loop: Frontend ∥ Backend fix → Reviewer → QA → PM (max 3 loops).
