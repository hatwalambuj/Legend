/**
 * Nightly catalogue job (ADR-002, ADR-007, ADR-008). Runs in GitHub Actions (.github/workflows/nightly-sync.yml).
 * OWNER: Backend. Pure step logic lives in src/server/jobs/{discover,palettes,enrich,imdb-refresh}.ts
 * (unit-tested); this file wires it to TMDB + Supabase. Deterministic data processing only: NO AI/LLM (PRD D15).
 *
 *   npm run sync:catalog                      # full nightly run (needs TMDB + Supabase service role)
 *   npm run sync:catalog -- --dry-run         # discover pages + DB reads + guardrails; 0 OMDb, 0 TMDB
 *                                             # detail, 0 image fetches, 0 writes (ADR-011 §1)
 *   npm run sync:catalog -- --from-fixtures   # seed a Supabase project from src/fixtures (no TMDB/OMDb needed)
 *   npm run sync:catalog -- --only=imdb       # just the OMDb step (also: --only=enrich|watch|discover)
 *
 * Flow (each step is skipped when its credentials are missing; a failed later step never undoes an earlier one)
 *  1. insert sync_runs(kind='catalog', status=running)
 *  2. DISCOVER — for media_type in [movie, tv], for each year shard (pre-1970 by decade):
 *       GET /discover/{type}?vote_average.gte=MIN&vote_count.gte=FLOOR&{date range}&sort_by=vote_count.desc
 *           &include_adult=false[&without_genres=10767,10763,10764 for tv]&page=n
 *     throttle 10 req/s, honour 429 Retry-After, exponential backoff with jitter (max 5 retries)
 *  3. transform → staging rows (slug, sort_title, search_text via src/lib/text.ts; is_listed via isListed())
 *  4. re-check previously listed titles missing from discover (GET /{type}/{id}): dropped (unlist) vs gone
 *     (404); at most SYNC_RECHECK_MAX (more missing → guard reason `recheck_capped`); titles whose re-check
 *     errored are carried forward unchanged (F2, ADR-011 §10)
 *  5. guardrails: listed count per type within [SYNC_GUARD_MIN_MOVIE | _TV, SYNC_GUARD_MAX] and delta vs
 *     last ok run < SYNC_GUARD_MAX_DELTA → otherwise no staging/apply/gone (index membership untouched),
 *     the remaining steps still run, sync_runs.status='aborted', exit 1 (ADR-011 §2).
 *     First run (no listed rows yet): the minimums only warn. Per-type counts are always printed
 *     (run `--dry-run` first to see them).
 *  6. upsert staging in batches of 500, rpc('catalog_apply_staging', { p_run })
 *  7. ENRICH — rpc('catalog_enrich_due', { p_limit: SYNC_ENRICH_MAX, p_ttl_days: SYNC_ENRICH_TTL_DAYS }),
 *     GET /{type}/{id}?append_to_response=<enrichmentAppends()> (10 req/s), mapTmdbEnrichment(),
 *     rpc('catalog_set_enrichment', { p_rows }) in batches of 200. Fills imdb_id, runtime/seasons/episodes,
 *     episode runtime, status, tagline, certification (CERTIFICATION_REGION), keywords, recommendations.
 *     The same call appends watch/providers (ADR-012 §1): mapTmdbWatch() → rpc('catalog_set_watch').
 * 7b. WATCH (ADR-012 §4) — rpc('catalog_watch_due', { p_limit: SYNC_WATCH_MAX, p_ttl_days: SYNC_WATCH_TTL_DAYS,
 *     p_hot_days: SYNC_WATCH_HOT_DAYS }) minus ids enriched this run → GET /{type}/{id}/watch/providers
 *     (10 req/s) → rpc('catalog_set_watch'). Weekly: GET /watch/providers/{movie|tv}?watch_region=R for
 *     each WATCH_REGIONS → rpc('watch_provider_set_priorities'); revalidates tag `watch-providers`.
 *  8. IMDB (ADR-008) — refreshImdbRatings(): rpc('catalog_imdb_due', { p_limit: OMDB_DAILY_BUDGET, … tiers })
 *     → OMDb → rpc('catalog_set_imdb'). Stops cleanly at the OMDb daily limit.
 *  9. palettes: rows where needs_palette → fetch w92 poster, sharp().resize(24,36,{fit:'fill'}).removeAlpha().raw()
 *     → extractColors() → tintsFrom() → LQIP sharp().resize(8,12).webp({quality:40}); 30 concurrent
 * 10. report: rpc('catalog_rating_disagreements') → log count + top 20 (PRD §4.1, for the monthly PM review)
 * 11. rpc('catalog_purge_stale'); POST {SITE_URL}/api/revalidate {tags:['catalog']} with x-revalidate-secret
 *     when any step wrote rows
 * 12. sync_runs.status='ok' | 'aborted', counts = { discover, enrich, watch, imdb, palettes, disagreements, purge }
 * Orchestration (order, abort, dry run): src/server/jobs/sync-runner.ts.
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
  mapTmdbCore,
  mapTmdbEnrichment,
  type EnrichmentRow,
} from '../src/server/jobs/enrich';
import {
  carryForwardRows,
  checkGuardrails,
  countListed,
  guardrailReport,
  createThrottle,
  discoverAll,
  genreMap,
  recheckCapReason,
  recheckMissing,
  STAGING_COLUMNS,
  withRetry,
  yearShards,
  type ListedCounts,
  type StagingRow,
} from '../src/server/jobs/discover';
import { refreshImdbRatings, type ImdbDueRow } from '../src/server/jobs/imdb-refresh';
import { linkMismatches, mapTmdbWatch, watchProvidersOf } from '../src/server/jobs/watch-map';
import {
  refreshWatch,
  syncProviderLists,
  type ProviderPriorityRow,
  type WatchDueRow,
  type WatchSetRow,
} from '../src/server/jobs/watch-refresh';
import { PROVIDER_LINKS } from '../src/lib/provider-links';
import {
  runSync,
  type DiscoverResult,
  type StepResult,
  type SyncStep,
  type SyncSteps,
} from '../src/server/jobs/sync-runner';
import { mapConcurrent, paletteFromPoster, type SharpLike } from '../src/server/jobs/palettes';
import { OmdbRatingProvider } from '../src/server/providers/omdb';
import { TmdbDetailProvider } from '../src/server/providers/tmdb';
import catalogJson from '../src/fixtures/catalog.json';
import watchJson from '../src/fixtures/watch.json';
import type { FixtureCatalog, FixtureWatch } from '../src/fixtures/schema';

const catalog = catalogJson as unknown as FixtureCatalog;
const watchFixtures = watchJson as unknown as FixtureWatch;

type Step = SyncStep;

interface Args {
  dryRun: boolean;
  fromFixtures: boolean;
  only: Step | null;
}

export function parseArgs(argv: string[]): Args {
  const only = argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? null;
  if (only && !['discover', 'enrich', 'watch', 'imdb'].includes(only))
    throw new Error(`Unknown --only=${only} (discover | enrich | watch | imdb)`);
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

/**
 * `--from-fixtures` availability (ADR-012 §8): catalog_set_watch rows for the demo titles plus the
 * `watch_checked_at` backdate per title (`ageDays`), so the stale fixture is stale in a live project too.
 */
