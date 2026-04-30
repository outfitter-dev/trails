import { describe, expect, test } from 'bun:test';

import * as cli from '@ontrails/cli';
import * as commander from '@ontrails/cli/commander';

describe('@ontrails/cli public API', () => {
  test('keeps Commander runtime helpers on the commander entrypoint', () => {
    expect('surface' in cli).toBe(false);
    expect('createProgram' in cli).toBe(false);

    expect(typeof commander.surface).toBe('function');
    expect(typeof commander.createProgram).toBe('function');
    expect(typeof commander.toCommander).toBe('function');
  });
});
