import { describe, test, expect } from 'bun:test';

import {
  NetworkError,
  ValidationError,
  TimeoutError,
  CancelledError,
  RateLimitError,
} from '../errors.js';
import {
  retry,
  withTimeout,
  shouldRetry,
  getBackoffDelay,
} from '../resilience.js';
import { Result } from '../result.js';

// ---------------------------------------------------------------------------
// shouldRetry
// ---------------------------------------------------------------------------

describe('shouldRetry', () => {
  test('returns true for retryable TrailsErrors', () => {
    expect(shouldRetry(new NetworkError('down'))).toBe(true);
    expect(shouldRetry(new TimeoutError('slow'))).toBe(true);
    expect(shouldRetry(new RateLimitError('throttled'))).toBe(true);
  });

  test('returns false for non-retryable TrailsErrors', () => {
    expect(shouldRetry(new ValidationError('bad'))).toBe(false);
    expect(shouldRetry(new CancelledError('stop'))).toBe(false);
  });

  test('returns false for plain Error', () => {
    expect(shouldRetry(new Error('generic'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getBackoffDelay
// ---------------------------------------------------------------------------

describe('getBackoffDelay', () => {
  test('returns a number >= 0', () => {
    for (let i = 0; i < 20; i += 1) {
      const delay = getBackoffDelay(0);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  test('respects maxDelay cap', () => {
    for (let i = 0; i < 20; i += 1) {
      const delay = getBackoffDelay(10, { maxDelay: 100 });
      expect(delay).toBeLessThanOrEqual(100);
    }
  });

  test('uses provided baseDelay and backoffFactor', () => {
    // With attempt=0, exponential = base * factor^0 = base
    // Jitter is [0, base], so delay <= base
    for (let i = 0; i < 20; i += 1) {
      const delay = getBackoffDelay(0, { backoffFactor: 3, baseDelay: 500 });
      expect(delay).toBeLessThanOrEqual(500);
    }
  });

  test('scales with attempt number', () => {
    // Higher attempts should have higher caps (on average)
    const samples0 = Array.from({ length: 100 }, () =>
      getBackoffDelay(0, { baseDelay: 100 })
    );
    const samples3 = Array.from({ length: 100 }, () =>
      getBackoffDelay(3, { baseDelay: 100 })
    );
    const avg0 = samples0.reduce((a, b) => a + b, 0) / samples0.length;
    const avg3 = samples3.reduce((a, b) => a + b, 0) / samples3.length;
    // Attempt 3 should have a noticeably higher average
    expect(avg3).toBeGreaterThan(avg0);
  });
});

// ---------------------------------------------------------------------------
// retry
// ---------------------------------------------------------------------------

describe('retry', () => {
  test('returns Ok on first success', async () => {
    let calls = 0;
    const result = await retry(() => {
      calls += 1;
      return Promise.resolve(Result.ok('done'));
    });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('done');
    expect(calls).toBe(1);
  });

  test('retries on retryable error', async () => {
    const responses: Result<string, Error>[] = [
      Result.err(new NetworkError('fail')),
      Result.err(new NetworkError('fail')),
      Result.ok('recovered'),
    ];
    let calls = 0;
    const result = await retry(
      () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- index is bounded by maxAttempts
        const r = responses[calls]!;
        calls += 1;
        return Promise.resolve(r);
      },
      { baseDelay: 1, maxAttempts: 3 }
    );
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('recovered');
    expect(calls).toBe(3);
  });

  test('does not retry non-retryable errors', async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls += 1;
        return Promise.resolve(Result.err(new ValidationError('bad')));
      },
      { baseDelay: 1, maxAttempts: 3 }
    );
    expect(result.isErr()).toBe(true);
    expect(calls).toBe(1);
  });

  test('gives up after maxAttempts', async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls += 1;
        return Promise.resolve(Result.err(new NetworkError('fail')));
      },
      { baseDelay: 1, maxAttempts: 2 }
    );
    expect(result.isErr()).toBe(true);
    expect(calls).toBe(2);
  });

  test('respects custom shouldRetry predicate', async () => {
    let calls = 0;
    const result = await retry(
      () => {
        calls += 1;
        return Promise.resolve(Result.err(new ValidationError('bad')));
      },
      {
        baseDelay: 1,
        maxAttempts: 3,
        // always retry
        shouldRetry: () => true,
      }
    );
    expect(result.isErr()).toBe(true);
    expect(calls).toBe(3);
  });

  test('cancels on abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await retry(
      () => Promise.resolve(Result.ok('should not run')),
      {
        signal: controller.signal,
      }
    );
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: Error };
    expect(err.error).toBeInstanceOf(CancelledError);
  });
});

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

describe('withTimeout', () => {
  test('returns result when function completes in time', async () => {
    const result = await withTimeout(
      () => Promise.resolve(Result.ok('fast')),
      1000
    );
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('fast');
  });

  test('returns TimeoutError when function exceeds timeout', async () => {
    const result = await withTimeout(
      () =>
        // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based delay
        new Promise<Result<string, Error>>((resolve) => {
          setTimeout(() => resolve(Result.ok('slow')), 500);
        }),
      10
    );
    expect(result.isErr()).toBe(true);
    const err1 = result as unknown as { error: TimeoutError };
    expect(err1.error).toBeInstanceOf(TimeoutError);
    expect(err1.error.message).toContain('timed out');
  });

  test('returns CancelledError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await withTimeout(
      () => Promise.resolve(Result.ok('value')),
      1000,
      controller.signal
    );
    expect(result.isErr()).toBe(true);
    const err2 = result as unknown as { error: Error };
    expect(err2.error).toBeInstanceOf(CancelledError);
  });

  test('handles function that throws', async () => {
    const result = await withTimeout(
      () => Promise.reject(new Error('unexpected')),
      1000
    );
    expect(result.isErr()).toBe(true);
    const err3 = result as unknown as { error: Error };
    expect(err3.error.message).toBe('unexpected');
  });

  test('includes timeout ms in error context', async () => {
    const result = await withTimeout(
      () =>
        // oxlint-disable-next-line avoid-new -- Promise constructor needed for setTimeout-based delay
        new Promise<Result<string, Error>>((resolve) => {
          setTimeout(() => resolve(Result.ok('slow')), 500);
        }),
      5
    );
    expect(result.isErr()).toBe(true);
    const err4 = result as unknown as { error: TimeoutError };
    expect(err4.error).toBeInstanceOf(TimeoutError);
    expect(err4.error.context?.['timeoutMs']).toBe(5);
  });
});
