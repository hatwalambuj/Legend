/**
 * OMDb client for IMDb ratings (ADR-008). Used ONLY by the nightly job — never on the request path.
 * OWNER: Backend (implemented by Architect; keep the parsing contract, covered by tests/server/omdb.test.ts).
 *
 * - GET https://www.omdbapi.com/?i={imdbId}&apikey={key}  (free tier: 1,000 calls/day, CC BY-NC)
 * - "N/A" rating → { rating: null } (the title exists but has no rating yet; the UI hides the chip)
 * - Unknown id ("Incorrect IMDb ID." / "Error getting data.") → null
 * - Quota exhausted / bad key → OmdbLimitError: the job stops calling and resumes next night.
 * Not marked `server-only` so tsx scripts can import it; it is never imported by the app.
 */
import type { ImdbRating, ImdbRatingProvider } from '@/server/ports';

export const OMDB_API_BASE = 'https://www.omdbapi.com/';

export class OmdbLimitError extends Error {
  override name = 'OmdbLimitError';
}

export class OmdbUpstreamError extends Error {
  override name = 'OmdbUpstreamError';
}

interface OmdbBody {
  Response?: string;
  Error?: string;
  imdbRating?: string;
  imdbVotes?: string;
}

/** Pure parser for an OMDb `?i=` response body. Exported for tests. */
export function parseOmdbRating(body: unknown): ImdbRating | null {
  const b = (body ?? {}) as OmdbBody;
  if (b.Response !== 'True') {
    const err = (b.Error ?? '').toLowerCase();
    if (err.includes('limit') || err.includes('api key')) throw new OmdbLimitError(b.Error);
    return null;
  }
  const r = Number.parseFloat(b.imdbRating ?? '');
  const rating = Number.isFinite(r) && r >= 1 && r <= 10 ? Math.round(r * 10) / 10 : null;
  const v = Number.parseInt((b.imdbVotes ?? '').replace(/[^0-9]/g, ''), 10);
  const votes = Number.isFinite(v) && v >= 0 ? v : null;
  return { rating, votes: rating === null ? null : votes };
}

export class OmdbRatingProvider implements ImdbRatingProvider {
  readonly name = 'omdb' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getImdbRating(imdbId: string): Promise<ImdbRating | null> {
    if (!/^tt\d{7,10}$/.test(imdbId)) return null;
    const url = new URL(OMDB_API_BASE);
    url.searchParams.set('i', imdbId);
    url.searchParams.set('apikey', this.apiKey);
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    // OMDb answers 401 (with a JSON Error) for "Request limit reached!" and "Invalid API key!".
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as OmdbBody;
      throw new OmdbLimitError(body.Error ?? 'OMDb 401');
    }
    if (!res.ok) throw new OmdbUpstreamError(`OMDb ${res.status} for ${imdbId}`);
    return parseOmdbRating(await res.json());
  }
}
