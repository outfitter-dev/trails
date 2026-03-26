import { describe, test, expect } from 'bun:test';

import {
  isDefined,
  isNonEmptyString,
  isPlainObject,
  hasProperty,
  assertNever,
} from '../guards';

describe('guards', () => {
  describe('isDefined()', () => {
    test('returns true for non-nullish values', () => {
      expect(isDefined(0)).toBe(true);
      expect(isDefined('')).toBe(true);
      expect(isDefined(false)).toBe(true);
      expect(isDefined([])).toBe(true);
    });

    test('returns false for null', () => {
      expect(isDefined(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isDefined()).toBe(false);
    });
  });

  describe('isNonEmptyString()', () => {
    test('returns true for non-empty strings', () => {
      expect(isNonEmptyString('hello')).toBe(true);
      expect(isNonEmptyString(' ')).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(isNonEmptyString('')).toBe(false);
    });

    test('returns false for non-string types', () => {
      expect(isNonEmptyString(42)).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString()).toBe(false);
      expect(isNonEmptyString([])).toBe(false);
    });
  });

  describe('isPlainObject()', () => {
    test('returns true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ a: 1 })).toBe(true);
      expect(isPlainObject(Object.create(null))).toBe(true);
    });

    test('returns false for arrays', () => {
      expect(isPlainObject([])).toBe(false);
    });

    test('returns false for class instances', () => {
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject(new Map())).toBe(false);
    });

    test('returns false for null', () => {
      expect(isPlainObject(null)).toBe(false);
    });

    test('returns false for primitives', () => {
      expect(isPlainObject('string')).toBe(false);
      expect(isPlainObject(42)).toBe(false);
    });
  });

  describe('hasProperty()', () => {
    test('returns true when key exists', () => {
      expect(hasProperty({ name: 'test' }, 'name')).toBe(true);
    });

    test('returns true for keys with undefined values', () => {
      expect(hasProperty({ x: undefined }, 'x')).toBe(true);
    });

    test('returns false when key is missing', () => {
      expect(hasProperty({}, 'missing')).toBe(false);
    });

    test('returns false for null', () => {
      expect(hasProperty(null, 'key')).toBe(false);
    });

    test('returns false for primitives', () => {
      expect(hasProperty(42, 'key')).toBe(false);
    });
  });

  describe('assertNever()', () => {
    test('throws with a descriptive message', () => {
      expect(() => assertNever('unexpected' as never)).toThrow(
        'Unexpected value: unexpected'
      );
    });
  });
});