export function fixtureWatchRows(idByKey: Map<string, number>): {
  rows: WatchSetRow[];
  ages: { id: number; ageDays: number }[];
} {
  const providers = watchFixtures.providers.map((p) => ({
    provider_id: p.id,
    name: p.name,
    logo_path: null,
  }));
  const rows: WatchSetRow[] = [];
  const ages: { id: number; ageDays: number }[] = [];
  for (const t of watchFixtures.titles) {
    const id = idByKey.get(t.key);
    if (id === undefined) continue;
    rows.push({ id, watch: t.watch, providers });
    if (t.ageDays > 0) ages.push({ id, ageDays: t.ageDays });
  }
  return { rows, ages };
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
  const watch = fixtureWatchRows(ids);
  await rpc(db, 'catalog_set_watch', { p_rows: watch.rows });
  for (const a of watch.ages) {
    const at = new Date(Date.now() - a.ageDays * 86_400_000).toISOString();
    const { error } = await db
      .from('catalog_index')
      .update({ watch_checked_at: at })
      .eq('id', a.id);
    if (error) throw new Error(`watch age ${a.id}: ${error.message}`);
  }
  console.log(
    '[sync] fixtures seeded (catalogue, enrichment, IMDb ratings, palettes, hooks, where to watch)',
  );
}

