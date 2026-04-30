import { describe, test, expect } from 'bun:test';

import {
  TrailsError,
  ValidationError,
  AmbiguousError,
  AssertionError,
  NotFoundError,
  AlreadyExistsError,
  ConflictError,
  PermissionError,
  TimeoutError,
  RateLimitError,
  NetworkError,
  InternalError,
  AuthError,
  CancelledError,
  RetryExhaustedError,
  codesByCategory,
  errorCategories,
  exitCodeMap,
  statusCodeMap,
  jsonRpcCodeMap,
  retryableMap,
  isRetryable,
  isTrailsError,
} from '../errors.js';
import type { ErrorCategory } from '../errors.js';

// ---------------------------------------------------------------------------
// Error class matrix
// ---------------------------------------------------------------------------

const errorMatrix: readonly {
  Class: new (
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) => TrailsError;
  category: ErrorCategory;
  retryable: boolean;
  name: string;
}[] = [
  {
    Class: ValidationError,
    category: 'validation',
    name: 'ValidationError',
    retryable: false,
  },
  {
    Class: AmbiguousError,
    category: 'validation',
    name: 'AmbiguousError',
    retryable: false,
  },
  {
    Class: AssertionError,
    category: 'internal',
    name: 'AssertionError',
    retryable: false,
  },
  {
    Class: NotFoundError,
    category: 'not_found',
    name: 'NotFoundError',
    retryable: false,
  },
  {
    Class: AlreadyExistsError,
    category: 'conflict',
    name: 'AlreadyExistsError',
    retryable: false,
  },
  {
    Class: ConflictError,
    category: 'conflict',
    name: 'ConflictError',
    retryable: false,
  },
  {
    Class: PermissionError,
    category: 'permission',
    name: 'PermissionError',
    retryable: false,
  },
  {
    Class: TimeoutError,
    category: 'timeout',
    name: 'TimeoutError',
    retryable: true,
  },
  {
    Class: RateLimitError,
    category: 'rate_limit',
    name: 'RateLimitError',
    retryable: true,
  },
  {
    Class: NetworkError,
    category: 'network',
    name: 'NetworkError',
    retryable: true,
  },
  {
    Class: InternalError,
    category: 'internal',
    name: 'InternalError',
    retryable: false,
  },
  { Class: AuthError, category: 'auth', name: 'AuthError', retryable: false },
  {
    Class: CancelledError,
    category: 'cancelled',
    name: 'CancelledError',
    retryable: false,
  },
];

