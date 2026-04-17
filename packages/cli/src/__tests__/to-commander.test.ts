import { describe, expect, mock, test } from 'bun:test';

import { NotFoundError, Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { deriveCliCommands } from '../build.js';
import type { AnyTrail, CliCommand } from '../command.js';
import { toCommander } from '../commander/to-commander.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// oxlint-disable-next-line no-empty-function, require-await -- intentional noop for callback type
const noopResult = async () => {};
// oxlint-disable-next-line no-empty-function -- intentional noop for callback type
const noopWrite = () => {};

const makeApp = (...trails: AnyTrail[]) => {
  const mod: Record<string, unknown> = {};
  for (const t of trails) {
    mod[t.id] = t;
  }
  return topo('test-app', mod);
};

const buildCommands = (...args: Parameters<typeof deriveCliCommands>) => {
  const result = deriveCliCommands(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

/** Intercept a command's execute to capture parsed opts. */
const interceptOpts = (commands: CliCommand[]) => {
  let received: Record<string, unknown> = {};
  const [cmd] = commands;
  if (!cmd) {
    throw new Error('No commands built');
  }
  const original = cmd.execute;
  cmd.execute = (args, opts) => {
    received = opts;
    return original(args, opts);
  };
  return {
    get received() {
      return received;
    },
  };
};

const requireCommand = (
  program: ReturnType<typeof toCommander>,
  name: string
) => {
  const command = program.commands.find((entry) => entry.name() === name);
  expect(command).toBeDefined();
  if (!command) {
    throw new Error(`Expected command: ${name}`);
  }
  return command;
};

const requireNestedCommand = (
  program: ReturnType<typeof toCommander>,
  path: readonly string[]
) => {
  let current = program;
  for (const segment of path) {
    const next = current.commands.find((entry) => entry.name() === segment);
    expect(next).toBeDefined();
    if (!next) {
      throw new Error(`Expected command path: ${path.join(' ')}`);
    }
    current = next;
  }
  return current;
};

const buildExecutableParentProgram = (calls: string[]) => {
  const topoShow = trail('topo', {
    blaze: () => {
      calls.push('topo');
      return Result.ok('topo');
    },
    input: z.object({}),
  });
  const topoPin = trail('topo.pin', {
    blaze: () => {
      calls.push('topo.pin');
      return Result.ok('topo.pin');
    },
    input: z.object({}),
  });
  const app = makeApp(topoShow, topoPin);
  const commands = buildCommands(app, { onResult: noopResult });
  const program = toCommander(commands, { name: 'test' });
  program.exitOverride();
  return program;
};

const makeCliExit = () =>
  mock((code?: number) => {
    throw new Error(`EXIT ${String(code)}`);
  }) as unknown as typeof process.exit;

const buildFailingProgram = () => {
  const failTrail = trail('fail', {
    blaze: () => Result.ok('ok'),
    input: z.object({}),
  });

  return toCommander([
    {
      args: [],
      execute: () => {
        throw new NotFoundError('missing');
      },
      flags: [],
      intent: 'read' as const,
      path: ['fail'] as const,
      trail: failTrail,
    },
  ]);
};

const withMockedProcess = async (
  run: () => Promise<void> | void
): Promise<void> => {
  const originalExit = process.exit;
  const originalWrite = process.stderr.write;

  process.exit = makeCliExit();
  process.stderr.write = mock(
    () => true
  ) as unknown as typeof process.stderr.write;

  try {
    await run();
  } finally {
    process.exit = originalExit;
    process.stderr.write = originalWrite;
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toCommander command trees', () => {
  test('creates a Commander program with correct commands', () => {
    const t = trail('greet', {
      blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const program = toCommander(commands, { name: 'test-cli' });

    expect(program.name()).toBe('test-cli');
    // Should have the greet subcommand
    const sub = program.commands.find((c) => c.name() === 'greet');
    expect(sub).toBeDefined();
  });

  test('grouped commands create parent/subcommand structure', () => {
    const show = trail('entity.show', {
      blaze: () => Result.ok({}),
      input: z.object({ id: z.string() }),
    });
    const add = trail('entity.add', {
      blaze: () => Result.ok({}),
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(show, add);
    const commands = buildCommands(app);
    const program = toCommander(commands);

    const entityCmd = requireNestedCommand(program, ['entity']);
    const subNames = entityCmd?.commands.map((c) => c.name());
    expect(subNames).toContain('show');
    expect(subNames).toContain('add');
  });

  test('supports arbitrary-depth nested command trees', () => {
    const remove = trail('topo.pin.remove', {
      blaze: () => Result.ok({ removed: true }),
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(remove);
    const commands = buildCommands(app);
    const program = toCommander(commands);

    const topoCmd = requireNestedCommand(program, ['topo']);
    const pinCmd = requireNestedCommand(program, ['topo', 'pin']);
    const removeCmd = requireNestedCommand(program, ['topo', 'pin', 'remove']);

    expect(topoCmd.commands.map((entry) => entry.name())).toContain('pin');
    expect(pinCmd.commands.map((entry) => entry.name())).toContain('remove');
    expect(removeCmd.name()).toBe('remove');
  });

  test('supports executable parents alongside child commands', async () => {
    const calls: string[] = [];
    const program = buildExecutableParentProgram(calls);

    const topoCmd = requireNestedCommand(program, ['topo']);
    expect(topoCmd.commands.map((entry) => entry.name())).toContain('pin');

    await program.parseAsync(['node', 'test', 'topo']);
    await program.parseAsync(['node', 'test', 'topo', 'pin']);

    expect(calls).toEqual(['topo', 'topo.pin']);
  });
});

describe('toCommander validation', () => {
  test('throws when two commands share the same CLI path', () => {
    const duplicatePath = ['topo', 'pin'] as const;
    const commands = [
      {
        args: [],
        execute: async () => await Result.ok('first'),
        flags: [],
        intent: 'read' as const,
        path: duplicatePath,
        trail: trail('first', {
          blaze: () => Result.ok('first'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => await Result.ok('second'),
        flags: [],
        intent: 'read' as const,
        path: duplicatePath,
        trail: trail('second', {
          blaze: () => Result.ok('second'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow('Duplicate CLI path: topo pin');
  });

  test('rejects executable parents with positional args when child commands exist', () => {
    const commands = [
      {
        args: [{ name: 'ref', required: true, variadic: false }],
        execute: async () => await Result.ok('topo'),
        flags: [],
        intent: 'read' as const,
        path: ['topo'] as const,
        trail: trail('topo', {
          blaze: () => Result.ok('topo'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => await Result.ok('topo.pin'),
        flags: [],
        intent: 'read' as const,
        path: ['topo', 'pin'] as const,
        trail: trail('topo.pin', {
          blaze: () => Result.ok('topo.pin'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow(
      'Executable parent commands cannot declare positional args when child commands exist: topo'
    );
  });
});

describe('toCommander option wiring', () => {
  test('flag types map correctly to Commander options', () => {
    const t = trail('search', {
      blaze: () => Result.ok([]),
      input: z.object({
        format: z.enum(['json', 'text']).optional(),
        limit: z.number().optional(),
        query: z.string(),
        tags: z.array(z.string()).optional(),
        verbose: z.boolean().optional(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const program = toCommander(commands);

    const opts = requireCommand(program, 'search').options;
    // 5 flags + negation options for boolean flags
    expect(opts.length).toBeGreaterThanOrEqual(5);

    const formatOpt = opts.find((entry) => entry.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt?.argChoices).toEqual(['json', 'text']);
  });

  test('complex schemas expose structured input options instead of lossy nested flags', () => {
    const t = trail('gist.create', {
      blaze: () => Result.ok('ok'),
      input: z.object({
        files: z.array(
          z.object({
            content: z.string(),
            filename: z.string(),
          })
        ),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const program = toCommander(commands);

    const opts = requireNestedCommand(program, ['gist', 'create']).options;
    const longs = opts.map((option) => option.long);

    expect(longs).toEqual(
      expect.arrayContaining(['--input-file', '--input-json', '--stdin'])
    );
    expect(longs).not.toContain('--files');
  });

  describe('boolean flag negation', () => {
    test('boolean flags get --no-<name> negation options', () => {
      const t = trail('check', {
        blaze: () => Result.ok('ok'),
        input: z.object({ strict: z.boolean() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app);
      const program = toCommander(commands);

      const cmd = requireCommand(program, 'check');
      const strictOpt = cmd.options.find((o) => o.long === '--strict');
      const noStrictOpt = cmd.options.find((o) => o.long === '--no-strict');

      expect(strictOpt).toBeDefined();
      expect(noStrictOpt).toBeDefined();
    });

    test('--no-<flag> sets value to false via parseAsync', async () => {
      const t = trail('check', {
        blaze: () => Result.ok('ok'),
        input: z.object({ strict: z.boolean().default(true) }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, { onResult: noopResult });
      const spy = interceptOpts(commands);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync(['node', 'test', 'check', '--no-strict']);
      expect(spy.received['strict']).toBe(false);
    });

    test('--flag sets boolean value to true via parseAsync', async () => {
      const t = trail('check', {
        blaze: () => Result.ok('ok'),
        input: z.object({ strict: z.boolean().default(false) }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, { onResult: noopResult });
      const spy = interceptOpts(commands);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync(['node', 'test', 'check', '--strict']);
      expect(spy.received['strict']).toBe(true);
    });
  });

  describe('strict number parsing', () => {
    const buildNumberProgram = () => {
      const t = trail('count', {
        blaze: () => Result.ok('ok'),
        input: z.object({ limit: z.number() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();
      program.configureOutput({
        writeErr: noopWrite,
        writeOut: noopWrite,
      });
      // Also configure on the subcommand directly
      for (const sub of program.commands) {
        sub.exitOverride();
        sub.configureOutput({
          writeErr: noopWrite,
          writeOut: noopWrite,
        });
      }
      return program;
    };

    test('rejects partial number like "123abc"', async () => {
      const program = buildNumberProgram();
      let threw = false;
      try {
        await program.parseAsync([
          'node',
          'test',
          'count',
          '--limit',
          '123abc',
        ]);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test('rejects Infinity', async () => {
      const program = buildNumberProgram();
      let threw = false;
      try {
        await program.parseAsync([
          'node',
          'test',
          'count',
          '--limit',
          'Infinity',
        ]);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test('rejects NaN', async () => {
      const program = buildNumberProgram();
      let threw = false;
      try {
        await program.parseAsync(['node', 'test', 'count', '--limit', 'abc']);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    test.each([
      { expected: 42, input: '42' },
      { expected: 3.14, input: '3.14' },
      { expected: -5, input: '-5' },
    ])('accepts valid number "$input"', async ({ expected, input }) => {
      const t = trail('count', {
        blaze: () => Result.ok('ok'),
        input: z.object({ limit: z.number() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, { onResult: noopResult });
      const spy = interceptOpts(commands);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync(['node', 'test', 'count', '--limit', input]);
      expect(spy.received['limit']).toBe(expected);
    });
  });

  test('sets version when provided', () => {
    const t = trail('ping', {
      blaze: () => Result.ok('pong'),
      input: z.object({}),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const program = toCommander(commands, {
      description: 'A test app',
      name: 'myapp',
      version: '1.2.3',
    });

    expect(program.name()).toBe('myapp');
    expect(program.version()).toBe('1.2.3');
    expect(program.description()).toBe('A test app');
  });

  test('error handling maps categories to exit codes', async () => {
    await withMockedProcess(async () => {
      const program = buildFailingProgram();
      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow('EXIT 2');
      expect(process.stderr.write).toHaveBeenCalledWith('Error: missing\n');
    });
  });
});
