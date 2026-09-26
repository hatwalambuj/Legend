/**
 * Nightly catalogue job (ADR-002, ADR-007, ADR-008). Runs in GitHub Actions (.github/workflows/nightly-sync.yml).
 * OWNER: Backend. Pure step logic lives in src/server/jobs/{discover,palettes,enrich,imdb-refresh}.ts
 * (unit-tested); this file wires it to TMDB + Supabase. Deterministic data processing only: NO AI/LLM (PRD D15).
 *
 *   npm run sync:catalog                      # full nightly run (needs TMDB + Supabase service role)
 *   npm run sync:catalog -- --dry-run         # fetch + transform + guardrails, write nothing
 *   npm run sync:catalog -- --from-fixtures   # seed a Supabase project from src/fixtures (no TMDB/OMDb needed)
 *   npm run sync:catalog -- --only=imdb       # just the OMDb step (also: --only=enrich, --only=discover)
 *
 * Flow (each step is skipped when its credentials are missing; a failed later step never undoes an earlier one)
 *  1. insert sync_runs(kind='catalog', status=running)
 *  2. DISCOVER — for media_type in [movie, tv], for each year shard (pre-1970 by decade):
 *       GET /discover/{type}?vote_average.gte=MIN&vote_count.gte=FLOOR&{date range}&sort_by=vote_count.desc
 *           &include_adult=false[&without_genres=10767,10763,10764 for tv]&page=n
 *     throttle 10 req/s, honour 429 Retry-After, exponential backoff with jitter (max 5 retries)
 *  3. transform → staging rows (slug, sort_title, search_text via src/lib/text.ts; is_listed via isListed())
 *  4. re-check previously listed titles missing from discover (GET /{type}/{id}): dropped (unlist) vs gone (404)
 *  5. guardrails: listed count per type within [SYNC_GUARD_MIN, SYNC_GUARD_MAX] and delta vs last ok run
 *     < SYNC_GUARD_MAX_DELTA → otherwise sync_runs.status='aborted', exit 1, index untouched
 *  6. upsert staging in batches of 500, rpc('catalog_apply_staging', { p_run })
 *  7. ENRICH — rpc('catalog_enrich_due', { p_limit: SYNC_ENRICH_MAX, p_ttl_days: SYNC_ENRICH_TTL_DAYS }),
 *     GET /{type}/{id}?append_to_response=<enrichmentAppends()> (10 req/s), mapTmdbEnrichment(),
 *     rpc('catalog_set_enrichment', { p_rows }) in batches of 200. Fills imdb_id, runtime/seasons/episodes,
 *     episode runtime, status, tagline, certification (CERTIFICATION_REGION), keywords, recommendations.
 *  8. IMDB (ADR-008) — refreshImdbRatings(): rpc('catalog_imdb_due', { p_limit: OMDB_DAILY_BUDGET, … tiers })
 *     → OMDb → rpc('catalog_set_imdb'). Stops cleanly at the OMDb daily limit.
 *  9. palettes: rows where needs_palette → fetch w92 poster, sharp().resize(24,36,{fit:'fill'}).removeAlpha().raw()
 *     → extractColors() → tintsFrom() → LQIP sharp().resize(8,12).webp({quality:40}); 30 concurrent
 * 10. report: rpc('catalog_rating_disagreements') → log count + top 20 (PRD §4.1, for the monthly PM review)
 * 11. rpc('catalog_purge_stale'); POST {SITE_URL}/api/revalidate {tags:['catalog']} with x-revalidate-secret
 * 12. sync_runs.status='ok', counts = { discover, enrich, imdb, palettes, disagreements, purge }
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../src/lib/errors';
import { DEFAULT_CURATION_RULE, isListed } from '../src/lib/curation';
import type { MediaType, TitleKey } from '../src/lib/types';
import { normalizeSearch, sortTitle } from '../src/lib/text';
import { parseEnv, type ServerEnv } from '../src/server/env';
import {
  enrichmentAppends,
  mapTmdbEnrichment,
  type EnrichmentRow,
} from '../src/server/jobs/enrich';
import {
  checkGuardrails,
  countListed,
  createThrottle,
  discoverAll,
  genreMap,
  recheckMissing,
  withRetry,
  yearShards,
  type ListedCounts,
  type StagingRow,
} from '../src/server/jobs/discover';
import { refreshImdbRatings, type ImdbRefreshResult } from '../src/server/jobs/imdb-refresh';
import { mapConcurrent, paletteFromPoster, type SharpLike } from '../src/server/jobs/palettes';
import { OmdbRatingProvider } from '../src/server/providers/omdb';
import { TmdbDetailProvider } from '../src/server/providers/tmdb';
import catalogJson from '../src/fixtures/catalog.json';
import type { FixtureCatalog } from '../src/fixtures/schema';

const catalog = catalogJson as unknown as FixtureCatalog;

type Step = 'discover' | 'enrich' | 'imdb';

interface Args {
  dryRun: boolean;
  fromFixtures: boolean;
  only: Step | null;
}

export function parseArgs(argv: string[]): Args {
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  if (only && !['discover', 'enrich', 'imdb'].includes(only))
    throw new Error(`Unknown --only=${only} (discover | enrich | imdb)`);
  return {
    dryRun: argv.includes('--dry-run'),
    fromFixtures: argv.includes('--from-fixtures'),
    only: only as Step | null,
  };
}

export { yearShards };

/** Staging row for one fixture title — the same transform the live path applies to TMDB results. */
export function fixtureStagingRows(runId: string, today: string) {
  return catalog.titles.map((t) => ({
    run_id: runId,
    media_type: t.mediaType,
    tmdb_id: t.tmdbId,
    imdb_id: t.imdbId,
    title: t.title,
    original_title: t.originalTitle,
    slug: t.slug,
    overview_short: t.overviewShort,
    release_date: t.releaseDate,
    vote_average: t.voteAverage,
    vote_count: t.voteCount,
    popularity: t.popularity,
    genre_ids: t.genres.map((g) => g.id),
    genres: t.genres,
    original_language: null,
    poster_path: t.posterPath,
    backdrop_path: t.backdropPath,
    sort_title: sortTitle(t.title),
    search_text: normalizeSearch(`${t.title} ${t.originalTitle}`),
    is_listed: isListed(
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
  }));
}

/** Enrichment rows for fixtures, given the catalog_index ids by title key. */
export function fixtureEnrichmentRows(idByKey: Map<string, number>): EnrichmentRow[] {
  return catalog.titles.flatMap((t) => {
    const id = idByKey.get(t.key);
    return id === undefined
      ? []
      : [
          {
            id,
            imdb_id: t.imdbId,
            runtime_minutes: t.runtimeMinutes,
            season_count: t.seasonCount,
            episode_count: t.episodeCount,
            episode_runtime: t.episodeRuntimeMinutes,
            series_status: t.seriesStatus,
            tagline: t.tagline,
            certification: t.certification,
            keywords: t.keywords,
            recommendation_keys: t.recommendationKeys,
          },
        ];
  });
}

function admin(env: ServerEnv): SupabaseClient {
  if (!env.supabase?.serviceRoleKey)
    throw new Error('Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`rpc ${fn}: ${error.message}`);
  return data as T;
}

async function idsByKey(db: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await db.from('catalog_index').select('id, title_key');
  if (error) throw new Error(`select ids: ${error.message}`);
  return new Map((data as { id: number; title_key: string }[]).map((r) => [r.title_key, r.id]));
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** --from-fixtures: seed a live project with the demo catalogue, enrichment, IMDb ratings, palettes, hooks. */
async function seedFromFixtures(env: ServerEnv, today: string, dryRun: boolean): Promise<void> {
  const runId = '00000000-0000-4000-8000-000000000000';
  const rows = fixtureStagingRows(runId, today);
  console.log(
    `[sync] fixtures → ${rows.length} rows (${rows.filter((r) => r.is_listed).length} listed)`,
  );
  if (dryRun) return;
  const db = admin(env);
  for (const batch of chunks(rows, 500)) {
    const { error } = await db.from('catalog_staging').upsert(batch);
    if (error) throw new Error(`staging upsert: ${error.message}`);
  }
  console.log('[sync] apply', await rpc(db, 'catalog_apply_staging', { p_run: runId }));
  const ids = await idsByKey(db);
  await rpc(db, 'catalog_set_enrichment', { p_rows: fixtureEnrichmentRows(ids) });
  await rpc(db, 'catalog_set_imdb', {
    p_rows: catalog.titles
      .filter((t) => t.imdbId && ids.has(t.key))
      .map((t) => ({ id: ids.get(t.key), rating: t.imdbRating, votes: t.imdbVotes })),
  });
  // Precomputed palettes and our editorial hooks (pitch_hook is never written by the live sync).
  for (const t of catalog.titles) {
    const { error } = await db
      .from('catalog_index')
      .update({ palette: t.palette, needs_palette: false, pitch_hook: t.pitchHook })
      .eq('title_key', t.key);
    if (error) throw new Error(`palette/hook ${t.key}: ${error.message}`);
  }
  console.log('[sync] fixtures seeded (catalogue, enrichment, IMDb ratings, palettes, hooks)');
}

async function enrichStep(env: ServerEnv, db: SupabaseClient, dryRun: boolean) {
  if (!env.tmdb) return { skipped: 'no TMDB key' };
  const tmdb = new TmdbDetailProvider(env.tmdb);
  const due = await rpc<{ id: number; media_type: 'movie' | 'tv'; tmdb_id: number }[]>(
    db,
    'catalog_enrich_due',
    { p_limit: env.sync.enrichMax, p_ttl_days: env.sync.enrichTtlDays },
  );
  const out: EnrichmentRow[] = [];
  let errors = 0;
  for (const r of due) {
    try {
      const body = await tmdb.request<unknown>(`/${r.media_type}/${r.tmdb_id}`, {
        append_to_response: enrichmentAppends(r.media_type),
      });
      out.push(
        mapTmdbEnrichment(r.id, r.media_type, r.tmdb_id, body, env.sync.certificationRegion),
      );
    } catch {
      errors++; // stays due; retried next night
    }
    await new Promise((res) => setTimeout(res, 100)); // ~10 req/s, well under TMDB's limit
  }
  if (!dryRun)
    for (const batch of chunks(out, 200))
      await rpc(db, 'catalog_set_enrichment', { p_rows: batch });
  return { due: due.length, enriched: out.length, errors };
}

async function imdbStep(
  env: ServerEnv,
  db: SupabaseClient,
  dryRun: boolean,
): Promise<ImdbRefreshResult | { skipped: string }> {
  const omdb = env.omdb;
  if (!omdb) return { skipped: 'no OMDB_API_KEY' };
  const provider = new OmdbRatingProvider(omdb.apiKey);
  return refreshImdbRatings(
    {
      due: (limit) =>
        rpc(db, 'catalog_imdb_due', {
          p_limit: limit,
          p_hot_ttl_days: omdb.hotTtlDays,
          p_ttl_days: omdb.ttlDays,
          p_hot_count: omdb.hotCount,
        }),
      lookup: (id) => provider.getImdbRating(id),
      save: async (rows) => {
        if (!dryRun) await rpc(db, 'catalog_set_imdb', { p_rows: rows });
      },
    },
    omdb.dailyBudget,
  );
}

/* ------------------------------------------------------------------ */
/* Steps 1–6: discover → staging → guardrails → apply                  */
/* ------------------------------------------------------------------ */

/** PostgREST caps responses (default 1,000 rows): page through with range(). */
export async function selectAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(`select: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** Listed counts of the last OK catalogue run (for the delta guardrail), or null. */
export function lastListedCounts(counts: unknown): ListedCounts | null {
  const listed = (counts as { discover?: { listed?: Partial<ListedCounts> } } | null)?.discover
    ?.listed;
  return listed && typeof listed.movie === 'number' && typeof listed.tv === 'number'
    ? { movie: listed.movie, tv: listed.tv }
    : null;
}

function tmdbGetter(env: ServerEnv) {
  const tmdb = new TmdbDetailProvider(env.tmdb!, { timeoutMs: 10_000 });
  const throttle = createThrottle(10); // ~10 req/s, well under TMDB's limit
  return (path: string, params: Record<string, string> = {}) =>
    withRetry(async () => {
      await throttle();
      return tmdb.request<unknown>(path, params);
    });
}

async function discoverStep(
  env: ServerEnv,
  db: SupabaseClient,
  runId: string,
  today: string,
  dryRun: boolean,
) {
  const get = tmdbGetter(env);
  const shards = yearShards(1900, Number(today.slice(0, 4)));
  console.log(
    `[sync] rule: >= ${env.curation.minRating}, votes movie >= ${env.curation.minVotesMovie}, tv >= ${env.curation.minVotesTv}; ${shards.length} shards per type`,
  );
  const [movieGenres, tvGenres, prev] = await Promise.all([
    get('/genre/movie/list', { language: 'en-US' }).then(genreMap),
    get('/genre/tv/list', { language: 'en-US' }).then(genreMap),
    selectAll<{ title_key: string }>((from, to) =>
      db
        .from('catalog_index')
        .select('title_key')
        .eq('is_listed', true)
        .order('id')
        .range(from, to),
    ),
  ]);
  const previouslyListed = new Set(prev.map((r) => r.title_key));
  const ctx = { runId, rule: env.curation, today, previouslyListed };
  const found = await discoverAll(
    { get, log: console.warn },
    { types: ['movie', 'tv'], shards, ctx, genreNames: { movie: movieGenres, tv: tvGenres } },
  );
  const missing = [...previouslyListed].filter((k) => !found.rows.has(k as TitleKey)) as TitleKey[];
  const recheck = await recheckMissing(
    {
      detail: async (type: MediaType, id: number) => {
        try {
          return await get(`/${type}/${id}`, {
            append_to_response: 'external_ids',
            language: 'en-US',
          });
        } catch (e) {
          if (e instanceof AppError && e.code === 'not_found') return null;
          throw e;
        }
      },
    },
    missing,
    { ...ctx, genreNames: new Map() },
  );
  const staged = new Map<string, StagingRow>(found.rows);
  for (const r of recheck.rows) staged.set(`${r.media_type}:${r.tmdb_id}`, r);
  const listed = countListed(staged.values());

  const { data: lastRun } = await db
    .from('sync_runs')
    .select('counts')
    .eq('kind', 'catalog')
    .eq('status', 'ok')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const guard = checkGuardrails(listed, lastListedCounts(lastRun?.counts), env.sync);
  const summary = {
    pages: found.pages,
    discovered: found.rows.size,
    malformed: found.malformed,
    truncated_shards: found.truncatedShards,
    rechecked: missing.length,
    recheck_errors: recheck.errors,
    gone: recheck.gone.length,
    listed,
  };
  if (!guard.ok) return { ...summary, aborted: guard.reasons };
  if (dryRun) return { ...summary, dry_run: true };

  for (const batch of chunks([...staged.values()], 500)) {
    const { error } = await db.from('catalog_staging').upsert(batch);
    if (error) throw new Error(`staging upsert: ${error.message}`);
  }
  const applied = await rpc<unknown>(db, 'catalog_apply_staging', { p_run: runId });
  for (const batch of chunks(recheck.gone, 200)) {
    const { error } = await db
      .from('catalog_index')
      .update({ source_status: 'gone', is_listed: false })
      .in('title_key', batch);
    if (error) throw new Error(`mark gone: ${error.message}`);
  }
  return { ...summary, applied };
}

/* ------------------------------------------------------------------ */
/* Steps 9–11: palettes, disagreement report, purge + revalidate       */
/* ------------------------------------------------------------------ */

async function paletteStep(db: SupabaseClient, dryRun: boolean, max = 2000) {
  const { data, error } = await db
    .from('catalog_index')
    .select('id, poster_path')
    .eq('needs_palette', true)
    .order('id')
    .limit(max);
  if (error) throw new Error(`palette select: ${error.message}`);
  const rows = (data ?? []) as { id: number; poster_path: string | null }[];
  if (dryRun || rows.length === 0) return { due: rows.length };
  const sharp = (await import('sharp')).default as unknown as SharpLike;
  const result = await mapConcurrent(rows, 30, async (r) => {
    let palette = null;
    if (r.poster_path) {
      const res = await fetch(`https://image.tmdb.org/t/p/w92${r.poster_path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`poster ${res.status}`);
      palette = await paletteFromPoster(Buffer.from(await res.arrayBuffer()), sharp);
    }
    const { error: e } = await db
      .from('catalog_index')
      .update({ palette, needs_palette: false })
      .eq('id', r.id);
    if (e) throw new Error(e.message);
  });
  return { due: rows.length, computed: result.ok.length, failed: result.failed.length };
}

