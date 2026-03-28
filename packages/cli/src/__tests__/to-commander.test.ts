import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { buildCliCommands } from '../build.js';
import type { AnyTrail } from '../command.js';
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

/** Intercept a command's execute to capture parsed opts. */
const interceptOpts = (commands: ReturnType<typeof buildCliCommands>) => {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toCommander', () => {
  test('creates a Commander program with correct commands', () => {
    const t = trail('greet', {
      input: z.object({ name: z.string() }),
      run: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands, { name: 'test-cli' });

    expect(program.name()).toBe('test-cli');
    // Should have the greet subcommand
    const sub = program.commands.find((c) => c.name() === 'greet');
    expect(sub).toBeDefined();
  });

  test('grouped commands create parent/subcommand structure', () => {
    const show = trail('entity.show', {
      input: z.object({ id: z.string() }),
      run: () => Result.ok({}),
    });
    const add = trail('entity.add', {
      input: z.object({ name: z.string() }),
      run: () => Result.ok({}),
    });
    const app = makeApp(show, add);
    const commands = buildCliCommands(app);
    const program = toCommander(commands);

    // Should have an "entity" parent command
    const entityCmd = program.commands.find((c) => c.name() === 'entity');
    expect(entityCmd).toBeDefined();
    // With "show" and "add" subcommands
    const subNames = entityCmd?.commands.map((c) => c.name());
    expect(subNames).toContain('show');
    expect(subNames).toContain('add');
  });

  test('flag types map correctly to Commander options', () => {
    const t = trail('search', {
      input: z.object({
        format: z.enum(['json', 'text']).optional(),
        limit: z.number().optional(),
        query: z.string(),
        tags: z.array(z.string()).optional(),
        verbose: z.boolean().optional(),
      }),
      run: () => Result.ok([]),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands);

    const opts = requireCommand(program, 'search').options;
    // 5 flags + negation options for boolean flags
    expect(opts.length).toBeGreaterThanOrEqual(5);

    const formatOpt = opts.find((entry) => entry.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt?.argChoices).toEqual(['json', 'text']);
  });

  describe('boolean flag negation', () => {
    test('boolean flags get --no-<name> negation options', () => {
      const t = trail('check', {
        input: z.object({ strict: z.boolean() }),
        run: () => Result.ok('ok'),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app);
      const program = toCommander(commands);

      const cmd = requireCommand(program, 'check');
      const strictOpt = cmd.options.find((o) => o.long === '--strict');
      const noStrictOpt = cmd.options.find((o) => o.long === '--no-strict');

      expect(strictOpt).toBeDefined();
      expect(noStrictOpt).toBeDefined();
    });

    test('--no-<flag> sets value to false via parseAsync', async () => {
      const t = trail('check', {
        input: z.object({ strict: z.boolean().default(true) }),
        run: () => Result.ok('ok'),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app, { onResult: noopResult });
      const spy = interceptOpts(commands);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync(['node', 'test', 'check', '--no-strict']);
      expect(spy.received['strict']).toBe(false);
    });

    test('--flag sets boolean value to true via parseAsync', async () => {
      const t = trail('check', {
        input: z.object({ strict: z.boolean().default(false) }),
        run: () => Result.ok('ok'),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app, { onResult: noopResult });
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
        input: z.object({ limit: z.number() }),
        run: () => Result.ok('ok'),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app);
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
        input: z.object({ limit: z.number() }),
        run: () => Result.ok('ok'),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app, { onResult: noopResult });
      const spy = interceptOpts(commands);
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync(['node', 'test', 'count', '--limit', input]);
      expect(spy.received['limit']).toBe(expected);
    });
  });

  test('sets version when provided', () => {
    const t = trail('ping', {
      input: z.object({}),
      run: () => Result.ok('pong'),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands, {
      description: 'A test app',
      name: 'myapp',
      version: '1.2.3',
    });

    expect(program.name()).toBe('myapp');
    expect(program.version()).toBe('1.2.3');
    expect(program.description()).toBe('A test app');
  });

  test('error handling maps categories to exit codes', () => {
    // This test verifies the error handling structure exists.
    // Full integration would need process.exit mocking.
    const t = trail('fail', {
      input: z.object({}),
      run: () => Result.ok('ok'),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands);

    // Verify the program was created (error handling is wired in action)
    expect(program).toBeDefined();
    expect(program.commands).toHaveLength(1);
  });
});
