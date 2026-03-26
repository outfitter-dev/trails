import { describe, test, expect } from 'bun:test';

import {
  brand,
  unbrand,
  uuid,
  email,
  nonEmptyString,
  positiveInt,
  shortId,
  hashId,
} from '../branded';

describe('branded', () => {
  describe('brand / unbrand', () => {
    test('brand wraps and unbrand unwraps', () => {
      const branded = brand('Tag', 'hello');
      expect(unbrand(branded)).toBe('hello');
    });

    test('branded value is still usable as base type at runtime', () => {
      const branded = brand('PositiveInt', 42);
      expect(branded + 1).toBe(43);
    });
  });

  describe('uuid()', () => {
    test('accepts a valid v4 UUID', () => {
      const result = uuid('550e8400-e29b-41d4-a716-446655440000');
      expect(result.isOk()).toBe(true);
      const value: string = unbrand(result.unwrap());
      expect(value).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    test('rejects an empty string', () => {
      const result = uuid('');
      expect(result.isErr()).toBe(true);
    });

    test('rejects a malformed UUID', () => {
      const result = uuid('not-a-uuid');
      expect(result.isErr()).toBe(true);
    });

    test('rejects UUID missing hyphens', () => {
      const result = uuid('550e8400e29b41d4a716446655440000');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('email()', () => {
    test('accepts a simple email', () => {
      const result = email('test@example.com');
      expect(result.isOk()).toBe(true);
    });

    test('rejects missing @', () => {
      const result = email('testexample.com');
      expect(result.isErr()).toBe(true);
    });

    test('rejects missing domain', () => {
      const result = email('test@');
      expect(result.isErr()).toBe(true);
    });

    test('rejects empty string', () => {
      const result = email('');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('nonEmptyString()', () => {
    test('accepts a non-empty string', () => {
      const result = nonEmptyString('hello');
      expect(result.isOk()).toBe(true);
    });

    test('rejects an empty string', () => {
      const result = nonEmptyString('');
      expect(result.isErr()).toBe(true);
    });
  });

  describe('positiveInt()', () => {
    test('accepts 1', () => {
      const result = positiveInt(1);
      expect(result.isOk()).toBe(true);
    });

    test('accepts a large integer', () => {
      const result = positiveInt(1_000_000);
      expect(result.isOk()).toBe(true);
    });

    test('rejects 0', () => {
      const result = positiveInt(0);
      expect(result.isErr()).toBe(true);
    });

    test('rejects negative numbers', () => {
      const result = positiveInt(-5);
      expect(result.isErr()).toBe(true);
    });

    test('rejects non-integers', () => {
      const result = positiveInt(1.5);
      expect(result.isErr()).toBe(true);
    });
  });

  describe('shortId()', () => {
    test('returns a string of default length 8', () => {
      const id = shortId();
      expect(id).toHaveLength(8);
    });

    test('respects custom length', () => {
      const id = shortId(16);
      expect(id).toHaveLength(16);
    });

    test('contains only alphanumeric characters', () => {
      const id = shortId(100);
      expect(id).toMatch(/^[A-Za-z0-9]+$/);
    });

    test('produces unique values', () => {
      const ids = new Set(Array.from({ length: 50 }, () => shortId()));
      expect(ids.size).toBe(50);
    });
  });

  describe('hashId()', () => {
    test('returns a hex string', () => {
      const id = hashId('test');
      expect(id).toMatch(/^[0-9a-f]{8}$/);
    });

    test('is deterministic', () => {
      expect(hashId('hello')).toBe(hashId('hello'));
    });

    test('different inputs produce different outputs', () => {
      expect(hashId('a')).not.toBe(hashId('b'));
    });
  });
});
