/* oxlint-disable max-classes-per-file -- error taxonomy requires co-located class definitions */
/**
 * Error taxonomy for @ontrails/core
 *
 * Provides a structured error hierarchy with category-based mapping
 * to exit codes, HTTP status codes, and JSON-RPC error codes.
 */

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

export const errorCategories = [
  'validation',
  'not_found',
  'conflict',
  'permission',
  'timeout',
  'rate_limit',
  'network',
  'internal',
  'auth',
  'cancelled',
] as const;

export type ErrorCategory = (typeof errorCategories)[number];

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export abstract class TrailsError extends Error {
  abstract readonly category: ErrorCategory;
  abstract readonly retryable: boolean;
  readonly context?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.context = options?.context;
  }
}

// ---------------------------------------------------------------------------
// Concrete error classes
// ---------------------------------------------------------------------------

export class ValidationError extends TrailsError {
  readonly category = 'validation' as const;
  readonly retryable = false as const;
}

export class AmbiguousError extends TrailsError {
  readonly category = 'validation' as const;
  readonly retryable = false as const;
}

export class AssertionError extends TrailsError {
  readonly category = 'internal' as const;
  readonly retryable = false as const;
}

export class NotFoundError extends TrailsError {
  readonly category = 'not_found' as const;
  readonly retryable = false as const;
}

export class AlreadyExistsError extends TrailsError {
  readonly category = 'conflict' as const;
  readonly retryable = false as const;
}

export class ConflictError extends TrailsError {
  readonly category = 'conflict' as const;
  readonly retryable = false as const;
}

export class PermissionError extends TrailsError {
  readonly category = 'permission' as const;
  readonly retryable = false as const;
}

export class TimeoutError extends TrailsError {
  readonly category = 'timeout' as const;
  readonly retryable = true as const;
}

export class RateLimitError extends TrailsError {
  readonly category = 'rate_limit' as const;
  readonly retryable = true as const;
  readonly retryAfter?: number | undefined;

  constructor(
    message: string,
    options?: {
      cause?: Error;
      context?: Record<string, unknown>;
      retryAfter?: number;
    }
  ) {
    super(message, options);
    this.retryAfter = options?.retryAfter;
  }
}

export class NetworkError extends TrailsError {
  readonly category = 'network' as const;
  readonly retryable = true as const;
}

export class InternalError extends TrailsError {
  readonly category = 'internal' as const;
  readonly retryable = false as const;
}

export class AuthError extends TrailsError {
  readonly category = 'auth' as const;
  readonly retryable = false as const;
}

export class CancelledError extends TrailsError {
  readonly category = 'cancelled' as const;
  readonly retryable = false as const;
}

// ---------------------------------------------------------------------------
// Taxonomy maps
// ---------------------------------------------------------------------------

export const exitCodeMap: Record<ErrorCategory, number> = {
  auth: 9,
  cancelled: 130,
  conflict: 3,
  internal: 8,
  network: 7,
  not_found: 2,
  permission: 4,
  rate_limit: 6,
  timeout: 5,
  validation: 1,
} as const;

export const statusCodeMap: Record<ErrorCategory, number> = {
  auth: 401,
  cancelled: 499,
  conflict: 409,
  internal: 500,
  network: 502,
  not_found: 404,
  permission: 403,
  rate_limit: 429,
  timeout: 504,
  validation: 400,
} as const;

export const jsonRpcCodeMap: Record<ErrorCategory, number> = {
  auth: -32_600,
  cancelled: -32_603,
  conflict: -32_603,
  internal: -32_603,
  network: -32_603,
  not_found: -32_601,
  permission: -32_600,
  rate_limit: -32_603,
  timeout: -32_603,
  validation: -32_602,
} as const;

export const retryableMap: Record<ErrorCategory, boolean> = {
  auth: false,
  cancelled: false,
  conflict: false,
  internal: false,
  network: true,
  not_found: false,
  permission: false,
  rate_limit: true,
  timeout: true,
  validation: false,
} as const;

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Type guard: narrows unknown to TrailsError */
export const isTrailsError = (error?: unknown): error is TrailsError =>
  error instanceof TrailsError;

/** Returns true if the error is retryable (TrailsError with retryable category). */
export const isRetryable = (error: Error): boolean => {
  if (isTrailsError(error)) {
    return error.retryable;
  }
  return false;
};
