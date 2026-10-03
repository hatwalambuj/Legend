/**
 * Ordered, checksum-tracked migration runner (C-14, FOUNDER_INPUTS F3). CLI: scripts/db-apply.ts.
 *
 * - Files: supabase/migrations/*.sql in name order (the 14-digit timestamp prefix sorts them).
 * - Tracking: `public._stubbed_migrations (name, checksum sha256, applied_at)`, RLS on and no grants for
 *   the API roles, so PostgREST never exposes it. Created only when something is applied.
 * - Each pending file runs in ONE transaction together with its tracking row: a failing file changes
 *   nothing and stops the run.
 * - Refuses (applies nothing) when an applied file's checksum changed, an applied file is missing on
 *   disk, a pending file sorts before the newest applied one, or the schema exists without tracking rows
 *   (applied by hand: `--baseline` records the files without running them).
 * - Drivers: `psql` (installed with every Postgres client; no new npm dependency) for a real database,
 *   PGlite (devDependency, WASM Postgres) for tests and `--pglite` rehearsals.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';

export const TRACKING_TABLE = 'public._stubbed_migrations';

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}
export interface AppliedRow {
  name: string;
  checksum: string;
}

export interface Driver {
  /** Tracking rows, [] when the table does not exist yet (read-only). */
  applied(): Promise<AppliedRow[]>;
  /** True when the Stubbed schema is already there (public.catalog_index exists). */
  hasSchema(): Promise<boolean>;
  /** Creates the tracking table if missing. */
  ensureTracking(): Promise<void>;
  /** Runs the file and inserts its tracking row in one transaction. */
  apply(file: MigrationFile): Promise<void>;
  /** Inserts the tracking row only (`--baseline`). */
  record(file: MigrationFile): Promise<void>;
}

const NAME = /^\d{14}_[a-z0-9_]+\.sql$/;

export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export function readMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      if (!NAME.test(name))
        throw new Error(`Bad migration file name: ${name} (expected <14 digits>_<a-z0-9_>.sql).`);
      const sql = readFileSync(join(dir, name), 'utf8');
      return { name, sql, checksum: checksum(sql) };
    });
}

export interface Plan {
  pending: MigrationFile[];
  applied: string[];
  /** Any entry means: apply nothing. */
  errors: string[];
}

export function plan(files: MigrationFile[], applied: AppliedRow[], hasSchema: boolean): Plan {
  const byName = new Map(applied.map((a) => [a.name, a.checksum]));
  const onDisk = new Set(files.map((f) => f.name));
  const errors: string[] = [];
  for (const f of files) {
    const sum = byName.get(f.name);
    if (sum !== undefined && sum !== f.checksum)
      errors.push(
        `${f.name} changed after it was applied (checksum differs). Never edit an applied migration: revert the edit and add a new migration file instead.`,
      );
  }
  for (const a of applied)
    if (!onDisk.has(a.name))
      errors.push(`${a.name} is recorded as applied but is not in supabase/migrations/.`);
  const pending = files.filter((f) => !byName.has(f.name));
  const newest = [...byName.keys()].sort().at(-1);
  for (const p of pending)
    if (newest && p.name < newest)
      errors.push(
        `${p.name} sorts before the newest applied migration (${newest}): rename it with a newer timestamp.`,
      );
  if (applied.length === 0 && hasSchema)
    errors.push(
      'The database already has the Stubbed schema (public.catalog_index) but no tracking rows. If every file in supabase/migrations/ was applied by hand (SQL editor or `supabase db push`), record them once with `--baseline --yes`; otherwise apply the missing files by hand first.',
    );
  return { pending, applied: files.filter((f) => byName.has(f.name)).map((f) => f.name), errors };
}

export interface RunOptions {
  yes: boolean;
  baseline?: boolean;
  /** One line per argument. */
  log?: (...lines: string[]) => void;
}

/** Plans, prints and (with `yes`) applies. Returns the process exit code. */
export async function run(
  driver: Driver,
  files: MigrationFile[],
  opts: RunOptions,
): Promise<number> {
  const log =
    opts.log ??
    ((...lines: string[]) => {
      for (const l of lines) console.log(l);
    });
  const [applied, hasSchema] = await Promise.all([driver.applied(), driver.hasSchema()]);
  const p = plan(files, applied, opts.baseline ? false : hasSchema);
  for (const name of p.applied) log(`  applied   ${name}`);
  for (const f of p.pending) log(`  ${opts.baseline ? 'record ' : 'pending'}   ${f.name}`);
  if (p.errors.length) {
    log('', 'Refusing to run:');
    for (const e of p.errors) log(`  - ${e}`);
    return 1;
  }
  if (opts.baseline && (applied.length > 0 || !hasSchema)) {
    log(
      '',
      applied.length > 0
        ? '--baseline only works on a database with no tracking rows yet.'
        : '--baseline needs the schema to exist already (public.catalog_index); run without it to apply.',
    );
    return 1;
  }
  if (p.pending.length === 0) {
    log('', 'Up to date: nothing to apply.');
    return 0;
  }
  const verb = opts.baseline ? 'record as applied (without running)' : 'apply';
  if (!opts.yes) {
    log('', `Dry run: would ${verb} ${p.pending.length} file(s). Re-run with --yes to do it.`);
    return 0;
  }
  await driver.ensureTracking();
  for (const f of p.pending) {
    try {
      await (opts.baseline ? driver.record(f) : driver.apply(f));
      log(`  ${opts.baseline ? 'recorded' : 'applied '}  ${f.name}`);
    } catch (e) {
      log('', `${f.name} failed and was rolled back; later files were not run.`);
      log(`  ${e instanceof Error ? e.message.split('\n')[0] : 'error'}`);
      return 1;
    }
  }
  log('', `Done: ${p.pending.length} file(s) ${opts.baseline ? 'recorded' : 'applied'}.`);
  return 0;
}

