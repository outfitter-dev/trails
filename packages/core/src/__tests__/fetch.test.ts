/* oxlint-disable require-await -- test mocks satisfy async interface without awaiting */
import { describe, test, expect, afterEach } from 'bun:test';

import {
  AuthError,
  CancelledError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TimeoutError,
} from '../errors.js';
import { Result } from '../result.js';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

const mockFetch = (impl: () => Promise<Response>) => {
  globalThis.fetch = impl as unknown as typeof globalThis.fetch;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fakeResponse = (
  status: number,
  options?: { headers?: Record<string, string> }
): Response => {
  const init: ResponseInit = { status };
  if (options?.headers) {
    init.headers = options.headers;
  }
  return new Response(null, init);
};

// ---------------------------------------------------------------------------
// Successful responses
// ---------------------------------------------------------------------------

describe('Result.fromFetch — success', () => {
  test('returns Ok with Response for 200', async () => {
    mockFetch(async () => fakeResponse(200));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap().status).toBe(200);
  });

  test('returns Ok for 201', async () => {
    mockFetch(async () => fakeResponse(201));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isOk()).toBe(true);
  });

  test('returns Ok for 204', async () => {
    mockFetch(async () => fakeResponse(204));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isOk()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// HTTP error status mapping
// ---------------------------------------------------------------------------

describe('Result.fromFetch — status code mapping', () => {
  test('401 → AuthError', async () => {
    mockFetch(async () => fakeResponse(401));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      AuthError
    );
  });

  test('403 → PermissionError', async () => {
    mockFetch(async () => fakeResponse(403));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      PermissionError
    );
  });

  test('404 → NotFoundError', async () => {
    mockFetch(async () => fakeResponse(404));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      NotFoundError
    );
  });

  test('429 → RateLimitError', async () => {
    mockFetch(async () => fakeResponse(429));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      RateLimitError
    );
  });

  test('429 with retry-after header', async () => {
    mockFetch(async () =>
      fakeResponse(429, { headers: { 'retry-after': '30' } })
    );
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    const err = (result as unknown as { error: RateLimitError }).error;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(30);
  });

  test('500 → InternalError', async () => {
    mockFetch(async () => fakeResponse(500));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      InternalError
    );
  });

  test('502 → NetworkError', async () => {
    mockFetch(async () => fakeResponse(502));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      NetworkError
    );
  });

  test('504 → TimeoutError', async () => {
    mockFetch(async () => fakeResponse(504));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      TimeoutError
    );
  });

  test('503 → InternalError (generic 5xx)', async () => {
    mockFetch(async () => fakeResponse(503));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      InternalError
    );
  });

  test('400 → InternalError (unmapped client error)', async () => {
    mockFetch(async () => fakeResponse(400));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      InternalError
    );
  });
});

// ---------------------------------------------------------------------------
// Network / abort errors
// ---------------------------------------------------------------------------

describe('Result.fromFetch — network errors', () => {
  test('TypeError → NetworkError', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      NetworkError
    );
  });

  test('AbortError → CancelledError', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      CancelledError
    );
  });

  test('unknown thrown value → NetworkError', async () => {
    mockFetch(async () => {
      // oxlint-disable-next-line no-throw-literal -- intentionally testing non-Error rejection handling
      throw 'string error';
    });
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    expect((result as unknown as { error: Error }).error).toBeInstanceOf(
      NetworkError
    );
  });
});

// ---------------------------------------------------------------------------
// Error context
// ---------------------------------------------------------------------------

describe('Result.fromFetch — error context', () => {
  test('includes status in error context', async () => {
    mockFetch(async () => fakeResponse(404));
    const result = await Result.fromFetch('https://example.com/api');
    expect(result.isErr()).toBe(true);
    const err = (result as unknown as { error: NotFoundError }).error;
    expect(err.context?.['status']).toBe(404);
  });
});
