/**
 * Nightly DISCOVER step (ADR-002/003, SYSTEM_DESIGN §4.4): TMDB /discover per media type and year
 * shard → staging rows (slug, sort_title, search_text via src/lib/text.ts; is_listed via isListed()),
 * re-check of previously listed titles missing from discover (dropped vs gone), and guardrails.
 * Pure over injected I/O (`get`, `sleep`, `now`) so every rule is unit-tested; scripts/sync-catalog.ts
 * wires it to TMDB + Supabase. Deterministic data processing only — no AI/LLM (PRD D15).
 * Not `server-only`: tsx imports it. OWNER: Backend.
 */
import { z } from 'zod';
import { isListed, type CurationRule } from '@/lib/curation';
import { toTitleKey } from '@/lib/keys';
import { normalizeSearch, slugify, sortTitle, truncate } from '@/lib/text';
import type { Genre, MediaType, TitleKey } from '@/lib/types';

/** Row shape of public.catalog_staging. */
export interface StagingRow {
  run_id: string;
  media_type: MediaType;
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  slug: string;
  overview_short: string;
  release_date: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
  genres: Genre[];
  original_language: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  sort_title: string;
  search_text: string;
  is_listed: boolean;
}

export const TMDB_MAX_PAGES = 500;

/* ---------------- query building ---------------- */

/** Year shards keep every discover query under TMDB's 500-page cap (pre-1970 by decade). */
export function yearShards(
  fromYear = 1900,
  toYear = new Date().getUTCFullYear(),
): { gte: string; lte: string }[] {
  const shards: { gte: string; lte: string }[] = [];
  for (let y = fromYear; y < 1970; y += 10)
    shards.push({ gte: `${y}-01-01`, lte: `${Math.min(y + 9, 1969)}-12-31` });
  for (let y = Math.max(fromYear, 1970); y <= toYear; y++)
    shards.push({ gte: `${y}-01-01`, lte: `${y}-12-31` });
  return shards;
}

/**
 * Discover floor: the lower of min/keep rating (hysteresis candidates must come back too), minus 0.05
 * because curation compares the one-decimal rounded value (6.45 rounds to 6.5 and is listed).
 */
export function discoverParams(
  type: MediaType,
  shard: { gte: string; lte: string },
  rule: CurationRule,
  page: number,
): Record<string, string> {
  const floor = Math.min(rule.minRating, rule.keepRating) - 0.05;
  const dateField = type === 'movie' ? 'primary_release_date' : 'first_air_date';
  const p: Record<string, string> = {
    'vote_average.gte': floor.toFixed(2),
    'vote_count.gte': String(type === 'movie' ? rule.minVotesMovie : rule.minVotesTv),
    [`${dateField}.gte`]: shard.gte,
    [`${dateField}.lte`]: shard.lte,
    sort_by: 'vote_count.desc',
    include_adult: 'false',
    language: 'en-US',
    page: String(page),
  };
  if (type === 'movie') p.include_video = 'false';
  if (type === 'tv' && rule.excludeTvGenreIds.length)
    p.without_genres = rule.excludeTvGenreIds.join(',');
  return p;
}

/* ---------------- mapping ---------------- */

const resultSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().optional(),
  name: z.string().optional(),
  original_title: z.string().optional(),
  original_name: z.string().optional(),
  overview: z.string().nullish(),
  release_date: z.string().nullish(),
  first_air_date: z.string().nullish(),
  vote_average: z.number().min(0).max(10),
  vote_count: z.number().int().min(0),
  popularity: z.number().nullish(),
  genre_ids: z.array(z.number().int()).nullish(),
  genres: z.array(z.object({ id: z.number().int(), name: z.string() })).nullish(),
  adult: z.boolean().nullish(),
  original_language: z.string().nullish(),
  poster_path: z.string().nullish(),
  backdrop_path: z.string().nullish(),
  imdb_id: z.string().nullish(),
  external_ids: z.object({ imdb_id: z.string().nullish() }).nullish(),
});

const pageSchema = z.object({
  page: z.number().int(),
  total_pages: z.number().int().min(0),
  results: z.array(z.unknown()),
});

export interface MapContext {
  runId: string;
  rule: CurationRule;
  today: string;
  /** Title keys listed after the previous sync (hysteresis input). */
  previouslyListed: ReadonlySet<string>;
  /** TMDB genre id → name, from /genre/{type}/list. */
  genreNames: ReadonlyMap<number, string>;
}