async function enrichStep(
  env: ServerEnv,
  db: SupabaseClient,
  dryRun: boolean,
  enrichedIds: Set<number> = new Set(),
): Promise<StepResult> {
  if (!env.tmdb) return { counts: { skipped: 'no TMDB key' }, wrote: 0 };
  const due = await rpc<
    { id: number; media_type: 'movie' | 'tv'; tmdb_id: number; is_listed?: boolean }[]
  >(db, 'catalog_enrich_due', { p_limit: env.sync.enrichMax, p_ttl_days: env.sync.enrichTtlDays });
  // ADR-011 §1: a dry run spends no enrich budget (no TMDB detail call) and writes nothing.
  if (dryRun) return { counts: { due: due.length, dry_run: true }, wrote: 0 };
  const tmdb = new TmdbDetailProvider(env.tmdb);
  const regions = env.watch.regions;
  const out: EnrichmentRow[] = [];
  const watchRows: WatchSetRow[] = [];
  let errors = 0;
  let watchMissing = 0;
  let linkMismatch = 0;
  let unlistedRefreshed = 0;
  const gone: number[] = [];
  for (const r of due) {
    try {
      const body = await tmdb.request<unknown>(`/${r.media_type}/${r.tmdb_id}`, {
        append_to_response: enrichmentAppends(r.media_type),
      });
      const row = mapTmdbEnrichment(
        r.id,
        r.media_type,
        r.tmdb_id,
        body,
        env.sync.certificationRegion,
      );
      // ADR-013 C-06 (AR-8): referenced unlisted rows get their core re-synced (TMDB 6-month rule).
      if (r.is_listed === false) {
        const core = mapTmdbCore(r.media_type, body);
        if (core) {
          row.core = core;
          unlistedRefreshed++;
        }
      }
      out.push(row);
      // ADR-012 §1–2: the appended availability. Missing = not fetched (stored data untouched, and
      // the title stays due for the watch step); counted so a renamed append key shows in sync_runs.
      const watch = mapTmdbWatch(body, regions);
      if (watch) {
        watchRows.push({ id: r.id, watch: watch.watch, providers: watch.providers });
        enrichedIds.add(r.id);
        linkMismatch += linkMismatches(watchProvidersOf(body), r.media_type, r.tmdb_id, regions);
      } else watchMissing++;
    } catch (e) {
      // TMDB 404: the title is gone upstream (ADR-013 C-06) → source_status 'gone'.
      if (e instanceof AppError && e.code === 'not_found') gone.push(r.id);
      else errors++; // stays due; retried next night
    }
    await new Promise((res) => setTimeout(res, 100)); // ~10 req/s, well under TMDB's limit
  }
  for (const batch of chunks(out, 200)) await rpc(db, 'catalog_set_enrichment', { p_rows: batch });
  if (gone.length) await rpc(db, 'catalog_mark_gone', { p_ids: gone });
  for (const batch of chunks(watchRows, 200)) await rpc(db, 'catalog_set_watch', { p_rows: batch });
  if (linkMismatch > 0)
    console.warn(`[sync] watch: ${linkMismatch} upstream links differ from tmdbWatchHref()`);
  return {
    counts: {
      due: due.length,
      enriched: out.length,
      errors,
      watch: watchRows.length,
      watch_missing: watchMissing,
      watch_link_mismatch: linkMismatch,
      unlisted_refreshed: unlistedRefreshed,
      gone: gone.length,
    },
    wrote: out.length + gone.length,
  };
}

