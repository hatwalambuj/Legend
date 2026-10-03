/** scripts/lib/db-apply.ts against PGlite (real Postgres in WASM): order, idempotence, refusals. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { describe, expect, it } from 'vitest';
import {
  checksum,
  pgEnvFromUrl,
  pgliteDriver,
  plan,
  readMigrations,
  run,
  type MigrationFile,
} from './db-apply';

const ROOT = process.cwd();
const FILES = readMigrations(join(ROOT, 'supabase/migrations'));

async function freshDb() {
  const db = await PGlite.create({ extensions: { citext, pg_trgm } });
  await db.exec(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
  return db;
}

function capture() {
  const lines: string[] = [];
  return { lines, log: (...l: string[]) => lines.push(...l) };
}

const file = (name: string, sql: string): MigrationFile => ({ name, sql, checksum: checksum(sql) });

describe('db-apply on PGlite', () => {
  it('dry run by default: lists pending files and writes nothing', async () => {
    const db = await freshDb();
    const out = capture();
    expect(await run(pgliteDriver(db), FILES, { yes: false, log: out.log })).toBe(0);
    expect(out.lines.filter((l) => l.includes('pending'))).toHaveLength(FILES.length);
    expect(out.lines.join('\n')).toMatch(/Dry run: would apply/);
    const t = await db.query<{ ok: boolean }>(
      "select to_regclass('public._stubbed_migrations') is null and to_regclass('public.catalog_index') is null as ok",
    );
    expect(t.rows[0]!.ok).toBe(true);
  });

  it('--yes applies every file in name order, then is a no-op on re-run', async () => {
    const db = await freshDb();
    const d = pgliteDriver(db);
    expect(await run(d, FILES, { yes: true, log: () => undefined })).toBe(0);
    const rows = await db.query<{ name: string; checksum: string }>(
      'select name, checksum from public._stubbed_migrations order by applied_at, name',
    );
    expect(rows.rows.map((r) => r.name)).toEqual(FILES.map((f) => f.name));
    expect(rows.rows.map((r) => r.checksum)).toEqual(FILES.map((f) => f.checksum));
    // The schema really exists (health_probe comes from the ops migration).
    await db.query('select public.health_probe()');
    const again = capture();
    expect(await run(d, FILES, { yes: true, log: again.log })).toBe(0);
    expect(again.lines.join('\n')).toMatch(/Up to date/);
  });

  it('keeps the tracking table away from the API roles (RLS on, no grants)', async () => {
    const db = await freshDb();
    await run(pgliteDriver(db), FILES, { yes: true, log: () => undefined });
    const r = await db.query<{ rls: boolean; anon: boolean }>(
      `select c.relrowsecurity as rls,
              has_table_privilege('anon', 'public._stubbed_migrations', 'select') as anon
         from pg_class c where c.oid = 'public._stubbed_migrations'::regclass`,
    );
    expect(r.rows[0]).toEqual({ rls: true, anon: false });
  });

  it('applies only the new file later', async () => {
    const db = await freshDb();
    const d = pgliteDriver(db);
    await run(d, FILES, { yes: true, log: () => undefined });
    const extra = file('29990101000000_extra.sql', 'create table public.zz_extra (id int);');
    const out = capture();
    expect(await run(d, [...FILES, extra], { yes: true, log: out.log })).toBe(0);
    expect(out.lines.join('\n')).toMatch(/1 file\(s\) applied/);
    await db.query('select * from public.zz_extra');
  });

  it('refuses everything when an applied file changed', async () => {
    const db = await freshDb();
    const d = pgliteDriver(db);
    await run(d, FILES, { yes: true, log: () => undefined });
    const edited = FILES.map((f, i) => (i === 1 ? file(f.name, `${f.sql}\n-- edit`) : f));
    const extra = file('29990101000000_extra.sql', 'create table public.zz_never (id int);');
    const out = capture();
    expect(await run(d, [...edited, extra], { yes: true, log: out.log })).toBe(1);
    expect(out.lines.join('\n')).toMatch(/changed after it was applied/);
    const t = await db.query<{ ok: boolean }>("select to_regclass('public.zz_never') is null as ok");
    expect(t.rows[0]!.ok).toBe(true);
  });

  it('a failing file rolls back alone and stops the run', async () => {
    const db = await freshDb();
    const d = pgliteDriver(db);
    const a = file('20000101000000_a.sql', 'create table public.zz_a (id int);');
    const bad = file('20000101000001_bad.sql', 'create table public.zz_b (id int); select nope();');
    const c = file('20000101000002_c.sql', 'create table public.zz_c (id int);');
    const out = capture();
    expect(await run(d, [a, bad, c], { yes: true, log: out.log })).toBe(1);
    expect(out.lines.join('\n')).toMatch(/20000101000001_bad.sql failed and was rolled back/);
    const r = await db.query<{ a: boolean; b: boolean; c: boolean }>(
      "select to_regclass('public.zz_a') is not null as a, to_regclass('public.zz_b') is not null as b, to_regclass('public.zz_c') is not null as c",
    );
    expect(r.rows[0]).toEqual({ a: true, b: false, c: false });
    expect((await d.applied()).map((x) => x.name)).toEqual([a.name]);
  });

  it('hand-applied schema: refuses without --baseline, records without running with it', async () => {
    const db = await freshDb();
    for (const f of FILES) await db.exec(f.sql);
    const d = pgliteDriver(db);
    const out = capture();
    expect(await run(d, FILES, { yes: true, log: out.log })).toBe(1);
    expect(out.lines.join('\n')).toMatch(/--baseline --yes/);
    expect(await run(d, FILES, { yes: true, baseline: true, log: () => undefined })).toBe(0);
    expect(await d.applied()).toHaveLength(FILES.length);
    expect(await run(d, FILES, { yes: true, baseline: true, log: () => undefined })).toBe(1);
  });

  it('--baseline refuses on an empty database', async () => {
    const db = await freshDb();
    expect(await run(pgliteDriver(db), FILES, { yes: true, baseline: true, log: () => undefined })).toBe(1);
  });
});

describe('plan (pure)', () => {
  const a = file('20000101000000_a.sql', 'a');
  const b = file('20000101000001_b.sql', 'b');
  it('refuses a pending file older than the newest applied one', () => {
    const p = plan([a, b], [{ name: b.name, checksum: b.checksum }], true);
    expect(p.errors.join()).toMatch(/sorts before/);
  });
  it('refuses an applied file missing on disk', () => {
    const p = plan([a], [{ name: a.name, checksum: a.checksum }, { name: b.name, checksum: 'x' }], true);
    expect(p.errors.join()).toMatch(/not in supabase\/migrations/);
  });
  it('checksums ignore CRLF vs LF', () => {
    expect(checksum('a\r\nb')).toBe(checksum('a\nb'));
  });
});

describe('pgEnvFromUrl', () => {
  it('moves every part into libpq env vars (password never in argv)', () => {
    expect(
      pgEnvFromUrl('postgresql://postgres.ref:p%40ss@aws-0-eu.pooler.supabase.com:5432/postgres'),
    ).toEqual({
      PGHOST: 'aws-0-eu.pooler.supabase.com',
      PGPORT: '5432',
      PGDATABASE: 'postgres',
      PGSSLMODE: 'require',
      PGAPPNAME: 'stubbed-db-apply',
      PGUSER: 'postgres.ref',
      PGPASSWORD: 'p@ss',
    });
    expect(pgEnvFromUrl('postgres://u@localhost/x?sslmode=disable').PGSSLMODE).toBe('disable');
  });
  it('rejects non-postgres URLs without echoing them', () => {
    expect(() => pgEnvFromUrl('https://u:secret@h')).toThrow(/postgres:\/\//);
    try {
      pgEnvFromUrl('nonsense secret');
    } catch (e) {
      expect(String(e)).not.toContain('secret');
    }
  });
});
