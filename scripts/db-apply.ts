/**
 * Apply supabase/migrations/*.sql to the live database, in name order, once each (C-14, FOUNDER_INPUTS F3).
 * Logic + safety rules: scripts/lib/db-apply.ts. DRY RUN unless --yes.
 *
 *   SUPABASE_DB_URL=postgres://… npm run db:apply            # dry run: lists applied / pending files
 *   SUPABASE_DB_URL=postgres://… npm run db:apply -- --yes   # applies the pending files
 *   npm run db:apply -- --baseline --yes                     # schema applied by hand earlier: record only
 *   npm run db:apply -- --pglite --yes                       # rehearsal on in-memory WASM Postgres
 *
 * Needs the `psql` client for a real database (preinstalled on GitHub's ubuntu runners; macOS:
 * `brew install libpq`). Alternative without psql: `supabase link && supabase db push` (Supabase CLI).
 * SUPABASE_DB_URL = Supabase → Connect → Session pooler string. It is never printed.
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pgliteDriver, psqlAvailable, psqlDriver, readMigrations, run, type Driver } from './lib/db-apply';

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((a) => !['--yes', '--baseline', '--pglite'].includes(a));
  if (unknown.length) {
    console.error(`Unknown option(s): ${unknown.join(' ')}. Use --yes, --baseline or --pglite.`);
    return 2;
  }
  const root = process.cwd();
  const files = readMigrations(join(root, 'supabase/migrations'));
  let driver: Driver;
  let target: string;
  if (args.has('--pglite')) {
    const { PGlite } = await import('@electric-sql/pglite');
    const { citext } = await import('@electric-sql/pglite/contrib/citext');
    const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
    const db = await PGlite.create({ extensions: { citext, pg_trgm } });
    // Stand-in for Supabase's auth schema and API roles (tests/db/supabase-shim.sql).
    await db.exec(readFileSync(join(root, 'tests/db/supabase-shim.sql'), 'utf8'));
    driver = pgliteDriver(db);
    target = 'in-memory PGlite (rehearsal; nothing persists)';
  } else {
    const url = process.env.SUPABASE_DB_URL?.trim();
    if (!url) {
      console.error(
        'SUPABASE_DB_URL is not set. Supabase → Connect → "Session pooler" connection string (with the DB password).\n' +
          'Or use the Supabase CLI instead: `supabase link` then `supabase db push`.',
      );
      return 2;
    }
    if (!psqlAvailable()) {
      console.error(
        'The `psql` client is not installed (no Postgres driver is bundled, to keep dependencies at zero).\n' +
          'Install it (Ubuntu: `sudo apt-get install postgresql-client`; macOS: `brew install libpq`), use the\n' +
          '"Apply database migrations" GitHub workflow, or run `supabase link && supabase db push`.',
      );
      return 2;
    }
    driver = psqlDriver(url);
    target = `${new URL(url).hostname} (SUPABASE_DB_URL)`;
  }
  console.log(`Migrations: ${files.length} file(s) → ${target}${args.has('--yes') ? '' : ' [dry run]'}`);
  return run(driver, files, { yes: args.has('--yes'), baseline: args.has('--baseline') });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    const msg = e instanceof Error ? e.message.split('\n')[0] : 'error';
    console.error(`db:apply failed: ${msg}`);
    process.exitCode = 1;
  },
);