const isoDate = (s: string | null | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/**
 * One TMDB discover result (or /{type}/{id} detail body) → staging row. Null for malformed rows
 * (schema drift is dropped row by row, and the guardrails catch a broken page).
 */
export function mapDiscoverResult(
  type: MediaType,
  raw: unknown,
  ctx: MapContext,
): StagingRow | null {
  const r = resultSchema.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  const title = (type === 'movie' ? d.title : d.name)?.trim() || d.title || d.name;
  if (!title) return null;
  const originalTitle = (type === 'movie' ? d.original_title : d.original_name)?.trim() || title;
  const releaseDate = isoDate(type === 'movie' ? d.release_date : d.first_air_date);
  const genreIds = d.genre_ids ?? d.genres?.map((g) => g.id) ?? [];
  const genres: Genre[] = genreIds.map((id) => ({
    id,
    name: d.genres?.find((g) => g.id === id)?.name ?? ctx.genreNames.get(id) ?? 'Other',
  }));
  const key = toTitleKey(type, d.id);
  const voteAverage = Math.round(d.vote_average * 10) / 10;
  const imdb = d.imdb_id ?? d.external_ids?.imdb_id ?? null;
  return {
    run_id: ctx.runId,
    media_type: type,
    tmdb_id: d.id,
    imdb_id: imdb && /^tt\d{7,10}$/.test(imdb) ? imdb : null,
    title,
    original_title: originalTitle,
    slug: slugify(title),
    overview_short: truncate((d.overview ?? '').replace(/\s+/g, ' ').trim(), 300),
    release_date: releaseDate,
    vote_average: voteAverage,
    vote_count: d.vote_count,
    popularity: d.popularity ?? 0,
    genre_ids: genreIds,
    genres,
    original_language: d.original_language ?? null,
    poster_path: d.poster_path ?? null,
    backdrop_path: d.backdrop_path ?? null,
    sort_title: sortTitle(title),
    search_text: normalizeSearch(`${title} ${originalTitle}`),
    is_listed: isListed(
      {
        mediaType: type,
        voteAverage,
        voteCount: d.vote_count,
        genreIds,
        releaseDate,
        adult: d.adult ?? false,
        wasListed: ctx.previouslyListed.has(key),
      },
      ctx.rule,
      ctx.today,
    ),
  };
}

/* ---------------- throttling + retries ---------------- */

export interface HttpErrorLike {
  status?: number;
  retryAfter?: number;
}

/** Spaces calls to at most `rps` per second (a token bucket of size 1). */
export function createThrottle(
  rps: number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): () => Promise<void> {
  const gap = 1000 / Math.max(rps, 0.001);
  let next = 0;
  return async () => {
    const t = now();
    const at = Math.max(t, next);
    next = at + gap;
    if (at > t) await sleep(at - t);
  };
}

/**
 * Retries 429 (honouring Retry-After), 5xx and network errors with exponential backoff + jitter,
 * at most `maxRetries` times. Other errors (e.g. 404) are returned to the caller immediately.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxRetries?: number;
    baseMs?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
    isRetryable?: (e: unknown) => boolean;
  } = {},
): Promise<T> {
  const max = opts.maxRetries ?? 5;
  const base = opts.baseMs ?? 500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  const retryable =
    opts.isRetryable ??
    ((e: unknown) => {
      const s = (e as HttpErrorLike)?.status;
      return s === undefined || s === 429 || s >= 500;
    });
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= max || !retryable(e)) throw e;
      const ra = (e as HttpErrorLike)?.retryAfter;
      const backoff = ra && ra > 0 ? ra * 1000 : base * 2 ** attempt * (0.5 + random());
      await sleep(Math.min(backoff, 60_000));
    }
  }
}

/* ---------------- discover all ---------------- */

export interface DiscoverDeps {
  /** GET a TMDB path (already throttled + retried by the caller). */
  get(path: string, params: Record<string, string>): Promise<unknown>;
  log?: (msg: string) => void;
}

export interface DiscoverResult {
  rows: Map<TitleKey, StagingRow>;
  pages: number;
  malformed: number;
  truncatedShards: number;
}

export async function discoverAll(
  deps: DiscoverDeps,
  opts: {
    types: MediaType[];
    shards: { gte: string; lte: string }[];
    ctx: Omit<MapContext, 'genreNames'>;
    genreNames: Record<MediaType, ReadonlyMap<number, string>>;
  },
): Promise<DiscoverResult> {
  const rows = new Map<TitleKey, StagingRow>();
  let pages = 0;
  let malformed = 0;
  let truncatedShards = 0;
  for (const type of opts.types) {
    const ctx: MapContext = { ...opts.ctx, genreNames: opts.genreNames[type] };
    for (const shard of opts.shards) {
      let totalPages = 1;
      for (let page = 1; page <= Math.min(totalPages, TMDB_MAX_PAGES); page++) {
        const parsed = pageSchema.safeParse(
          await deps.get(`/discover/${type}`, discoverParams(type, shard, opts.ctx.rule, page)),
        );
        pages++;
        if (!parsed.success)
          throw new Error(`discover ${type} ${shard.gte}: malformed page ${page}`);
        totalPages = parsed.data.total_pages;
        for (const raw of parsed.data.results) {
          const row = mapDiscoverResult(type, raw, ctx);
          if (!row) malformed++;
          else rows.set(toTitleKey(type, row.tmdb_id), row);
        }
      }
      if (totalPages > TMDB_MAX_PAGES) {
        truncatedShards++;
        deps.log?.(`[discover] ${type} ${shard.gte}..${shard.lte} exceeds ${TMDB_MAX_PAGES} pages`);
      }
    }
  }
  return { rows, pages, malformed, truncatedShards };
}

/**
 * Previously listed titles absent from discover: re-fetch each one. 404 → gone (stays unlisted, marked
 * source_status 'gone'); otherwise its fresh row (hysteresis may keep it listed) is staged.
 */
export async function recheckMissing(
  deps: { detail(type: MediaType, id: number): Promise<unknown | null> },
  missing: TitleKey[],
  ctx: MapContext,
  limit = 500,
): Promise<{ rows: StagingRow[]; gone: TitleKey[]; skipped: number; errors: number }> {
  const rows: StagingRow[] = [];
  const gone: TitleKey[] = [];
  let errors = 0;
  for (const key of missing.slice(0, limit)) {
    const [type, id] = key.split(':') as [MediaType, string];
    try {
      const body = await deps.detail(type, Number(id));
      if (body === null) gone.push(key);
      else {
        const row = mapDiscoverResult(type, body, ctx);
        if (row) rows.push(row);
      }
    } catch {
      errors++; // left as is; the next run re-checks
    }
  }
  return { rows, gone, skipped: Math.max(0, missing.length - limit), errors };
}

/* ---------------- guardrails ---------------- */

export interface GuardrailConfig {
  guardMin: number;
  guardMax: number;
  guardMaxDelta: number;
}

export type ListedCounts = Record<MediaType, number>;

export function countListed(rows: Iterable<StagingRow>): ListedCounts {
  const c: ListedCounts = { movie: 0, tv: 0 };
  for (const r of rows) if (r.is_listed) c[r.media_type]++;
  return c;
}

/**
 * Listed count per type within [guardMin, guardMax] and |Δ| vs the last OK run < guardMaxDelta.
 * Failing guardrails abort the run with the index untouched (SYSTEM_DESIGN §14).
 */
export function checkGuardrails(
  counts: ListedCounts,
  last: ListedCounts | null,
  cfg: GuardrailConfig,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const type of ['movie', 'tv'] as const) {
    const n = counts[type];
    if (n < cfg.guardMin || n > cfg.guardMax)
      reasons.push(`${type}: ${n} listed is outside [${cfg.guardMin}, ${cfg.guardMax}]`);
    const prev = last?.[type];
    if (prev && prev > 0) {
      const delta = Math.abs(n - prev) / prev;
      if (delta >= cfg.guardMaxDelta)
        reasons.push(
          `${type}: ${n} vs ${prev} last run (Δ ${(delta * 100).toFixed(1)}% ≥ ${(cfg.guardMaxDelta * 100).toFixed(0)}%)`,
        );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Genre list response → id → name. */
export function genreMap(body: unknown): Map<number, string> {
  const parsed = z
    .object({ genres: z.array(z.object({ id: z.number().int(), name: z.string() })) })
    .safeParse(body);
  return new Map(parsed.success ? parsed.data.genres.map((g) => [g.id, g.name]) : []);
}
