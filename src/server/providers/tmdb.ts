/**
 * Live TMDB detail provider (ADR-002, SYSTEM_DESIGN §4.3, §9). OWNER: Backend.
 *
 *   GET /3/{movie|tv}/{id}?append_to_response=credits,videos,reviews (+ aggregate_credits for TV)
 *
 * - Auth: `Authorization: Bearer ${TMDB_READ_TOKEN}` (preferred) or `?api_key=${TMDB_API_KEY}`.
 * - L1: Next data cache — fetch(..., { next: { revalidate: 86400, tags: [`title:${key}`] } }).
 * - L2: `DetailCacheStore` (Supabase `title_detail_cache`), plus a bounded in-process copy of the last
 *   good payload, both used only when TMDB fails → `stale: true` (detailStatus 'stale').
 * - 2.5 s timeout, request coalescing (one in-flight fetch per title), circuit breaker
 *   (5 failures / 30 s → open 60 s → one half-open trial).
 * - 404 → null (the DAL renders index-only). Other failures without any cached copy throw
 *   `UpstreamError`, which the DAL degrades to index-only — the page never errors.
 * - Responses are validated with zod; unknown fields are ignored, malformed parts become empty.
 * Not `server-only`: scripts/sync-catalog.ts reuses `request()`.
 */
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { toTitleKey } from '@/lib/keys';
import type { CastMember, MediaType, TitleKey, TmdbReview, Trailer } from '@/lib/types';
import type { ServerEnv } from '@/server/env';
import type {
  CatalogDetailProvider,
  DetailCacheStore,
  DetailFields,
  DetailResult,
} from '@/server/ports';
import { CircuitBreaker } from './circuit-breaker';

export const TMDB_API_BASE = 'https://api.themoviedb.org/3';
export const TMDB_TIMEOUT_MS = 2500;
export const DETAIL_REVALIDATE_SECONDS = 86_400;

export class UpstreamError extends Error {
  override name = 'UpstreamError';
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/* ---------------- response schema (lenient) ---------------- */

const str = z.string().catch('');
const optStr = z.string().nullish().catch(null);
const num = z.number().nullish().catch(null);
const list = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((xs) =>
      xs.flatMap((x) => {
        const r = item.safeParse(x);
        return r.success ? [r.data as z.output<T>] : [];
      }),
    );

const castSchema = z.object({
  name: z.string(),
  character: optStr,
  profile_path: optStr,
  order: num,
  roles: list(z.object({ character: optStr })).optional(),
});
const crewSchema = z.object({ name: z.string(), job: optStr });
const videoSchema = z.object({
  site: z.string(),
  key: z.string(),
  name: str,
  type: str,
  official: z.boolean().nullish().catch(null),
});
const reviewSchema = z.object({
  id: z.string(),
  author: str,
  content: str,
  created_at: str,
  url: str,
  author_details: z.object({ rating: num }).nullish().catch(null),
});

export const tmdbDetailSchema = z.object({
  overview: str,
  tagline: optStr,
  runtime: num,
  number_of_seasons: num,
  number_of_episodes: num,
  created_by: list(z.object({ name: z.string() })).optional(),
  credits: z
    .object({ cast: list(castSchema).optional(), crew: list(crewSchema).optional() })
    .nullish()
    .catch(null),
  aggregate_credits: z
    .object({ cast: list(castSchema).optional() })
    .nullish()
    .catch(null),
  videos: z
    .object({ results: list(videoSchema).optional() })
    .nullish()
    .catch(null),
  reviews: z
    .object({ results: list(reviewSchema).optional() })
    .nullish()
    .catch(null),
});

export const CAST_LIMIT = 12;
export const TMDB_REVIEW_LIMIT = 5;
export const TMDB_REVIEW_MAX_CHARS = 4000;

const positive = (n: number | null | undefined) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;

function pickTrailer(videos: z.output<typeof videoSchema>[]): Trailer | null {
  const ok = videos.filter((v) => v.site === 'YouTube' || v.site === 'Vimeo');
  const rank = (v: (typeof ok)[number]) =>
    (v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 2 : 4) + (v.official ? 0 : 1);
  const best = [...ok].sort((a, b) => rank(a) - rank(b))[0];
  if (!best || rank(best) >= 4) return null;
  return { site: best.site as Trailer['site'], key: best.key, name: best.name || 'Trailer' };
}

/** Pure mapping of a TMDB detail body to the DetailResult. Exported for tests. */
export function mapTmdbDetail(mediaType: MediaType, body: unknown): Omit<DetailResult, 'stale'> {
  const d = tmdbDetailSchema.parse(body ?? {});
  const castSrc =
    mediaType === 'tv' && d.aggregate_credits?.cast?.length
      ? d.aggregate_credits.cast
      : (d.credits?.cast ?? []);
  const cast: CastMember[] = [...castSrc]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT)
    .map((c) => ({
      name: c.name,
      character: c.character || c.roles?.find((r) => r.character)?.character || '',
      profilePath: c.profile_path ?? null,
    }));
  const directors =
    mediaType === 'movie'
      ? [...new Set((d.credits?.crew ?? []).filter((c) => c.job === 'Director').map((c) => c.name))]
      : [...new Set((d.created_by ?? []).map((c) => c.name))];
  const tmdbReviews: TmdbReview[] = (d.reviews?.results ?? [])
    .slice(0, TMDB_REVIEW_LIMIT)
    .map((r) => ({
      id: r.id,
      author: r.author || 'TMDB user',
      rating: r.author_details?.rating ?? null,
      content:
        r.content.length > TMDB_REVIEW_MAX_CHARS
          ? `${r.content.slice(0, TMDB_REVIEW_MAX_CHARS - 1)}…`
          : r.content,
      createdAt: r.created_at,
      url: r.url,
    }));
  const fields: DetailFields = {
    overview: d.overview,
    tagline: d.tagline?.trim() ? d.tagline.trim() : null,
    directors: directors.slice(0, 4),
    cast,
    trailer: pickTrailer(d.videos?.results ?? []),
    tmdbReviews,
  };
  const summaryPatch: DetailResult['summaryPatch'] = {};
  if (mediaType === 'movie' && positive(d.runtime))
    summaryPatch.runtimeMinutes = positive(d.runtime);
  if (mediaType === 'tv' && positive(d.number_of_seasons))
    summaryPatch.seasonCount = positive(d.number_of_seasons);
  if (mediaType === 'tv' && positive(d.number_of_episodes))
    summaryPatch.episodeCount = positive(d.number_of_episodes);
  return { fields, summaryPatch };
}

