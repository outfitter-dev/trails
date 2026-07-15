/**
 * Serialization utilities for @ontrails/core
 *
 * Safe JSON parsing/stringifying and error serialization/deserialization
 * for transport across process boundaries.
 */

import type { ErrorCategory, TrailsError } from './errors.js';
import {
  AuthError,
  CancelledError,
  ConflictError,
  ValidationError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  RetryExhaustedError,
  TimeoutError,
  WorkspaceShiftError,
  errorClasses,
  isTrailsError,
} from './errors.js';
import {
  redactErrorContext,
  redactErrorStack,
  redactErrorString,
} from './error-rendering.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// SerializedError interface
// ---------------------------------------------------------------------------

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly attempts?: number | undefined;
  readonly category?: ErrorCategory | undefined;
  readonly cause?: SerializedError | undefined;
  readonly detour?: string | undefined;
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
  opts: { cause?: Error; context?: Record<string, unknown> },
  retryAfter: number | undefined
) => TrailsError;

type FixedErrorConstructor = new (
  message: string,
  options?: { cause?: Error; context?: Record<string, unknown> }
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
  shift: (msg, opts) => new WorkspaceShiftError(msg, opts),
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

/** Map fixed error class names to constructors for precise round-tripping. */
const errorConstructorsByName: Readonly<Record<string, ErrorFactory>> =
  Object.fromEntries(
    errorClasses.flatMap((entry): [string, ErrorFactory][] => {
      if (entry.category === 'dynamic') {
        return [];
      }
      const ctor = entry.ctor as FixedErrorConstructor;
      return [
        [
          entry.name,
          (message, opts, retryAfter) => {
            if (ctor === RateLimitError) {
              const rateLimitOptions:
                | {
                    cause?: Error;
                    context?: Record<string, unknown>;
                    retryAfter?: number;
                  }
                | undefined =
                opts.context === undefined &&
                opts.cause === undefined &&
                retryAfter === undefined
                  ? undefined
                  : {
                      ...opts,
                      ...(retryAfter === undefined ? {} : { retryAfter }),
                    };
              return new RateLimitError(message, rateLimitOptions);
            }
            return new ctor(message, opts);
          },
        ],
      ];
    })
  );

// ---------------------------------------------------------------------------
// Error serialization
// ---------------------------------------------------------------------------

/** Extract structured data from an Error for transport. */
export const serializeError = (error: Error): SerializedError => {
  const result: SerializedError = {
    message: redactErrorString(error.message),
    name: error.name,
    stack: redactErrorStack(error.stack),
  };

  if (isTrailsError(error)) {
    return {
      ...result,
      category: error.category,
      context: redactErrorContext(error.context),
      ...(error instanceof RetryExhaustedError
        ? {
            attempts: error.attempts,
            cause: serializeError(error.cause),
            detour: error.detour,
          }
        : {}),
      retryAfter:
        error instanceof RateLimitError ? error.retryAfter : undefined,
      retryable: error.retryable,
    };
  }

  return result;
};

/** Reconstruct a TrailsError from serialized data. */
export const deserializeError = (data: SerializedError): TrailsError => {
  const opts = buildOpts(data.context);
  if (data.name === 'RetryExhaustedError') {
    const wrapped =
      data.cause === undefined
        ? createErrorByCategory(
            data.category ?? 'internal',
            data.message,
            data.context,
            data.retryAfter
          )
        : deserializeError(data.cause);
    const error = new RetryExhaustedError(wrapped, {
      attempts: data.attempts ?? 0,
      detour: data.detour ?? 'unknown',
    });
    if (data.message !== error.message) {
      error.message = data.message;
    }
    if (data.stack) {
      error.stack = data.stack;
    }
    return error;
  }
  const nameFactory = errorConstructorsByName[data.name];

  const error = nameFactory
    ? nameFactory(data.message, opts, data.retryAfter)
    : createErrorByCategory(
        data.category ?? 'internal',
        data.message,
        data.context,
        data.retryAfter
      );

  if (data.stack) {
    error.stack = data.stack;
  }

  return error;
};

/** Stringify a value, returning a Result. Handles circular references. */
export const safeStringify = (
  value: unknown
): Result<string, InternalError> => {
  try {
    // Track the current ancestor chain, not every object ever visited.
    // This allows shared references in a DAG while still detecting cycles.
    const stack: unknown[] = [];
    const keys: string[] = [];

    const json = JSON.stringify(value, function json(key, val: unknown) {
      if (stack.length > 0) {
        // `this` is the object that contains `key`. Trim the stack back
        // to `this` so we only track the current ancestor path.
        const thisIndex = stack.lastIndexOf(this as unknown);
        stack.splice(thisIndex + 1);
        keys.splice(thisIndex);
      }

      if (typeof val === 'object' && val !== null) {
        if (stack.includes(val)) {
          return '[Circular]';
        }
        stack.push(val);
        keys.push(key);
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
