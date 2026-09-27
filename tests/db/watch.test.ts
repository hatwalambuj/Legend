/**
 * W-01 (ADR-012 §3) against real Postgres (PGlite): the where-to-watch migration compiles, RLS keeps
 * `user_settings` owner-only and `watch_provider` read-only for the API roles, the job RPCs can't be
 * executed by anon/authenticated, check constraints hold, and the RPCs do what the job relies on.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, titleId } from './pg';

const A = '0a000000-0000-4000-8000-0000000000a1';
const B = '0b000000-0000-4000-8000-0000000000b1';
let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, A, 'alice');
  await createUser(db, B, 'bob');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

const err = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e as { code?: string; message: string };
  }
};

describe('user_settings is owner-only (ADR-012 §3, §10.5)', () => {
  it('the owner sets, reads and clears their region through the invoker RPC', async () => {
    await asUser(db, A, () => db.query(`select public.user_settings_set_watch_region('GB')`));
    const own = await asUser(db, A, () =>
      db.query<{ watch_region: string | null }>('select watch_region from public.user_settings'),
    );
    expect(own.rows).toEqual([{ watch_region: 'GB' }]);
    await asUser(db, A, () => db.query(`select public.user_settings_set_watch_region(null)`));
    const cleared = await asUser(db, A, () =>
      db.query<{ watch_region: string | null }>('select watch_region from public.user_settings'),
    );
    expect(cleared.rows).toEqual([{ watch_region: null }]);
    await asUser(db, A, () => db.query(`select public.user_settings_set_watch_region('IN')`));
  });

  it("another user can't read or change it; anon sees nothing and can't write", async () => {
    const other = await asUser(db, B, () => db.query('select * from public.user_settings'));
    expect(other.rows).toEqual([]);
    const upd = await asUser(db, B, () =>
      db.query(`update public.user_settings set watch_region = 'US' where user_id = $1`, [A]),
    );
    expect(upd.affectedRows ?? 0).toBe(0);
    expect(
      await err(
        asUser(db, B, () =>
          db.query(`insert into public.user_settings (user_id, watch_region) values ($1, 'US')`, [
            A,
          ]),
        ),
      ),
    ).not.toBeNull();
    expect(
      await err(asUser(db, null, () => db.query('select * from public.user_settings'))),
    ).not.toBeNull();
    expect(
      await err(
        asUser(db, null, () => db.query(`select public.user_settings_set_watch_region('US')`)),
      ),
    ).not.toBeNull();
    const { rows } = await db.query<{ watch_region: string }>(
      'select watch_region from public.user_settings where user_id = $1',
      [A],
    );
    expect(rows).toEqual([{ watch_region: 'IN' }]);
  });

  it('only ^[A-Z]{2}$ is stored; users cannot delete or re-key rows', async () => {
    const bad = await err(
      asUser(db, B, () => db.query(`select public.user_settings_set_watch_region('gb')`)),
    );
    expect(bad?.code).toBe('23514');
    await asUser(db, B, () => db.query(`select public.user_settings_set_watch_region('US')`));
    expect(
      await err(asUser(db, B, () => db.query('delete from public.user_settings'))),
    ).not.toBeNull();
    expect(
      await err(asUser(db, B, () => db.query(`update public.user_settings set user_id = $1`, [A]))),
    ).not.toBeNull();
  });

  it('is deleted with the account (cascade from auth.users)', async () => {
    await db.query('delete from auth.users where id = $1', [B]);
    const { rows } = await db.query('select * from public.user_settings where user_id = $1', [B]);
    expect(rows).toEqual([]);
  });
});

describe('job RPCs are service-only; watch_provider is public read, no API writes', () => {
  it.each([
    [`select public.catalog_set_watch('[]'::jsonb)`],
    [`select * from public.catalog_watch_due(10)`],
    [`select public.watch_provider_set_priorities('[]'::jsonb)`],
  ])('%s is denied to anon and authenticated', async (sql) => {
    for (const uid of [null, A])
      expect(await err(asUser(db, uid, () => db.query(sql)))).not.toBeNull();
  });

  it('anon/authenticated can read watch_provider but not write it or catalog watch columns', async () => {
    await db.query(`insert into public.watch_provider (provider_id, name) values (8, 'Netflix')`);
    const r = await asUser(db, null, () =>
      db.query('select provider_id from public.watch_provider'),
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const uid of [null, A]) {
      expect(
        await err(
          asUser(db, uid, () =>
            db.query(`insert into public.watch_provider (provider_id, name) values (9, 'x')`),
          ),
        ),
      ).not.toBeNull();
      expect(
        await err(
          asUser(db, uid, () => db.query(`update public.catalog_index set watch = '{}'::jsonb`)),
        ),
      ).not.toBeNull();
    }
  });

  it('check constraints: provider id > 0, name 1..80, logo path shape, watch is an object <= 4 KB', async () => {
    for (const sql of [
      `insert into public.watch_provider (provider_id, name) values (0, 'x')`,
      `insert into public.watch_provider (provider_id, name) values (5, '')`,
      `insert into public.watch_provider (provider_id, name, logo_path) values (6, 'x', 'https://evil/x.png')`,
      `update public.catalog_index set watch = '[1]'::jsonb where id = (select min(id) from public.catalog_index)`,
      `update public.catalog_index set watch = jsonb_build_object('US', jsonb_build_object('b',
         (select jsonb_agg(g) from generate_series(1, 3000) g))) where id = (select min(id) from public.catalog_index)`,
    ])
      expect((await err(db.query(sql)))?.code).toBe('23514');
  });
});

describe('catalog_set_watch / catalog_watch_due / watch_provider_set_priorities (service role)', () => {
  it('stores watch, stamps checked_at, derives tags from s|f|a, upserts provider names only', async () => {
    const dune = await titleId(db, 'movie:693134');
    const n = await db.query<{ n: number }>(`select public.catalog_set_watch($1::jsonb) as n`, [
      JSON.stringify([
        {
          id: dune,
          watch: { US: { s: [1899], a: [73], r: [2, 3], b: [2, 3, 10] }, GB: { f: [38] } },
          providers: [
            { provider_id: 1899, name: 'Max', logo_path: '/max.jpg' },
            { provider_id: 73, name: 'Tubi', logo_path: 'bad path' },
            { provider_id: -1, name: 'bad', logo_path: null },
          ],
        },
        { id: dune, watch: 'not-an-object', providers: [] },
      ]),
    ]);
    expect(n.rows[0]!.n).toBe(1);
    const { rows } = await db.query<{
      watch: unknown;
      watch_tags: string[];
      fresh: boolean;
    }>(
      `select watch, watch_tags, watch_checked_at > now() - interval '1 minute' as fresh
         from public.catalog_index where id = $1`,
      [dune],
    );
    expect(rows[0]).toEqual({
      watch: { US: { s: [1899], a: [73], r: [2, 3], b: [2, 3, 10] }, GB: { f: [38] } },
      watch_tags: ['GB:38', 'US:1899', 'US:73'],
      fresh: true,
    });
    const p = await db.query<{
      provider_id: number;
      logo_path: string | null;
      priorities: unknown;
    }>(
      `select provider_id, logo_path, priorities from public.watch_provider where provider_id in (73, 1899) order by 1`,
    );
    expect(p.rows).toEqual([
      { provider_id: 73, logo_path: null, priorities: {} },
      { provider_id: 1899, logo_path: '/max.jpg', priorities: {} },
    ]);
  });

  it('due: never-checked first, fresh rows not due, old rows due after the TTL', async () => {
    const due = async (limit = 500) =>
      (
        await db.query<{ id: number }>(`select id from public.catalog_watch_due($1, 7, 1, 50)`, [
          limit,
        ])
      ).rows.map((r) => Number(r.id));
    const dune = await titleId(db, 'movie:693134');
    const all = await due();
    expect(all).not.toContain(dune);
    const total = await db.query<{ n: number }>(
      `select count(*)::int as n from public.catalog_index where source_status = 'active'`,
    );
    expect(all).toHaveLength(total.rows[0]!.n - 1);
    await db.query(
      `update public.catalog_index set watch_checked_at = now() - interval '8 days' where id = $1`,
      [dune],
    );
    expect(await due()).toContain(dune);
    // Never-checked rows come before a checked one.
    expect((await due()).at(-1)).toBe(dune);
    expect(await due(3)).toHaveLength(3);
    // Hot (top by popularity): due after 1 day instead of 7.
    await db.query(
      `update public.catalog_index set watch_checked_at = now() - interval '25 hours' where id = $1`,
      [dune],
    );
    const hot = await db.query<{ id: number }>(
      `select id from public.catalog_watch_due(500, 7, 1, 100)`,
    );
    expect(hot.rows.map((r) => Number(r.id))).toContain(dune);
    const notHot = await db.query<{ id: number }>(
      `select id from public.catalog_watch_due(500, 7, 1, 0)`,
    );
    // Dune (2024) is not "new" relative to the PGlite clock's current_date - 60 in 2026.
    expect(notHot.rows.map((r) => Number(r.id))).not.toContain(dune);
  });

  it('gone rows are never due', async () => {
    const id = await titleId(db, 'movie:278');
    await db.query(`update public.catalog_index set source_status = 'gone' where id = $1`, [id]);
    const { rows } = await db.query<{ id: number }>(`select id from public.catalog_watch_due(500)`);
    expect(rows.map((r) => Number(r.id))).not.toContain(id);
  });

  it('set_priorities replaces priorities and stamps priorities_at', async () => {
    await db.query(`select public.watch_provider_set_priorities($1::jsonb)`, [
      JSON.stringify([
        { provider_id: 8, name: 'Netflix', logo_path: '/n.jpg', priorities: { US: 1, GB: 2 } },
        { provider_id: 38, name: 'BBC iPlayer', logo_path: null, priorities: { GB: 4 } },
      ]),
    ]);
    await db.query(`select public.watch_provider_set_priorities($1::jsonb)`, [
      JSON.stringify([
        { provider_id: 8, name: 'Netflix', logo_path: '/n.jpg', priorities: { US: 3 } },
      ]),
    ]);
    const { rows } = await db.query<{ provider_id: number; priorities: unknown; stamped: boolean }>(
      `select provider_id, priorities, priorities_at is not null as stamped
         from public.watch_provider where provider_id in (8, 38) order by 1`,
    );
    expect(rows).toEqual([
      { provider_id: 8, priorities: { US: 3 }, stamped: true },
      { provider_id: 38, priorities: { GB: 4 }, stamped: true },
    ]);
  });

  it('watch_tags_of ignores malformed regions and ids', async () => {
    const { rows } = await db.query<{ t: string[] }>(
      `select public.watch_tags_of($1::jsonb) as t`,
      [
        JSON.stringify({
          US: { s: [8, 'x', -1], b: [10] },
          us: { s: [1] },
          GB: 'x',
          IN: { a: 's' },
        }),
      ],
    );
    expect(rows[0]!.t).toEqual(['US:8']);
  });
});
