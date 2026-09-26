/**
 * Nightly catalogue job (ADR-002, ADR-007, ADR-008). Runs in GitHub Actions (.github/workflows/nightly-sync.yml).
 * OWNER: Backend. Skeleton + reference wiring by Architect — the flow, guardrails and RPC contract below
 * are the spec. Deterministic data processing only: NO AI/LLM calls anywhere (PRD D15).
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
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CURATION_RULE, isListed } from '../src/lib/curation';
import { normalizeSearch, sortTitle } from '../src/lib/text';
import { parseEnv, type ServerEnv } from '../src/server/env';
import {
  enrichmentAppends,
  mapTmdbEnrichment,
  type EnrichmentRow,
} from '../src/server/jobs/enrich';
import { refreshImdbRatings, type ImdbRefreshResult } from '../src/server/jobs/imdb-refresh';
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

/** Year shards keep every discover query under TMDB's 500-page cap. */
export function yearShards(
  fromYear = 1900,
  toYear = new Date().getUTCFullYear(),
): { gte: string; lte: string }[] {
  const shards: { gte: string; lte: string }[] = [];
  for (let y = fromYear; y < 1970; y += 10)
    shards.push({ gte: `${y}-01-01`, lte: `${Math.min(y + 9, 1969)}-12-31` });
  for (let y = 1970; y <= toYear; y++) shards.push({ gte: `${y}-01-01`, lte: `${y}-12-31` });
  return shards;
}

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

  if (run('discover')) {
    if (!env.tmdb) counts.discover = { skipped: 'no TMDB key' };
    else {
      const shards = yearShards();
      console.log(
        `[sync] rule: >= ${env.curation.minRating}, votes movie >= ${env.curation.minVotesMovie}, tv >= ${env.curation.minVotesTv}; ${shards.length} shards per type`,
      );
      // TODO(Backend): steps 1–6 (discover → staging → guardrails → catalog_apply_staging).
      console.warn(
        '[sync] TODO(Backend): live TMDB discover not implemented yet; skipping to enrich.',
      );
      counts.discover = { todo: 'not implemented' };
    }
  }
  if (run('enrich')) counts.enrich = await enrichStep(env, db, args.dryRun);
  if (run('imdb')) counts.imdb = await imdbStep(env, db, args.dryRun);
  // TODO(Backend): steps 9–12 (palettes, disagreement report, purge + revalidate, sync_runs bookkeeping).
  console.log('[sync] done', JSON.stringify(counts));
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1]?.endsWith('sync-catalog.ts')) {
  main().catch((e: unknown) => {
    console.error('[sync] failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