describe('error classes', () => {
  // oxlint-disable-next-line prefer-each -- describe.each loses type safety on heterogeneous class matrix
  for (const { Class, category, retryable, name } of errorMatrix) {
    describe(name, () => {
      test('sets correct category', () => {
        const err = new Class('test');
        expect(err.category).toBe(category);
      });

      test('sets correct retryable', () => {
        const err = new Class('test');
        expect(err.retryable).toBe(retryable);
      });

      test('sets message', () => {
        const err = new Class('something went wrong');
        expect(err.message).toBe('something went wrong');
      });

      test('sets name to constructor name', () => {
        const err = new Class('test');
        expect(err.name).toBe(name);
      });

      test('sets cause when provided', () => {
        const cause = new Error('root cause');
        const err = new Class('test', { cause });
        expect(err.cause).toBe(cause);
      });

      test('sets context when provided', () => {
        const ctx = { action: 'delete', userId: 'u_123' };
        const err = new Class('test', { context: ctx });
        expect(err.context).toEqual(ctx);
      });

      test('context is undefined when not provided', () => {
        const err = new Class('test');
        expect(err.context).toBeUndefined();
      });

      test('is instanceof TrailsError', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(TrailsError);
      });

      test('is instanceof Error', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(Error);
      });

      test('is instanceof its own class', () => {
        const err = new Class('test');
        expect(err).toBeInstanceOf(Class);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// RateLimitError.retryAfter
// ---------------------------------------------------------------------------

describe('RateLimitError.retryAfter', () => {
  test('stores retryAfter when provided', () => {
    const err = new RateLimitError('slow down', { retryAfter: 30 });
    expect(err.retryAfter).toBe(30);
  });

  test('retryAfter is undefined when not provided', () => {
    const err = new RateLimitError('slow down');
    expect(err.retryAfter).toBeUndefined();
  });

  test('retryAfter coexists with cause and context', () => {
    const cause = new Error('upstream');
    const err = new RateLimitError('slow down', {
      cause,
      context: { endpoint: '/api' },
      retryAfter: 60,
    });
    expect(err.retryAfter).toBe(60);
    expect(err.cause).toBe(cause);
    expect(err.context).toEqual({ endpoint: '/api' });
  });
});

// ---------------------------------------------------------------------------
// Taxonomy maps
// ---------------------------------------------------------------------------

describe('codesByCategory', () => {
  test('maps all categories to expected exit, HTTP, and JSON-RPC codes', () => {
    expect(codesByCategory.validation).toEqual({
      exit: 1,
      http: 400,
      jsonRpc: -32_602,
    });
    expect(codesByCategory.not_found).toEqual({
      exit: 2,
      http: 404,
      jsonRpc: -32_601,
    });
    expect(codesByCategory.conflict).toEqual({
      exit: 3,
      http: 409,
      jsonRpc: -32_603,
    });
    expect(codesByCategory.permission).toEqual({
      exit: 4,
      http: 403,
      jsonRpc: -32_600,
    });
    expect(codesByCategory.timeout).toEqual({
      exit: 5,
      http: 504,
      jsonRpc: -32_603,
    });
    expect(codesByCategory.rate_limit).toEqual({
      exit: 6,
      http: 429,
      jsonRpc: -32_603,
    });
    expect(codesByCategory.network).toEqual({
      exit: 7,
      http: 502,
      jsonRpc: -32_603,
    });
    expect(codesByCategory.internal).toEqual({
      exit: 8,
      http: 500,
      jsonRpc: -32_603,
    });
    expect(codesByCategory.auth).toEqual({
      exit: 9,
      http: 401,
      jsonRpc: -32_600,
    });
    expect(codesByCategory.cancelled).toEqual({
      exit: 130,
      http: 499,
      jsonRpc: -32_603,
    });
  });

  test('drives the legacy per-surface maps', () => {
    for (const category of errorCategories) {
      expect(exitCodeMap[category]).toBe(codesByCategory[category].exit);
      expect(statusCodeMap[category]).toBe(codesByCategory[category].http);
      expect(jsonRpcCodeMap[category]).toBe(codesByCategory[category].jsonRpc);
    }
  });
});

describe('exitCodeMap', () => {
  test('maps all categories to expected exit codes', () => {
    expect(exitCodeMap.validation).toBe(1);
    expect(exitCodeMap.not_found).toBe(2);
    expect(exitCodeMap.conflict).toBe(3);
    expect(exitCodeMap.permission).toBe(4);
    expect(exitCodeMap.timeout).toBe(5);
    expect(exitCodeMap.rate_limit).toBe(6);
    expect(exitCodeMap.network).toBe(7);
    expect(exitCodeMap.internal).toBe(8);
    expect(exitCodeMap.auth).toBe(9);
    expect(exitCodeMap.cancelled).toBe(130);
  });
});

describe('statusCodeMap', () => {
  test('maps all categories to expected HTTP status codes', () => {
    expect(statusCodeMap.validation).toBe(400);
    expect(statusCodeMap.not_found).toBe(404);
    expect(statusCodeMap.conflict).toBe(409);
    expect(statusCodeMap.permission).toBe(403);
    expect(statusCodeMap.timeout).toBe(504);
    expect(statusCodeMap.rate_limit).toBe(429);
    expect(statusCodeMap.network).toBe(502);
    expect(statusCodeMap.internal).toBe(500);
    expect(statusCodeMap.auth).toBe(401);
    expect(statusCodeMap.cancelled).toBe(499);
  });
});

describe('jsonRpcCodeMap', () => {
  test('maps all categories to expected JSON-RPC codes', () => {
    expect(jsonRpcCodeMap.validation).toBe(-32_602);
    expect(jsonRpcCodeMap.not_found).toBe(-32_601);
    expect(jsonRpcCodeMap.conflict).toBe(-32_603);
    expect(jsonRpcCodeMap.permission).toBe(-32_600);
    expect(jsonRpcCodeMap.timeout).toBe(-32_603);
    expect(jsonRpcCodeMap.rate_limit).toBe(-32_603);
    expect(jsonRpcCodeMap.network).toBe(-32_603);
    expect(jsonRpcCodeMap.internal).toBe(-32_603);
    expect(jsonRpcCodeMap.auth).toBe(-32_600);
    expect(jsonRpcCodeMap.cancelled).toBe(-32_603);
  });
});

describe('retryableMap', () => {
  test('only timeout, rate_limit, and network are retryable', () => {
    expect(retryableMap.timeout).toBe(true);
    expect(retryableMap.rate_limit).toBe(true);
    expect(retryableMap.network).toBe(true);

    expect(retryableMap.validation).toBe(false);
    expect(retryableMap.not_found).toBe(false);
    expect(retryableMap.conflict).toBe(false);
    expect(retryableMap.permission).toBe(false);
    expect(retryableMap.internal).toBe(false);
    expect(retryableMap.auth).toBe(false);
    expect(retryableMap.cancelled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

describe('isRetryable', () => {
  test('returns true for retryable errors', () => {
    expect(isRetryable(new TimeoutError('timed out'))).toBe(true);
    expect(isRetryable(new RateLimitError('too fast'))).toBe(true);
    expect(isRetryable(new NetworkError('disconnected'))).toBe(true);
  });

  test('returns false for non-retryable errors', () => {
    expect(isRetryable(new ValidationError('bad input'))).toBe(false);
    expect(isRetryable(new NotFoundError('missing'))).toBe(false);
    expect(isRetryable(new AuthError('unauthorized'))).toBe(false);
    expect(isRetryable(new InternalError('oops'))).toBe(false);
    expect(isRetryable(new CancelledError('aborted'))).toBe(false);
  });

  test('returns false for plain Error', () => {
    expect(isRetryable(new Error('generic'))).toBe(false);
  });
});

describe('isTrailsError', () => {
  test('returns true for TrailsError subclasses', () => {
    expect(isTrailsError(new ValidationError('bad'))).toBe(true);
    expect(isTrailsError(new NetworkError('down'))).toBe(true);
    expect(isTrailsError(new CancelledError('stop'))).toBe(true);
  });

  test('returns false for plain Error', () => {
    expect(isTrailsError(new Error('nope'))).toBe(false);
  });

  test('returns false for non-error values', () => {
    expect(isTrailsError(null)).toBe(false);
    expect(isTrailsError()).toBe(false);
    expect(isTrailsError('string')).toBe(false);
    expect(isTrailsError(42)).toBe(false);
    expect(isTrailsError({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RetryExhaustedError
// ---------------------------------------------------------------------------

describe('RetryExhaustedError', () => {
  describe('category and retryability', () => {
    test('inherits category from wrapped error', () => {
      const err = new RetryExhaustedError(new ConflictError('conflict'), {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err.category).toBe('conflict');
    });

    test('inherits category from retryable error class', () => {
      const err = new RetryExhaustedError(new TimeoutError('timed out'), {
        attempts: 3,
        detour: 'TimeoutError',
      });
      expect(err.category).toBe('timeout');
    });

    test('retryable is always false regardless of wrapped category', () => {
      const fromTimeout = new RetryExhaustedError(
        new TimeoutError('timed out'),
        { attempts: 3, detour: 'TimeoutError' }
      );
      expect(fromTimeout.retryable).toBe(false);

      const fromNetwork = new RetryExhaustedError(
        new NetworkError('disconnected'),
        { attempts: 2, detour: 'NetworkError' }
      );
      expect(fromNetwork.retryable).toBe(false);
    });

    test('isRetryable returns false even when wrapping a retryable error', () => {
      const err = new RetryExhaustedError(new TimeoutError('timed out'), {
        attempts: 3,
        detour: 'TimeoutError',
      });
      expect(isRetryable(err)).toBe(false);
    });
  });

  describe('metadata properties', () => {
    test('cause preserves the original error', () => {
      const original = new ConflictError('version mismatch');
      const err = new RetryExhaustedError(original, {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err.cause).toBe(original);
    });

    test('exposes attempts as a typed readonly property', () => {
      const err = new RetryExhaustedError(
        new ConflictError('version mismatch'),
        { attempts: 3, detour: 'ConflictError' }
      );
      expect(err.attempts).toBe(3);
    });

    test('exposes detour as a typed readonly property', () => {
      const err = new RetryExhaustedError(new TimeoutError('timed out'), {
        attempts: 2,
        detour: 'TimeoutRetry',
      });
      expect(err.detour).toBe('TimeoutRetry');
    });

    test('message includes attempt count and wrapped message', () => {
      const err = new RetryExhaustedError(
        new ConflictError('version mismatch'),
        { attempts: 3, detour: 'ConflictError' }
      );
      expect(err.message).toBe(
        'Recovery exhausted after 3 attempts: version mismatch'
      );
    });
  });

  describe('identity', () => {
    test('is instanceof InternalError', () => {
      const err = new RetryExhaustedError(new ConflictError('x'), {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err).toBeInstanceOf(InternalError);
    });

    test('name is RetryExhaustedError', () => {
      const err = new RetryExhaustedError(new ConflictError('x'), {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err.name).toBe('RetryExhaustedError');
    });

    test('is instanceof TrailsError', () => {
      const err = new RetryExhaustedError(new ConflictError('x'), {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err).toBeInstanceOf(TrailsError);
    });

    test('is instanceof Error', () => {
      const err = new RetryExhaustedError(new ConflictError('x'), {
        attempts: 1,
        detour: 'ConflictError',
      });
      expect(err).toBeInstanceOf(Error);
    });
  });
});