const TRACKING_DDL = `
create table if not exists ${TRACKING_TABLE} (
  name text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
comment on table ${TRACKING_TABLE} is 'Applied supabase/migrations files (scripts/db-apply.ts). Do not edit.';
alter table ${TRACKING_TABLE} enable row level security;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on ${TRACKING_TABLE} from %I', r);
    end if;
  end loop;
end $$;
`;
const APPLIED_SQL = `select name, checksum from ${TRACKING_TABLE} order by name`;
const TRACKING_EXISTS_SQL = `select to_regclass('${TRACKING_TABLE}') is not null as ok`;
const SCHEMA_EXISTS_SQL = `select to_regclass('public.catalog_index') is not null as ok`;

/** PGlite driver (tests, `--pglite`). */
export function pgliteDriver(db: PGlite): Driver {
  const flag = async (sql: string) => (await db.query<{ ok: boolean }>(sql)).rows[0]?.ok === true;
  const insert = 'insert into public._stubbed_migrations (name, checksum) values ($1, $2)';
  return {
    async applied() {
      if (!(await flag(TRACKING_EXISTS_SQL))) return [];
      return (await db.query<AppliedRow>(APPLIED_SQL)).rows;
    },
    hasSchema: () => flag(SCHEMA_EXISTS_SQL),
    async ensureTracking() {
      await db.exec(TRACKING_DDL);
    },
    async apply(f) {
      await db.transaction(async (tx) => {
        await tx.exec(f.sql);
        await tx.query(insert, [f.name, f.checksum]);
      });
    },
    async record(f) {
      await db.query(insert, [f.name, f.checksum]);
    },
  };
}

/**
 * libpq environment for `psql` from a postgres:// URL, so the password never appears in argv / `ps`.
 * Remote hosts default to sslmode=require (Supabase requires TLS).
 */
export function pgEnvFromUrl(url: string): Record<string, string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('SUPABASE_DB_URL is not a valid postgres:// connection string.');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:')
    throw new Error('SUPABASE_DB_URL must start with postgres:// or postgresql://.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const local = /^(localhost|127\.0\.0\.1|::1)$/.test(host);
  const out: Record<string, string> = {
    PGHOST: host,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres',
    PGSSLMODE: u.searchParams.get('sslmode') ?? (local ? 'prefer' : 'require'),
    PGAPPNAME: 'stubbed-db-apply',
  };
  if (u.username) out.PGUSER = decodeURIComponent(u.username);
  if (u.password) out.PGPASSWORD = decodeURIComponent(u.password);
  return out;
}

export function psqlAvailable(): boolean {
  const r = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

/** `psql` driver: one process per step, ON_ERROR_STOP, single transaction per file. */
export function psqlDriver(url: string): Driver {
  const pgEnv = pgEnvFromUrl(url);
  const psql = (input: string): string => {
    const r = spawnSync(
      'psql',
      ['-X', '-q', '-t', '-A', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      {
        input,
        encoding: 'utf8',
        env: { ...process.env, ...pgEnv },
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (r.error) throw new Error(`Could not start psql (${r.error.message}).`);
    if (r.status !== 0) {
      // psql errors never contain the password (it travels in PGPASSWORD); strip it anyway.
      const msg = (r.stderr || 'psql failed').trim();
      throw new Error(pgEnv.PGPASSWORD ? msg.split(pgEnv.PGPASSWORD).join('***') : msg);
    }
    return r.stdout;
  };
  const flag = (sql: string) => psql(`${sql};`).trim() === 't';
  const row = (f: MigrationFile) => {
    if (!NAME.test(f.name) || !/^[0-9a-f]{64}$/.test(f.checksum))
      throw new Error('Bad tracking row.');
    return `insert into ${TRACKING_TABLE} (name, checksum) values ('${f.name}', '${f.checksum}');`;
  };
  return {
    async applied() {
      if (!flag(TRACKING_EXISTS_SQL)) return [];
      return psql(`${APPLIED_SQL};`)
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [name = '', sum = ''] = l.split('\t');
          return { name, checksum: sum };
        });
    },
    async hasSchema() {
      return flag(SCHEMA_EXISTS_SQL);
    },
    async ensureTracking() {
      psql(TRACKING_DDL);
    },
    async apply(f) {
      psql(`begin;\n${f.sql}\n;\n${row(f)}\ncommit;\n`);
    },
    async record(f) {
      psql(row(f));
    },
  };
}
