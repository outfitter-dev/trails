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

export class PermitError extends PermissionError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, options);
    this.name = 'PermitError';
  }
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
  readonly category: ErrorCategory = 'internal';
  readonly retryable = false as const;
}

export class DerivationError extends TrailsError {
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

/**
 * Returned when a detour exhausts all recovery attempts.
 *
 * Inherits the wrapped error's category for trailhead mapping (e.g. a
 * `RetryExhaustedError<ConflictError>` maps to HTTP 409), but always
 * sets `retryable = false` to prevent amplification across `ctx.cross()`
 * boundaries or stacked layers.
 */
export class RetryExhaustedError<
  TErr extends TrailsError = TrailsError,
> extends InternalError {
  readonly category: ErrorCategory;
  readonly cause: TErr;

  /** Number of recovery attempts made before exhaustion. */
  readonly attempts: number;

  /** Name of the detour whose recovery was exhausted. */
  readonly detour: string;

  constructor(
    wrapped: TErr,
    metadata: { readonly attempts: number; readonly detour: string }
  ) {
    super(
      `Recovery exhausted after ${metadata.attempts} attempts: ${wrapped.message}`,
      { cause: wrapped }
    );
    this.cause = wrapped;
    this.attempts = metadata.attempts;
    this.detour = metadata.detour;
    // Dynamic — inherited from wrapped error at construction time.
    this.category = wrapped.category;
  }
}

// ---------------------------------------------------------------------------
// Class registry
// ---------------------------------------------------------------------------

export type ErrorClassConstructor = new (...args: never[]) => TrailsError;

export interface FixedErrorClassRegistryEntry {
  readonly category: ErrorCategory;
  readonly ctor: ErrorClassConstructor;
  readonly name: string;
  readonly retryable: boolean;
}

export interface DynamicErrorClassRegistryEntry {
  readonly category: 'dynamic';
  readonly ctor: ErrorClassConstructor;
  readonly inheritsCategoryFrom: 'wrapped-error';
  readonly name: string;
  readonly retryable: false;
}

export type ErrorClassRegistryEntry =
  | DynamicErrorClassRegistryEntry
  | FixedErrorClassRegistryEntry;

/**
 * Authored registry of concrete TrailsError classes.
 *
 * JavaScript cannot enumerate subclasses at runtime, so rule and projection
 * tooling should walk this owner-held list instead of hardcoding parallel
 * class-name tables. `RetryExhaustedError` is marked dynamic because it
 * inherits its runtime category from the wrapped error rather than always
 * mapping as `internal`.
 */
export const errorClasses = [
  {
    category: 'validation',
    ctor: ValidationError,
    name: 'ValidationError',
    retryable: false,
  },
  {
    category: 'validation',
    ctor: AmbiguousError,
    name: 'AmbiguousError',
    retryable: false,
  },
  {
    category: 'internal',
    ctor: AssertionError,
    name: 'AssertionError',
    retryable: false,
  },
  {
    category: 'not_found',
    ctor: NotFoundError,
    name: 'NotFoundError',
    retryable: false,
  },
  {
    category: 'conflict',
    ctor: AlreadyExistsError,
    name: 'AlreadyExistsError',
    retryable: false,
  },
  {
    category: 'conflict',
    ctor: ConflictError,
    name: 'ConflictError',
    retryable: false,
  },
  {
    category: 'permission',
    ctor: PermissionError,
    name: 'PermissionError',
    retryable: false,
  },
  {
    category: 'permission',
    ctor: PermitError,
    name: 'PermitError',
    retryable: false,
  },
  {
    category: 'timeout',
    ctor: TimeoutError,
    name: 'TimeoutError',
    retryable: true,
  },
  {
    category: 'rate_limit',
    ctor: RateLimitError,
    name: 'RateLimitError',
    retryable: true,
  },
  {
    category: 'network',
    ctor: NetworkError,
    name: 'NetworkError',
    retryable: true,
  },
  {
    category: 'internal',
    ctor: InternalError,
    name: 'InternalError',
    retryable: false,
  },
  {
    category: 'internal',
    ctor: DerivationError,
    name: 'DerivationError',
    retryable: false,
  },
  { category: 'auth', ctor: AuthError, name: 'AuthError', retryable: false },
  {
    category: 'cancelled',
    ctor: CancelledError,
    name: 'CancelledError',
    retryable: false,
  },
  {
    category: 'dynamic',
    ctor: RetryExhaustedError,
    inheritsCategoryFrom: 'wrapped-error',
    name: 'RetryExhaustedError',
    retryable: false,
  },
] as const satisfies readonly ErrorClassRegistryEntry[];

// ---------------------------------------------------------------------------
// Taxonomy maps
// ---------------------------------------------------------------------------

export interface ErrorCategoryCodes {
  readonly exit: number;
  readonly http: number;
  readonly jsonRpc: number;
}

export const codesByCategory = {
  auth: { exit: 9, http: 401, jsonRpc: -32_600 },
  cancelled: { exit: 130, http: 499, jsonRpc: -32_603 },
  conflict: { exit: 3, http: 409, jsonRpc: -32_603 },
  internal: { exit: 8, http: 500, jsonRpc: -32_603 },
  network: { exit: 7, http: 502, jsonRpc: -32_603 },
  not_found: { exit: 2, http: 404, jsonRpc: -32_601 },
  permission: { exit: 4, http: 403, jsonRpc: -32_600 },
  rate_limit: { exit: 6, http: 429, jsonRpc: -32_603 },
  timeout: { exit: 5, http: 504, jsonRpc: -32_603 },
  validation: { exit: 1, http: 400, jsonRpc: -32_602 },
} as const satisfies Record<ErrorCategory, ErrorCategoryCodes>;

const deriveCodeMap = <TCode extends keyof ErrorCategoryCodes>(
  code: TCode
): {
  readonly [TCategory in ErrorCategory]: (typeof codesByCategory)[TCategory][TCode];
} => ({
  auth: codesByCategory.auth[code],
  cancelled: codesByCategory.cancelled[code],
  conflict: codesByCategory.conflict[code],
  internal: codesByCategory.internal[code],
  network: codesByCategory.network[code],
  not_found: codesByCategory.not_found[code],
  permission: codesByCategory.permission[code],
  rate_limit: codesByCategory.rate_limit[code],
  timeout: codesByCategory.timeout[code],
  validation: codesByCategory.validation[code],
});

/** @deprecated Prefer `codesByCategory[category].exit`. */
export const exitCodeMap = deriveCodeMap('exit');

/** @deprecated Prefer `codesByCategory[category].http`. */
export const statusCodeMap = deriveCodeMap('http');

/** @deprecated Prefer `codesByCategory[category].jsonRpc`. */
export const jsonRpcCodeMap = deriveCodeMap('jsonRpc');

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
