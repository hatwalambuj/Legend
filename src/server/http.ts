/**
 * Route-handler helpers: error mapping, input parsing, CSRF/origin check, cache headers
 * (API_CONTRACT §2–§4). OWNER: Backend (authored by Architect — keep the behaviour).
 */
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { AppError, ERROR_COPY, isAppError } from '@/lib/errors';
import { env, type TrustedProxy } from '@/server/env';
import { log } from '@/server/log';

/**
 * Host the client used. x-forwarded-host is trusted only behind a known edge (TRUSTED_PROXY, ADR-001
 * §A3); with `none` it is ignored and the Host header is used.
 */
function clientHost(req: NextRequest, trust: TrustedProxy): string | null {
  const fwd =
    trust === 'none' ? undefined : req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  return fwd || req.headers.get('host');
}

export const CACHE = {
  /** Anonymous catalogue JSON. */
  catalog: 'public, s-maxage=3600, stale-while-revalidate=86400',
  search: 'public, s-maxage=300, stale-while-revalidate=3600',
  reviews: 'public, s-maxage=60, stale-while-revalidate=300',
  /** v1.5 GET /api/titles/{type}/{id}/watch?region= : the URL fully keys it (no cookie, no Accept-Language). */
  watch: 'public, s-maxage=3600, stale-while-revalidate=86400',
  /** v1.6 GET /api/watch/providers?region= (tag `watch-providers`). */
  watchProviders: 'public, s-maxage=3600, stale-while-revalidate=86400',
  /** Anything that reads the session cookie or mutates. */
  private: 'private, no-store',
} as const;

export function json<T>(data: T, init: { status?: number; cache?: string } = {}): NextResponse {
  const res = NextResponse.json(data, { status: init.status ?? 200 });
  res.headers.set('Cache-Control', init.cache ?? CACHE.private);
  if ((init.cache ?? CACHE.private) === CACHE.private) res.headers.set('Vary', 'Cookie');
  return res;
}

export function noContent(): NextResponse {
  const res = new NextResponse(null, { status: 204 });
  res.headers.set('Cache-Control', CACHE.private);
  res.headers.set('Vary', 'Cookie');
  return res;
}

export function errorResponse(e: unknown): NextResponse {
  const err = isAppError(e)
    ? e
    : new AppError('internal', 'Something went wrong. Try again.', { cause: e });
  if (!isAppError(e)) log.error('api_unhandled_error', { error: e });
  const res = NextResponse.json(err.toBody(), { status: err.status });
  // API_CONTRACT §4: every error is `private, no-store` + `Vary: Cookie`.
  res.headers.set('Cache-Control', CACHE.private);
  res.headers.set('Vary', 'Cookie');
  if (err.retryAfter !== undefined) res.headers.set('Retry-After', String(err.retryAfter));
  return res;
}

/** Wrap a handler so thrown AppErrors become the contract's error body. */
export function route<Ctx>(fn: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

function zodFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const k = issue.path.join('.') || '_';
    fields[k] ??= issue.message;
  }
  return fields;
}

export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.output<S> {
  const obj = Object.fromEntries(req.nextUrl.searchParams.entries());
  const r = schema.safeParse(obj);
  if (!r.success)
    throw new AppError('validation_failed', 'Invalid query parameters.', {
      fields: zodFields(r.error),
    });
  return r.data;
}

/** Mutations: require same-origin + JSON (CSRF defence, SYSTEM_DESIGN §7). */
export async function parseBody<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<z.output<S>> {
  assertSameOrigin(req);
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError('unsupported_media_type', 'Expected application/json.');
  }
  const raw: unknown = await req.json().catch(() => {
    throw new AppError('validation_failed', 'Malformed JSON body.');
  });
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: zodFields(r.error),
    });
  return r.data;
}

const tooLarge = () => new AppError('payload_too_large', ERROR_COPY.payload_too_large);

/**
 * Reads at most `maxBytes` of the body (v1.6, ADR-013): a declared `Content-Length` over the limit is
 * refused before reading, and a streamed body is cut off as soon as it passes the limit → 413.
 */
export async function readBodyCapped(req: NextRequest, maxBytes: number): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** `parseBody` with a byte cap (same-origin + JSON + zod; 413 over the cap). */
export async function parseBodyLimited<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
  maxBytes: number,
): Promise<z.output<S>> {
  assertSameOrigin(req);
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    throw new AppError('unsupported_media_type', 'Expected application/json.');
  }
  const text = await readBodyCapped(req, maxBytes);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('validation_failed', 'Malformed JSON body.');
  }
  const r = schema.safeParse(raw);
  if (!r.success)
    throw new AppError('validation_failed', 'Please check the highlighted fields.', {
      fields: zodFields(r.error),
    });
  return r.data;
}

/** For body-less mutations (DELETE). Browsers always send Origin on cross-origin/unsafe requests. */
export function assertSameOrigin(req: NextRequest, trust: TrustedProxy = env().trustedProxy): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetches from older browsers / server-to-server; cookies are SameSite=Lax
  // Same host resolution as requestOrigin(): the first hop of a (possibly chained) proxy list.
  const host = clientHost(req, trust);
  try {
    if (new URL(origin).host !== host)
      throw new AppError('forbidden', 'Cross-origin request blocked.');
  } catch (e) {
    if (isAppError(e)) throw e;
    throw new AppError('forbidden', 'Cross-origin request blocked.');
  }
}

/**
 * The origin the client actually used (proxy-aware). `req.nextUrl.origin` can differ from it under
 * `next start` (e.g. "localhost" for a request to 127.0.0.1), which would move cookies across hosts.
 */
export function requestOrigin(req: NextRequest, trust: TrustedProxy = env().trustedProxy): string {
  // TRUSTED_PROXY=none: the scheme comes from NEXT_PUBLIC_SITE_URL, never from a client header.
  const proto =
    trust === 'none'
      ? new URL(env().siteUrl).protocol.replace(/:$/, '')
      : req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ||
        req.nextUrl.protocol.replace(/:$/, '');
  const host = clientHost(req, trust) || req.nextUrl.host;
  return `${proto === 'https' ? 'https' : 'http'}://${host}`;
}

/** Same-origin redirect with a relative Location, so the browser stays on the host it used. */
export function redirectRelative(path: string, status: 302 | 303 = 302): NextResponse {
  const res = new NextResponse(null, { status, headers: { Location: path } });
  res.headers.set('Cache-Control', CACHE.private);
  res.headers.set('Vary', 'Cookie');
  return res;
}

export function notImplementedRoute(): NextResponse {
  return errorResponse(new AppError('not_implemented', 'This endpoint is not implemented yet.'));
}
