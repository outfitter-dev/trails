import { describe, test, expect } from 'bun:test';

import { Result, resultAccessorNames } from '../result';
import type { ResultAccessorName } from '../result';

const acceptsAccessorName = (name: ResultAccessorName) => name;

describe('Result', () => {
  describe('resultAccessorNames', () => {
    test('exports the owner-held Result accessor surface', () => {
      expect(acceptsAccessorName('unwrap')).toBe('unwrap');
      expect(resultAccessorNames).toEqual([
        'error',
        'flatMap',
        'isErr',
        'isOk',
        'map',
        'mapErr',
        'match',
        'unwrap',
        'unwrapOr',
        'value',
      ]);
    });
  });

  describe('construction', () => {
    test('Result.ok() creates a success result', () => {
      const result = Result.ok(42);
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
    });

    test('Result.err() creates a failure result', () => {
      const result = Result.err(new Error('fail'));
      expect(result.isOk()).toBe(false);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('type narrowing', () => {
    test('isOk() narrows to Ok with value access', () => {
      const result: Result<number, Error> = Result.ok(42);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(42);
    });

    test('isErr() narrows to Err with error access', () => {
      const error = new Error('boom');
      const result: Result<number, Error> = Result.err(error);
      expect(result.isErr()).toBe(true);
      expect((result as { error: Error }).error).toBe(error);
    });
  });

  describe('map()', () => {
    test('transforms the value of an Ok', () => {
      const result = Result.ok(10).map((n) => n * 2);
      expect(result.unwrap()).toBe(20);
    });

    test('passes through on Err', () => {
      const error = new Error('fail');
      const result = Result.err<Error>(error).map((_n: number) => 999);
      expect(result.isErr()).toBe(true);
      expect((result as { error: Error }).error).toBe(error);
    });
  });

  describe('flatMap()', () => {
    test('chains successful results', () => {
      const result = Result.ok(10).flatMap((n) => Result.ok(n + 5));
      expect(result.unwrap()).toBe(15);
    });

    test('short-circuits on error', () => {
      const error = new Error('first');
      const result = Result.err<Error>(error).flatMap((_n: number) =>
        Result.ok(999)
      );
      expect(result.isErr()).toBe(true);
      expect((result as { error: Error }).error).toBe(error);
    });

    test('chains into an error', () => {
      const result = Result.ok(10).flatMap(() =>
        Result.err(new Error('second'))
      );
      expect(result.isErr()).toBe(true);
    });
  });

  describe('mapErr()', () => {
    test('transforms the error of an Err', () => {
      const result = Result.err('bad').mapErr((e) => new Error(e));
      expect(result.isErr()).toBe(true);
      expect((result as { error: Error }).error).toBeInstanceOf(Error);
      expect((result as { error: Error }).error.message).toBe('bad');
    });

    test('passes through on Ok', () => {
      const result = Result.ok(42).mapErr(() => 'transformed');
      expect(result.unwrap()).toBe(42);
    });
  });

  describe('match()', () => {
    test('dispatches to ok handler on success', () => {
      const output = Result.ok(5).match({
        err: (e) => `error:${e}`,
        ok: (v) => `value:${v}`,
      });
      expect(output).toBe('value:5');
    });

    test('dispatches to err handler on failure', () => {
      const output = Result.err('oops').match({
        err: (e) => `error:${e}`,
        ok: (v) => `value:${v}`,
      });
      expect(output).toBe('error:oops');
    });
  });

  describe('unwrap()', () => {
    test('returns value on Ok', () => {
      expect(Result.ok('hello').unwrap()).toBe('hello');
    });

    test('throws on Err with Error instance', () => {
      const error = new Error('boom');
      expect(() => Result.err(error).unwrap()).toThrow('boom');
    });

    test('throws wrapped error on Err with non-Error value', () => {
      expect(() => Result.err('string error').unwrap()).toThrow('string error');
    });
  });

  describe('unwrapOr()', () => {
    test('returns value on Ok', () => {
      expect(Result.ok(42).unwrapOr(0)).toBe(42);
    });

    test('returns fallback on Err', () => {
      const result: Result<number, Error> = Result.err(new Error('fail'));
      expect(result.unwrapOr(0)).toBe(0);
    });
  });

  describe('Result.combine()', () => {
    test('collects all Ok values into an array', () => {
      const results = [Result.ok(1), Result.ok(2), Result.ok(3)];
      const combined = Result.combine(results);
      expect(combined.unwrap()).toEqual([1, 2, 3]);
    });

    test('returns first error encountered', () => {
      const err1 = new Error('first');
      const err2 = new Error('second');
      const results: Result<number, Error>[] = [
        Result.ok(1),
        Result.err(err1),
        Result.err(err2),
      ];
      const combined = Result.combine(results);
      expect(combined.isErr()).toBe(true);
      expect((combined as { error: Error }).error).toBe(err1);
    });

    test('returns Ok with empty array for empty input', () => {
      const combined = Result.combine([]);
      expect(combined.unwrap()).toEqual([]);
    });
  });
});
