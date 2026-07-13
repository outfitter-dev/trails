import { describe, expect, test } from 'bun:test';
import { Result, trail } from '@ontrails/core';

import type { CliCommand, CliFlag } from '../command.js';
import { normalizeCliArgv } from '../argv.js';

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

const surfacesFlag: CliFlag = {
  choices: ['cli', 'mcp', 'http'],
  name: 'surfaces',
  required: false,
  type: 'string[]',
  variadic: false,
};

const modesFlag = (choices: string[]): CliFlag => ({
  choices,
  name: 'modes',
  required: false,
  type: 'string[]',
  variadic: false,
});

describe('normalizeCliArgv', () => {
  test('normalizes contiguous bounded choices into repeated flags', () => {
    expect(
      normalizeCliArgv(
        [command(['create'], [surfacesFlag])],
        ['create', '--surfaces', 'cli', 'mcp', 'http']
      )
    ).toEqual([
      'create',
      '--surfaces',
      'cli',
      '--surfaces',
      'mcp',
      '--surfaces',
      'http',
    ]);
  });

  test('preserves the repeated form', () => {
    const argv = ['create', '--surfaces', 'cli', '--surfaces', 'mcp'];
    expect(
      normalizeCliArgv([command(['create'], [surfacesFlag])], argv)
    ).toEqual(argv);
  });

  test('stops bounded values before a child command', () => {
    const include: CliFlag = {
      choices: ['examples', 'errors'],
      name: 'include',
      required: false,
      type: 'string[]',
      variadic: false,
    };
    expect(
      normalizeCliArgv(
        [command(['wayfind'], [include]), command(['wayfind', 'search'], [])],
        ['wayfind', '--include', 'examples', 'errors', 'search']
      )
    ).toEqual([
      'wayfind',
      '--include',
      'examples',
      '--include',
      'errors',
      'search',
    ]);
  });

  test('gives a child route precedence over an additional choice value', () => {
    const include: CliFlag = {
      choices: ['examples', 'search'],
      name: 'include',
      required: false,
      type: 'string[]',
      variadic: false,
    };
    expect(
      normalizeCliArgv(
        [command(['wayfind'], [include]), command(['wayfind', 'search'], [])],
        ['wayfind', '--include', 'examples', 'search']
      )
    ).toEqual(['wayfind', '--include', 'examples', 'search']);
  });

  test('preserves a required option value that looks like another flag', () => {
    const label: CliFlag = {
      name: 'label',
      required: true,
      type: 'string',
      variadic: false,
    };
    const argv = ['configure', '--label', '--surfaces', 'cli', 'mcp'];
    expect(
      normalizeCliArgv([command(['configure'], [label, surfacesFlag])], argv)
    ).toEqual(argv);
  });

  test('stops a required variadic flag before a following bounded flag', () => {
    const tags: CliFlag = {
      name: 'tags',
      required: true,
      type: 'string[]',
      variadic: true,
    };
    expect(
      normalizeCliArgv(
        [command(['configure'], [tags, surfacesFlag])],
        ['configure', '--tags', 'a', '--surfaces', 'cli', 'mcp']
      )
    ).toEqual([
      'configure',
      '--tags',
      'a',
      '--surfaces',
      'cli',
      '--surfaces',
      'mcp',
    ]);
  });

  test('uses the active command when flag names overlap', () => {
    const commands = [
      command(['alpha'], [modesFlag(['one', 'two'])]),
      command(['beta'], [modesFlag(['three', 'four'])]),
    ];
    expect(
      normalizeCliArgv(commands, ['beta', '--modes', 'three', 'four'])
    ).toEqual(['beta', '--modes', 'three', '--modes', 'four']);
  });

  test('prefers child flag semantics over an inherited flag', () => {
    const commands = [
      command(['wayfind'], [modesFlag(['nearby', 'impact'])]),
      command(['wayfind', 'query'], [modesFlag(['fuzzy', 'exact'])]),
    ];
    expect(
      normalizeCliArgv(commands, [
        'wayfind',
        'query',
        '--modes',
        'fuzzy',
        'exact',
      ])
    ).toEqual(['wayfind', 'query', '--modes', 'fuzzy', '--modes', 'exact']);
  });

  test('supports an inline first value', () => {
    expect(
      normalizeCliArgv(
        [command(['create'], [surfacesFlag])],
        ['create', '--surfaces=cli', 'mcp']
      )
    ).toEqual(['create', '--surfaces=cli', '--surfaces', 'mcp']);
  });

  test('supports compact short-option first values', () => {
    expect(
      normalizeCliArgv(
        [command(['create'], [{ ...surfacesFlag, short: 's' }])],
        ['create', '-scli', 'mcp']
      )
    ).toEqual(['create', '-scli', '--surfaces', 'mcp']);
  });

  test('finds a bounded value option after grouped boolean shorts', () => {
    const quiet: CliFlag = {
      name: 'quiet',
      required: false,
      short: 'q',
      type: 'boolean',
      variadic: false,
    };
    expect(
      normalizeCliArgv(
        [command(['create'], [quiet, { ...surfacesFlag, short: 's' }])],
        ['create', '-qscli', 'mcp']
      )
    ).toEqual(['create', '-qscli', '--surfaces', 'mcp']);
  });

  test('gives a declared digit short flag precedence over a negative number', () => {
    const threshold: CliFlag = {
      name: 'threshold',
      required: false,
      type: 'number',
      variadic: false,
    };
    const modes: CliFlag = {
      choices: ['a', 'b'],
      name: 'modes',
      required: false,
      short: '1',
      type: 'string[]',
      variadic: false,
    };
    expect(
      normalizeCliArgv(
        [command(['run'], [threshold, modes])],
        ['run', '--threshold', '-1', 'a', 'b']
      )
    ).toEqual(['run', '--threshold', '-1', 'a', '--modes', 'b']);
  });
});
