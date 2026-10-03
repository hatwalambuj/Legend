# Founder inputs and workarounds (close-out, 2026-10-03)

Only these items need the founder. Everything else is closed by the agent team.
Each item has a workaround the team builds now, so the founder's step becomes one command or one click later.

| # | Needs from founder | Why only you | Workaround we build now | Your step later |
|---|---|---|---|---|
| F1 | Official TMDB logo file | TMDB terms; the container has no network to download it | `npm run launch:check` fails until `public/tmdb-logo.svg` is replaced (placeholder detected by marker) | Download from TMDB "Logos & Attribution", overwrite the file |
| F2 | TMDB, OMDb, Supabase keys | Accounts + ToS in your name; secrets never in chat | `.env.example` + `launch:check` validates every var and names what is missing | Paste keys in Vercel + GitHub settings |
| F3 | Apply 5+ DB migrations to Supabase | Changes a live database | `npm run db:apply` (dry-run by default, `--yes` to apply, ordered, idempotent check) + GitHub workflow_dispatch | Run once with `SUPABASE_DB_URL` |
| F4 | Supabase Auth URLs + custom SMTP | Dashboard settings in your account | README step-by-step + `launch:check --live` probes magic-link config | Click through 2 dashboard pages |
| F5 | Vercel project + domain | Your account | One-click import; `vercel.json` not needed; README table | Import repo, add env vars |
| F6 | Staging smoke on real keys | Needs live services + secrets | `npm run smoke:live -- --url <deploy>` Playwright suite + `smoke-live.yml` workflow_dispatch that also verifies TMDB `watch/providers` key, OMDb, posters, sign-up, export | Click "Run workflow" |
| F7 | Provider links on real phones | Needs devices | `npm run check:provider-links` (HEAD/GET each allowlisted template in CI with network) + manual 15-item checklist | Tap through the checklist once |
| F8 | Trademark search "Stubbed" | Legal | Name is one config value (`NEXT_PUBLIC_BRAND_NAME`) so a rename is cheap | Search USPTO/EUIPO |
| F9 | Contact email | Your inbox | `NEXT_PUBLIC_CONTACT_EMAIL`; `launch:check` fails on the placeholder | Set the env var |
| F10 | Repo public/private; commercial plans | Your decision | Defaults: works either way; keep-alive commits not needed if private; non-commercial notice on About | Answer when ready |
