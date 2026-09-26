/**
 * Nightly catalogue sync (ADR-002, ADR-007). Runs in GitHub Actions (.github/workflows/nightly-sync.yml).
 * OWNER: Backend (skeleton by Architect — the flow and guardrails below are the contract).
 *
 *   npm run sync:catalog                   # live: TMDB → catalog_staging → catalog_index (needs keys)
 *   npm run sync:catalog -- --dry-run      # fetch + transform + guardrails, write nothing
 *   npm run sync:catalog -- --from-fixtures  # seed a Supabase project from src/fixtures (no TMDB needed)
 *
 * Flow
 *  1. insert sync_runs(status=running)
 *  2. for media_type in [movie, tv], for each year shard (pre-1970 by decade):
 *       GET /discover/{type}?vote_average.gte=MIN&vote_count.gte=FLOOR&{date range}&sort_by=vote_count.desc
 *           &include_adult=false[&without_genres=10767,10763,10764 for tv]&page=n
 *     throttle 10 req/s, honour 429 Retry-After, exponential backoff with jitter (max 5 retries)
 *  3. transform rows → staging shape (slug, sort_title, search_text via src/lib/text.ts;
 *     is_listed via src/lib/curation.ts isListed())
 *  4. re-check previously-listed titles missing from discover (GET /{type}/{id}): dropped (unlist) vs gone (404)
 *  5. guardrails: listed count per type within [SYNC_GUARD_MIN, SYNC_GUARD_MAX] and delta vs last ok run
 *     < SYNC_GUARD_MAX_DELTA → otherwise sync_runs.status='aborted', exit 1, index untouched
 *  6. upsert staging in batches of 500 (service role), rpc('catalog_apply_staging', { p_run })
 *  7. palettes: rows where needs_palette → fetch w92 poster, sharp().resize(24,36,{fit:'fill'}).removeAlpha().raw()
 *     → extractColors() → tintsFrom() → LQIP sharp().resize(8,12).webp({quality:40}); 30 concurrent
 *  8. rpc('catalog_purge_stale'); POST {SITE_URL}/api/revalidate {tags:['catalog']} with x-revalidate-secret
 *  9. sync_runs.status='ok', counts
 */
import { DEFAULT_CURATION_RULE, isListed } from '../src/lib/curation';
import { normalizeSearch, sortTitle } from '../src/lib/text';
import { parseEnv } from '../src/server/env';
import catalogJson from '../src/fixtures/catalog.json';
import type { FixtureCatalog } from '../src/fixtures/schema';

interface Args {
  dryRun: boolean;
  fromFixtures: boolean;
}

function parseArgs(argv: string[]): Args {
  return { dryRun: argv.includes('--dry-run'), fromFixtures: argv.includes('--from-fixtures') };
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
  const catalog = catalogJson as unknown as FixtureCatalog;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = parseEnv();
  const today = new Date().toISOString().slice(0, 10);

  if (args.fromFixtures) {
    const rows = fixtureStagingRows('00000000-0000-4000-8000-000000000000', today);
    console.log(
      `[sync] fixtures → ${rows.length} staging rows (${rows.filter((r) => r.is_listed).length} listed)`,
    );
    if (args.dryRun) return;
    if (!env.supabase?.serviceRoleKey)
      throw new Error('--from-fixtures needs Supabase URL + SUPABASE_SERVICE_ROLE_KEY');
    // TODO(Backend): upsert rows into catalog_staging, rpc('catalog_apply_staging'), then write palettes
    // straight from the fixtures (they are precomputed) and set needs_palette=false.
    throw new Error('TODO(Backend): --from-fixtures write path not implemented yet');
  }

  if (!env.tmdb) {
    console.log(
      '[sync] No TMDB_READ_TOKEN / TMDB_API_KEY: nothing to sync (demo mode uses bundled fixtures).',
    );
    return;
  }
  if (!args.dryRun && !env.supabase?.serviceRoleKey) {
    throw new Error('Live sync needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  const shards = yearShards();
  console.log(
    `[sync] rule: >= ${env.curation.minRating}, votes movie >= ${env.curation.minVotesMovie}, tv >= ${env.curation.minVotesTv}; ${shards.length} shards per type`,
  );
  // TODO(Backend): steps 1–9 above.
  throw new Error('TODO(Backend): live TMDB sync not implemented yet');
}

// Only run when executed directly (tests may import the helpers).
if (process.argv[1]?.endsWith('sync-catalog.ts')) {
  main().catch((e: unknown) => {
    console.error('[sync] failed:', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
