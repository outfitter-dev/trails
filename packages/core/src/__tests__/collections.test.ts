import { describe, test, expect } from 'bun:test';

import {
  chunk,
  dedupe,
  groupBy,
  sortBy,
  isNonEmptyArray,
} from '../collections';

describe('collections', () => {
  describe('chunk()', () => {
    test('splits into even chunks', () => {
      expect(chunk([1, 2, 3, 4], 2)).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    test('handles remainder', () => {
      expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    test('returns empty array for empty input', () => {
      expect(chunk([], 3)).toEqual([]);
    });

    test('single-element chunks', () => {
      expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
    });

    test('chunk size larger than array', () => {
      expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
    });

    test('throws on size < 1', () => {
      expect(() => chunk([1], 0)).toThrow(RangeError);
    });
  });

  describe('dedupe()', () => {
    test('removes primitive duplicates', () => {
      expect(dedupe([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
    });

    test('dedupes by key function', () => {
      const items = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
        { id: 1, name: 'c' },
      ];
      const result = dedupe(items, (i) => i.id);
      expect(result).toEqual([
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ]);
    });

    test('preserves order', () => {
      expect(dedupe([3, 1, 2, 1, 3])).toEqual([3, 1, 2]);
    });

    test('handles empty array', () => {
      expect(dedupe([])).toEqual([]);
    });
  });

  describe('groupBy()', () => {
    test('groups by key', () => {
      const items = [
        { type: 'a', value: 1 },
        { type: 'b', value: 2 },
        { type: 'a', value: 3 },
      ];
      const groups = groupBy(items, (i) => i.type);
      expect(groups).toEqual({
        a: [
          { type: 'a', value: 1 },
          { type: 'a', value: 3 },
        ],
        b: [{ type: 'b', value: 2 }],
      });
    });

    test('returns empty object for empty array', () => {
      expect(groupBy([], () => 'key')).toEqual({});
    });
  });

  describe('sortBy()', () => {
    test('sorts by numeric key ascending', () => {
      const items = [{ n: 3 }, { n: 1 }, { n: 2 }];
      expect(sortBy(items, (i) => i.n)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    test('sorts by string key alphabetically', () => {
      const items = [{ name: 'charlie' }, { name: 'alice' }, { name: 'bob' }];
      expect(sortBy(items, (i) => i.name)).toEqual([
        { name: 'alice' },
        { name: 'bob' },
        { name: 'charlie' },
      ]);
    });

    test('does not mutate the original array', () => {
      const original = [{ n: 3 }, { n: 1 }];
      sortBy(original, (i) => i.n);
      expect(original[0]?.n).toBe(3);
    });

    test('returns empty array for empty input', () => {
      expect(sortBy([], () => 0)).toEqual([]);
    });
  });

  describe('isNonEmptyArray()', () => {
    test('returns true for arrays with elements', () => {
      expect(isNonEmptyArray([1])).toBe(true);
      expect(isNonEmptyArray([1, 2, 3])).toBe(true);
    });

    test('returns false for empty array', () => {
      expect(isNonEmptyArray([])).toBe(false);
    });
  });
});