/** ADR-012 §4: availability refresh for due titles + the weekly provider list. */
async function watchStep(
  env: ServerEnv,
  db: SupabaseClient,
  dryRun: boolean,
  enrichedIds: ReadonlySet<number>,
  rps = 10,
): Promise<StepResult> {
  if (!env.tmdb) return { counts: { skipped: 'no TMDB key' }, wrote: 0 };
  const regions = env.watch.regions;
  // Dry run: the due list and the provider-list age only (read-only); the TMDB client is never built.
  const get = dryRun ? null : tmdbGetter(env, rps);
  const noCalls = () => Promise.reject(new Error('dry run: no TMDB calls'));
  const counts = await refreshWatch(
    {
      due: async (limit) =>
        (await rpc<WatchDueRow[] | null>(db, 'catalog_watch_due', {
          p_limit: limit,
          p_ttl_days: env.watch.sync.ttlDays,
          p_hot_days: env.watch.sync.hotDays,
        })) ?? [],
      fetch: get ? (r) => get(`/${r.media_type}/${r.tmdb_id}/watch/providers`) : noCalls,
      save: async (rows) => {
        await rpc(db, 'catalog_set_watch', { p_rows: rows });
      },
    },
    { max: env.watch.sync.max, regions, skipIds: enrichedIds, dryRun },
  );
  const providers = await syncProviderLists(
    {
      lastSyncedAt: async () => {
        const { data, error } = await db
          .from('watch_provider')
          .select('priorities_at')
          .not('priorities_at', 'is', null)
          .order('priorities_at', { ascending: false })
          .limit(1);
        if (error) throw new Error(`select watch_provider: ${error.message}`);
        return ((data ?? []) as { priorities_at: string | null }[])[0]?.priorities_at ?? null;
      },
      fetchList: get
        ? (type, region) => get(`/watch/providers/${type}`, { watch_region: region })
        : noCalls,
      save: async (rows: ProviderPriorityRow[]) => {
        await rpc(db, 'watch_provider_set_priorities', { p_rows: rows });
      },
    },
    { regions, configIds: Object.keys(PROVIDER_LINKS).map(Number), dryRun },
  );
  if (providers.unknownConfigIds?.length)
    console.warn(
      `[sync] provider-links ids TMDB did not return: ${providers.unknownConfigIds.join(', ')}`,
    );
  if (dryRun) console.log(`[sync] watch due: ${counts.due}; provider list due: ${providers.due}`);
  const fetched = 'fetched' in counts ? counts.fetched : 0;
  const listWrote = providers.providers ?? 0;
  return {
    counts: { ...counts, providers },
    wrote: fetched + listWrote,
    ...(listWrote > 0 ? { tags: ['watch-providers'] } : {}),
  };
}

