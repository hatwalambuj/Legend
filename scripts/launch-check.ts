/**
 * Launch readiness checklist (C-14; FOUNDER_INPUTS F1 F2 F4 F9). Exit 1 while anything required fails.
 *
 *   npm run launch:check                     # offline: env vars, logo, contact email, migration files
 *   npm run launch:check -- --live           # + probes TMDB, OMDb, Supabase Auth/DB, the deployed /api/health
 *   npm run launch:check -- --env-file .env.production.local
 *   npm run launch:check -- --migrations     # only: every supabase/migrations file applied? (pre-deploy gate)
 *
 * `--live` / `--migrations` read `public._stubbed_migrations` (read-only) with psql + SUPABASE_DB_URL,
 * else via Supabase REST with SUPABASE_SERVICE_ROLE_KEY, and fail naming each pending file (AR-C1).
 *
 * Reads the real environment, then `.env.local` and `.env` (the environment wins). Prints variable
 * NAMES only, never a value. Logic: scripts/lib/launch-check.ts (unit-tested without network).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  checkEnv,
  checkLogo,
  checkMigrations,
  exitCode,
  formatReport,
  mergeDotenv,
  probeLive,
  probeMigrations,
  type ReadApplied,
} from './lib/launch-check';
import { psqlAvailable, psqlDriver } from './lib/db-apply';

/** Read-only: psqlDriver.applied() only runs SELECTs (to_regclass + the tracking rows). */
const readViaPsql: ReadApplied = async (url) =>
  (await psqlDriver(url).applied()).map((a) => a.name);

async function main() {
  const args = process.argv.slice(2);
  const onlyMigrations = args.includes('--migrations');
  const live = args.includes('--live');
  const i = args.indexOf('--env-file');
  const files = i >= 0 && args[i + 1] ? [args[i + 1]!] : ['.env.local', '.env'];
  const env: Record<string, string | undefined> = { ...process.env };
  const loaded = files.filter((f) => existsSync(f));
  for (const f of loaded) mergeDotenv(readFileSync(f, 'utf8'), env);

  const root = process.cwd();
  const logoPath = join(root, 'public/tmdb-logo.svg');
  const migrations = readdirSync(join(root, 'supabase/migrations'));
  const compare = live || onlyMigrations;
  const appliedCheck = async () => {
    const r = await probeMigrations(
      env,
      migrations,
      fetch,
      psqlAvailable() ? readViaPsql : undefined,
    );
    // As a pre-deploy gate, "could not compare" must not pass silently.
    return onlyMigrations && r.status === 'manual' ? { ...r, status: 'fail' as const } : r;
  };
  const results = [
    ...(onlyMigrations
      ? []
      : [
          ...checkEnv(env),
          checkLogo(existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : null),
        ]),
    ...checkMigrations(migrations, compare),
    ...(compare ? [await appliedCheck()] : []),
    ...(live && !onlyMigrations ? await probeLive(env) : []),
  ];
  const source = loaded.length ? `environment + ${loaded.join(', ')}` : 'environment only';
  const mode = onlyMigrations
    ? 'migrations only'
    : live
      ? 'offline + live probes'
      : 'offline; add --live to probe services';
  console.log(formatReport(results, `Stubbed launch check (${mode}; ${source})`));
  process.exitCode = exitCode(results);
}

main().catch((e: unknown) => {
  console.error(`launch:check crashed: ${e instanceof Error ? e.name : 'error'}`);
  process.exitCode = 2;
});
