import { describe, expect, test } from 'bun:test';
import { Result, trail } from '@ontrails/core';

import type { CliCommand, CliFlag } from '../command.js';
import { validateCliCommands } from '../validate.js';

const command = (
  path: readonly string[],
  flags: readonly CliFlag[]
): CliCommand => ({
  args: [],
  execute: async () => await Result.ok(),
  flags: [...flags],
  intent: 'read',
  path,
  trail: trail(path.join('.'), {
    implementation: () => Result.ok(),
  }),
});

const modes = (choices: string[], short?: string): CliFlag => ({
  choices,
  name: 'modes',
  required: false,
  short,
  type: 'string[]',
  variadic: false,
});

describe('validateCliCommands inherited flags', () => {
  test('accepts equivalent parsing semantics on nested commands', () => {
    expect(() =>
      validateCliCommands([
        command(['parent'], [modes(['one', 'two'], 'm')]),
        command(['parent', 'child'], [modes(['one', 'two'], 'm')]),
      ])
    ).not.toThrow();
  });

  test('rejects divergent parsing semantics on nested commands', () => {
    expect(() =>
      validateCliCommands([
        command(['parent'], [modes(['one', 'two'])]),
        command(['parent', 'child'], [modes(['three', 'four'])]),
      ])
    ).toThrow(
      'CLI flag --modes on command parent child conflicts with inherited parsing semantics from command parent'
    );
  });

  test('rejects divergent short aliases on inherited bounded flags', () => {
    expect(() =>
      validateCliCommands([
        command(['parent'], [modes(['one', 'two'], 'm')]),
        command(['parent', 'child'], [modes(['one', 'two'], 'x')]),
      ])
    ).toThrow(
      'CLI flag --modes on command parent child conflicts with inherited parsing semantics from command parent'
    );
  });
});
