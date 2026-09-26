/**
 * Route-handler helpers: error mapping, input parsing, CSRF/origin check, cache headers
 * (API_CONTRACT §2–§4). OWNER: Backend (authored by Architect — keep the behaviour).
 */
import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { z } from 'zod';
import { AppError, isAppError } from '@/lib/errors';

export const CACHE = {
  /** Anonymous catalogue JSON. */
  catalog: 'public, s-maxage=3600, stale-while-revalidate=86400',
  search: 'public, s-maxage=300, stale-while-revalidate=3600',
  reviews: 'public, s-maxage=60, stale-while-revalidate=300',
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
  return res;
}

export function errorResponse(e: unknown): NextResponse {
  const err = isAppError(e)
    ? e
    : new AppError('internal', 'Something went wrong. Try again.', { cause: e });
  if (!isAppError(e)) console.error('[api] unhandled error', e);
  const res = NextResponse.json(err.toBody(), { status: err.status });
  res.headers.set('Cache-Control', CACHE.private);
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

/** For body-less mutations (DELETE). Browsers always send Origin on cross-origin/unsafe requests. */
export function assertSameOrigin(req: NextRequest): void {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetches from older browsers / server-to-server; cookies are SameSite=Lax
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origin).host !== host)
      throw new AppError('forbidden', 'Cross-origin request blocked.');
  } catch (e) {
    if (isAppError(e)) throw e;
    throw new AppError('forbidden', 'Cross-origin request blocked.');
  }
}

export function notImplementedRoute(): NextResponse {
  return errorResponse(new AppError('not_implemented', 'This endpoint is not implemented yet.'));
}