async function imdbStep(env: ServerEnv, db: SupabaseClient, dryRun: boolean): Promise<StepResult> {
  const omdb = env.omdb;
  if (!omdb) return { counts: { skipped: 'no OMDB_API_KEY' }, wrote: 0 };
  const due = (limit: number) =>
    rpc<ImdbDueRow[]>(db, 'catalog_imdb_due', {
      p_limit: limit,
      p_hot_ttl_days: omdb.hotTtlDays,
      p_ttl_days: omdb.ttlDays,
      p_hot_count: omdb.hotCount,
    });
  // ADR-011 §1: the due list only (read-only RPC); the OMDb provider is never even constructed.
  if (dryRun) {
    const never = () => Promise.reject(new Error('dry run: no OMDb calls'));
    const counts = await refreshImdbRatings({ due, lookup: never, save: never }, omdb.dailyBudget, {
      dryRun: true,
    });
    return { counts, wrote: 0 };
  }
  const provider = new OmdbRatingProvider(omdb.apiKey);
  const counts = await refreshImdbRatings(
    {
      due,
      lookup: (id) => provider.getImdbRating(id),
      save: async (rows) => {
        await rpc(db, 'catalog_set_imdb', { p_rows: rows });
      },
    },
    omdb.dailyBudget,
  );
  return { counts, wrote: counts.looked_up };
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

/**
 * Listed counts of the newest OK run that actually ran discover (runs newest first). Single-step runs
 * (`--only=enrich|imdb`) are also recorded as ok `catalog` runs but carry no discover counts; they must
 * not switch the delta guardrail off for the next nightly run.
 */
export function latestListedCounts(
  runs: readonly { counts: unknown }[] | null,
): ListedCounts | null {
  for (const r of runs ?? []) {
    const c = lastListedCounts(r.counts);
    if (c) return c;
  }
  return null;
}

function tmdbGetter(env: ServerEnv, rps = 10) {
  const tmdb = new TmdbDetailProvider(env.tmdb!, { timeoutMs: 10_000 });
  const throttle = createThrottle(rps); // ~10 req/s, well under TMDB's limit
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
  rps = 10,
): Promise<DiscoverResult> {
  if (!env.tmdb) return { counts: { skipped: 'no TMDB key' }, wrote: 0 };
  const get = tmdbGetter(env, rps);
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
    env.sync.recheckMax,
    { dryRun },
  );
  // F2: a failed re-check is not a drop. Stage the current row unchanged so apply keeps it listed.
  const carried: StagingRow[] = [];
  for (const batch of chunks(recheck.erroredKeys, 200)) {
    const { data, error } = await db
      .from('catalog_index')
      .select(STAGING_COLUMNS.join(', '))
      .in('title_key', batch);
    if (error) throw new Error(`select carried-forward rows: ${error.message}`);
    carried.push(
      ...carryForwardRows((data ?? []) as unknown as Omit<StagingRow, 'run_id'>[], runId),
    );
  }
  const staged = new Map<string, StagingRow>(found.rows);
  for (const r of [...recheck.rows, ...carried]) staged.set(`${r.media_type}:${r.tmdb_id}`, r);
  // Dry run (no re-checks): upper bound = every missing title still listed; lower bound = all dropped.
  const lower = countListed(found.rows.values());
  const upper = { ...lower };
  for (const k of missing) upper[k.startsWith('movie:') ? 'movie' : 'tv']++;
  const listed = dryRun ? upper : countListed(staged.values());

  const { data: lastRuns, error: lastErr } = await db
    .from('sync_runs')
    .select('counts')
    .eq('kind', 'catalog')
    .eq('status', 'ok')
    .order('finished_at', { ascending: false })
    .limit(50);
  if (lastErr) throw new Error(`select last runs: ${lastErr.message}`);
  const last = latestListedCounts(lastRuns);
  const firstRun = previouslyListed.size === 0;
  const guard = checkGuardrails(listed, last, env.sync, { firstRun });
  const cap = recheckCapReason(missing.length, env.sync.recheckMax);
  if (cap) guard.reasons.push(cap);
  guard.ok = guard.reasons.length === 0;
  for (const line of guardrailReport(listed, last, env.sync, guard, { firstRun }))
    console.log(line);
  if (dryRun) {
    const low = checkGuardrails(lower, last, env.sync, { firstRun });
    console.log(
      `[sync] dry run: missing ${missing.length} (would be re-checked); counted as listed above. ` +
        `If all dropped: movie ${lower.movie}, tv ${lower.tv} → ${low.ok ? 'pass' : `fail (${low.reasons.join('; ')})`}`,
    );
    console.log(`[sync] GUARD: ${guard.ok ? 'pass' : 'fail'}`);
  }
  const summary = {
    pages: found.pages,
    discovered: found.rows.size,
    malformed: found.malformed,
    truncated_shards: found.truncatedShards,
    missing: missing.length,
    rechecked: missing.length - recheck.skipped,
    recheck_skipped: recheck.skipped,
    recheck_errors: recheck.errors,
    carried_forward: carried.length,
    gone: recheck.gone.length,
    listed,
    first_run: firstRun,
    ...(dryRun ? { listed_if_all_dropped: lower } : {}),
    ...(guard.warnings.length ? { warnings: guard.warnings } : {}),
  };
  if (!guard.ok)
    return { counts: { ...summary, aborted: guard.reasons }, wrote: 0, aborted: guard.reasons };
  if (dryRun) return { counts: { ...summary, dry_run: true }, wrote: 0 };

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
  return { counts: { ...summary, applied }, wrote: staged.size + recheck.gone.length };
}

