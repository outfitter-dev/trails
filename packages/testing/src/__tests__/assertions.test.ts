import { describe, expect, test } from 'bun:test';

import { Result } from '@ontrails/core';

import { expectOk } from '../assertions.js';

describe('expectOk', () => {
  test('returns the success value unchanged', () => {
    const value = { ready: true };

    expect(expectOk(Result.ok(value))).toBe(value);
  });

  test('omits the value of a non-Error failure', () => {
    expect(() => expectOk(Result.err('fake-opaque-credential'))).toThrow(
      /^Expected Result\.ok\(\), received Result\.err\(\): a non-Error value$/
    );
  });
});
