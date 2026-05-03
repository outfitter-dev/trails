import { describe, expect, test } from 'bun:test';

import { WAYFINDER_SHELL } from '../index.ts';

describe('@ontrails/wayfinder shell', () => {
  test('exports the shell marker', () => {
    expect(WAYFINDER_SHELL).toBe(true);
  });
});