/* ------------------------------------------------------------------ */
/* Steps 9–11: palettes, disagreement report, purge + revalidate       */
/* ------------------------------------------------------------------ */

async function paletteStep(db: SupabaseClient, dryRun: boolean, max = 2000): Promise<StepResult> {
  const { data, error } = await db
    .from('catalog_index')
    .select('id, poster_path')
    .eq('needs_palette', true)
    .order('id')
    .limit(max);
  if (error) throw new Error(`palette select: ${error.message}`);
  const rows = (data ?? []) as { id: number; poster_path: string | null }[];
  // Dry run: no poster download, no sharp, no update (ADR-011 §1).
  if (dryRun || rows.length === 0) return { counts: { due: rows.length }, wrote: 0 };
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
  return {
    counts: { due: rows.length, computed: result.ok.length, failed: result.failed.length },
    wrote: result.ok.length,
  };
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

/** The injected steps for `runSync`, wired to Supabase (service role), TMDB and OMDb. */
export function buildSteps(
  env: ServerEnv,
  db: SupabaseClient,
  opts: { runId: string; today: string; tmdbRps?: number },
): SyncSteps {
  const { runId, today } = opts;
  // Ids whose availability the enrich step refreshed this run: the watch step skips them (ADR-012 §4).
  const enrichedIds = new Set<number>();
  return {
    startRun: async () => {
      const { error } = await db
        .from('sync_runs')
        .insert({ id: runId, kind: 'catalog', status: 'running' });
      if (error) throw new Error(`sync_runs insert: ${error.message}`);
    },
    finishRun: async (status, counts, error) => {
      const { error: e } = await db
        .from('sync_runs')
        .update({ status, counts, error: error ?? null, finished_at: new Date().toISOString() })
        .eq('id', runId);
      if (e) console.error('[sync] could not record the run:', e.message);
    },
    discover: ({ dryRun }) => discoverStep(env, db, runId, today, dryRun, opts.tmdbRps),
    enrich: ({ dryRun }) => enrichStep(env, db, dryRun, enrichedIds),
    watch: ({ dryRun }) => watchStep(env, db, dryRun, enrichedIds, opts.tmdbRps),
    imdb: ({ dryRun }) => imdbStep(env, db, dryRun),
    palettes: ({ dryRun }) => paletteStep(db, dryRun),
    disagreements: () => disagreementStep(db),
    purge: () => rpc(db, 'catalog_purge_stale', {}),
    // ADR-013 C-09: analytics retention (anonymous daily counters, 400 days).
    eventsPurge: () => rpc(db, 'events_purge', { p_days: 400 }),
    revalidate: (tags) => revalidateSite(env.siteUrl, env.revalidateSecret, tags),
  };
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
  const result = await runSync(buildSteps(env, db, { runId: randomUUID(), today }), args);
  if (result.status === 'aborted') {
    console.error(
      '[sync] guardrails failed; index membership untouched, the other steps ran:',
      result.reasons.join('; '),
    );
    process.exitCode = 1;
  }
  console.log('[sync] done', JSON.stringify(result.counts));
  if (args.dryRun)
    console.log(
      '[sync] dry run: nothing was written; no OMDb, enrich, watch or image budget was spent',
    );
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1]?.endsWith('sync-catalog.ts')) {
  main().catch((e: unknown) => {
    console.error('[sync] failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
