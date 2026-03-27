/**
 * Resilience utilities for @ontrails/core
 *
 * Retry with exponential backoff and timeout wrappers,
 * all returning Result types.
 */

import { CancelledError, TimeoutError, isRetryable } from './errors.js';
import { Result } from './result.js';

// ---------------------------------------------------------------------------
// RetryOptions
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of attempts (default: 3) */
  readonly maxAttempts?: number | undefined;
  /** Base delay in ms before first retry (default: 1000) */
  readonly baseDelay?: number | undefined;
  /** Maximum delay in ms (default: 30000) */
  readonly maxDelay?: number | undefined;
  /** Exponential backoff factor (default: 2) */
  readonly backoffFactor?: number | undefined;
  /** Custom predicate — defaults to isRetryable from error taxonomy */
  readonly shouldRetry?: ((error: Error) => boolean) | undefined;
  /** AbortSignal for cancellation */
  readonly signal?: AbortSignal | undefined;
}

// ---------------------------------------------------------------------------
// Helpers (defined before usage)
// ---------------------------------------------------------------------------

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based sleep
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

// ---------------------------------------------------------------------------
// shouldRetry (default)
// ---------------------------------------------------------------------------

/** Default retry predicate using the error taxonomy. */
export const shouldRetry = (error: Error): boolean => isRetryable(error);

// ---------------------------------------------------------------------------
// getBackoffDelay
// ---------------------------------------------------------------------------

/** Compute exponential backoff delay with full jitter. */
export const getBackoffDelay = (
  attempt: number,
  options?: Pick<RetryOptions, 'baseDelay' | 'maxDelay' | 'backoffFactor'>
): number => {
  const base = options?.baseDelay ?? 1000;
  const max = options?.maxDelay ?? 30_000;
  const factor = options?.backoffFactor ?? 2;
  const exponential = base * factor ** attempt;
  const capped = Math.min(exponential, max);
  // Full jitter: random value in [0, capped]
  return Math.floor(Math.random() * capped);
};

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

/**
 * Retry an async function that returns a Result.
 *
 * On each failure, checks whether the error is retryable and whether the
 * attempt budget remains. Applies exponential backoff with jitter between
 * retries.
 */
/** Attempt a single retry iteration. Returns the result to stop, or undefined to continue. */
const tryAttempt = async <T>(
  fn: () => Promise<Result<T, Error>>,
  attempt: number,
  maxAttempts: number,
  retryPredicate: (error: Error) => boolean,
  options?: RetryOptions
): Promise<
  | { done: true; result: Result<T, Error> }
  | { done: false; result: Result<T, Error> }
> => {
  const result = await fn();
  if (result.isOk()) {
    return { done: true, result };
  }
  const isLast = attempt === maxAttempts - 1;
  if (isLast || !retryPredicate(result.error)) {
    return { done: true, result };
  }
  const delay = getBackoffDelay(attempt, options);
  if (delay > 0) {
    await sleep(delay, options?.signal);
  }
  return { done: false, result };
};

/** Resolve retry options to concrete values. */
const resolveRetryOptions = (options?: RetryOptions) => ({
  maxAttempts: options?.maxAttempts ?? 3,
  retryPredicate: options?.shouldRetry ?? shouldRetry,
  signal: options?.signal,
});

export const retry = async <T>(
  fn: () => Promise<Result<T, Error>>,
  options?: RetryOptions
): Promise<Result<T, Error>> => {
  const { maxAttempts, retryPredicate, signal } = resolveRetryOptions(options);
  let lastResult: Result<T, Error> | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      return Result.err(new CancelledError('Retry cancelled'));
    }
    const outcome = await tryAttempt(
      fn,
      attempt,
      maxAttempts,
      retryPredicate,
      options
    );
    lastResult = outcome.result;
    if (outcome.done) {
      return outcome.result;
    }
  }

  return lastResult ?? Result.err(new CancelledError('Retry exhausted'));
};

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

/**
 * Run an async Result-returning function with a timeout.
 *
 * If the timeout fires first, returns a TimeoutError result.
 * Also respects an external AbortSignal.
 */
export const withTimeout = <T>(
  fn: () => Promise<Result<T, Error>>,
  ms: number,
  signal?: AbortSignal
): Promise<Result<T, Error>> => {
  if (signal?.aborted) {
    return Promise.resolve(Result.err(new CancelledError('Already cancelled')));
  }

  // oxlint-disable-next-line avoid-new, promise/no-multiple-resolved -- Promise constructor needed for timeout race; settled guard ensures single resolution
  return new Promise<Result<T, Error>>((resolve) => {
    let settled = false;
    // oxlint-disable-next-line prefer-const -- assigned after declaration
    let timer: ReturnType<typeof setTimeout>;

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // oxlint-disable-next-line promise/no-multiple-resolved -- settled guard ensures single resolution
      resolve(Result.err(new CancelledError('Operation cancelled')));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      // oxlint-disable-next-line promise/no-multiple-resolved -- settled guard ensures single resolution
      resolve(
        Result.err(
          new TimeoutError(`Operation timed out after ${ms}ms`, {
            context: { timeoutMs: ms },
          })
        )
      );
    }, ms);

    // oxlint-disable-next-line prefer-await-to-then, no-void -- .then() needed inside Promise constructor; void discards unhandled rejection
    void fn().then(
      // oxlint-disable-next-line prefer-await-to-callbacks -- callback required inside .then()
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        // oxlint-disable-next-line promise/no-multiple-resolved -- settled guard ensures single resolution
        resolve(result);
      },
      // oxlint-disable-next-line prefer-await-to-callbacks -- rejection handler required inside .then()
      (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        // oxlint-disable-next-line promise/no-multiple-resolved -- settled guard ensures single resolution
        resolve(
          Result.err(error instanceof Error ? error : new Error(String(error)))
        );
      }
    );
  });
};