export function detailAppends(mediaType: MediaType): string {
  return mediaType === 'tv' ? 'aggregate_credits,credits,videos,reviews' : 'credits,videos,reviews';
}

/* ---------------- provider ---------------- */

type NextInit = RequestInit & { next?: { revalidate?: number; tags?: string[] } };

export interface TmdbProviderOptions {
  fetchImpl?: typeof fetch;
  cache?: DetailCacheStore | null;
  breaker?: CircuitBreaker;
  timeoutMs?: number;
  now?: () => number;
  /** Bounded in-process fallback copies. */
  memoryEntries?: number;
}

const isOutage = (e: unknown) => e instanceof UpstreamError;

export class TmdbDetailProvider implements CatalogDetailProvider {
  readonly name = 'tmdb' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly breaker: CircuitBreaker;
  private readonly inflight = new Map<TitleKey, Promise<DetailResult | null>>();
  private readonly lastGood = new Map<
    TitleKey,
    { result: Omit<DetailResult, 'stale'>; fetchedAt: string }
  >();
  private readonly lastPut = new Map<TitleKey, number>();

  constructor(
    private readonly cfg: NonNullable<ServerEnv['tmdb']>,
    private readonly opts: TmdbProviderOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.breaker = opts.breaker ?? new CircuitBreaker();
  }

  private now() {
    return (this.opts.now ?? Date.now)();
  }

  /** Low-level GET with auth + timeout. Shared with scripts/sync-catalog.ts. */
  async request<T>(path: string, params: Record<string, string> = {}, init?: NextInit): Promise<T> {
    const url = new URL(`${TMDB_API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cfg.readToken) headers.authorization = `Bearer ${this.cfg.readToken}`;
    else if (this.cfg.apiKey) url.searchParams.set('api_key', this.cfg.apiKey);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? TMDB_TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(
        `TMDB ${e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network error'} for ${path}`,
      );
    }
    if (res.status === 404) throw new AppError('not_found', 'Not found on TMDB');
    if (!res.ok) {
      const ra = Number(res.headers.get('retry-after'));
      throw new UpstreamError(
        `TMDB ${res.status} for ${path}`,
        res.status,
        Number.isFinite(ra) && ra > 0 ? ra : undefined,
      );
    }
    try {
      return (await res.json()) as T;
    } catch {
      throw new UpstreamError(`TMDB returned invalid JSON for ${path}`, res.status);
    }
  }

  async getDetail(mediaType: MediaType, tmdbId: number): Promise<DetailResult | null> {
    const key = toTitleKey(mediaType, tmdbId);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = this.load(mediaType, tmdbId, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async load(mediaType: MediaType, tmdbId: number, key: TitleKey) {
    try {
      const body = await this.breaker.run(
        () =>
          this.request<unknown>(
            `/${mediaType}/${tmdbId}`,
            { append_to_response: detailAppends(mediaType), language: 'en-US' },
            { next: { revalidate: DETAIL_REVALIDATE_SECONDS, tags: [`title:${key}`] } },
          ),
        isOutage,
      );
      const result = mapTmdbDetail(mediaType, body);
      const fetchedAt = new Date(this.now()).toISOString();
      this.remember(key, result, fetchedAt);
      return { ...result, fetchedAt };
    } catch (e) {
      if (e instanceof AppError && e.code === 'not_found') return null;
      const cached = await this.cached(key);
      if (cached) return { ...cached.result, fetchedAt: cached.fetchedAt, stale: true };
      throw e instanceof UpstreamError ? e : new UpstreamError(String(e));
    }
  }

  private remember(key: TitleKey, result: Omit<DetailResult, 'stale'>, fetchedAt: string) {
    this.lastGood.delete(key);
    this.lastGood.set(key, { result, fetchedAt });
    const max = this.opts.memoryEntries ?? 500;
    while (this.lastGood.size > max) {
      const oldest = this.lastGood.keys().next().value;
      if (oldest === undefined) break;
      this.lastGood.delete(oldest);
    }
    // L2 write at most every 12 h per title per instance (L1 hits look identical to misses here).
    const cache = this.opts.cache;
    const last = this.lastPut.get(key);
    if (cache && (last === undefined || this.now() - last > 12 * 3600_000)) {
      this.lastPut.set(key, this.now());
      cache.put(key, result, fetchedAt).catch((err: unknown) => {
        console.warn('[tmdb] L2 cache write failed', key, err);
      });
    }
  }

  private async cached(key: TitleKey) {
    const mem = this.lastGood.get(key);
    if (mem) return mem;
    try {
      return (await this.opts.cache?.get(key)) ?? null;
    } catch (err) {
      console.warn('[tmdb] L2 cache read failed', key, err);
      return null;
    }
  }
}
