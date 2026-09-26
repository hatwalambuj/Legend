/**
 * Live-mode read functions (supabase/migrations/20260926120000_user_data_reads.sql) on PGlite:
 * stub numbering, keyset pagination of diary/wallet/reviews, title states in one call, stats, and the
 * DB-backed rate limiter — including RLS behaviour under the API roles.
 */
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, createDb, createUser, titleId } from './pg';

const A = '0a000000-0000-4000-8000-00000000000a';
const B = '0b000000-0000-4000-8000-00000000000b';
const DUNE = 'movie:693134';
const INTERSTELLAR = 'movie:157336';
const OFFICE = 'tv:2316';

let db: PGlite;

beforeAll(async () => {
  db = await createDb();
  await createUser(db, A, 'alice');
  await createUser(db, B, 'bob');
}, 60_000);

afterAll(async () => {
  await db?.close();
});

async function seedStub(user: string, key: string, watchedOn: string, createdAt: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.stubs (user_id, title_id, watched_on, created_at) values ($1, $2, $3, $4) returning id`,
    [user, await titleId(db, key), watchedOn, createdAt],
  );
  return rows[0]!.id;
}

describe('stub_insert + stub_details', () => {
  it('inserts for the caller by title key and numbers watches chronologically', async () => {
    const first = await asUser(db, A, () =>
      db.query<{ id: string; number: number; title_key: string; user_id: string }>(
        `select * from public.stub_insert($1, '2026-09-20', 'cinema', 'first')`,
        [OFFICE],
      ),
    );
    expect(first.rows[0]).toMatchObject({ number: 1, title_key: OFFICE, user_id: A });
    // An earlier watch logged later becomes #1 and pushes the other to #2.
    const earlier = await asUser(db, A, () =>
      db.query<{ number: number }>(`select * from public.stub_insert($1, '2026-01-02', null, '')`, [
        OFFICE,
      ]),
    );
    expect(earlier.rows[0]!.number).toBe(1);
    const again = await db.query<{ number: number }>(
      'select number from public.stub_details where id = $1',
      [first.rows[0]!.id],
    );
    expect(again.rows[0]!.number).toBe(2);
  });

  it('rejects unknown titles and anonymous callers', async () => {
    await expect(
      asUser(db, A, () =>
        db.query(`select * from public.stub_insert('movie:1', '2026-09-20', null, '')`),
      ),
    ).rejects.toThrow(/unknown_title/);
    await expect(
      asUser(db, null, () =>
        db.query(`select * from public.stub_insert($1, '2026-09-20', null, '')`, [DUNE]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('user_diary / user_wallet keyset pagination', () => {
  it('walks the diary newest first across pages without gaps or overlaps', async () => {
    await seedStub(B, DUNE, '2026-03-02', '2026-03-02T20:00:00Z');
    await seedStub(B, DUNE, '2026-09-12', '2026-09-12T20:00:00Z');
    await seedStub(B, INTERSTELLAR, '2026-09-12', '2026-09-12T21:00:00Z');
    await seedStub(B, OFFICE, '2026-09-12', '2026-09-12T21:00:00Z'); // same created_at → id tie-break
    await seedStub(B, OFFICE, '2025-12-24', '2025-12-24T10:00:00Z');
    const all = await db.query<{ id: string; watched_on: string; created_at: string }>(
      `select id, watched_on::text, created_at from public.stubs where user_id = $1
        order by watched_on desc, created_at desc, id asc`,
      [B],
    );
    const got: string[] = [];
    let after: unknown[] | null = null;
    for (let i = 0; i < 10; i++) {
      const res: {
        rows: { id: string; watched_on: string; created_at: string; number: number }[];
      } = await asUser(db, null, () =>
        db.query(
          `select id, watched_on::text, created_at::text, number from public.user_diary($1, 'all', $2::jsonb, 2)`,
          [B, after ? JSON.stringify(after) : null],
        ),
      );
      if (res.rows.length === 0) break;
      got.push(...res.rows.map((r) => r.id));
      const last = res.rows[res.rows.length - 1]!;
      after = [last.watched_on, last.created_at, last.id];
    }
    expect(got).toEqual(all.rows.map((r) => r.id));

    const tv = await db.query<{ title_key: string; number: number }>(
      `select title_key, number from public.user_diary($1, 'tv', null, 10)`,
      [B],
    );
    expect(tv.rows).toEqual([
      { title_key: OFFICE, number: 2 },
      { title_key: OFFICE, number: 1 },
    ]);
  });

  it('groups the wallet per title, newest last-watched first', async () => {
    const res = await db.query<{ title_key: string; count: number; last_watched_on: string }>(
      `select title_key, count, last_watched_on::text from public.user_wallet($1, null, 10)`,
      [B],
    );
    expect(res.rows.map((r) => [r.title_key, r.count])).toEqual([
      [INTERSTELLAR, 1],
      [OFFICE, 2],
      [DUNE, 2],
    ]);
    const page2 = await db.query<{ title_key: string }>(
      `select title_key from public.user_wallet($1, $2::jsonb, 10)`,
      [
        B,
        JSON.stringify([
          res.rows[0]!.last_watched_on,
          (
            await db.query<{ lc: string }>(
              `select last_created_at::text as lc from public.user_wallet($1, null, 1)`,
              [B],
            )
          ).rows[0]!.lc,
          INTERSTELLAR,
        ]),
      ],
    );
    expect(page2.rows.map((r) => r.title_key)).toEqual([OFFICE, DUNE]);
  });
});

describe('reviews, title states and stats', () => {
  it('lists title reviews newest/highest with authors and stub numbers', async () => {
    const stub2 = (
      await db.query<{ id: string }>(
        `select id from public.stub_details where user_id = $1 and title_key = $2 and number = 2`,
        [B, DUNE],
      )
    ).rows[0]!.id;
    await asUser(db, B, async () => {
      await db.query(
        `insert into public.reviews (user_id, title_id, rating_10, body, stub_id) values ($1, $2, 9, 'great', $3)`,
        [B, await titleId(db, DUNE), stub2],
      );
    });
    await asUser(db, A, async () => {
      await db.query(
        `insert into public.reviews (user_id, title_id, rating_10, body) values ($1, $2, 6, 'ok')`,
        [A, await titleId(db, DUNE)],
      );
    });
    const newest = await asUser(db, null, () =>
      db.query<{ rating_10: number; author: { handle: string }; stub_number: number | null }>(
        `select rating_10, author, stub_number from public.title_reviews($1, 'newest', null, 10)`,
        [DUNE],
      ),
    );
    expect(newest.rows.map((r) => [r.author.handle, r.rating_10, r.stub_number])).toEqual([
      ['alice', 6, null],
      ['bob', 9, 2],
    ]);
    const highest = await db.query<{ rating_10: number; created_at: string; id: string }>(
      `select rating_10, created_at::text, id from public.title_reviews($1, 'highest', null, 1)`,
      [DUNE],
    );
    expect(highest.rows.map((r) => r.rating_10)).toEqual([9]);
    const h = highest.rows[0]!;
    const next = await db.query<{ rating_10: number }>(
      `select rating_10 from public.title_reviews($1, 'highest', $2::jsonb, 5)`,
      [DUNE, JSON.stringify([h.rating_10, h.created_at, h.id])],
    );
    expect(next.rows.map((r) => r.rating_10)).toEqual([6]);
  });

  it('returns personal state for many keys in one call; the watchlist stays private', async () => {
    const interstellar = await titleId(db, INTERSTELLAR);
    await asUser(db, B, () =>
      db.query(`insert into public.watchlist (user_id, title_id) values ($1, $2)`, [
        B,
        interstellar,
      ]),
    );
    const mine = await asUser(db, B, () =>
      db.query<{
        title_key: string;
        stub_count: number;
        has_stub_today: boolean;
        watchlisted: boolean;
        review_id: string | null;
      }>(`select * from public.user_title_states($1, $2, '2026-09-12') order by title_key`, [
        B,
        [DUNE, INTERSTELLAR, 'movie:238'],
      ]),
    );
    const byKey = Object.fromEntries(mine.rows.map((r) => [r.title_key, r]));
    expect(byKey[DUNE]).toMatchObject({ stub_count: 2, has_stub_today: true, watchlisted: false });
    expect(byKey[DUNE]!.review_id).toBeTruthy();
    expect(byKey[INTERSTELLAR]).toMatchObject({
      stub_count: 1,
      watchlisted: true,
      review_id: null,
    });
    expect(byKey['movie:238']).toMatchObject({ stub_count: 0, has_stub_today: false });
    // Someone else asking about B's watchlist sees nothing (RLS).
    const other = await asUser(db, A, () =>
      db.query<{ watchlisted: boolean }>(
        `select watchlisted from public.user_title_states($1, $2, '2026-09-12')`,
        [B, [INTERSTELLAR]],
      ),
    );
    expect(other.rows[0]!.watchlisted).toBe(false);
  });

  it('exposes trigger-maintained title stats and profile stats', async () => {
    const stats = await asUser(db, null, () =>
      db.query<{
        stub_count: number;
        review_count: number;
        rating_sum: number;
        rating_count: number;
      }>(`select * from public.title_stats_by_key($1)`, [DUNE]),
    );
    expect(stats.rows[0]).toEqual({
      stub_count: 2,
      review_count: 2,
      rating_sum: 15,
      rating_count: 2,
    });
    const none = await db.query<{ stub_count: number }>(
      `select * from public.title_stats_by_key('movie:238')`,
    );
    expect(none.rows[0]!.stub_count).toBe(0);

    const p = await asUser(db, null, () =>
      db.query<{ s: Record<string, unknown> }>(`select public.profile_stats($1, 2026) as s`, [B]),
    );
    const s = p.rows[0]!.s as {
      total_stubs: number;
      stubs_this_year: number;
      titles_stubbed: number;
      review_count: number;
      most_stubbed: { count: number; title: { title_key: string } };
      latest: { title_key: string };
    };
    expect(s.total_stubs).toBe(5);
    expect(s.stubs_this_year).toBe(4);
    expect(s.titles_stubbed).toBe(3);
    expect(s.review_count).toBe(1);
    expect(s.most_stubbed.count).toBe(2);
    // Same order as the diary (the seeded tie on watched_on + created_at is broken by id).
    const first = await db.query<{ title_key: string }>(
      `select title_key from public.user_diary($1, 'all', null, 1)`,
      [B],
    );
    expect(s.latest.title_key).toBe(first.rows[0]!.title_key);
  });
});

describe('consume_rate_limit', () => {
  it('allows max hits per window per user and kind, then returns seconds to wait', async () => {
    const hit = (uid: string, kind = 'export') =>
      asUser(db, uid, () =>
        db.query<{ r: number }>(`select public.consume_rate_limit($1, 1, 600) as r`, [kind]),
      ).then((x) => x.rows[0]!.r);
    expect(await hit(A)).toBe(0);
    const wait = await hit(A);
    expect(wait).toBeGreaterThan(590);
    expect(wait).toBeLessThanOrEqual(600);
    expect(await hit(B)).toBe(0); // per user
    expect(await hit(A, 'other')).toBe(0); // per kind
    await expect(
      asUser(db, null, () => db.query(`select public.consume_rate_limit('export', 1, 600)`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, () => db.query('select * from public.rate_events'))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('reviewer hardening (migrations/20260926180000_review_hardening.sql)', () => {
  const C = '0c000000-0000-4000-8000-00000000000c';
  beforeAll(async () => {
    await createUser(db, C, 'carol');
  });

  it('API roles cannot choose created_at / edited_at (rate-limit bypass, "Newest" pinning)', async () => {
    const dune = await titleId(db, DUNE);
    const stub = await asUser(db, C, () =>
      db.query<{ created_at: Date }>(
        `insert into public.stubs (user_id, title_id, watched_on, created_at, updated_at)
         values ($1, $2, '2026-09-01', '2000-01-01', '2000-01-01') returning created_at`,
        [C, dune],
      ),
    );
    expect(Date.now() - new Date(stub.rows[0]!.created_at).getTime()).toBeLessThan(60_000);
    const review = await asUser(db, C, () =>
      db.query<{ id: string; created_at: Date; edited_at: Date | null }>(
        `insert into public.reviews (user_id, title_id, rating_10, created_at, edited_at)
         values ($1, $2, 8, '2099-01-01', '2099-01-01') returning id, created_at, edited_at`,
        [C, dune],
      ),
    );
    const r = review.rows[0]!;
    expect(new Date(r.created_at).getFullYear()).toBeLessThan(2099);
    expect(r.edited_at).toBeNull();
    const upd = await asUser(db, C, () =>
      db.query<{ created_at: Date; edited_at: Date | null }>(
        `update public.reviews set created_at = '2099-01-01', edited_at = '2099-01-01'
          where id = $1 returning created_at, edited_at`,
        [r.id],
      ),
    );
    expect(new Date(upd.rows[0]!.created_at).getTime()).toBe(new Date(r.created_at).getTime());
    expect(upd.rows[0]!.edited_at).toBeNull(); // no content change → not "EDITED"
  });

  it('counts diary rows per type', async () => {
    const all = await asUser(db, null, () =>
      db.query<{ n: number }>(`select public.user_diary_count($1) as n`, [B]),
    );
    const tv = await db.query<{ n: number }>(`select public.user_diary_count($1, 'tv') as n`, [B]);
    expect(all.rows[0]!.n).toBe(5);
    expect(tv.rows[0]!.n).toBeGreaterThan(0);
    expect(tv.rows[0]!.n).toBeLessThan(5);
  });

  it('rejects non-https avatar URLs', async () => {
    await expect(
      asUser(db, C, () =>
        db.query(`update public.profiles set avatar_url = 'javascript:alert(1)' where id = $1`, [
          C,
        ]),
      ),
    ).rejects.toThrow(/profiles_avatar_https/);
  });
});