async function disagreementStep(db: SupabaseClient) {
  const rows = await rpc<
    { title_key: string; title: string; vote_average: number; imdb_rating: number }[]
  >(db, 'catalog_rating_disagreements', {});
  console.log(`[sync] rating disagreements (PRD §4.1): ${rows.length}`);
  for (const r of rows.slice(0, 20))
    console.log(`  ${r.title_key}  TMDB ${r.vote_average}  IMDb ${r.imdb_rating}  ${r.title}`);
  return rows.length;
}

/** POST {site}/api/revalidate {tags} with the shared secret (API_CONTRACT §5.19). */
export async function revalidateSite(
  siteUrl: string,
  secret: string | undefined,
  tags: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ skipped: string } | { status: number }> {
  if (!secret) return { skipped: 'no REVALIDATE_SECRET' };
  const res = await fetchImpl(new URL('/api/revalidate', siteUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret },
    body: JSON.stringify({ tags }),
    signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status };
}

/* ------------------------------------------------------------------ */
/* Main + sync_runs bookkeeping                                        */
/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = parseEnv();
  const today = new Date().toISOString().slice(0, 10);

  if (args.fromFixtures) return seedFromFixtures(env, today, args.dryRun);

  if (!env.supabase?.serviceRoleKey) {
    console.log(
      '[sync] No Supabase service role: nothing to sync (demo mode uses bundled fixtures).',
    );
    return;
  }
  const db = admin(env);
  const counts: Record<string, unknown> = {};
  const run = (s: Step) => args.only === null || args.only === s;
  const runId = randomUUID();
  const finish = async (status: 'ok' | 'aborted' | 'failed', error?: string) => {
    if (args.dryRun) return;
    const { error: e } = await db
      .from('sync_runs')
      .update({ status, counts, error: error ?? null, finished_at: new Date().toISOString() })
      .eq('id', runId);
    if (e) console.error('[sync] could not record the run:', e.message);
  };
  if (!args.dryRun) {
    const { error } = await db
      .from('sync_runs')
      .insert({ id: runId, kind: 'catalog', status: 'running' });
    if (error) throw new Error(`sync_runs insert: ${error.message}`);
  }

  try {
    if (run('discover')) {
      if (!env.tmdb) counts.discover = { skipped: 'no TMDB key' };
      else {
        const d = await discoverStep(env, db, runId, today, args.dryRun);
        counts.discover = d;
        if ('aborted' in d && d.aborted) {
          console.error('[sync] guardrails failed; index untouched:', d.aborted.join('; '));
          await finish('aborted', d.aborted.join('; '));
          process.exitCode = 1;
          return;
        }
      }
    }
    if (run('enrich')) counts.enrich = await enrichStep(env, db, args.dryRun);
    if (run('imdb')) counts.imdb = await imdbStep(env, db, args.dryRun);
    if (run('discover')) {
      counts.palettes = await paletteStep(db, args.dryRun);
      counts.disagreements = await disagreementStep(db);
      if (!args.dryRun) {
        counts.purge = await rpc(db, 'catalog_purge_stale', {});
        counts.revalidate = await revalidateSite(env.siteUrl, env.revalidateSecret, ['catalog']);
      }
    }
    await finish('ok');
    console.log('[sync] done', JSON.stringify(counts));
  } catch (e) {
    await finish('failed', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1]?.endsWith('sync-catalog.ts')) {
  main().catch((e: unknown) => {
    console.error('[sync] failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
