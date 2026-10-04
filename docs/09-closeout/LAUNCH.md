# Launch runbook: from zero to live

This is the founder's checklist. Do the steps in order. Each step says what to do, where, which setting it fills, and how to check it worked.

Sources: [FOUNDER_INPUTS.md](FOUNDER_INPUTS.md) (F1 to F12), README "Going live", and the launch kit in `scripts/` and `.github/workflows/`. The README has more background on each step.

**Rules for the whole run**
- Never paste a key into chat, an issue or a commit. Put keys only in Vercel, GitHub or your local `.env.local` (git ignores it).
- Only `NEXT_PUBLIC_*` values reach the browser. Never put a secret in a `NEXT_PUBLIC_*` variable.
- `launch:check` prints variable **names** only, never values. Its output is safe to share.

**What you need before you start**
- Accounts: TMDB, OMDb, Supabase, Vercel, GitHub, and an email sender for Supabase (for example Resend).
- A computer with Node 22 (`.nvmrc` says `22`) and this repo cloned.
- Optional: the `psql` client. You can skip it: the GitHub workflows do the database work for you.
- About half a day, plus 3 to 5 nights for the catalogue to fill in.

---

## Part 1. Decisions first (free, no code)

### Step 1. Check the name (F8)
1. Search "Stubbed" on USPTO and EUIPO (classes 9, 41, 42). Watch for AMC Stubs, MyStubs and TicketStub.
2. If the name is not free, pick a new one. The fallback in the docs is **Punched**.
3. The name is one setting: `NEXT_PUBLIC_BRAND_NAME` (1 to 24 letters, digits, spaces or `. ' & -`). You set it in Step 10. It is baked in at build time, so a later rename needs a redeploy.

**Check:** later, `npm run launch:check` shows `[warn]` for `NEXT_PUBLIC_BRAND_NAME` while it is unset or still "Stubbed". That is a reminder, not a failure.

### Step 2. Decide public or private repo, and commercial or not (F10)
- **Private is safer.** Backup files are uploaded to the GitHub run page. They are encrypted, but anyone can download them from a public repo.
- If the repo is public: GitHub can switch off scheduled workflows after 60 days with no commits (noted in `docs/08-clearpath/ARCH_REVIEW.md` AR-6). Then the nightly sync and the Supabase keep-alive stop. Check the Actions tab once a month.
- **The product is non-commercial as built.** The TMDB developer licence, OMDb data (CC BY-NC) and Vercel Hobby are all non-commercial. No ads, paid plans or sponsors until you have a commercial TMDB licence and Vercel Pro. The About page already says the project is non-commercial.

---

## Part 2. Get the keys

### Step 3. Set up the repo on your computer
1. In the repo folder run `npm ci`.
2. Copy the template: `cp .env.example .env.local`. You fill this file as you go. It is only for running the checks on your computer.
3. Run `npm run launch:check`.

**Check:** it prints a list with `[ok]`, `[FAIL]`, `[warn]` and `[todo]` lines, then "N things to fix before launch". Many failures now are normal. Each later step clears some of them.

Note: once `.env.local` has live keys, `npm run dev` on your computer talks to the real services, not the demo.

### Step 4. Replace the TMDB logo (F1)
1. Go to themoviedb.org/about/logos-attribution and download an official logo (SVG).
2. Overwrite `public/tmdb-logo.svg` with it. Commit that file.

**Check:** `npm run launch:check` shows `[ok]   public/tmdb-logo.svg is the official TMDB logo`.

### Step 5. TMDB key (F2)
1. themoviedb.org → Settings → API → request a **Developer** key.
2. Copy the **API Read Access Token** (the long one).
3. Put it in `.env.local` as `TMDB_READ_TOKEN=...`. You add it to Vercel and GitHub in Steps 10 and 11.

**Check:** `npm run launch:check` shows `[ok]` for `TMDB_READ_TOKEN (or TMDB_API_KEY) is set`.

### Step 6. OMDb key (F2)
1. Get a free key at omdbapi.com/apikey.aspx.
2. Click the activation link in the email. The key does not work until you do.
3. Put it in `.env.local` as `OMDB_API_KEY=...`. In production only the nightly GitHub job uses it.

