import { describe, expect, mock, test } from 'bun:test';

import {
  createTrailContext,
  NotFoundError,
  PermitError,
  Result,
  surfaceOverlay,
  TimeoutError,
  trail,
  topo,
  ValidationError,
} from '@ontrails/core';
import type { AnyTrail, CliCommand } from '@ontrails/cli';
import { deriveCliCommands, outputModePreset } from '@ontrails/cli';
import { z } from 'zod';

import { toCommander } from '../to-commander.js';

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
    implementation: () => {
      calls.push('topo');
      return Result.ok('topo');
    },
    input: z.object({}),
  });
  const topoPin = trail('topo.pin', {
    implementation: () => {
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
    implementation: () => Result.ok('ok'),
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
      implementation: (input: { name: string }) =>
        Result.ok(`Hello, ${input.name}`),
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
      implementation: () => Result.ok({}),
      input: z.object({ id: z.string() }),
    });
    const add = trail('entity.add', {
      implementation: () => Result.ok({}),
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
      implementation: () => Result.ok({ removed: true }),
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

  test('materializes trail-owned aliases that execute the same command', async () => {
    const calls: string[] = [];
    const search = trail('wayfind.search', {
      cli: {
        aliases: ['find'],
      },
      implementation: (input: { query: string }) => {
        calls.push(input.query);
        return Result.ok(input.query);
      },
      input: z.object({ query: z.string() }),
    });
    const app = makeApp(search);
    const commands = buildCommands(app, { onResult: noopResult });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    expect(requireNestedCommand(program, ['wayfind', 'search'])).toBeDefined();
    expect(requireNestedCommand(program, ['wayfind', 'find'])).toBeDefined();

    await program.parseAsync(['node', 'test', 'wayfind', 'find', 'trails']);

    expect(calls).toEqual(['trails']);
  });

  test('materializes surface overlay synonym bindings that execute the same command', async () => {
    const calls: string[] = [];
    const search = trail('wayfind.search', {
      implementation: (input: { query: string }) => {
        calls.push(input.query);
        return Result.ok(input.query);
      },
      input: z.object({ query: z.string() }),
    });
    const app = makeApp(search);
    const commands = buildCommands(app, {
      onResult: noopResult,
      overlays: [surfaceOverlay({ cli: { 'wf.search': 'wayfind.search' } })],
    });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    expect(requireNestedCommand(program, ['wf', 'search'])).toBeDefined();

    await program.parseAsync(['node', 'test', 'wf', 'search', 'trails']);

    expect(calls).toEqual(['trails']);
  });

  test('materializes surface overlay group member commands that dispatch the member trail', async () => {
    const calls: string[] = [];
    const create = trail('gear.create', {
      implementation: (input: { name: string }) => {
        calls.push(`create:${input.name}`);
        return Result.ok({ name: input.name });
      },
      input: z.object({ name: z.string() }),
    });
    const list = trail('gear.list', {
      implementation: () => {
        calls.push('list');
        return Result.ok([]);
      },
      input: z.object({}),
    });
    const app = makeApp(create, list);
    const commands = buildCommands(app, {
      onResult: noopResult,
      overlays: [
        surfaceOverlay({ cli: { tools: ['gear.create', 'gear.list'] } }),
      ],
    });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    // Member identity: the group route is [group, ...memberTrailId segments]
    // and dispatches the member trail with its full contract.
    expect(
      requireNestedCommand(program, ['tools', 'gear', 'create'])
    ).toBeDefined();
    expect(
      requireNestedCommand(program, ['tools', 'gear', 'list'])
    ).toBeDefined();

    await program.parseAsync([
      'node',
      'test',
      'tools',
      'gear',
      'create',
      'tent',
    ]);
    await program.parseAsync(['node', 'test', 'tools', 'gear', 'list']);

    expect(calls).toEqual(['create:tent', 'list']);
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

  test('does not leak executable parent defaults into child commands', async () => {
    const calls: string[] = [];
    const navigate = trail('wayfind.navigate', {
      args: ['target'],
      cli: { path: 'wayfind' },
      implementation: (input: { resources: boolean; target?: string }) => {
        calls.push(
          `navigate:${String(input.target)}:${String(input.resources)}`
        );
        return Result.ok(input);
      },
      input: z
        .object({
          resources: z.boolean().default(false),
          target: z.string().optional(),
        })
        .strict(),
    });
    const search = trail('wayfind.search', {
      implementation: (input: { query: string }) => {
        calls.push(`search:${input.query}`);
        return Result.ok(input);
      },
      input: z.object({ query: z.string() }).strict(),
    });
    const app = makeApp(navigate, search);
    const commands = buildCommands(app, { onResult: noopResult });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'wayfind', 'search', 'trails']);

    expect(calls).toEqual(['search:trails']);
  });

  test('routes parent-only flags before a no-arg child token through parent fallback', async () => {
    const calls: string[] = [];
    const navigate = trail('wayfind.navigate', {
      args: ['target'],
      cli: { path: 'wayfind' },
      implementation: (input: { errors: boolean; target?: string }) => {
        calls.push(`navigate:${String(input.target)}:${String(input.errors)}`);
        return Result.ok(input);
      },
      input: z
        .object({
          errors: z.boolean().default(false),
          target: z.string().optional(),
        })
        .strict(),
    });
    const search = trail('wayfind.search', {
      implementation: () => {
        calls.push('search');
        return Result.ok({});
      },
      input: z.object({}).strict(),
    });
    const app = makeApp(navigate, search);
    const commands = buildCommands(app, { onResult: noopResult });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'wayfind', 'search']);
    await program.parseAsync(['node', 'test', 'wayfind', '--errors', 'search']);

    expect(calls).toEqual(['search', 'navigate:search:true']);
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
          implementation: () => Result.ok('first'),
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
          implementation: () => Result.ok('second'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow('Duplicate CLI path: topo pin');
  });

  test('throws when a value alias collides with another flag', () => {
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async () => await Result.ok('ok'),
        flags: [
          {
            choices: ['json', 'text'],
            name: 'format',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'json', value: 'json' }],
            variadic: false,
          },
          {
            name: 'json',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow(
      'CLI flag alias --json for --format collides on command render'
    );
  });

  test('throws when a value alias collides with a normalized flag key', () => {
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async () => await Result.ok('ok'),
        flags: [
          {
            choices: ['json', 'text'],
            name: 'format',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'jsonOutput', value: 'json' }],
            variadic: false,
          },
          {
            name: 'json-output',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow(
      'CLI flag alias --jsonOutput for --format collides on command render'
    );
  });

  test('throws when a value alias collides with a boolean negation', () => {
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async () => await Result.ok('ok'),
        flags: [
          {
            choices: ['fresh', 'stale'],
            name: 'mode',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'no-cache', value: 'fresh' }],
            variadic: false,
          },
          {
            name: 'cache',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];

    expect(() => toCommander(commands)).toThrow(
      'CLI flag alias --no-cache for --mode collides on command render'
    );
  });

  test('routes child commands before parent positional args', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'ref', required: false, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(
            `survey:${String(args['ref'] ?? `flag:${String(args['id'])}`)}`
          );
          return await Result.ok('survey');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'ref', required: true, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey.trail:${String(args['ref'])}`);
          return await Result.ok('survey.trail');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'survey', 'shared']);
    await program.parseAsync(['node', 'test', 'survey', 'trail', 'shared']);

    expect(calls).toEqual(['survey:shared', 'survey.trail:shared']);
  });

  test('routes bare child-name tokens to parent positional lookup', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey:${String(args['id'])}`);
          return await Result.ok('survey');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: true, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey.trail:${String(args['id'])}`);
          return await Result.ok('survey.trail');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'survey', 'trail']);
    await program.parseAsync(['node', 'test', 'survey', 'trail', 'shared']);

    expect(calls).toEqual(['survey:trail', 'survey.trail:shared']);
  });

  test('keeps child command tokens out of child positionals when structured input selects the child', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [
          { name: 'from', required: false, variadic: false },
          { name: 'to', required: false, variadic: false },
        ],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`regrade:${String(args['from'])}:${String(args['to'])}`);
          return await Result.ok('regrade');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'write' as const,
        path: ['regrade'] as const,
        trail: trail('regrade', {
          implementation: () => Result.ok('regrade'),
          input: z.object({}),
        }),
      },
      {
        args: [
          { name: 'from', required: false, variadic: false },
          { name: 'to', required: false, variadic: false },
        ],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `regrade.plan:${String(args['from'])}:${String(args['to'])}:${String(
              opts['inputJson']
            )}`
          );
          return await Result.ok('regrade.plan');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'write' as const,
        path: ['regrade', 'plan'] as const,
        trail: trail('plan.regrade', {
          implementation: () => Result.ok('regrade.plan'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'regrade',
      'plan',
      '--input-json',
      '{"from":"@ontrails/warden/ast","to":"@ontrails/source"}',
    ]);
    await program.parseAsync([
      'node',
      'test',
      'regrade',
      'plan',
      'plan',
      '@ontrails/source',
      '--input-json',
      '{"from":"structured"}',
    ]);

    expect(calls).toEqual([
      'regrade.plan:undefined:undefined:{"from":"@ontrails/warden/ast","to":"@ontrails/source"}',
      'regrade.plan:plan:@ontrails/source:{"from":"structured"}',
    ]);
  });

  test('matches Commander value consumption before resolving a structured-input child path', async () => {
    const calls: string[] = [];
    const sharedFlags = [
      {
        name: 'limit',
        required: false,
        type: 'number' as const,
        variadic: false,
      },
      {
        name: 'tags',
        required: false,
        type: 'string[]' as const,
        variadic: true,
      },
      {
        name: 'input-json',
        required: false,
        role: 'structured-input' as const,
        type: 'string' as const,
        variadic: false,
      },
    ];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => {
          calls.push('survey');
          return await Result.ok('survey');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(opts['limit'])}:${JSON.stringify(opts['tags'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--limit',
      '-1',
      'trail',
      '--input-json',
      '{}',
    ]);
    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      '--input-json',
      '{}',
      '--tags',
      'x',
      'survey',
      'trail',
    ]);

    expect(calls).toEqual([
      'survey.trail:-1:undefined',
      'survey.trail:undefined:["x","survey","trail"]',
    ]);
  });

  test('resolves pre-child option arity against the parent command', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => {
          calls.push('survey');
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'scope',
            required: true,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'module',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => {
          calls.push('survey.trail');
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'scope',
            required: true,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'module',
            required: true,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--scope',
      'prod',
      '--module',
      'trail',
      '--input-json',
      '{}',
    ]);

    expect(calls).toEqual(['survey.trail']);
  });

  test('ends variadic collection after an inline option value', async () => {
    const calls: string[] = [];
    const sharedFlags = [
      {
        name: 'tags',
        required: false,
        type: 'string[]' as const,
        variadic: true,
      },
      {
        name: 'input-json',
        required: false,
        role: 'structured-input' as const,
        type: 'string' as const,
        variadic: false,
      },
    ];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => {
          calls.push('survey');
          return await Result.ok('survey');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => {
          calls.push('survey.trail');
          return await Result.ok('survey.trail');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--tags=x',
      'trail',
      '--input-json',
      '{}',
    ]);

    expect(calls).toEqual(['survey.trail']);
  });

  test('does not treat grandparent structured input as an immediate parent signal', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => {
          calls.push('a');
          return await Result.ok('a');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['a'] as const,
        trail: trail('a', {
          implementation: () => Result.ok('a'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => {
          calls.push('a.b');
          return await Result.ok('a.b');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['a', 'b'] as const,
        trail: trail('a.b', {
          implementation: () => Result.ok('a.b'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => {
          calls.push('a.b.c');
          return await Result.ok('a.b.c');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['a', 'b', 'c'] as const,
        trail: trail('a.b.c', {
          implementation: () => Result.ok('a.b.c'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'a',
      '--input-json',
      '{}',
      'b',
      'c',
    ]);

    expect(calls).toEqual(['a.b.c']);
  });

  test('does not treat an option value as child-owned structured input', async () => {
    const calls: string[] = [];
    const sharedFlags = [
      {
        name: 'input-json',
        required: false,
        role: 'structured-input' as const,
        type: 'string' as const,
        variadic: false,
      },
      {
        name: 'label',
        required: true,
        type: 'string' as const,
        variadic: false,
      },
    ];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => {
          calls.push('survey.trail');
          return await Result.ok('survey.trail');
        },
        flags: sharedFlags,
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--input-json',
      '{}',
      'trail',
      '--label',
      '--input-json',
    ]);

    expect(calls).toEqual(['survey:trail:{}']);
  });

  test('preserves parent option arity after a child path', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [],
        execute: async () => {
          calls.push('survey');
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => {
          calls.push('survey.trail');
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();
    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      '--module',
      '--input-json',
      '{}',
    ]);

    expect(calls).toEqual(['survey.trail']);
  });

  test('keeps parent-owned input-json flags on bare child-name fallback', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'label',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
          {
            name: 'label',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--label',
      'trail',
      '--input-json',
      'parent-value',
      'trail',
    ]);

    expect(calls).toEqual(['survey:trail:parent-value']);
  });

  test('does not treat schema-derived input-json flags as structured input', async () => {
    const calls: string[] = [];
    const sharedFlag = {
      name: 'input-json',
      required: false,
      type: 'string' as const,
      variadic: false,
    };
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey');
        },
        flags: [sharedFlag],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [sharedFlag],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      '--input-json',
      'parent-value',
    ]);

    expect(calls).toEqual(['survey:trail:parent-value']);
  });

  test('recognizes child structured input when an ancestor owns the same token', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey:${String(args['id'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['inputJson'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      '--input-json',
      '{"id":"shared"}',
    ]);

    expect(calls).toEqual(['survey.trail:undefined:{"id":"shared"}']);
  });

  test('recognizes compact short structured input after the child path', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey:${String(args['id'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'verbose',
            required: false,
            short: 'v',
            type: 'boolean' as const,
            variadic: false,
          },
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            short: 'i',
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(`survey.trail:${String(opts['inputJson'])}`);
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'verbose',
            required: false,
            short: 'v',
            type: 'boolean' as const,
            variadic: false,
          },
          {
            name: 'input-json',
            required: false,
            role: 'structured-input' as const,
            short: 'i',
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    for (const compactInput of ['-i=equals', '-icompact', '-vi{}']) {
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();
      await program.parseAsync([
        'node',
        'test',
        'survey',
        'trail',
        compactInput,
      ]);
    }

    expect(calls).toEqual([
      'survey.trail:=equals',
      'survey.trail:compact',
      'survey.trail:{}',
    ]);
  });

  test('parent flag aliases can target IDs that match child command names', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(`survey:${String(args['id'] ?? opts['id'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'id',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: true, variadic: false }],
        execute: async (args: Record<string, unknown>) => {
          calls.push(`survey.trail:${String(args['id'])}`);
          return await Result.ok('survey.trail');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'survey', '--id=trail']);

    expect(calls).toEqual(['survey:trail']);
  });

  test('passes child flags when an executable parent has fallback routing', async () => {
    let received:
      | {
          readonly args: Record<string, unknown>;
          readonly opts: Record<string, unknown>;
        }
      | undefined;
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => await Result.ok('survey'),
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: true, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = { args, opts };
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'json',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      'hello',
      '--module',
      './src/app.ts',
      '--json',
    ]);

    expect(received).toEqual({
      args: { id: 'hello' },
      opts: { json: true, module: './src/app.ts' },
    });
  });

  test('does not route child-only nested command flags through parent fallback', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(`survey:${String(args['id'])}:${String(opts['module'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['format'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'format',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'survey', 'trail', '--format']);

    expect(calls).toEqual(['survey.trail:undefined:true']);
  });

  test('routes parent flags before a bare child-name token through parent fallback', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(`survey:${String(args['id'])}:${String(opts['module'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['module'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--module',
      './src/app.ts',
      'trail',
    ]);

    expect(calls).toEqual(['survey:trail:./src/app.ts']);
  });

  test('keeps repeatable choice arrays from consuming the bare child token', async () => {
    let received:
      | {
          readonly args: Record<string, unknown>;
          readonly opts: Record<string, unknown>;
        }
      | undefined;
    const commands = [
      {
        args: [{ name: 'target', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = { args, opts };
          return await Result.ok('wayfind');
        },
        flags: [
          {
            choices: ['errors', 'examples'],
            default: [],
            name: 'include',
            required: false,
            type: 'string[]' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['wayfind'] as const,
        trail: trail('wayfind.navigate', {
          implementation: () => Result.ok('wayfind'),
          input: z.object({}),
        }),
      },
      {
        args: [],
        execute: async () => await Result.ok('search'),
        flags: [],
        intent: 'read' as const,
        path: ['wayfind', 'search'] as const,
        trail: trail('wayfind.search', {
          implementation: () => Result.ok('search'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'wayfind',
      '--include',
      'examples',
      '--include',
      'errors',
      'search',
    ]);

    expect(received).toEqual({
      args: { target: 'search' },
      opts: { include: ['examples', 'errors'] },
    });
  });

  test('routes matching trailing parent flags through parent fallback', async () => {
    const calls: string[] = [];
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(`survey:${String(args['id'])}:${String(opts['module'])}`);
          return await Result.ok('survey');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async (
          args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          calls.push(
            `survey.trail:${String(args['id'])}:${String(opts['module'])}`
          );
          return await Result.ok('survey.trail');
        },
        flags: [
          {
            name: 'module',
            required: false,
            type: 'string' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      'trail',
      '--module',
      './src/app.ts',
    ]);

    expect(calls).toEqual(['survey:trail:./src/app.ts']);
  });

  test('passes parent-supplied global flags to child commands', async () => {
    let received: Record<string, unknown> | undefined;
    const commands = [
      {
        args: [{ name: 'id', required: false, variadic: false }],
        execute: async () => await Result.ok('survey'),
        flags: [
          {
            name: 'json',
            required: false,
            type: 'boolean' as const,
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['survey'] as const,
        trail: trail('survey', {
          implementation: () => Result.ok('survey'),
          input: z.object({}),
        }),
      },
      {
        args: [{ name: 'id', required: true, variadic: false }],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = opts;
          return await Result.ok('survey.trail');
        },
        flags: [],
        intent: 'read' as const,
        path: ['survey', 'trail'] as const,
        trail: trail('survey.trail', {
          implementation: () => Result.ok('survey.trail'),
          input: z.object({}),
        }),
      },
    ];

    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'survey',
      '--json',
      'trail',
      'hello',
    ]);

    expect(received).toEqual({ json: true });
  });

  test('rejects parent-owned non-global flags on child commands', async () => {
    await withMockedProcess(async () => {
      const commands = [
        {
          args: [{ name: 'target', required: false, variadic: false }],
          execute: async () => await Result.ok('wayfind'),
          flags: [
            {
              choices: ['summary', 'contract'],
              name: 'view',
              required: false,
              type: 'string' as const,
              variadic: false,
            },
          ],
          intent: 'read' as const,
          path: ['wayfind'] as const,
          trail: trail('wayfind.navigate', {
            implementation: () => Result.ok('wayfind'),
            input: z.object({}),
          }),
        },
        {
          args: [{ name: 'selector', required: true, variadic: false }],
          execute: async () => await Result.ok('wayfind.file'),
          flags: [],
          intent: 'read' as const,
          path: ['wayfind', 'file'] as const,
          trail: trail('wayfind.file', {
            implementation: () => Result.ok('wayfind.file'),
            input: z.object({}),
          }),
        },
      ];

      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await expect(
        program.parseAsync([
          'node',
          'test',
          'wayfind',
          'file',
          'apps/trails/src/app.ts',
          '--view',
          'contract',
        ])
      ).rejects.toThrow('EXIT 1');

      expect(process.stderr.write).toHaveBeenCalledWith(
        'Error: Unsupported option for this CLI command.\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        '  - --view belongs to "wayfind" and is not supported by "wayfind file". (wayfind.file)\n'
      );
    });
  });
});

describe('toCommander option wiring', () => {
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
    const commands = buildCommands(app);
    const program = toCommander(commands);

    const opts = requireCommand(program, 'search').options;
    // 5 flags + negation options for boolean flags
    expect(opts.length).toBeGreaterThanOrEqual(5);

    const formatOpt = opts.find((entry) => entry.long === '--format');
    expect(formatOpt).toBeDefined();
    expect(formatOpt?.argChoices).toEqual(['json', 'text']);
  });

  test('value aliases parse as canonical enum flag values', async () => {
    let received: Record<string, unknown> | undefined;
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = opts;
          return await Result.ok('ok');
        },
        flags: [
          {
            choices: ['json', 'text'],
            name: 'format',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'json', value: 'json' }],
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'render', '--json']);

    expect(received).toEqual({ format: 'json' });
  });

  test('canonical enum flags still parse when value aliases exist', async () => {
    let received: Record<string, unknown> | undefined;
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = opts;
          return await Result.ok('ok');
        },
        flags: [
          {
            choices: ['json', 'text'],
            name: 'format',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'json', value: 'json' }],
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync(['node', 'test', 'render', '--format', 'text']);

    expect(received).toEqual({ format: 'text' });
  });

  test('default-valued aliases override structured input', async () => {
    let observed: unknown;
    const t = trail('render', {
      fields: {
        outputFormat: { aliases: true },
      },
      implementation: (input) => {
        observed = input;
        return Result.ok(input);
      },
      input: z.object({
        outputFormat: z.enum(['json', 'text']).default('text'),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app, { onResult: noopResult });
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await program.parseAsync([
      'node',
      'test',
      'render',
      '--input-json',
      '{"outputFormat":"json"}',
      '--text',
    ]);

    expect(observed).toEqual({ outputFormat: 'text' });
  });

  test('value aliases reject simultaneous canonical enum flags', async () => {
    let received: Record<string, unknown> | undefined;
    const commands: CliCommand[] = [
      {
        args: [],
        execute: async (
          _args: Record<string, unknown>,
          opts: Record<string, unknown>
        ) => {
          received = opts;
          return await Result.ok('ok');
        },
        flags: [
          {
            choices: ['json', 'text'],
            name: 'format',
            required: false,
            type: 'string' as const,
            valueAliases: [{ name: 'json', value: 'json' }],
            variadic: false,
          },
        ],
        intent: 'read' as const,
        path: ['render'] as const,
        trail: trail('render', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        }),
      },
    ];
    const program = toCommander(commands, { name: 'test' });
    program.exitOverride();

    await withMockedProcess(async () => {
      await expect(
        program.parseAsync([
          'node',
          'test',
          'render',
          '--json',
          '--format',
          'text',
        ])
      ).rejects.toThrow('EXIT');
    });

    expect(received).toBeUndefined();
  });

  test('complex schemas expose structured input options instead of lossy nested flags', () => {
    const t = trail('gist.create', {
      implementation: () => Result.ok('ok'),
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

    expect(longs).toEqual(expect.arrayContaining(['--input', '--input-json']));
    expect(longs).not.toContain('--files');
  });

  describe('boolean flag negation', () => {
    test('boolean flags get --no-<name> negation options', () => {
      const t = trail('check', {
        implementation: () => Result.ok('ok'),
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
        implementation: () => Result.ok('ok'),
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
        implementation: () => Result.ok('ok'),
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

    test('explicit --no-<flag> overrides structured input through Commander', async () => {
      let observed: unknown;
      const t = trail('regrade-like', {
        implementation: (input) => {
          observed = input;
          return Result.ok(input);
        },
        input: z.object({
          apply: z.boolean().default(false),
          query: z.string(),
        }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, { onResult: noopResult });
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync([
        'node',
        'test',
        'regrade-like',
        '--input-json',
        '{"apply":true,"query":"from json"}',
        '--no-apply',
      ]);

      expect(observed).toEqual({
        apply: false,
        query: 'from json',
      });
    });

    test('omitted --dry-run preserves a createContext dryRun default through Commander', async () => {
      let observed: boolean | undefined;
      const t = trail('thing.delete', {
        implementation: (_input, ctx) => {
          observed = ctx.dryRun;
          return Result.ok({ ok: true });
        },
        input: z.object({ id: z.string() }),
        intent: 'destroy',
        output: z.object({ ok: z.boolean() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, {
        createContext: () => createTrailContext({ dryRun: true }),
        onResult: noopResult,
      });
      const program = toCommander(commands, { name: 'test' });
      program.exitOverride();

      await program.parseAsync([
        'node',
        'test',
        'thing',
        'delete',
        '--id',
        'abc',
      ]);

      expect(observed).toBe(true);
    });
  });

  describe('strict number parsing', () => {
    const buildNumberProgram = () => {
      const t = trail('count', {
        implementation: () => Result.ok('ok'),
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
        implementation: () => Result.ok('ok'),
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
      implementation: () => Result.ok('pong'),
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

  test('error handling hides unknown error messages from stderr', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new Error('token=secret');
          },
          flags: [],
          intent: 'read' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow('EXIT 8');
      expect(process.stderr.write).toHaveBeenCalledWith(
        'Error: Internal server error\n'
      );
    });
  });

  test('error handling emits structured stderr under --json', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new TimeoutError(
              'Timed out waiting for the topo store lock',
              {
                context: {
                  operation: 'write',
                  reason: 'sqlite-lock-contention',
                  resource: 'topo-store',
                },
              }
            );
          },
          flags: [
            {
              name: 'json',
              required: false,
              type: 'boolean' as const,
              variadic: false,
            },
          ],
          intent: 'write' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail', '--json'], {
          from: 'node',
        })
      ).rejects.toThrow('EXIT 5');
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"category": "timeout"')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"code": 5')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"ok": false')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"reason": "sqlite-lock-contention"')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"resource": "topo-store"')
      );
    });
  });

  test('error handling treats value alias output modes as explicit', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new TimeoutError('Timed out waiting for output');
          },
          flags: [
            {
              choices: ['text', 'json'],
              default: 'text',
              name: 'output',
              required: false,
              type: 'string' as const,
              valueAliases: [{ name: 'json', value: 'json' }],
              variadic: false,
            },
          ],
          intent: 'write' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail', '--json'], {
          from: 'node',
        })
      ).rejects.toThrow('EXIT 5');
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"category": "timeout"')
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        expect.stringContaining('"ok": false')
      );
    });
  });

  test('error handling honors topo-derived JSON env mode', async () => {
    const previous = process.env['TEST_APP_JSON'];
    process.env['TEST_APP_JSON'] = '1';

    try {
      await withMockedProcess(async () => {
        const failTrail = trail('fail', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        });
        const program = toCommander(
          [
            {
              args: [],
              execute: () => {
                throw new TimeoutError(
                  'Timed out waiting for the topo store lock'
                );
              },
              flags: outputModePreset(),
              intent: 'write' as const,
              path: ['fail'] as const,
              trail: failTrail,
            },
          ],
          { name: 'demo', topoName: 'test-app' }
        );

        await expect(
          program.parseAsync(['node', 'test', 'fail'], {
            from: 'node',
          })
        ).rejects.toThrow('EXIT 5');
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringContaining('"category": "timeout"')
        );
        expect(process.stderr.write).toHaveBeenCalledWith(
          expect.stringContaining('"ok": false')
        );
      });
    } finally {
      if (previous === undefined) {
        delete process.env['TEST_APP_JSON'];
      } else {
        process.env['TEST_APP_JSON'] = previous;
      }
    }
  });

  test('error handling lets explicit text output override topo env mode', async () => {
    const previous = process.env['TEST_APP_JSON'];
    process.env['TEST_APP_JSON'] = '1';

    try {
      await withMockedProcess(async () => {
        const failTrail = trail('fail', {
          implementation: () => Result.ok('ok'),
          input: z.object({}),
        });
        const program = toCommander(
          [
            {
              args: [],
              execute: () => {
                throw new TimeoutError(
                  'Timed out waiting for the topo store lock'
                );
              },
              flags: outputModePreset(),
              intent: 'write' as const,
              path: ['fail'] as const,
              trail: failTrail,
            },
          ],
          { name: 'test-app' }
        );

        await expect(
          program.parseAsync(['node', 'test', 'fail', '--output', 'text'], {
            from: 'node',
          })
        ).rejects.toThrow('EXIT 5');
        expect(process.stderr.write).toHaveBeenCalledWith(
          'Error: Timed out waiting for the topo store lock\n'
        );
        expect(process.stderr.write).not.toHaveBeenCalledWith(
          expect.stringContaining('"category": "timeout"')
        );
      });
    } finally {
      if (previous === undefined) {
        delete process.env['TEST_APP_JSON'];
      } else {
        process.env['TEST_APP_JSON'] = previous;
      }
    }
  });

  test('error handling lists validation issues from error context', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new ValidationError(
              'Topo validation failed with 2 issue(s)',
              {
                context: {
                  issues: [
                    {
                      message: 'Resource "note-store" is not in the topo',
                      rule: 'resource-exists',
                      trailId: 'notes.add',
                    },
                    {
                      message: 'Resource "note-store" is not in the topo',
                      rule: 'resource-exists',
                      trailId: 'notes.list',
                    },
                  ],
                },
              }
            );
          },
          flags: [],
          intent: 'read' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow(/EXIT/);
      expect(process.stderr.write).toHaveBeenCalledWith(
        'Error: Topo validation failed with 2 issue(s)\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        '  - Resource "note-store" is not in the topo (notes.add)\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        '  - Resource "note-store" is not in the topo (notes.list)\n'
      );
    });
  });

  test('error handling names required permit scopes and the --permit form', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new PermitError('No permit provided', {
              context: { required: ['project:write'], trailId: 'create' },
            });
          },
          flags: [],
          intent: 'read' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow(/EXIT/);
      expect(process.stderr.write).toHaveBeenCalledWith(
        'Error: No permit provided\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        '  Required scopes: project:write\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        `  Grant with: --permit '{"id":"<caller-id>","scopes":["project:write"]}'\n`
      );
    });
  });

  test('error handling JSON-escapes permit scopes in the grant form', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new PermitError('No permit provided', {
              context: { required: ['weird"scope'] },
            });
          },
          flags: [],
          intent: 'read' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow(/EXIT/);
      expect(process.stderr.write).toHaveBeenCalledWith(
        `  Grant with: --permit '{"id":"<caller-id>","scopes":["weird\\"scope"]}'\n`
      );
    });
  });

  test('error handling builds the permit grant from all required scopes', async () => {
    await withMockedProcess(async () => {
      const failTrail = trail('fail', {
        implementation: () => Result.ok('ok'),
        input: z.object({}),
      });
      const program = toCommander([
        {
          args: [],
          execute: () => {
            throw new PermitError('Missing scopes: project:write', {
              context: {
                missing: ['project:write'],
                required: ['project:read', 'project:write'],
              },
            });
          },
          flags: [],
          intent: 'read' as const,
          path: ['fail'] as const,
          trail: failTrail,
        },
      ]);

      await expect(
        program.parseAsync(['node', 'test', 'fail'], { from: 'node' })
      ).rejects.toThrow(/EXIT/);
      expect(process.stderr.write).toHaveBeenCalledWith(
        '  Required scopes: project:read, project:write\n'
      );
      expect(process.stderr.write).toHaveBeenCalledWith(
        `  Grant with: --permit '{"id":"<caller-id>","scopes":["project:read","project:write"]}'\n`
      );
    });
  });
});
