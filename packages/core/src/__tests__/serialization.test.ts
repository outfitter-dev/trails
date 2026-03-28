import { describe, test, expect } from 'bun:test';

import {
  ValidationError,
  AmbiguousError,
  AssertionError,
  NetworkError,
  RateLimitError,
  InternalError,
  TimeoutError,
  NotFoundError,
  AlreadyExistsError,
  ConflictError,
  PermissionError,
  AuthError,
  CancelledError,
} from '../errors.js';
import {
  serializeError,
  deserializeError,
  safeStringify,
} from '../serialization.js';
import { Result } from '../result.js';
import type { SerializedError } from '../serialization.js';

// ---------------------------------------------------------------------------
// serializeError
// ---------------------------------------------------------------------------

describe('serializeError', () => {
  test('serializes a plain Error', () => {
    const err = new Error('boom');
    const serialized = serializeError(err);
    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('boom');
    expect(serialized.stack).toBeDefined();
    expect(serialized.category).toBeUndefined();
    expect(serialized.retryable).toBeUndefined();
  });

  test('serializes a TrailsError with category', () => {
    const err = new NetworkError('disconnected');
    const serialized = serializeError(err);
    expect(serialized.name).toBe('NetworkError');
    expect(serialized.message).toBe('disconnected');
    expect(serialized.category).toBe('network');
    expect(serialized.retryable).toBe(true);
  });

  test('serializes context', () => {
    const err = new ValidationError('bad input', {
      context: { field: 'email' },
    });
    const serialized = serializeError(err);
    expect(serialized.context).toEqual({ field: 'email' });
  });

  test('serializes RateLimitError.retryAfter', () => {
    const err = new RateLimitError('slow down', { retryAfter: 30 });
    const serialized = serializeError(err);
    expect(serialized.retryAfter).toBe(30);
  });

  test('retryAfter is undefined for non-RateLimitError', () => {
    const err = new TimeoutError('timed out');
    const serialized = serializeError(err);
    expect(serialized.retryAfter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deserializeError
// ---------------------------------------------------------------------------

describe('deserializeError', () => {
  test('reconstructs a validation error', () => {
    const data: SerializedError = {
      category: 'validation',
      message: 'bad input',
      name: 'ValidationError',
      retryable: false,
    };
    const err = deserializeError(data);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toBe('bad input');
    expect(err.category).toBe('validation');
  });

  test('reconstructs a rate limit error with retryAfter', () => {
    const data: SerializedError = {
      category: 'rate_limit',
      message: 'slow down',
      name: 'RateLimitError',
      retryAfter: 60,
      retryable: true,
    };
    const err = deserializeError(data);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(60);
  });

  test('restores stack trace', () => {
    const data: SerializedError = {
      category: 'internal',
      message: 'oops',
      name: 'InternalError',
      stack: 'Error: oops\n    at test.ts:1:1',
    };
    const err = deserializeError(data);
    expect(err.stack).toBe('Error: oops\n    at test.ts:1:1');
  });

  test('restores context', () => {
    const data: SerializedError = {
      category: 'auth',
      context: { endpoint: '/api/secret' },
      message: 'unauthorized',
      name: 'AuthError',
    };
    const err = deserializeError(data);
    expect(err.context).toEqual({ endpoint: '/api/secret' });
  });

  test('defaults to InternalError when category is missing', () => {
    const data: SerializedError = {
      message: 'unknown',
      name: 'SomeError',
    };
    const err = deserializeError(data);
    expect(err).toBeInstanceOf(InternalError);
    expect(err.category).toBe('internal');
  });

  test('round-trips through serialize/deserialize', () => {
    const original = new NotFoundError('missing resource', {
      context: { id: 'abc' },
    });
    const serialized = serializeError(original);
    const restored = deserializeError(serialized);
    expect(restored).toBeInstanceOf(NotFoundError);
    expect(restored.message).toBe('missing resource');
    expect(restored.context).toEqual({ id: 'abc' });
    expect(restored.category).toBe('not_found');
  });

  test('handles all error categories', () => {
    const categories = [
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

    for (const category of categories) {
      const data: SerializedError = {
        category,
        message: 'test',
        name: 'Test',
      };
      const err = deserializeError(data);
      expect(err.category).toBe(category);
    }
  });

  describe('round-trips all subclasses by name', () => {
    const subclasses = [
      { Ctor: ValidationError, category: 'validation' },
      { Ctor: AmbiguousError, category: 'validation' },
      { Ctor: AssertionError, category: 'internal' },
      { Ctor: NotFoundError, category: 'not_found' },
      { Ctor: AlreadyExistsError, category: 'conflict' },
      { Ctor: ConflictError, category: 'conflict' },
      { Ctor: PermissionError, category: 'permission' },
      { Ctor: TimeoutError, category: 'timeout' },
      { Ctor: NetworkError, category: 'network' },
      { Ctor: InternalError, category: 'internal' },
      { Ctor: AuthError, category: 'auth' },
      { Ctor: CancelledError, category: 'cancelled' },
    ] as const;

    test.each(subclasses)(
      '$Ctor.name round-trips with correct identity',
      ({ Ctor, category }) => {
        const original = new Ctor(`test ${Ctor.name}`, {
          context: { key: 'value' },
        });
        const serialized = serializeError(original);
        const restored = deserializeError(serialized);

        expect(restored).toBeInstanceOf(Ctor);
        expect(restored.constructor.name).toBe(Ctor.name);
        expect(restored.name).toBe(Ctor.name);
        expect(restored.category).toBe(category);
        expect(restored.message).toBe(`test ${Ctor.name}`);
        expect(restored.context).toEqual({ key: 'value' });
      }
    );

    test('RateLimitError round-trips with retryAfter', () => {
      const original = new RateLimitError('slow down', {
        context: { endpoint: '/api' },
        retryAfter: 42,
      });
      const serialized = serializeError(original);
      const restored = deserializeError(serialized);

      expect(restored).toBeInstanceOf(RateLimitError);
      expect(restored.constructor.name).toBe('RateLimitError');
      expect((restored as RateLimitError).retryAfter).toBe(42);
      expect(restored.context).toEqual({ endpoint: '/api' });
    });

    test('falls back to category when name is unknown', () => {
      const data: SerializedError = {
        category: 'conflict',
        message: 'custom error',
        name: 'CustomConflictError',
      };
      const err = deserializeError(data);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.category).toBe('conflict');
    });
  });
});

// ---------------------------------------------------------------------------
// Result.fromJson
// ---------------------------------------------------------------------------

describe('Result.fromJson (safeParse)', () => {
  test('parses valid JSON', () => {
    const result = Result.fromJson('{"key": "value"}');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual({ key: 'value' });
  });

  test('parses JSON arrays', () => {
    const result = Result.fromJson('[1, 2, 3]');
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toEqual([1, 2, 3]);
  });

  test('parses JSON primitives', () => {
    expect(Result.fromJson('"hello"').unwrap()).toBe('hello');
    expect(Result.fromJson('42').unwrap()).toBe(42);
    expect(Result.fromJson('true').unwrap()).toBe(true);
    expect(Result.fromJson('null').unwrap()).toBe(null);
  });

  test('returns ValidationError for invalid JSON', () => {
    const result = Result.fromJson('not json');
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error).toBeInstanceOf(ValidationError);
    expect(err.error.message).toBe('Invalid JSON');
  });

  test('includes truncated input in context', () => {
    const result = Result.fromJson('{bad}');
    expect(result.isErr()).toBe(true);
    const err = result as unknown as { error: ValidationError };
    expect(err.error.context).toBeDefined();
    expect(err.error.context?.['input']).toBe('{bad}');
  });
});

// ---------------------------------------------------------------------------
// Result.toJson
// ---------------------------------------------------------------------------

describe('Result.toJson (safeStringify)', () => {
  test('stringifies objects', () => {
    const result = Result.toJson({ key: 'value' });
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('{"key":"value"}');
  });

  test('stringifies arrays', () => {
    const result = Result.toJson([1, 2, 3]);
    expect(result.isOk()).toBe(true);
    expect(result.unwrap()).toBe('[1,2,3]');
  });

  test('stringifies primitives', () => {
    expect(Result.toJson('hello').unwrap()).toBe('"hello"');
    expect(Result.toJson(42).unwrap()).toBe('42');
    expect(Result.toJson(true).unwrap()).toBe('true');
    expect(Result.toJson(null).unwrap()).toBe('null');
  });

  test('handles circular references gracefully', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    const result = Result.toJson(obj);
    expect(result.isOk()).toBe(true);
    const ok = result as unknown as { value: string };
    const parsed = JSON.parse(ok.value) as Record<string, unknown>;
    expect(parsed['a']).toBe(1);
    expect(parsed['self']).toBe('[Circular]');
  });

  test('serializes shared references in a DAG without marking as circular', () => {
    const shared = { x: 1 };
    const obj = { a: shared, b: shared };
    const result = Result.toJson(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<string, unknown>;
    expect(parsed['a']).toEqual({ x: 1 });
    expect(parsed['b']).toEqual({ x: 1 });
  });

  test('detects deep circular references', () => {
    const inner: Record<string, unknown> = { value: 'deep' };
    const obj: Record<string, unknown> = { child: { nested: inner } };
    inner['back'] = obj;
    const result = Result.toJson(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<string, unknown>;
    const child = parsed['child'] as Record<string, unknown>;
    const nested = child['nested'] as Record<string, unknown>;
    expect(nested['value']).toBe('deep');
    expect(nested['back']).toBe('[Circular]');
  });

  test('handles shared ref used in sibling subtrees of a DAG', () => {
    const shared = { id: 42 };
    const obj = {
      left: { extra: 'l', ref: shared },
      right: { extra: 'r', ref: shared },
    };
    const result = Result.toJson(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed['left']?.['ref']).toEqual({ id: 42 });
    expect(parsed['right']?.['ref']).toEqual({ id: 42 });
  });
});

// ---------------------------------------------------------------------------
// safeStringify (shared DAG / circular detection)
// ---------------------------------------------------------------------------

describe('safeStringify', () => {
  test('serializes shared references in a DAG without marking as circular', () => {
    const shared = { x: 1 };
    const obj = { a: shared, b: shared };
    const result = safeStringify(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<string, unknown>;
    expect(parsed['a']).toEqual({ x: 1 });
    expect(parsed['b']).toEqual({ x: 1 });
  });

  test('detects true circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj['self'] = obj;
    const result = safeStringify(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<string, unknown>;
    expect(parsed['a']).toBe(1);
    expect(parsed['self']).toBe('[Circular]');
  });

  test('detects deep circular references', () => {
    const inner: Record<string, unknown> = { value: 'deep' };
    const obj: Record<string, unknown> = { child: { nested: inner } };
    inner['back'] = obj;
    const result = safeStringify(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<string, unknown>;
    const child = parsed['child'] as Record<string, unknown>;
    const nested = child['nested'] as Record<string, unknown>;
    expect(nested['value']).toBe('deep');
    expect(nested['back']).toBe('[Circular]');
  });

  test('handles shared ref used in sibling subtrees of a DAG', () => {
    const shared = { id: 42 };
    const obj = {
      left: { extra: 'l', ref: shared },
      right: { extra: 'r', ref: shared },
    };
    const result = safeStringify(obj);
    expect(result.isOk()).toBe(true);
    const parsed = JSON.parse(result.unwrap()) as Record<
      string,
      Record<string, unknown>
    >;
    expect(parsed['left']?.['ref']).toEqual({ id: 42 });
    expect(parsed['right']?.['ref']).toEqual({ id: 42 });
  });
});
