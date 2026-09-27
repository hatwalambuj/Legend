/**
 * Applies supabase/migrations to PGlite (real Postgres compiled to WASM) behind a tiny Supabase shim and
 * checks: the schema compiles, SQL ordering/keyset pagination matches src/lib/catalog-order.ts for every
 * sort, accent-insensitive search, RLS ownership rules, rate-limit + aggregate triggers.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog } from '@/fixtures/schema';
import { decodeCursor, encodeCursor, paginate, SORT_KEYS, sortTuple } from '@/lib/catalog-order';
import { DEFAULT_CURATION_RULE, isListed } from '@/lib/curation';
import { normalizeSearch, sortTitle } from '@/lib/text';
import type { SortKey, TitleSummary, TypeFilter } from '@/lib/types';

const ROOT = process.cwd();
const catalog = catalogJson as unknown as FixtureCatalog;
const TODAY = '2026-09-26';

let db: PGlite;

async function asUser<T>(uid: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(
    uid
      ? `set role authenticated; select set_config('request.jwt.claim.sub', '${uid}', false);`
      : 'set role anon;',
  );
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { citext, pg_trgm } });
  await db.exec(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase/migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort()) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  for (const t of catalog.titles) {
    const listed = isListed(
      {
        mediaType: t.mediaType,
        voteAverage: t.voteAverage,
        voteCount: t.voteCount,
        genreIds: t.genres.map((g) => g.id),
        releaseDate: t.releaseDate,
      },
      DEFAULT_CURATION_RULE,
      TODAY,
    );
    await db.query(
      `insert into public.catalog_index (media_type, tmdb_id, imdb_id, title, original_title, slug, overview_short,
         release_date, vote_average, vote_count, popularity, genre_ids, genres, poster_path, backdrop_path, palette,
         sort_title, search_text, is_listed, imdb_rating, imdb_votes, runtime_minutes, season_count, episode_count,
         episode_runtime, series_status, tagline, certification, keywords, recommendation_keys, pitch_hook)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
               $28,$29,$30,$31)`,
      [
        t.mediaType,
        t.tmdbId,
        t.imdbId,
        t.title,
        t.originalTitle,
        t.slug,
        t.overviewShort,
        t.releaseDate,
        t.voteAverage,
        t.voteCount,
        t.popularity,
        t.genres.map((g) => g.id),
        JSON.stringify(t.genres),
        t.posterPath,
        t.backdropPath,
        JSON.stringify(t.palette),
        sortTitle(t.title),
        normalizeSearch(`${t.title} ${t.originalTitle}`),
        listed,
        t.imdbRating,
        t.imdbVotes,
        t.runtimeMinutes,
        t.seasonCount,
        t.episodeCount,
        t.episodeRuntimeMinutes,
        t.seriesStatus,
        t.tagline,
        t.certification,
        t.keywords,
        t.recommendationKeys,
        t.pitchHook,
      ],
    );
  }
}, 60_000);

afterAll(async () => {
  await db?.close();
});

interface Row {
  title_key: string;
  title: string;
  release_date: string | Date;
  vote_average: string | number;
  vote_count: number;
  popularity: number;
  media_type: 'movie' | 'tv';
}

const toSortable = (r: Row) => ({
  key: r.title_key as TitleSummary['key'],
  title: r.title,
  releaseDate:
    typeof r.release_date === 'string'
      ? r.release_date.slice(0, 10)
      : r.release_date.toISOString().slice(0, 10),
  voteAverage: Number(r.vote_average),
  voteCount: r.vote_count,
  popularity: r.popularity,
});

describe('migrations', () => {
  it('curates: edge cases excluded, boundaries included', async () => {
    const { rows } = await db.query<{ title_key: string }>(
      'select title_key from public.catalog_index where is_listed',
    );
    const keys = new Set(rows.map((r) => r.title_key));
    expect(keys.has('movie:8966')).toBe(false); // 6.4
    expect(keys.has('movie:11830')).toBe(false); // low votes
    expect(keys.has('tv:110382')).toBe(false); // 99 votes
    expect(keys.has('tv:34549')).toBe(false); // reality
    expect(keys.has('movie:370755')).toBe(true); // 6.5 / 200
    expect(keys.has('tv:96580')).toBe(true); // 6.5 / 100
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });

  const types: TypeFilter[] = ['all', 'movie', 'tv'];
  for (const sort of SORT_KEYS) {
    for (const type of types) {
      it(`catalog_page(${type}, ${sort}) matches the JS reference order across pages`, async () => {
        const all = (await db.query<Row>('select * from public.catalog_index where is_listed')).rows
          .filter((r) => type === 'all' || r.media_type === type)
          .map(toSortable);
        const expected: string[] = [];
        let cursor: string | null = null;
        do {
          const page: ReturnType<typeof paginate<(typeof all)[number]>> = paginate(
            all,
            sort as SortKey,
            cursor,
            7,
          );
          expected.push(...page.items.map((x) => x.key));
          cursor = page.nextCursor;
        } while (cursor);

        const got: string[] = [];
        let after: unknown[] | null = null;
        for (let guard = 0; guard < 50; guard++) {
          const res: { rows: Row[] } = await asUser(null, () =>
            db.query<Row>('select * from public.catalog_page($1, $2, $3::jsonb, 7)', [
              type,
              sort,
              after ? JSON.stringify(after) : null,
            ]),
          );
          if (res.rows.length === 0) break;
          got.push(...res.rows.map((r) => r.title_key));
          const last = res.rows[res.rows.length - 1]!;
          // Round-trip through the real cursor codec.
          after = decodeCursor(
            encodeCursor(sort as SortKey, sortTuple(toSortable(last), sort as SortKey)),
            sort as SortKey,
          );
        }
        expect(got).toEqual(expected);
      });
    }
  }

  it('catalog_search is accent- and case-insensitive and only returns listed titles', async () => {
    const q = normalizeSearch('SHOGUN');
    const { rows } = await asUser(null, () =>
      db.query<Row>('select * from public.catalog_search($1)', [q]),
    );
    expect(rows.map((r) => r.title)).toContain('Shōgun');
    const tw = await db.query<Row>('select * from public.catalog_search($1)', [
      normalizeSearch('twilight'),
    ]);
    expect(tw.rows).toHaveLength(0);
  });
});

describe('auth trigger + RLS', () => {
  const A = '00000000-0000-4000-8000-00000000aaaa';
  const B = '00000000-0000-4000-8000-00000000bbbb';
  let titleId = 0;

  beforeAll(async () => {
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'a@x.test', '{"handle":"alice","display_name":"Alice"}')`,
      [A],
    );
    await db.query(
      `insert into auth.users (id, email, raw_user_meta_data) values ($1, 'b@x.test', '{"handle":"bob"}')`,
      [B],
    );
    titleId = (
      await db.query<{ id: number }>(
        `select id from public.catalog_index where title_key = 'movie:693134'`,
      )
    ).rows[0]!.id;
  });

  it('creates profiles from sign-up metadata and rejects reserved handles', async () => {
    const { rows } = await db.query<{ handle: string }>(
      'select handle from public.profiles order by handle',
    );
    expect(rows.map((r) => r.handle)).toEqual(['alice', 'bob']);
    await expect(
      db.query(
        `insert into auth.users (email, raw_user_meta_data) values ('c@x.test', '{"handle":"admin"}')`,
      ),
    ).rejects.toThrow(/invalid_handle/);
    const avail = await asUser(null, () =>
      db.query<{ ok: boolean }>(`select public.handle_available('alice') as ok`),
    );
    expect(avail.rows[0]!.ok).toBe(false);
  });

  it('lets users write only their own stubs; stats follow', async () => {
    await asUser(A, () =>
      db.query(
        `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2026-09-01')`,
        [A, titleId],
      ),
    );
    await asUser(A, () =>
      db.query(
        `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2026-09-02')`,
        [A, titleId],
      ),
    );
    await expect(
      asUser(B, () =>
        db.query(
          `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2026-09-01')`,
          [A, titleId],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
    const upd = await asUser(B, () =>
      db.query(`update public.stubs set note = 'hacked' where user_id = $1`, [A]),
    );
    expect(upd.affectedRows ?? 0).toBe(0);
    const stats = await db.query<{ stub_count: number }>(
      'select stub_count from public.title_stats where title_id = $1',
      [titleId],
    );
    expect(stats.rows[0]!.stub_count).toBe(2);
    const anonRead = await asUser(null, () => db.query('select * from public.stubs'));
    expect(anonRead.rows.length).toBe(2); // public diaries
  });

  it('rejects future dates and enforces the stub rate limit', async () => {
    await expect(
      asUser(A, () =>
        db.query(
          `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2099-01-01')`,
          [A, titleId],
        ),
      ),
    ).rejects.toThrow(/watched_on_in_future/);
    await asUser(B, async () => {
      for (let i = 0; i < 30; i++) {
        await db.query(
          `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2026-09-01')`,
          [B, titleId],
        );
      }
      await expect(
        db.query(
          `insert into public.stubs (user_id, title_id, watched_on) values ($1, $2, '2026-09-01')`,
          [B, titleId],
        ),
      ).rejects.toThrow(/rate_limited/);
    });
  });

  it('keeps one review per user per title, sets edited_at, hides watchlists', async () => {
    await asUser(A, () =>
      db.query(
        `insert into public.reviews (user_id, title_id, rating_10, body) values ($1, $2, 9, 'great')`,
        [A, titleId],
      ),
    );
    await expect(
      asUser(A, () =>
        db.query(`insert into public.reviews (user_id, title_id, rating_10) values ($1, $2, 5)`, [
          A,
          titleId,
        ]),
      ),
    ).rejects.toThrow(/duplicate key/);
    await asUser(A, () =>
      db.query(`update public.reviews set body = 'great!!' where user_id = $1`, [A]),
    );
    const r = await db.query<{ edited_at: Date | null }>(
      'select edited_at from public.reviews where user_id = $1',
      [A],
    );
    expect(r.rows[0]!.edited_at).not.toBeNull();

    await asUser(A, () =>
      db.query(`insert into public.watchlist (user_id, title_id) values ($1, $2)`, [A, titleId]),
    );
    const seenByB = await asUser(B, () => db.query('select * from public.watchlist'));
    expect(seenByB.rows).toHaveLength(0);
    await expect(
      asUser(A, () => db.query(`update public.profiles set handle = 'mallory' where id = $1`, [A])),
    ).rejects.toThrow(/permission denied/);
  });

  it('has no third-party sync tables or columns (ADR-008)', async () => {
    const { rows } = await db.query<{ n: string }>(
      `select table_name as n from information_schema.tables
        where table_schema = 'public' and table_name in ('sync_accounts', 'sync_jobs', 'rating_enrichment')
       union all
       select column_name from information_schema.columns
        where table_schema = 'public' and column_name in ('imdb_shared_at')`,
    );
    expect(rows).toEqual([]);
    await expect(
      db.query(
        `insert into public.stubs (user_id, title_id, watched_on, source) values ($1, $2, '2026-09-01', 'trakt')`,
        [A, titleId],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('never lets API roles write the catalogue or read ops tables', async () => {
    await expect(
      asUser(A, () => db.query(`update public.catalog_index set vote_average = 1`)),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(null, () => db.query('select * from public.sync_runs'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(A, () => db.query(`select public.catalog_apply_staging(gen_random_uuid())`)),
    ).rejects.toThrow(/permission denied/);
    for (const sql of [
      `select * from public.catalog_imdb_due(10)`,
      `select public.catalog_set_imdb('[]'::jsonb)`,
      `select * from public.catalog_enrich_due(10)`,
      `select public.catalog_set_enrichment('[]'::jsonb)`,
      `select * from public.catalog_rating_disagreements()`,
    ]) {
      await expect(
        asUser(null, () => db.query(sql)),
        sql,
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe('IMDb ratings + enrichment (ADR-008, PRD §4.2)', () => {
  const idOf = async (key: string) =>
    (
      await db.query<{ id: number }>('select id from public.catalog_index where title_key = $1', [
        key,
      ])
    ).rows[0]!.id;

  it('exposes imdb_rating on catalogue rows read by anon', async () => {
    const { rows } = await asUser(null, () =>
      db.query<{ imdb_rating: string | null; title_key: string }>(
        `select title_key, imdb_rating from public.catalog_page('movie', 'rating_desc', null, 50)`,
      ),
    );
    const dune = rows.find((r) => r.title_key === 'movie:693134');
    expect(Number(dune?.imdb_rating)).toBe(8.5);
  });

  it('staggers OMDb refresh: never-checked first (listed, popular), then hot/stale tiers', async () => {
    const due = await db.query<{ id: number; imdb_id: string }>(
      'select * from public.catalog_imdb_due(500)',
    );
    // Fixture rows were inserted with ratings but no imdb_checked_at → all are "never checked".
    const withImdb = catalog.titles.filter((t) => t.imdbId).length;
    expect(due.rows).toHaveLength(withImdb);
    expect((await db.query('select * from public.catalog_imdb_due(3)')).rows).toHaveLength(3);

    const dune = await idOf('movie:693134');
    const n = await db.query<{ n: number }>(`select public.catalog_set_imdb($1::jsonb) as n`, [
      JSON.stringify([{ id: dune, rating: 8.6, votes: 700000 }]),
    ]);
    expect(n.rows[0]!.n).toBe(1);
    const after = await db.query<{ id: number }>('select id from public.catalog_imdb_due(500)');
    expect(after.rows.map((r) => r.id)).not.toContain(dune); // checked now → not due for 7 days
    // Hot tier: checked 8 days ago and among the most popular → due again.
    await db.query(
      `update public.catalog_index set imdb_checked_at = now() - interval '8 days' where id = $1`,
      [dune],
    );
    expect(
      (await db.query<{ id: number }>('select id from public.catalog_imdb_due(500)')).rows.map(
        (r) => r.id,
      ),
    ).toContain(dune);
    // "N/A" from OMDb → null rating, but marked checked.
    await db.query(`select public.catalog_set_imdb($1::jsonb)`, [
      JSON.stringify([{ id: dune, rating: null, votes: null }]),
    ]);
    const row = await db.query<{ imdb_rating: string | null; imdb_checked_at: Date | null }>(
      'select imdb_rating, imdb_checked_at from public.catalog_index where id = $1',
      [dune],
    );
    expect(row.rows[0]!.imdb_rating).toBeNull();
    expect(row.rows[0]!.imdb_checked_at).not.toBeNull();
  });

  it('stores enrichment, keeps pitch_hook, and resets the IMDb cache when the imdb id changes', async () => {
    const id = await idOf('movie:157336');
    await db.query(`select public.catalog_set_imdb($1::jsonb)`, [
      JSON.stringify([{ id, rating: 8.7, votes: 2360000 }]),
    ]);
    const hookBefore = (
      await db.query<{ pitch_hook: string | null }>(
        'select pitch_hook from public.catalog_index where id = $1',
        [id],
      )
    ).rows[0]!.pitch_hook;
    await db.query(`select public.catalog_set_enrichment($1::jsonb)`, [
      JSON.stringify([
        {
          id,
          imdb_id: 'tt0816692',
          runtime_minutes: 169,
          season_count: null,
          episode_count: null,
          episode_runtime: null,
          series_status: null,
          tagline: 'Mankind was born on Earth. It was never meant to die here.',
          certification: 'PG-13',
          keywords: ['space travel', 'epic'],
          recommendation_keys: ['movie:27205'],
        },
      ]),
    ]);
    let r = await db.query<{
      imdb_rating: string | null;
      keywords: string[];
      pitch_hook: string | null;
    }>('select imdb_rating, keywords, pitch_hook from public.catalog_index where id = $1', [id]);
    expect(Number(r.rows[0]!.imdb_rating)).toBe(8.7); // same id → kept
    expect(r.rows[0]!.keywords).toEqual(['space travel', 'epic']);
    expect(r.rows[0]!.pitch_hook).toBe(hookBefore);
    await db.query(`select public.catalog_set_enrichment($1::jsonb)`, [
      JSON.stringify([{ id, imdb_id: 'tt9999999', keywords: [], recommendation_keys: [] }]),
    ]);
    r = await db.query(
      'select imdb_rating, keywords, pitch_hook from public.catalog_index where id = $1',
      [id],
    );
    expect(r.rows[0]!.imdb_rating).toBeNull(); // changed id → re-fetch
    const due = await db.query<{ id: number }>('select id from public.catalog_imdb_due(500)');
    expect(due.rows.map((x) => x.id)).toContain(id); // never-checked again → tier 1
  });

  it('reports TMDB/IMDb disagreements without touching curation', async () => {
    const { rows } = await db.query<{ title_key: string }>(
      'select * from public.catalog_rating_disagreements(0.6, 6.0)',
    );
    expect(rows.map((r) => r.title_key)).toContain('tv:1438'); // The Wire: 8.6 vs 9.3
    expect(rows.map((r) => r.title_key)).not.toContain('movie:19908'); // unlisted
  });
});

describe('ops health (ADR-011 §3, §9: F1)', () => {
  type Probe = { health_probe: { catalog_count: number; last_full_sync_at: string | null } };
  const probe = async () =>
    (await asUser(null, () => db.query<Probe>('select public.health_probe()'))).rows[0]!
      .health_probe;
  const lastSync = async () =>
    (
      await asUser(null, () =>
        db.query<{ t: string | null }>('select public.last_catalog_sync() as t'),
      )
    ).rows[0]!.t;

  it('counts only full syncs (discover applied, status ok); anon can probe', async () => {
    await db.query('delete from public.sync_runs');
    const listed = Number(
      (await db.query<{ n: string }>(`select public.catalog_count('all') as n`)).rows[0]!.n,
    );
    expect(await probe()).toEqual({ catalog_count: listed, last_full_sync_at: null });
    expect(await lastSync()).toBeNull();

    const insert = (status: string, counts: unknown, at: string) =>
      db.query(
        `insert into public.sync_runs (kind, status, counts, finished_at) values ('catalog', $1, $2::jsonb, $3)`,
        [status, JSON.stringify(counts), at],
      );
    await insert('ok', { discover: { applied: { upserted: 1 } } }, '2026-09-20T03:00:00Z');
    await insert('ok', { imdb: { rated: 5 } }, '2026-09-21T03:00:00Z'); // --only=imdb
    await insert('ok', { discover: { dry_run: true } }, '2026-09-22T03:00:00Z'); // dry
    await insert('aborted', { discover: { applied: {} } }, '2026-09-23T03:00:00Z');
    await insert('failed', { discover: { applied: {} } }, '2026-09-24T03:00:00Z');

    const p = await probe();
    expect(new Date(p.last_full_sync_at!).toISOString()).toBe('2026-09-20T03:00:00.000Z');
    expect(new Date((await lastSync())!).toISOString()).toBe('2026-09-20T03:00:00.000Z');
    await asUser('00000000-0000-4000-8000-00000000000a', () =>
      db.query('select public.health_probe()'),
    );
    await db.query('delete from public.sync_runs');
  });
});
