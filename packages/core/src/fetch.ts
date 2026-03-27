/**
 * Fetch utilities for @ontrails/core
 *
 * Wraps the standard fetch API, mapping errors and HTTP status codes
 * to the TrailsError taxonomy.
 */

import {
  AuthError,
  CancelledError,
  ConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TimeoutError,
  ValidationError,
} from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// Internal helpers (defined before usage)
// ---------------------------------------------------------------------------

const toError = (err: unknown): Error =>
  err instanceof Error ? err : new Error(String(err));

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }
  // Try parsing as HTTP-date
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const delta = Math.ceil((date - Date.now()) / 1000);
    return delta > 0 ? delta : undefined;
  }
  return undefined;
};

const mapFetchError = (err: unknown): Error => {
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new CancelledError('Request was aborted', { cause: toError(err) });
  }

  // TypeError is thrown for network failures in the fetch spec
  if (err instanceof TypeError) {
    return new NetworkError('Network request failed', { cause: err });
  }

  return new NetworkError('Network request failed', {
    cause: toError(err),
  });
};

type StatusMapper = (
  context: Record<string, unknown>,
  response: Response
) => Error;

const statusMappers: Record<number, StatusMapper> = {
  401: (ctx) => new AuthError('Unauthorized', { context: ctx }),
  403: (ctx) => new PermissionError('Forbidden', { context: ctx }),
  404: (ctx) => new NotFoundError('Not found', { context: ctx }),
  429: (ctx, response) => {
    const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
    const opts: { context: Record<string, unknown>; retryAfter?: number } = {
      context: ctx,
    };
    if (retryAfter !== undefined) {
      opts.retryAfter = retryAfter;
    }
    return new RateLimitError('Rate limited', opts);
  },
  500: (ctx) => new InternalError('Internal server error', { context: ctx }),
  502: (ctx) => new NetworkError('Bad gateway', { context: ctx }),
  504: (ctx) => new TimeoutError('Gateway timeout', { context: ctx }),
};

/** Map 4xx status codes not in the explicit mapper to appropriate error types. */
const mapClientError = (
  status: number,
  context: Record<string, unknown>
): Error => {
  if (status === 400 || status === 422) {
    return new ValidationError(`Validation error (${status})`, { context });
  }
  if (status === 409) {
    return new ConflictError(`Conflict (${status})`, { context });
  }
  return new InternalError(`HTTP error (${status})`, { context });
};

const mapStatusCode = (response: Response): Error => {
  const context = { status: response.status, url: response.url };
  const mapper = statusMappers[response.status];
  if (mapper) {
    return mapper(context, response);
  }
  if (response.status >= 500) {
    return new InternalError(`Server error (${response.status})`, { context });
  }
  return mapClientError(response.status, context);
};

// ---------------------------------------------------------------------------
// fromFetch
// ---------------------------------------------------------------------------

/**
 * Wrap a fetch call in a Result, mapping failures to TrailsError subclasses.
 *
 * Network errors become NetworkError. Abort signals become CancelledError.
 * HTTP error status codes map to the appropriate error category.
 */
export const fromFetch = async (
  input: string | URL | Request,
  init?: RequestInit
): Promise<Result<Response, Error>> => {
  let response: Response;

  try {
    response = await fetch(input, init);
  } catch (error) {
    return Result.err(mapFetchError(error));
  }

  if (response.ok) {
    return Result.ok(response);
  }

  return Result.err(mapStatusCode(response));
};