**Check:** `npm run launch:check` shows `[ok]` for `OMDB_API_KEY is set`.

### Step 7. Supabase project and keys (F2)
1. Create a Supabase project in a region near your users. Save the database password in your password manager.
2. Project Settings → API. Copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (a master key: never in a `NEXT_PUBLIC_` variable)
3. Supabase → Connect → **Session pooler** connection string (with your password in it) → this is `SUPABASE_DB_URL`. Keep it in your password manager. It goes into GitHub in Step 8.

**Check:** `npm run launch:check` shows `[ok]` for the three Supabase lines and `[ok]   No secret is exposed to the browser`.

---

## Part 3. Database and accounts

### Step 8. Create the GitHub "production" environment
All four ops workflows (`nightly-sync.yml`, `db-apply.yml`, `smoke-live.yml`, `backup.yml`) use an environment called `production`.
1. GitHub repo → Settings → Environments → New environment → name it `production`.
2. In that environment add the **secret** `SUPABASE_DB_URL` (the session pooler string from Step 7).

**Check:** Settings → Environments → `production` lists `SUPABASE_DB_URL` under secrets.

### Step 9. Apply the database migrations (F3)
This creates the tables. There are 15 files in `supabase/migrations/` today. The tool applies them in name order, once each, and refuses to run if a file was edited or is out of order.

Easiest way (no installs):
1. GitHub → Actions → **"Apply database migrations"** → Run workflow. Leave `confirm` as `no`. This is a dry run.
2. Open the run. The "Plan (dry run)" step lists each file as `pending`, then "Dry run: would apply N file(s)".
3. Run it again with `confirm` = `yes`.

From your computer instead (needs `psql`):
1. `SUPABASE_DB_URL='<session pooler string>' npm run db:apply` (dry run, read the plan).
2. `SUPABASE_DB_URL='<session pooler string>' npm run db:apply -- --yes`

If you already ran the SQL files by hand (SQL editor or `supabase db push`), run `npm run db:apply -- --baseline --yes` once (or the workflow with `baseline` ticked and `confirm` = `yes`). This records the files as applied without running them again.

**Check:**
- The apply run ends with `Done: N file(s) applied.` A second run says `Up to date: nothing to apply.`
- `npm run launch:check -- --migrations` ends with `All required checks pass.` (It reads the database only; it never writes.)

### Step 10. Supabase sign-in settings (F4)
1. Authentication → Providers → **Email**: on. Turn **Confirm email OFF** (the live smoke test needs this too).
2. Authentication → URL Configuration:
   - **Site URL** = your domain, for example `https://stubbed.app`.
   - **Redirect URLs**: add `https://<your domain>/auth/callback` and your Vercel preview pattern, for example `https://*-yourteam.vercel.app/auth/callback`. Without this, magic links fail.
3. Authentication → Emails → **SMTP settings**: set up custom SMTP. Supabase's built-in sender only mails your own team (about 2 an hour), so real users would never get magic links or password resets. Resend's free tier is enough: verify your domain in Resend, then paste its SMTP host, user and password.
4. Optional (F12): turn on asymmetric JWT signing keys (FOUNDER_INPUTS says Supabase → Auth → Signing keys; the exact menu name may differ). The code works either way.

**Check:**
- `npm run launch:check -- --live` shows `[ok]   Supabase Auth: email sign-up on, Confirm email OFF`.
- Redirect URLs and SMTP cannot be read by the tool. It lists them under "Also check". To check by hand, request a magic link to a Gmail address after Step 12. It must arrive.

---

## Part 4. The website

### Step 11. Fill the last settings (F9, F8)
Add to `.env.local`:
- `NEXT_PUBLIC_SITE_URL` = your public `https://` domain (not localhost).
- `REVALIDATE_SECRET` = the output of `openssl rand -hex 32` (32+ characters). Use the same value in Vercel and GitHub.
- `NEXT_PUBLIC_CONTACT_EMAIL` = an inbox you read. Contact messages and review reports go there (F9).
- `NEXT_PUBLIC_BRAND_NAME` = only if you renamed in Step 1.

