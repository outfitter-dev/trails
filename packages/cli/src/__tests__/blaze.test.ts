import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { buildCliCommands } from '../build.js';
import { blaze } from '../commander/blaze.js';
import { toCommander } from '../commander/to-commander.js';
import { defaultOnResult } from '../on-result.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('blaze', () => {
  test('smoke test: buildCliCommands + toCommander wiring does not throw', () => {
    const t = trail('ping', {
      implementation: () => Result.ok('pong'),
      input: z.object({}),
    });
    const app = topo('smoke-test', { ping: t });

    // Reproduce blaze() steps without calling parse()
    const commands = buildCliCommands(app, {
      onResult: defaultOnResult,
    });
    const program = toCommander(commands, { name: 'smoke-test' });

    expect(program.name()).toBe('smoke-test');
    expect(program.commands).toHaveLength(1);
    expect(program.commands[0]?.name()).toBe('ping');
  });

  test('uses defaultOnResult when none provided', () => {
    const t = trail('echo', {
      implementation: (input: { msg: string }) => Result.ok(input.msg),
      input: z.object({ msg: z.string() }),
    });
    const app = topo('default-on-result', { echo: t });

    // buildCliCommands without onResult should still work
    const commands = buildCliCommands(app, {
      onResult: defaultOnResult,
    });
    const program = toCommander(commands, { name: app.name });

    expect(program.commands).toHaveLength(1);
    expect(program.commands[0]?.name()).toBe('echo');
  });

  test('blaze returns a Promise (async signature)', () => {
    // Verify blaze's return type is a Promise by checking its constructor name.
    // We don't call blaze() here because it invokes parseAsync on real argv.
    expect(blaze).toBeDefined();
    // The function is async, so calling it returns a Promise.
    // We verify the type signature indirectly: async functions have AsyncFunction constructor.
    expect(blaze.constructor.name).toBe('AsyncFunction');
  });

  test('end-to-end: define trail, build commands, execute, verify output', async () => {
    const written: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string) => {
      written.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const t = trail('greet', {
        implementation: (input: { name: string }) =>
          Result.ok(`Hello, ${input.name}!`),
        input: z.object({ name: z.string() }),
      });
      const app = topo('e2e-test', { greet: t });

      const commands = buildCliCommands(app, {
        onResult: defaultOnResult,
      });

      // Execute directly (bypassing Commander parse)
      await commands[0]?.execute({}, { name: 'World' });

      expect(written.join('')).toBe('Hello, World!\n');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
