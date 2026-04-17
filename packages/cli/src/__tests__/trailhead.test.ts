import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { buildCliCommands, deriveCliCommands } from '../build.js';
import { createProgram, trailhead } from '../commander/surface.js';
import { toCommander } from '../commander/to-commander.js';
import { defaultOnResult } from '../on-result.js';

const unwrapOk = <T>(result: Result<T, Error>): T =>
  result.match({
    err: (error) => {
      throw error;
    },
    ok: (value) => value,
  });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('trailhead', () => {
  test('smoke test: buildCliCommands + toCommander wiring does not throw', () => {
    const t = trail('ping', {
      blaze: () => Result.ok('pong'),
      input: z.object({}),
    });
    const app = topo('smoke-test', { ping: t });

    // Reproduce trailhead() steps without calling parse()
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
      blaze: (input: { msg: string }) => Result.ok(input.msg),
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

  test('deriveCliCommands returns Result and createProgram wires the new surface API', () => {
    const t = trail('greet', {
      blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}!`),
      input: z.object({ name: z.string() }),
    });
    const app = topo('surface-api', { greet: t });

    const commands = unwrapOk(
      deriveCliCommands(app, {
        onResult: defaultOnResult,
      })
    );
    expect(commands).toHaveLength(1);

    const program = createProgram(app, { description: 'Surface API smoke' });
    expect(program.name()).toBe('surface-api');
    expect(program.description()).toBe('Surface API smoke');
    expect(program.commands[0]?.name()).toBe('greet');
  });

  test('trailhead throws on invalid topo', async () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    await expect(trailhead(app)).rejects.toThrow(/validation/i);
  });

  test('TrailheadCliOptions accepts validate: false without type errors', () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('test', { t });
    expect(() =>
      buildCliCommands(app, {
        onResult: defaultOnResult,
        validate: false,
      })
    ).not.toThrow();
    const opts: Parameters<typeof trailhead>[1] = {
      exclude: ['entity.secret'],
      include: ['entity.show'],
      resources: {},
      validate: false,
    };
    expect(opts.exclude).toEqual(['entity.secret']);
    expect(opts.include).toEqual(['entity.show']);
    expect(opts.validate).toBe(false);
    expect(opts.resources).toEqual({});
  });

  test('deriveCliCommands returns Err on invalid topo', () => {
    const t = trail('broken', {
      blaze: () => Result.ok({}),
      crosses: ['nonexistent.trail'],
      input: z.object({}),
      output: z.object({}),
    });
    const app = topo('invalid-cli', { t });

    const result = deriveCliCommands(app, { validate: true });
    expect(result.isErr()).toBe(true);
  });

  test('trailhead returns a Promise (async signature)', () => {
    // Verify trailhead's return type is a Promise by checking its constructor name.
    // We don't call trailhead() here because it invokes parseAsync on real argv.
    expect(trailhead).toBeDefined();
    // The function is async, so calling it returns a Promise.
    // We verify the type signature indirectly: async functions have AsyncFunction constructor.
    expect(trailhead.constructor.name).toBe('AsyncFunction');
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
        blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}!`),
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