Make sure none of these are set: `DEMO_MODE_PUBLIC`, `DEMO_DEV_LINKS`, `DEMO_RESET_ON_BOOT`, `DEMO_TODAY`, `IMAGE_MODE=off`, `CATALOG_MODE=fixtures`, `DATA_MODE=local`. The template sets `DEMO_MODE_PUBLIC=false`, which is fine.

**Check:** `npm run launch:check` ends with `All required checks pass.` (exit code 0). The `TRUSTED_PROXY` and `SUPABASE_DB_URL` warnings are fine on your computer.

### Step 12. Vercel project and domain (F5)
1. Vercel → Add New → Project → import the GitHub repo. Framework: Next.js. Node 22. No `vercel.json` is needed.
2. Settings → Environment Variables, for **Production and Preview**, add:
   `NEXT_PUBLIC_SITE_URL`, `TMDB_READ_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REVALIDATE_SECRET`, `NEXT_PUBLIC_CONTACT_EMAIL`, and `NEXT_PUBLIC_BRAND_NAME` if you renamed.
   Do not add `OMDB_API_KEY` here (only GitHub needs it). Leave `TRUSTED_PROXY` unset on Vercel (it is detected).
3. Settings → Domains → add your domain.
4. Redeploy so the variables take effect.

**Check:** open `https://<your domain>/api/health`. It answers `"status":"degraded"` until the first sync (Step 14), then `"status":"ok"`. A `503` with `"down"` means the site cannot reach the database. A production server with missing or partial keys refuses to start, so a failed deploy log is also a signal.

### Step 13. GitHub secrets and variables
GitHub repo → Settings → Secrets and variables → Actions (or inside the `production` environment).

**Secrets:** `TMDB_READ_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `REVALIDATE_SECRET`, `OMDB_API_KEY`, `SUPABASE_DB_URL` (already done in Step 8), `BACKUP_PASSPHRASE` (Step 15).

**Variables:** `NEXT_PUBLIC_SITE_URL` (your domain). `SMOKE_EMAIL` = an address on a real mail domain, used by the live smoke test (Supabase may reject `example.com`). Optional tuning: `SYNC_GUARD_MIN_MOVIE`, `SYNC_GUARD_MIN_TV`, `OMDB_DAILY_BUDGET`, `SYNC_ENRICH_MAX`.

**Check:** the names in GitHub match the list above exactly (they are case sensitive).

### Step 14. First catalogue sync
1. Actions → **"Nightly catalogue sync"** → Run workflow with **dry_run** ticked. It reads TMDB and the database and writes nothing.
2. In the log, find lines like `[sync] listed tv 1450 (min 1000, max 25000)` and then `[sync] GUARD: pass`. On the first run (empty catalogue) the minimums only warn.
3. Run it again with **dry_run** not ticked.
4. Later: set `SYNC_GUARD_MIN_MOVIE` and `SYNC_GUARD_MIN_TV` to about 80% of the real counts from the log.

**Check:**
- `/browse` and search on your site show titles.
- `https://<your domain>/api/health` answers `"status":"ok"`.
- "Worth it?" details fill in over 3 to 5 nights. IMDb chips fill in over about 2 weeks on the free OMDb key.
- After this it runs by itself every night at 03:17 UTC.

### Step 15. Backups
Supabase Free has no backups. `backup.yml` makes one every night at 04:07 UTC.
1. Make a long random passphrase. Save it in your password manager. Without it the backups cannot be opened.
2. Add it as the GitHub secret `BACKUP_PASSPHRASE` (in the `production` environment).
3. In the Supabase SQL editor run `select version();`. The major number must match `PG_MAJOR` in `.github/workflows/backup.yml` (it is `17` today). If not, change that line.
4. Actions → **"Nightly database backup"** → Run workflow.

**Check:** the run page has an artifact named `db-YYYY-MM-DD.tar.gpg`. Kept 14 days. Rehearse a restore once on a spare project (README "Backups and restore").

---

## Part 5. Prove it works

