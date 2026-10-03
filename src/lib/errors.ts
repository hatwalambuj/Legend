/**
 * Error model shared by route handlers, the data-access layer and the typed API client.
 * OWNER: Architect. FROZEN. See docs/04-architecture/API_CONTRACT.md §2.
 */
import { BRAND_NAME } from './brand';

export const ERROR_STATUS = {
  validation_failed: 400,
  invalid_credentials: 401,
  /** v1.4: PUT /api/auth/password with a session whose last sign-in is older than 10 min. */
  reauth_required: 401,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  email_taken: 409,
  handle_taken: 409,
  conflict: 409,
  /** v1.6 (ADR-013): body or row count over the route limit (imports, /api/events, /api/log). */
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  not_implemented: 501,
  upstream_unavailable: 503,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** JSON body of every non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Human-readable, safe to show to users. Never includes stack traces or SQL. */
    message: string;
    /** Per-field validation messages, keyed by input field name. */
    fields?: Record<string, string>;
    /** Seconds until retry is allowed (rate_limited only). Mirrors the Retry-After header. */
    retryAfter?: number;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: Record<string, string>;
  readonly retryAfter?: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { fields?: Record<string, string>; retryAfter?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.fields = opts.fields;
    this.retryAfter = opts.retryAfter;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
        ...(this.retryAfter !== undefined ? { retryAfter: this.retryAfter } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Copy the design system uses for common errors (DESIGN §10). */
export const ERROR_COPY = {
  invalid_credentials: "That email and password don't match.",
  email_taken: 'An account with that email already exists. Sign in instead?',
  handle_taken: 'That handle is taken.',
  rate_limited_stub: "Easy — that's a lot of stubs in a minute. Try again shortly.",
  rate_limited_review: "Easy — that's a lot of reviews in a minute. Try again shortly.",
  unauthenticated: 'Sign in to do that.',
  reauth_required: 'Sign in again to change your password.',
  not_found: "This ticket doesn't exist.",
  upstream_unavailable: "The projector jammed. We couldn't load that.",
  internal: 'Something went wrong. Try again.',
  /** v1.6 (ADR-013 C-11). */
  payload_too_large: "That's too much at once. Try a smaller file.",
  /** v1.6: search / import copy for titles outside the curated catalogue (C-15 brand). */
  not_in_catalog: `Not in ${BRAND_NAME} — we only list titles rated 6.5+`,
  rate_limited_import: "That's a lot of imports for one day. Try again tomorrow.",
} as const;
