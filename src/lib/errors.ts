/**
 * Error model shared by route handlers, the data-access layer and the typed API client.
 * OWNER: Architect. FROZEN. See docs/04-architecture/API_CONTRACT.md §2.
 */

export const ERROR_STATUS = {
  validation_failed: 400,
  invalid_credentials: 401,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  email_taken: 409,
  handle_taken: 409,
  conflict: 409,
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
  not_found: "This ticket doesn't exist.",
  upstream_unavailable: "The projector jammed. We couldn't load that.",
  internal: 'Something went wrong. Try again.',
} as const;