### Step 16. Full live check
On your computer, with `.env.local` filled: `npm run launch:check -- --live`.

It also calls TMDB (including the `watch/providers` data), OMDb, Supabase Auth, `health_probe()`, your site's `/api/health`, and compares the applied migrations with the files.

**Check:** `All required checks pass.` Under "Also check" it still lists redirect URLs and SMTP (Step 10). That is expected.

### Step 17. Staging smoke test on real keys (F6)
1. Push a branch or use any Vercel preview deploy. Copy its URL.
2. GitHub → Actions → **"Live smoke (staging)"** → Run workflow → paste the URL into `url`.
   Or on your computer: `npm run smoke:live -- --url https://<deploy>` (needs `TMDB_READ_TOKEN`; set `SMOKE_EMAIL`).
3. The workflow first runs `npm run launch:check -- --migrations`. It stops if the database is missing a migration.
4. Then it checks: health, real posters, TMDB `watch/providers`, a title page with TMDB, IMDb and Where to watch, a real 404 and a 308 redirect, "On {Service}" chips on `/browse`, the 1200×630 share image, and one throwaway account (sign up, stub, story image 1080×1920, review, export, delete).
5. Last it runs `npm run check:provider-links`.

**Check:** every step is green. Download the `live-smoke-evidence` artifact to keep the proof (kept 30 days). On your computer the evidence is in `test-results-live/evidence/`.

### Step 18. Provider links on real phones (F7)
1. `npm run check:provider-links` (also part of Step 17). The last line reads `N URLs: … ok, … bot-blocked (tolerated), … to look at, … failing.` It fails only on DNS, TLS, 5xx or non-https. 403 and 429 are tolerated.
2. On an iPhone (Safari) and an Android phone (Chrome), signed out, open the title pages for Dune: Part Two, Interstellar and Fleabag. Tap each Where to watch tile from the 15-item checklist in `docs/08-clearpath/QA_VERIFICATION.md` §8. Try regions US, GB and IN.

**Check:** each tap opens the service's app or site, and the address has no tracking parameters.

### Step 19. Before telling anyone
On a Vercel preview with real keys:
1. Sign up, stub a title, stub it again, write a review, delete a stub.
2. Export the CSV and import it into your own Letterboxd account.
3. Request a magic link to a Gmail address. It must arrive.
4. In the browser dev tools, check the `sb-*` cookies are httpOnly.
5. Delete a test account.
6. Run Lighthouse (mobile) on a title page: LCP under 2.5 s, CLS under 0.1.
7. Share a title link in a chat app and check the preview card.
8. Open the About page: official TMDB logo, "IMDb ratings via OMDb", privacy text, your contact address.

**Check:** all eight pass. Reported reviews arrive at `NEXT_PUBLIC_CONTACT_EMAIL`. Hide them in the Supabase table editor.

### Step 20. Uptime alerts (free)
Add two monitors in UptimeRobot or Better Stack, every 5 minutes:
- `https://<domain>/api/health`: alerts when the site or database is down (503). This also keeps Supabase Free awake.
- `https://<domain>/api/health?strict=1`: also alerts when the catalogue sync is older than 36 hours (`HEALTH_MAX_SYNC_AGE_HOURS`).

**Check:** both monitors show "up".

### Step 21. Optional: a real TV Time export (F11)
TV Time import is labelled "beta" because its file format was built from documentation, not a real export. Send one export file when convenient so the team can confirm it.

---

## Every release after launch: migrate, then deploy

New code may need a new column or function. Migrations only add things, so old code keeps working on the new database, but new code breaks on the old one. For any change that adds a file to `supabase/migrations/`:
1. Actions → "Apply database migrations" with `confirm` = `no` (read the plan), then again with `confirm` = `yes`. Or `npm run db:apply`, then `npm run db:apply -- --yes`.
2. `npm run launch:check -- --migrations` must pass. It names any file still pending.
3. Only then merge or deploy. Then run "Live smoke (staging)" on the deploy.

