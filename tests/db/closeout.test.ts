/**
 * ADR-013 close-out migrations against real Postgres (PGlite): watch filter + chips (C-02), stub season
 * (C-10), enrich core refresh + mark gone (C-06), avatar colour (C-12), events (C-09), imports (C-11).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENT_EVENT_NAMES } from '@/lib/analytics';
import { asUser, createDb, createUser, titleId } from './pg';

const A = '0a000000-0000-4000-8000-0000000000c1';
const B = '0b000000-0000-4000-8000-0000000000c2';
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

const key64 = (c: string) => c.repeat(64);

describe('C-02 watch filter + provider counts', () => {
  beforeAll(async () => {
    await db.query(
      `insert into public.watch_provider (provider_id, name, logo_path, priorities)
       values (8, 'Netflix', '/n.png', '{"US": 1}'), (337, 'Disney Plus', null, '{"US": 2}')`,
    );
    await db.query(
      `update public.catalog_index set watch = '{"US":{"s":[8]}}', watch_tags = '{US:8}',
         watch_checked_at = now() where title_key in ('movie:278', 'tv:1396')`,
    );
    // Stale (> 30 days) data never counts.
    await db.query(
      `update public.catalog_index set watch = '{"US":{"s":[337]}}', watch_tags = '{US:337}',
         watch_checked_at = now() - interval '40 days' where title_key = 'movie:238'`,
    );
  });

  it('filters by tag with the 30-day rule; order and count are consistent', async () => {
    const rows = await asUser(db, null, () =>
      db.query<{ title_key: string }>(
        `select title_key from public.catalog_page('all', 'rating_desc', null, 20, null, 'US:8')`,
      ),
    );
    expect(rows.rows.map((r) => r.title_key).sort()).toEqual(['movie:278', 'tv:1396']);
    const count = await asUser(db, null, () =>
      db.query<{ n: number }>(`select public.catalog_count('all', null, 'US:8') as n`),
    );
    expect(Number(count.rows[0]!.n)).toBe(2);
    const stale = await db.query<{ n: number }>(
      `select public.catalog_count('all', null, 'US:337') as n`,
    );
    expect(Number(stale.rows[0]!.n)).toBe(0);
    const all = await db.query<{ n: number }>(`select public.catalog_count('all') as n`);
    expect(Number(all.rows[0]!.n)).toBeGreaterThan(2);
    expect(
      await err(
        db.query(`select * from public.catalog_page('all', 'release_desc', null, 20, null, 'x')`),
      ),
    ).toMatchObject({ message: expect.stringContaining('invalid_watch_tag') });
  });

  it('watch_provider_counts: fresh listed rows only, by priority, count >= 1', async () => {
    const r = await asUser(db, null, () =>
      db.query<{ provider_id: number; name: string; count: number; priority: number }>(
        `select * from public.watch_provider_counts('US')`,
      ),
    );
    expect(r.rows).toEqual([
      { provider_id: 8, name: 'Netflix', logo_path: '/n.png', priority: 1, count: 2 },
    ]);
    const none = await db.query(`select * from public.watch_provider_counts('xx')`);
    expect(none.rows).toEqual([]);
  });
});

describe('C-10 stub season', () => {
  it('stub_insert takes a season for shows; movies and out-of-range seasons are rejected', async () => {
    const r = await asUser(db, A, () =>
      db.query<{ season: number; title_key: string }>(
        `select title_key, season from public.stub_insert('tv:1396', '2024-01-01', null, '', 2::smallint)`,
      ),
    );
    expect(r.rows).toEqual([{ title_key: 'tv:1396', season: 2 }]);
    const movie = await err(
      asUser(db, A, () =>
        db.query(
          `select * from public.stub_insert('movie:278', '2024-01-01', null, '', 1::smallint)`,
        ),
      ),
    );
    expect(movie?.message).toContain('season_on_movie');
    const range = await err(
      asUser(db, A, () =>
        db.query(
          `select * from public.stub_insert('tv:1396', '2024-01-01', null, '', 201::smallint)`,
        ),
      ),
    );
    expect(range).not.toBeNull();
    // The old 4-argument call still works (default null).
    const plain = await asUser(db, A, () =>
      db.query<{ season: number | null }>(
        `select season from public.stub_insert('tv:1396', '2024-01-02', null, '')`,
      ),
    );
    expect(plain.rows[0]!.season).toBeNull();
    const diary = await db.query<{ season: number | null }>(
      `select season from public.user_diary($1, 'tv') order by watched_on`,
      [A],
    );
    expect(diary.rows.map((d) => d.season)).toEqual([2, null]);
  });
});

describe('C-06 enrich core refresh', () => {
  it('core fields apply only to unlisted rows; is_listed and pitch_hook are untouched', async () => {
    const listed = await titleId(db, 'movie:278');
    await db.query(
      `update public.catalog_index set is_listed = false, pitch_hook = 'ours', synced_at = now() - interval '200 days' where title_key = 'movie:238'`,
    );
    const unlisted = await titleId(db, 'movie:238');
    const due = await db.query<{ id: number }>(`select id from public.catalog_enrich_due(5, 30)`);
    expect(Number(due.rows[0]!.id)).toBe(unlisted);
    const core = {
      title: 'New Title',
      original_title: 'New Title',
      slug: 'new-title',
      sort_title: 'new title',
      search_text: 'new title',
      overview_short: 'Short.',
      release_date: '1972-03-15',
      vote_average: 8.66,
      vote_count: 99,
      popularity: 1.5,
      poster_path: '/p.jpg',
      backdrop_path: null,
      genre_ids: [18],
      genres: [{ id: 18, name: 'Drama' }],
    };
    const rows = [listed, unlisted].map((id) => ({
      id,
      keywords: [],
      recommendation_keys: [],
      core,
    }));
    await db.query(`select public.catalog_set_enrichment($1::jsonb)`, [JSON.stringify(rows)]);
    const after = await db.query<{
      title_key: string;
      title: string;
      vote_average: string;
      is_listed: boolean;
      pitch_hook: string | null;
      fresh: boolean;
    }>(
      `select title_key, title, vote_average::text, is_listed, pitch_hook,
              synced_at > now() - interval '1 minute' as fresh
         from public.catalog_index where id in ($1, $2) order by title_key`,
      [listed, unlisted],
    );
    const by = Object.fromEntries(after.rows.map((r) => [r.title_key, r]));
    expect(by['movie:238']).toMatchObject({
      title: 'New Title',
      vote_average: '8.7',
      is_listed: false,
      pitch_hook: 'ours',
      fresh: true,
    });
    expect(by['movie:278']!.title).toBe('The Shawshank Redemption');
    expect(by['movie:278']!.is_listed).toBe(true);
  });

  it('catalog_mark_gone is job-only', async () => {
    const id = await titleId(db, 'movie:238');
    const n = await db.query<{ n: number }>(`select public.catalog_mark_gone($1::bigint[]) as n`, [
      [id],
    ]);
    expect(Number(n.rows[0]!.n)).toBe(1);
    expect(
      await err(asUser(db, A, () => db.query(`select public.catalog_mark_gone('{1}')`))),
    ).not.toBeNull();
    await db.query(`update public.catalog_index set source_status = 'active' where id = $1`, [id]);
  });

  it('gone rows are never due for enrichment; back to active → due again (AR-C3)', async () => {
    const id = await titleId(db, 'movie:238');
    await db.query(
      `update public.catalog_index set is_listed = false, enriched_at = null,
              synced_at = now() - interval '300 days' where id = $1`,
      [id],
    );
    const due = async () =>
      (
        await db.query<{ id: number }>(`select id from public.catalog_enrich_due(1000, 30)`)
      ).rows.map((r) => Number(r.id));
    expect((await due())[0]).toBe(id);
    await db.query(`select public.catalog_mark_gone($1::bigint[])`, [[id]]);
    expect(await due()).not.toContain(id);
    await db.query(`update public.catalog_index set source_status = 'active' where id = $1`, [id]);
    expect(await due()).toContain(id);
  });
});

describe('C-12 avatar colour', () => {
  it('the owner can set an allowed colour; review_details carries it', async () => {
    await asUser(db, A, () =>
      db.query(`update public.profiles set avatar_color = 'ocean' where id = $1`, [A]),
    );
    expect(
      await err(
        asUser(db, A, () =>
          db.query(`update public.profiles set avatar_color = 'pink' where id = $1`, [A]),
        ),
      ),
    ).not.toBeNull();
    const other = await asUser(db, B, () =>
      db.query(`update public.profiles set avatar_color = 'gold' where id = $1`, [A]),
    );
    expect(other.affectedRows ?? 0).toBe(0);
    const tid = await titleId(db, 'movie:278');
    await asUser(db, A, () =>
      db.query(`insert into public.reviews (user_id, title_id, rating_10) values ($1, $2, 8)`, [
        A,
        tid,
      ]),
    );
    const r = await db.query<{ author: { avatarColor: string } }>(
      `select author from public.review_details where user_id = $1`,
      [A],
    );
    expect(r.rows[0]!.author.avatarColor).toBe('ocean');
  });
});

describe('C-09 events', () => {
  it('events_track upsert-adds into today; anon/authenticated cannot read or execute', async () => {
    const rows = JSON.stringify([
      { name: 'stub_created', dim: '', n: 1 },
      { name: 'stub_created', dim: '', n: 2 },
      { name: 'share_generated', dim: 'title:copy', n: 1 },
      { name: 'BAD NAME', dim: '', n: 1 },
    ]);
    await db.query(`select public.events_track($1::jsonb)`, [rows]);
    await db.query(`select public.events_track($1::jsonb)`, [
      JSON.stringify([{ name: 'stub_created', dim: '', n: 1 }]),
    ]);
    const r = await db.query<{ name: string; count: string }>(
      `select name, count::text from public.events order by name`,
    );
    expect(r.rows).toEqual([
      { name: 'share_generated', count: '1' },
      { name: 'stub_created', count: '4' },
    ]);
    for (const uid of [null, A]) {
      expect(
        await err(asUser(db, uid, () => db.query('select * from public.events'))),
      ).not.toBeNull();
      expect(
        await err(asUser(db, uid, () => db.query(`select public.events_track('[]')`))),
      ).not.toBeNull();
      expect(
        await err(asUser(db, uid, () => db.query('select * from public.metrics_weekly'))),
      ).not.toBeNull();
    }
    const m = await db.query<{ week: string; events: Record<string, number> }>(
      'select * from public.metrics_weekly',
    );
    expect(m.rows).toHaveLength(8);
    expect(Number(m.rows[0]!.events.stub_created)).toBe(4);
    await db.query(`select public.events_purge(400)`);
  });

  it('events_track creates at most 1,000 distinct rows per day; existing rows still count (SR-1)', async () => {
    await db.query('delete from public.events');
    const batch = (from: number) =>
      JSON.stringify(
        Array.from({ length: 50 }, (_, i) => ({
          name: 'provider_clicked',
          dim: `stream:US:${from + i}:home`,
          n: 1,
        })),
      );
    for (let b = 0; b < 21; b++)
      await db.query(`select public.events_track($1::jsonb)`, [batch(1 + b * 50)]);
    const total = async () =>
      Number(
        (await db.query<{ n: string }>('select count(*)::text as n from public.events')).rows[0]!.n,
      );
    expect(await total()).toBe(1000);
    await db.query(`select public.events_track($1::jsonb)`, [
      JSON.stringify([
        { name: 'provider_clicked', dim: 'stream:US:1:home', n: 1 },
        { name: 'stub_created', dim: '', n: 1 },
        { name: 'provider_clicked', dim: 'stream:US:9998:home', n: 1 },
      ]),
    ]);
    // The new client dim is dropped; the server event has its own cap (AR-C4).
    expect(await total()).toBe(1001);
    const one = await db.query<{ count: string }>(
      `select count::text from public.events where dim = 'stream:US:1:home'`,
    );
    expect(one.rows[0]!.count).toBe('2');
    await db.query('delete from public.events');
  });

  it('server events have their own 300/day cap and are never starved by client events (AR-C4)', async () => {
    await db.query('delete from public.events');
    const track = (rows: unknown[]) =>
      db.query(`select public.events_track($1::jsonb)`, [JSON.stringify(rows)]);
    for (let b = 0; b < 21; b++)
      await track(
        Array.from({ length: 50 }, (_, i) => ({
          name: 'provider_clicked',
          dim: `stream:US:${1 + b * 50 + i}:home`,
        })),
      );
    await track([
      { name: 'stub_created', dim: '' },
      { name: 'server_error', dim: 'api:titles' },
      { name: 'provider_clicked', dim: 'stream:US:9999:home' },
    ]);
    const count = async (where: string) =>
      Number(
        (
          await db.query<{ n: string }>(
            `select count(*)::text as n from public.events where ${where}`,
          )
        ).rows[0]!.n,
      );
    expect(await count(`name = 'provider_clicked'`)).toBe(1000);
    expect(await count(`name in ('stub_created', 'server_error')`)).toBe(2);
    for (let b = 0; b < 7; b++)
      await track(
        Array.from({ length: 50 }, (_, i) => ({
          name: 'server_error',
          dim: `route:a${b * 50 + i}`,
        })),
      );
    expect(await count(`name <> 'provider_clicked'`)).toBe(300);
    expect(await count('true')).toBe(1300);
    await db.query('delete from public.events');
  });

  it("events_track's client-name list matches CLIENT_EVENT_NAMES (AR-C4)", () => {
    const files = ['20261004091000_events_source_caps.sql'];
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations', files[0]!), 'utf8');
    const list = /v_clients text\[\] := array\[([^\]]+)\]/.exec(sql)![1]!;
    const names = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(names.sort()).toEqual([...CLIENT_EVENT_NAMES].sort());
  });
});

describe('C-11 imports', () => {
  const rows = (k: string) =>
    JSON.stringify([
      { title_key: 'movie:278', import_key: key64(k), watched_on: '2020-05-01', season: null },
      { title_key: 'movie:278', rating_10: 9, body: 'Great', is_spoiler: false },
      // Before release − 1: skipped, never aborts the batch.
      { title_key: 'movie:278', import_key: key64('z'), watched_on: '1900-01-01' },
      { title_key: 'tv:1396', import_key: key64('y'), watched_on: '2020-06-01', season: 3 },
    ]);

  it('import_apply is idempotent, never overwrites a review, and bypasses the per-minute limit only inside it', async () => {
    const first = await asUser(db, B, () =>
      db.query<{ r: { stubs: number; reviews: number } }>(
        `select public.import_apply('letterboxd', $1::jsonb) as r`,
        [rows('a')],
      ),
    );
    expect(first.rows[0]!.r).toEqual({ stubs: 2, reviews: 1 });
    const again = await asUser(db, B, () =>
      db.query<{ r: { stubs: number; reviews: number } }>(
        `select public.import_apply('letterboxd', $1::jsonb) as r`,
        [rows('a')],
      ),
    );
    expect(again.rows[0]!.r).toEqual({ stubs: 0, reviews: 0 });
    const src = await db.query<{ source: string; season_number: number | null }>(
      `select source, season_number from public.stubs where user_id = $1 order by watched_on`,
      [B],
    );
    expect(src.rows).toEqual([
      { source: 'import', season_number: null },
      { source: 'import', season_number: 3 },
    ]);
    // 40 imported rows in a minute: no rate limit inside import_apply …
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => ({
        title_key: 'movie:278',
        import_key: (i.toString(16).padStart(2, '0') + 'b').repeat(22).slice(0, 64),
        watched_on: '2021-01-01',
      })),
    );
    const bulk = await asUser(db, B, () =>
      db.query<{ r: { stubs: number } }>(`select public.import_apply('imdb', $1::jsonb) as r`, [
        many,
      ]),
    );
    expect(bulk.rows[0]!.r.stubs).toBe(40);
    // … and imported rows don't count toward the app limit; a direct insert can't fake an import.
    const tid = await titleId(db, 'movie:278');
    await asUser(db, B, () =>
      db.query(
        `insert into public.stubs (user_id, title_id, watched_on, source, import_key) values ($1, $2, '2022-01-01', 'import', $3)`,
        [B, tid, key64('q')],
      ),
    );
    const direct = await db.query<{ source: string; import_key: string | null }>(
      `select source, import_key from public.stubs where user_id = $1 and watched_on = '2022-01-01'`,
      [B],
    );
    expect(direct.rows).toEqual([{ source: 'app', import_key: null }]);
    expect(
      await err(asUser(db, null, () => db.query(`select public.import_apply('imdb', '[]')`))),
    ).not.toBeNull();
  });

  it('catalog_match: tmdb → imdb → title + year ±1 + type', async () => {
    const items = JSON.stringify([
      { ref: 'a', media_type: 'movie', tmdb_id: 278 },
      { ref: 'b', imdb_id: 'tt0068646' },
      { ref: 'c', title_norm: 'breaking bad', year: 2009, media_type: 'tv' },
      { ref: 'd', title_norm: 'breaking bad', year: 2015 },
      { ref: 'e', title_norm: 'no such film' },
    ]);
    const r = await asUser(db, null, () =>
      db.query<{ ref: string; title: { title_key: string } }>(
        `select ref, title from public.catalog_match($1::jsonb) order by ref`,
        [items],
      ),
    );
    expect(r.rows.map((x) => [x.ref, x.title.title_key])).toEqual([
      ['a', 'movie:278'],
      ['b', 'movie:238'],
      ['c', 'tv:1396'],
    ]);
  });
});
