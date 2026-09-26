/**
 * GAP-06 (DELETE /api/me, live mode): `auth.admin.deleteUser` removes the auth.users row; everything the
 * user owns must follow through the `on delete cascade` chain, and the trigger-maintained title_stats
 * must be decremented for every cascaded stub and review. Other users are untouched.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, titleId } from './pg';

const A = '0a000000-0000-4000-8000-0000000000a1';
const B = '0b000000-0000-4000-8000-0000000000b1';
const OFFICE = 'tv:2316';
const DUNE = 'movie:693134';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, A, 'leaver');
  await createUser(db, B, 'stayer');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function count(table: string, uid: string): Promise<number> {
  const col = table === 'profiles' ? 'id' : 'user_id';
  const { rows } = await db.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where ${col} = $1`,
    [uid],
  );
  return rows[0]!.n;
}

async function stats(key: string) {
  const { rows } = await db.query<{ stub_count: number; review_count: number }>(
    'select stub_count, review_count from public.title_stats where title_id = $1',
    [await titleId(db, key)],
  );
  return rows[0] ?? { stub_count: 0, review_count: 0 };
}

describe('deleting the auth user cascades all user data', () => {
  it('removes profile, stubs, reviews (incl. stub-linked), watchlist and rate events', async () => {
    for (const uid of [A, B]) {
      const stub = await asUser(db, uid, () =>
        db.query<{ id: string }>(
          `select * from public.stub_insert($1, '2026-09-20', 'cinema', 'note')`,
          [OFFICE],
        ),
      );
      await db.query(
        `insert into public.reviews (user_id, title_id, rating_10, body, stub_id)
         values ($1, $2, 8, 'x', $3)`,
        [uid, await titleId(db, OFFICE), stub.rows[0]!.id],
      );
      await db.query('insert into public.watchlist (user_id, title_id) values ($1, $2)', [
        uid,
        await titleId(db, DUNE),
      ]);
      await asUser(db, uid, () => db.query(`select public.consume_rate_limit('export', 5, 600)`));
    }
    const before = await stats(OFFICE);
    expect(before).toMatchObject({ stub_count: 2, review_count: 2 });

    await db.query('delete from auth.users where id = $1', [A]);

    for (const t of ['profiles', 'stubs', 'reviews', 'watchlist', 'rate_events'])
      expect(await count(t, A), t).toBe(0);
    for (const t of ['profiles', 'stubs', 'reviews', 'watchlist', 'rate_events'])
      expect(await count(t, B), t).toBe(1);
    expect(await stats(OFFICE)).toMatchObject({ stub_count: 1, review_count: 1 });
    // The handle is free again.
    const { rows } = await db.query<{ ok: boolean }>(
      `select public.handle_available('leaver') as ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });
});