To see how the product is doing: `npx tsx scripts/metrics.ts` (needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`). It prints 8 weeks of usage and the last 7 days of error counts. Vercel Hobby keeps runtime logs for only about 1 hour, so these counts are the long-term error record.

---

## If something fails

| What you see | Likely cause | Fix |
|---|---|---|
| `launch:check`: `public/tmdb-logo.svg ... It is still the placeholder` | Logo not replaced | Step 4 |
| `launch:check`: `NEXT_PUBLIC_CONTACT_EMAIL is a real inbox` fails | Unset or still `contact@example.com` | Step 11 |
| `launch:check`: `REVALIDATE_SECRET is too short` | Under 32 characters | `openssl rand -hex 32`, same value in Vercel and GitHub |
| `launch:check`: `NEXT_PUBLIC_SITE_URL is your public https:// domain` fails | Still `http://localhost:3000` from the template | Set your `https://` domain |
| `launch:check`: `No demo / E2E switches are set` fails | A `DEMO_*`, `IMAGE_MODE=off`, `CATALOG_MODE=fixtures` or `DATA_MODE=local` value is set | Remove it from the live settings |
| `launch:check`: `No secret is exposed to the browser` fails | A key was put in a `NEXT_PUBLIC_*` variable | Move it, then **rotate that key** in its dashboard |
| `launch:check`: `A production server boots in LIVE mode` fails | Keys missing or only partly set | Set every key in the group (for Supabase: URL and anon key together) |
| `db:apply`: `SUPABASE_DB_URL is not set` | Variable not passed | Put it in front of the command, or use the workflow (Step 9) |
| `db:apply`: `The psql client is not installed` | No `psql` on your computer | Use the "Apply database migrations" workflow |
| `db:apply`: `Refusing to run:` | An applied file was edited, removed, or a new file sorts before an applied one | Do not edit applied files. Restore the file from git and add a new migration instead |
| `db:apply`: `<file> failed and was rolled back` | SQL error in that file | Nothing was half-applied. Read the error line, fix forward with a new file |
| `launch:check -- --migrations` fails naming files | Migrations not applied yet | Step 9, then deploy |
| `--live`: `turn Confirm email OFF` | Supabase email confirm still on | Step 10.1 |
| `--live`: `health_probe() not found` | Migrations not applied | Step 9 |
| `--live`: `OMDb rejected the key` | Activation link not clicked | Click the link in the OMDb email (Step 6) |
| `--live`: `TMDB answered HTTP 401` | Wrong token copied | Copy the long "API Read Access Token" again (Step 5) |
| `--live`: `Health is "degraded"` | No sync yet, or the last one is over 36 h old | Step 14; check the "Nightly catalogue sync" run |
| `/api/health` answers 503 `down` | Site cannot reach the database, or Supabase paused | Supabase dashboard → restore the project; check the keys in Vercel |
| Vercel deploy crashes at start | Demo mode or partial keys on a production server | Compare Vercel variables with Step 12 |
| Nightly sync log: `GUARD: fail` | Count below the minimum, over the maximum, or moved more than 20% | Read the counts in the log. If TMDB is fine, adjust `SYNC_GUARD_MIN_*`; the index was left untouched |
| Nightly sync: "Secrets not configured; skipping sync." | TMDB or service_role secret missing in GitHub | Step 13 |
| Backup run: "SUPABASE_DB_URL or BACKUP_PASSPHRASE not set; skipping backup." | Secret missing | Step 15 |
| Backup run fails at `pg_dump` with a version error | `PG_MAJOR` does not match the server | Step 15.3 |
| Live smoke: sign-up step fails | Confirm email on, or `SMOKE_EMAIL` on a domain Supabase rejects | Step 10.1; set `SMOKE_EMAIL` to a real domain |
| Live smoke: first step fails | A migration is pending | Step 9, then re-run |
| `check:provider-links` fails on a URL | That service changed its address or is down | Tell the team; the link list is in `src/lib/provider-links.ts` |
| Magic link never arrives | No custom SMTP, or redirect URL missing | Step 10.2 and 10.3 |
| Scheduled workflows stopped running | Public repo with no commits for 60 days | Actions tab → re-enable the workflow; consider a private repo (Step 2) |
