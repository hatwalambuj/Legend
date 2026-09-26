/**
 * Live TMDB detail provider (ADR-002). OWNER: Backend. SKELETON — implement mapping + caching.
 *
 * Requirements (SYSTEM_DESIGN §4.3, §9):
 * - GET /3/{movie|tv}/{id}?append_to_response=credits,videos,external_ids,reviews (+ aggregate_credits for TV)
 * - Auth: `Authorization: Bearer ${TMDB_READ_TOKEN}` (preferred) or `?api_key=${TMDB_API_KEY}`.
 * - L1: fetch(..., { next: { revalidate: 86400, tags: [`title:${key}`] } }). L2: title_detail_cache table.
 * - 2.5 s timeout (AbortSignal.timeout), request coalescing, circuit breaker (5 failures / 30 s → open 60 s).
 * - On failure: serve L2 (detailStatus 'stale'), else index-only. Never throw to the page.
 * - Validate responses with zod; unknown fields ignored.
 */
import { AppError } from '@/lib/errors';
import type { MediaType } from '@/lib/types';
import type { ServerEnv } from '@/server/env';
import type { CatalogDetailProvider } from '@/server/ports';

export const TMDB_API_BASE = 'https://api.themoviedb.org/3';

export class UpstreamError extends Error {
  override name = 'UpstreamError';
}

export class TmdbDetailProvider implements CatalogDetailProvider {
  readonly name = 'tmdb' as const;

  constructor(private readonly cfg: NonNullable<ServerEnv['tmdb']>) {}

  /** Low-level GET with auth + timeout. Shared with scripts/sync-catalog.ts. */
  async request<T>(
    path: string,
    params: Record<string, string> = {},
    init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } },
  ): Promise<T> {
    const url = new URL(`${TMDB_API_BASE}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.cfg.readToken) headers.authorization = `Bearer ${this.cfg.readToken}`;
    else if (this.cfg.apiKey) url.searchParams.set('api_key', this.cfg.apiKey);
    const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(2500) });
    if (res.status === 404) throw new AppError('not_found', 'Not found on TMDB');
    if (!res.ok) throw new UpstreamError(`TMDB ${res.status} for ${path}`);
    return (await res.json()) as T;
  }

  async getDetail(_mediaType: MediaType, _tmdbId: number): Promise<never> {
    throw new AppError('not_implemented', 'TMDB detail provider not implemented yet (Backend).');
  }
}
