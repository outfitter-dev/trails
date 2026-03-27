/**
 * Serialization utilities for @ontrails/core
 *
 * Safe JSON parsing/stringifying and error serialization/deserialization
 * for transport across process boundaries.
 */

import type { ErrorCategory, TrailsError } from './errors.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
  PermissionError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  InternalError,
  AuthError,
  CancelledError,
  isTrailsError,
} from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// SerializedError interface
// ---------------------------------------------------------------------------

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly category?: ErrorCategory | undefined;
  readonly retryable?: boolean | undefined;
  readonly retryAfter?: number | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly stack?: string | undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers (defined before usage)
// ---------------------------------------------------------------------------

/** Build options object without including undefined context. */
const buildOpts = (
  context: Record<string, unknown> | undefined
): {
  context?: Record<string, unknown>;
} => {
  if (context !== undefined) {
    return { context };
  }
  return {};
};

type ErrorFactory = (
  message: string,
  opts: { context?: Record<string, unknown> },
  retryAfter: number | undefined
) => TrailsError;

const errorFactories: Record<ErrorCategory, ErrorFactory> = {
  auth: (msg, opts) => new AuthError(msg, opts),
  cancelled: (msg, opts) => new CancelledError(msg, opts),
  conflict: (msg, opts) => new ConflictError(msg, opts),
  internal: (msg, opts) => new InternalError(msg, opts),
  network: (msg, opts) => new NetworkError(msg, opts),
  not_found: (msg, opts) => new NotFoundError(msg, opts),
  permission: (msg, opts) => new PermissionError(msg, opts),
  rate_limit: (msg, opts, retryAfter) => {
    const rlOpts: { context?: Record<string, unknown>; retryAfter?: number } = {
      ...opts,
    };
    if (retryAfter !== undefined) {
      rlOpts.retryAfter = retryAfter;
    }
    return new RateLimitError(msg, rlOpts);
  },
  timeout: (msg, opts) => new TimeoutError(msg, opts),
  validation: (msg, opts) => new ValidationError(msg, opts),
};

const createErrorByCategory = (
  category: ErrorCategory,
  message: string,
  context: Record<string, unknown> | undefined,
  retryAfter: number | undefined
): TrailsError => {
  const opts = buildOpts(context);
  const factory = errorFactories[category] ?? errorFactories.internal;
  return factory(message, opts, retryAfter);
};

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

/** Extract structured data from an Error for transport. */
export const serializeError = (error: Error): SerializedError => {
  const result: SerializedError = {
    message: error.message,
    name: error.name,
    stack: error.stack,
  };

  if (isTrailsError(error)) {
    return {
      ...result,
      category: error.category,
      context: error.context,
      retryAfter:
        error instanceof RateLimitError ? error.retryAfter : undefined,
      retryable: error.retryable,
    };
  }

  return result;
};

/** Reconstruct a TrailsError from serialized data. */
export const deserializeError = (data: SerializedError): TrailsError => {
  const category = data.category ?? 'internal';
  const error = createErrorByCategory(
    category,
    data.message,
    data.context,
    data.retryAfter
  );

  if (data.stack) {
    error.stack = data.stack;
  }

  return error;
};

// ---------------------------------------------------------------------------
// Safe JSON
// ---------------------------------------------------------------------------

/** Parse a JSON string, returning a Result instead of throwing. */
export const safeParse = (json: string): Result<unknown, ValidationError> => {
  try {
    return Result.ok(JSON.parse(json) as unknown);
  } catch (error) {
    return Result.err(
      new ValidationError('Invalid JSON', {
        cause: error instanceof Error ? error : new Error(String(error)),
        context: { input: json.slice(0, 200) },
      })
    );
  }
};

/** Stringify a value, returning a Result. Handles circular references. */
export const safeStringify = (
  value: unknown
): Result<string, InternalError> => {
  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      }
      return val;
    });
    if (json === undefined) {
      return Result.err(
        new InternalError('Value is not JSON-serializable', {
          context: { type: typeof value },
        })
      );
    }
    return Result.ok(json);
  } catch (error) {
    return Result.err(
      new InternalError('Failed to stringify value', {
        cause: error instanceof Error ? error : new Error(String(error)),
      })
    );
  }
};
