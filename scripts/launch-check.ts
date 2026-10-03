/**
 * Launch readiness checklist (C-14; FOUNDER_INPUTS F1 F2 F4 F9). Exit 1 while anything required fails.
 *
 *   npm run launch:check                     # offline: env vars, logo, contact email, migration files
 *   npm run launch:check -- --live           # + probes TMDB, OMDb, Supabase Auth/DB, the deployed /api/health
 *   npm run launch:check -- --env-file .env.production.local
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
} from './lib/launch-check';

async function main() {
  const args = process.argv.slice(2);
  const live = args.includes('--live');
  const i = args.indexOf('--env-file');
  const files = i >= 0 && args[i + 1] ? [args[i + 1]!] : ['.env.local', '.env'];
  const env: Record<string, string | undefined> = { ...process.env };
  const loaded = files.filter((f) => existsSync(f));
  for (const f of loaded) mergeDotenv(readFileSync(f, 'utf8'), env);

  const root = process.cwd();
  const logoPath = join(root, 'public/tmdb-logo.svg');
  const results = [
    ...checkEnv(env),
    checkLogo(existsSync(logoPath) ? readFileSync(logoPath, 'utf8') : null),
    ...checkMigrations(readdirSync(join(root, 'supabase/migrations'))),
    ...(live ? await probeLive(env) : []),
  ];
  const source = loaded.length ? `environment + ${loaded.join(', ')}` : 'environment only';
  console.log(
    formatReport(
      results,
      `Stubbed launch check (${live ? 'offline + live probes' : 'offline; add --live to probe services'}; ${source})`,
    ),
  );
  process.exitCode = exitCode(results);
}

main().catch((e: unknown) => {
  console.error(`launch:check crashed: ${e instanceof Error ? e.name : 'error'}`);
  process.exitCode = 2;
});
