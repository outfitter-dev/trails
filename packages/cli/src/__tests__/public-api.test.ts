import { describe, expect, test } from 'bun:test';

import * as cli from '@ontrails/cli';

describe('@ontrails/cli public API', () => {
  test('exports framework argv normalization for CLI adapters', () => {
    expect(typeof cli.normalizeCliArgv).toBe('function');
  });

  test('does not expose Commander runtime helpers from the root entrypoint', () => {
    expect('surface' in cli).toBe(false);
    expect('createProgram' in cli).toBe(false);
    expect('toCommander' in cli).toBe(false);
  });

  test('does not expose legacy layer wrappers from the root entrypoint', () => {
    expect('autoIterateLayer' in cli).toBe(false);
    expect('dateShortcutsLayer' in cli).toBe(false);
  });
});
