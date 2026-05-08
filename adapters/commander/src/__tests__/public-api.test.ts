import { describe, expect, test } from 'bun:test';

import * as commander from '@ontrails/commander';

describe('@ontrails/commander public API', () => {
  test('exports the Commander adapter helpers', () => {
    expect(typeof commander.surface).toBe('function');
    expect(typeof commander.createProgram).toBe('function');
    expect(typeof commander.toCommander).toBe('function');
  });
});
