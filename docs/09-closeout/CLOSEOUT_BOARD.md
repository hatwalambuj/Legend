# Close-out board (orchestrator-owned)

Goal: close every engineering item; leave only FOUNDER_INPUTS.md. Constraints: $0, no AI, no third-party posting, demo mode offline.

## Roles deployed
| Role | Agent file | Owns in close-out |
|---|---|---|
| Orchestrator | (main) | board, approvals, commits, memory, final gate |
| Product manager | product-manager | final scope acceptance, release notes |
| UX designer (arena ×3) | ux-designer | share-ticket / story image design |
| Architect | architect | ADR-013 close-out specs, WORK_SPLIT §7 |
| Backend dev | backend-dev | server, DB, jobs, imports, analytics |
| Frontend dev | frontend-dev | UI, share, chips, season picker |
| DevOps / release engineer | devops-release (new) | launch kit: launch:check, db:apply, smoke:live, provider-link check, workflows |
| Security reviewer | security-reviewer (new) | security review of close-out diff |
| Code reviewer | code-reviewer | ClearPath code review |
| Architecture reviewer | arch-reviewer | ADR drift / scale / cost |
| QA engineer | qa-engineer | E2E for every new story, full suite |
| Tech writer | tech-writer (new) | README, LAUNCH runbook, release notes |

## Items to close
| ID | Item | Owner | Status |
|---|---|---|---|
| C-01 | W-30 ticket `watchHint` in list APIs + stub logo (W7-AC1 E2E) | BE + FE + QA | open |
| C-02 | W-31/32 browse "On {Service}" provider chips + index | BE + FE + QA | open |
| C-03 | BUG-03 real 404 status + 308 slug redirect | BE/FE + QA | open |
| C-04 | R10 "On Stubbed · N" count increments after posting a review | FE | open |
| C-05 | AR-5 Supabase `getClaims()` local session check | BE | open |
| C-06 | AR-8 refresh referenced (unlisted) rows within TMDB 6-month rule | BE | open |
| C-07 | Share: Web Share + copy link on title, wallet, review | FE | open |
| C-08 | Story-sized share ticket image (`next/og`, offline fonts) + og:image | FE + UX(arena) | open |
| C-09 | First-party privacy-safe analytics (PRD §7 events → own DB table, no third party, no cookies) | BE + FE | open |
| C-10 | Season picker for show stubs (nullable season on stubs) | BE + FE | open |
| C-11 | Imports: Letterboxd CSV, IMDb ratings CSV, TV Time export (offline parse, preview, dedupe) | BE + FE | open |
| C-12 | Avatar colour picker (B3-AC2) | FE (+BE field) | open |
| C-13 | Error tracking without third party: structured JSON logs + error boundary reporting to `/api/log` (rate-limited) | BE + FE | open |
| C-14 | Launch kit: `launch:check`, `db:apply`, `smoke:live` + workflow, `check:provider-links` | DevOps | open |
| C-15 | Brand name as config (F8 workaround) | FE | open |
| C-16 | Docs: README, LAUNCH.md runbook, RELEASE_NOTES | Tech writer | open |
| C-17 | Security + code + arch review of close-out; fix all ≥80 | Reviewers | open |
| C-18 | Full gate + full E2E green; PM acceptance | QA + PM | open |

Orchestrator decisions (2026-10-03): accept ADR-013 calls — BUG-03 via removing root/title/profile loading.tsx; imports match catalogue only; OG uses bundled Geist-Regular.ttf (static cuts of brand fonts optional later); isProfileShareable = true (all profiles public).
