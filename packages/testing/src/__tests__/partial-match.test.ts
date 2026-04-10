import { describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import { assertPartialMatch } from '../assertions.js';

describe('assertPartialMatch', () => {
  describe('scalar values', () => {
    test('passes with exact scalar match', () => {
      const result = Result.ok('hello');
      assertPartialMatch(result, 'hello');
    });

    test('passes with numeric match', () => {
      const result = Result.ok(42);
      assertPartialMatch(result, 42);
    });

    test('fails when scalar does not match', () => {
      const result = Result.ok('hello');
      expect(() => assertPartialMatch(result, 'world')).toThrow();
    });
  });

  describe('object subset', () => {
    test('passes with full match', () => {
      const result = Result.ok({ id: '1', name: 'Alpha', type: 'concept' });
      assertPartialMatch(result, { id: '1', name: 'Alpha', type: 'concept' });
    });

    test('passes with partial match (extra keys in actual ignored)', () => {
      const result = Result.ok({
        createdAt: '2026-01-01',
        id: '1',
        name: 'Alpha',
        type: 'concept',
      });
      assertPartialMatch(result, { name: 'Alpha', type: 'concept' });
    });

    test('fails when expected key is missing from actual', () => {
      const result = Result.ok({ id: '1', name: 'Alpha' });
      expect(() =>
        assertPartialMatch(result, { missing: true, name: 'Alpha' })
      ).toThrow();
    });

    test('fails when expected value does not match', () => {
      const result = Result.ok({ id: '1', name: 'Alpha' });
      expect(() => assertPartialMatch(result, { name: 'Beta' })).toThrow();
    });
  });

  describe('nested object subset', () => {
    test('passes with nested partial match', () => {
      const result = Result.ok({
        id: '1',
        meta: { stars: 0, tags: ['a', 'b'], views: 5 },
      });
      assertPartialMatch(result, { meta: { stars: 0 } });
    });

    test('fails when nested value does not match', () => {
      const result = Result.ok({
        id: '1',
        meta: { stars: 0, views: 5 },
      });
      expect(() =>
        assertPartialMatch(result, { meta: { stars: 3 } })
      ).toThrow();
    });
  });

  describe('array subset', () => {
    test('passes when actual contains all expected elements (order-independent)', () => {
      const result = Result.ok({
        tags: ['a', 'b', 'c'],
      });
      assertPartialMatch(result, { tags: ['c', 'a'] });
    });

    test('fails when actual is missing expected array element', () => {
      const result = Result.ok({
        tags: ['a', 'b'],
      });
      expect(() => assertPartialMatch(result, { tags: ['a', 'z'] })).toThrow();
    });
  });

  describe('error on non-ok result', () => {
    test('fails when result is an error', () => {
      const result = Result.err(new Error('boom'));
      expect(() => assertPartialMatch(result, { id: '1' })).toThrow();
    });
  });
});
