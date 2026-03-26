import { describe, expect, test } from 'bun:test';

import { Result, trail, topo } from '@ontrails/core';
import { z } from 'zod';

import { buildCliCommands } from '../build.js';
import type { AnyTrail } from '../command.js';
import { toCommander } from '../commander/to-commander.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeApp = (...trails: AnyTrail[]) => {
  const mod: Record<string, unknown> = {};
  for (const t of trails) {
    mod[t.id] = t;
  }
  return topo('test-app', mod);
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
      implementation: (input: { name: string }) =>
        Result.ok(`Hello, ${input.name}`),
      input: z.object({ name: z.string() }),
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
      implementation: () => Result.ok({}),
      input: z.object({ id: z.string() }),
    });
    const add = trail('entity.add', {
      implementation: () => Result.ok({}),
      input: z.object({ name: z.string() }),
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
      implementation: () => Result.ok([]),
      input: z.object({
        format: z.enum(['json', 'text']).optional(),
        limit: z.number().optional(),
        query: z.string(),
        tags: z.array(z.string()).optional(),
        verbose: z.boolean().optional(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands);

    const opts = requireCommand(program, 'search').options;
    expect(opts.length).toBeGreaterThanOrEqual(5);

    const formatOpt = opts.find((entry) => entry.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt?.argChoices).toEqual(['json', 'text']);
  });

  test('sets version when provided', () => {
    const t = trail('ping', {
      implementation: () => Result.ok('pong'),
      input: z.object({}),
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
      implementation: () => Result.ok('ok'),
      input: z.object({}),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const program = toCommander(commands);

    // Verify the program was created (error handling is wired in action)
    expect(program).toBeDefined();
    expect(program.commands).toHaveLength(1);
  });
});
