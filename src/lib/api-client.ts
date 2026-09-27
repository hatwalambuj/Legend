/**
 * Typed browser client for the route handlers in API_CONTRACT.md. Client components use ONLY this
 * module to talk to the server (pages/RSC use `@/server/dal` directly). OWNER: Architect. FROZEN.
 *
 * Every call resolves to the typed body or throws `ApiError` (never returns an error body).
 */
import type {
  AuthResponse,
  CatalogResponse,
  CreateStubInput,
  DiaryResponse,
  HandleAvailableResponse,
  MagicLinkInput,
  MagicLinkResponse,
  MeResponse,
  ProfileResponse,
  ReviewUpsertResponse,
  SearchResponse,
  SetPasswordInput,
  SetWatchRegionResponse,
  SignInInput,
  SignUpInput,
  StubDeleteResponse,
  StubMutationResponse,
  TitleReviewsResponse,
  TitleStatesResponse,
  TitleWatchResponse,
  UpdateProfileInput,
  UpdateStubInput,
  UpsertReviewInput,
  WatchlistListResponse,
  WatchlistResponse,
} from './contracts';
import type { ApiErrorBody, ErrorCode } from './errors';
import type { CatalogQuery, MediaType, ReviewSort, TitleKey, TypeFilter } from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Json = Record<string, unknown> | unknown[];

async function request<T>(
  method: string,
  path: string,
  body?: Json,
  opts: { signal?: AbortSignal; cache?: RequestCache } = {},
): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: opts.cache ?? 'no-store',
    signal: opts.signal,
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'internal',
      err?.message ?? 'Something went wrong. Try again.',
      err?.fields,
      err?.retryAfter,
    );
  }
  return data as T;
}

function qs(params: Record<string, string | number | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params))
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const api = {
  /* ---- session / mode ---- */
  me: () => request<MeResponse>('GET', '/api/me'),

  /* ---- catalogue (public) ---- */
  catalog: (q: CatalogQuery) =>
    request<CatalogResponse>(
      'GET',
      `/api/catalog${qs({ type: q.type, sort: q.sort, cursor: q.cursor, limit: q.limit, genre: q.genreIds?.join(',') })}`,
    ),
  search: (q: string, type: TypeFilter = 'all', limit = 20) =>
    request<SearchResponse>('GET', `/api/search${qs({ q, type, limit })}`),
  titleReviews: (
    mediaType: MediaType,
    tmdbId: number,
    sort: ReviewSort = 'newest',
    cursor?: string | null,
  ) =>
    request<TitleReviewsResponse>(
      'GET',
      `/api/titles/${mediaType}/${tmdbId}/reviews${qs({ sort, cursor })}`,
    ),

  /**
   * v1.5 "Where to watch" for one region (region switcher, §5.21). Public and CDN-cached per URL; the
   * region is the only input. Pass `signal` (e.g. `AbortSignal.timeout(1500)`) for the 1.5 s budget;
   * an abort rejects with the platform's AbortError/TimeoutError, not ApiError.
   */
  titleWatch: (key: TitleKey, region: string, opts: { signal?: AbortSignal } = {}) => {
    const [mediaType, tmdbId] = key.split(':');
    return request<TitleWatchResponse>(
      'GET',
      `/api/titles/${mediaType}/${tmdbId}/watch${qs({ region })}`,
      undefined,
      { signal: opts.signal, cache: 'default' },
    );
  },

  /* ---- personal state (private) ---- */
  titleStates: (keys: TitleKey[]) =>
    request<TitleStatesResponse>('GET', `/api/me/title-states${qs({ keys: keys.join(',') })}`),
  diary: (type: TypeFilter = 'all', cursor?: string | null) =>
    request<DiaryResponse>('GET', `/api/me/stubs${qs({ type, cursor })}`),
  watchlist: (cursor?: string | null) =>
    request<WatchlistListResponse>('GET', `/api/me/watchlist${qs({ cursor })}`),

  /* ---- stubs ---- */
  createStub: (input: CreateStubInput) =>
    request<StubMutationResponse>('POST', '/api/stubs', input),
  updateStub: (id: string, input: UpdateStubInput) =>
    request<StubMutationResponse>('PATCH', `/api/stubs/${encodeURIComponent(id)}`, input),
  deleteStub: (id: string) =>
    request<StubDeleteResponse>('DELETE', `/api/stubs/${encodeURIComponent(id)}`),

  /* ---- reviews ---- */
  upsertReview: (input: UpsertReviewInput) =>
    request<ReviewUpsertResponse>('PUT', '/api/reviews', input),
  deleteReview: (id: string) => request<void>('DELETE', `/api/reviews/${encodeURIComponent(id)}`),

  /* ---- watchlist ---- */
  addToWatchlist: (mediaType: MediaType, tmdbId: number) =>
    request<WatchlistResponse>('PUT', `/api/watchlist/${mediaType}/${tmdbId}`, {}),
  removeFromWatchlist: (mediaType: MediaType, tmdbId: number) =>
    request<WatchlistResponse>('DELETE', `/api/watchlist/${mediaType}/${tmdbId}`),

  /* ---- profile ---- */
  /** v1.5: save the watch region (cookie; also the profile when signed in). null = automatic. */
  setWatchRegion: (region: string | null) =>
    request<SetWatchRegionResponse>('PUT', '/api/me/watch-region', { region }),
  updateProfile: (input: UpdateProfileInput) =>
    request<ProfileResponse>('PATCH', '/api/me/profile', input),
  /** Export is a plain navigation/download: <a href={exportUrl('letterboxd')} download>. */
  exportUrl: (format: 'letterboxd' | 'json') => `/api/me/export${qs({ format })}`,

  /* ---- auth ---- */
  signUp: (input: SignUpInput) => request<AuthResponse>('POST', '/api/auth/signup', input),
  signIn: (input: SignInInput) => request<AuthResponse>('POST', '/api/auth/signin', input),
  signOut: () => request<void>('POST', '/api/auth/signout', {}),
  /** v1.4: 204; throws ApiError('reauth_required') when the last sign-in is older than 10 min. */
  setPassword: (input: SetPasswordInput) => request<void>('PUT', '/api/auth/password', input),
  /** Irreversible: erases the account + all its data, then the session is gone (204). */
  deleteAccount: () => request<void>('DELETE', '/api/me', { confirm: 'DELETE' }),
  magicLink: (input: MagicLinkInput) =>
    request<MagicLinkResponse>('POST', '/api/auth/magic-link', input),
  handleAvailable: (handle: string) =>
    request<HandleAvailableResponse>('GET', `/api/auth/handle-available${qs({ handle })}`),
};

export type Api = typeof api;
