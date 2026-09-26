/**
 * Shared PGlite setup for DB tests: Supabase shim + every migration + the fixture catalogue.
 * (tests/db/migrations.test.ts keeps its own inline copy; this helper is for the newer suites.)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import catalogJson from '@/fixtures/catalog.json';
import type { FixtureCatalog } from '@/fixtures/schema';
import { DEFAULT_CURATION_RULE, isListed } from '@/lib/curation';
import { normalizeSearch, sortTitle } from '@/lib/text';

const ROOT = process.cwd();
export const catalog = catalogJson as unknown as FixtureCatalog;

export async function createDb(today = '2026-09-26'): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { citext, pg_trgm } });
  await db.exec(readFileSync(join(ROOT, 'tests/db/supabase-shim.sql'), 'utf8'));
  const dir = join(ROOT, 'supabase/migrations');
  for (const f of readdirSync(dir)
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  for (const t of catalog.titles) {
    await db.query(
      `insert into public.catalog_index (media_type, tmdb_id, imdb_id, title, original_title, slug,
         overview_short, release_date, vote_average, vote_count, popularity, genre_ids, genres,
         sort_title, search_text, is_listed, imdb_rating, imdb_votes, runtime_minutes, season_count,
         episode_count, episode_runtime, palette)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
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
        sortTitle(t.title),
        normalizeSearch(`${t.title} ${t.originalTitle}`),
        isListed(
          {
            mediaType: t.mediaType,
            voteAverage: t.voteAverage,
            voteCount: t.voteCount,
            genreIds: t.genres.map((g) => g.id),
            releaseDate: t.releaseDate,
          },
          DEFAULT_CURATION_RULE,
          today,
        ),
        t.imdbRating,
        t.imdbVotes,
        t.runtimeMinutes,
        t.seasonCount,
        t.episodeCount,
        t.episodeRuntimeMinutes,
        JSON.stringify(t.palette),
      ],
    );
  }
  return db;
}

/** Run `fn` as an API role (authenticated with `uid`, or anon), like PostgREST does. */
export async function asUser<T>(db: PGlite, uid: string | null, fn: () => Promise<T>): Promise<T> {
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

export async function createUser(db: PGlite, id: string, handle: string): Promise<void> {
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('handle', $3::text))`,
    [id, `${handle}@x.test`, handle],
  );
}

export async function titleId(db: PGlite, key: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    'select id from public.catalog_index where title_key = $1',
    [key],
  );
  return Number(rows[0]!.id);
}
