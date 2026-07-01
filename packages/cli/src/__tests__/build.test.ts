import { describe, expect, test } from 'bun:test';

import {
  AuthError,
  Result,
  SURFACE_KEY,
  ValidationError,
  createTrailContext,
  resource,
  signal,
  trail,
  topo,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import type {
  ActionResultContext,
  ResolveCliPermitFromToken,
} from '../build.js';
import { deriveCliCommands } from '../build.js';
import type { AnyTrail, CliCommand } from '../command.js';
import { devPermitPreset, permitPreset, tokenPreset } from '../flags.js';

const DEV_PERMIT_FLAG = ['--dev', '-permit'].join('');

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

const dbResource = resource('db.main', {
  create: () =>
    Result.ok({
      name: 'factory',
    }),
});

const orderPlaced = signal('order.placed', {
  payload: z.object({ orderId: z.string() }),
});

const buildCommands = (...args: Parameters<typeof deriveCliCommands>) => {
  const result = deriveCliCommands(...args);
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const authPresets = () => [permitPreset(), tokenPreset(), devPermitPreset()];

const requireCommand = (commands: CliCommand[]) => {
  const [command] = commands;
  expect(command).toBeDefined();
  if (!command) {
    throw new Error('Expected command');
  }
  return command;
};

const requireFire = (fire: TrailContext['fire']) => {
  if (!fire) {
    throw new Error('Expected ctx.fire to be bound');
  }
  return fire;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildCommands path derivation', () => {
  test('builds commands from a simple app with one trail', () => {
    const t = trail('greet', {
      blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
      input: z.object({ name: z.string() }),
    });
    const app = topo('test-app', { 'db.main': dbResource, [t.id]: t });
    const commands = buildCommands(app);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.path).toEqual(['greet']);
  });

  test('builds full ordered paths from dotted trail IDs', () => {
    const show = trail('entity.show', {
      blaze: (input: { id: string }) => Result.ok({ id: input.id }),
      input: z.object({ id: z.string() }),
    });
    const add = trail('entity.add', {
      blaze: (input: { name: string }) => Result.ok({ name: input.name }),
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(show, add);
    const commands = buildCommands(app);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.path).toEqual(['entity', 'show']);
    expect(commands[1]?.path).toEqual(['entity', 'add']);
  });

  test('preserves deeper CLI hierarchies from multi-dot trail IDs', () => {
    const remove = trail('topo.pin.remove', {
      blaze: () => Result.ok({ removed: true }),
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(remove);
    const commands = buildCommands(app);

    expect(commands[0]?.path).toEqual(['topo', 'pin', 'remove']);
  });

  test('uses trail-owned CLI canonical path overrides', () => {
    const search = trail('wayfind.search', {
      blaze: () => Result.ok([]),
      cli: 'find',
      input: z.object({ query: z.string() }),
    });
    const app = makeApp(search);
    const commands = buildCommands(app);

    expect(commands[0]?.path).toEqual(['find']);
    expect(commands[0]?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['find'],
        source: 'trail',
        target: 'wayfind.search',
      },
    ]);
  });

  test('projects trail-owned and surface-owned CLI aliases as routes', () => {
    const search = trail('wayfind.search', {
      blaze: () => Result.ok([]),
      cli: {
        aliases: ['find'],
      },
      input: z.object({ query: z.string() }),
    });
    const app = makeApp(search);
    const commands = buildCommands(app, {
      aliases: {
        'wayfind.search': [['wf', 'search']],
      },
    });

    expect(commands[0]?.path).toEqual(['wayfind', 'search']);
    expect(commands[0]?.routes).toEqual([
      {
        kind: 'canonical',
        path: ['wayfind', 'search'],
        source: 'derived',
        target: 'wayfind.search',
      },
      {
        kind: 'alias',
        path: ['wayfind', 'find'],
        source: 'trail',
        target: 'wayfind.search',
      },
      {
        kind: 'alias',
        path: ['wf', 'search'],
        source: 'surface',
        target: 'wayfind.search',
      },
    ]);
  });

  test('rejects surface-owned aliases for unknown trail ids', () => {
    const search = trail('wayfind.search', {
      blaze: () => Result.ok([]),
      input: z.object({ query: z.string() }),
    });
    const result = deriveCliCommands(makeApp(search), {
      aliases: {
        'wayfind.serch': [['wf', 'search']],
      },
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toContain(
        'CLI command aliases target unknown trail "wayfind.serch"'
      );
    }
  });

  test('derives flags from input schema', () => {
    const t = trail('search', {
      blaze: () => Result.ok([]),
      input: z.object({
        limit: z.number().optional(),
        query: z.string(),
      }),
    });
    const app = topo('test-app', {
      'db.main': dbResource,
      [t.id]: t,
    });
    const { flags, args } = requireCommand(buildCommands(app));

    // Single required string → auto-promoted to positional arg + kept as flag alias
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({ name: 'query', required: false });
    expect(flags.find((f) => f.name === 'query')).toBeDefined();
    const limitFlag = flags.find((f) => f.name === 'limit');
    expect(limitFlag?.required).toBe(false);
  });

  test('passes field value aliases into derived flags', () => {
    const fields = {
      format: { aliases: true },
    } as const;
    const t = trail('render', {
      blaze: (input: { format: 'agent-json' | 'markdown' }) =>
        Result.ok(input.format),
      fields,
      input: z.object({
        format: z.enum(['markdown', 'agent-json']).default('markdown'),
      }),
    });
    const app = makeApp(t);
    const { flags } = requireCommand(buildCommands(app));

    expect(flags.find((flag) => flag.name === 'format')?.valueAliases).toEqual([
      { name: 'markdown', value: 'markdown' },
      { name: 'agent-json', value: 'agent-json' },
    ]);
  });

  test('adds structured input flags for non-empty object schemas', () => {
    const t = trail('search', {
      blaze: () => Result.ok([]),
      input: z.object({
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const { flags, args } = requireCommand(buildCommands(app));

    // query is auto-promoted to positional AND kept as --query flag alias
    expect(args).toHaveLength(1);
    expect(args[0]).toMatchObject({ name: 'query' });
    expect(flags.find((f) => f.name === 'query')).toBeDefined();
  });

  test('adds --dry-run for destroy intent trails', () => {
    const t = trail('entity.delete', {
      blaze: () => Result.ok(),
      input: z.object({ id: z.string() }),
      intent: 'destroy',
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const dryRunFlag = commands[0]?.flags.find((f) => f.name === 'dry-run');
    expect(dryRunFlag).toBeDefined();
    expect(dryRunFlag?.type).toBe('boolean');
  });

  test('adds --dry-run for write intent trails', () => {
    const t = trail('entity.create', {
      blaze: () => Result.ok({ id: 'x' }),
      input: z.object({ name: z.string() }),
      intent: 'write',
      output: z.object({ id: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const dryRunFlag = commands[0]?.flags.find((f) => f.name === 'dry-run');
    expect(dryRunFlag).toBeDefined();
    expect(dryRunFlag?.type).toBe('boolean');
  });

  test('does not add --dry-run for read intent trails', () => {
    const t = trail('entity.show', {
      blaze: (input: { id: string }) => Result.ok({ id: input.id }),
      input: z.object({ id: z.string() }),
      intent: 'read',
      output: z.object({ id: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);
    const dryRunFlag = commands[0]?.flags.find((f) => f.name === 'dry-run');
    expect(dryRunFlag).toBeUndefined();
  });
});

describe('buildCommands execution', () => {
  describe('onResult callback', () => {
    test('receives correct context', async () => {
      let captured: ActionResultContext | undefined;
      const t = trail('ping', {
        blaze: (input: { msg: string }) => Result.ok(input.msg),
        input: z.object({ msg: z.string() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, {
        onResult: (ctx) => {
          captured = ctx;
          return Promise.resolve();
        },
      });

      await commands[0]?.execute({}, { msg: 'hello' });

      expect(captured).toBeDefined();
      expect(captured?.trail.id).toBe('ping');
      expect(captured?.input).toEqual({ msg: 'hello' });
      expect(captured?.result.isOk()).toBe(true);
    });

    test('receives validated (coerced) input on success', async () => {
      let captured: ActionResultContext | undefined;
      const t = trail('coerce', {
        blaze: (input: { count: number }) => Result.ok(input.count),
        input: z.object({ count: z.coerce.number() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, {
        onResult: (ctx) => {
          captured = ctx;
          return Promise.resolve();
        },
      });

      // Pass count as a string — z.coerce.number() should transform it to 42
      await commands[0]?.execute({}, { count: '42' });

      expect(captured).toBeDefined();
      expect(captured?.result.isOk()).toBe(true);
      // onResult should receive the coerced number, not the raw string
      expect(captured?.input).toEqual({ count: 42 });
    });

    test('receives merged args+flags as input on merge failure', async () => {
      // Regression: the error path previously passed only parsedFlags, dropping parsedArgs.
      let captured: ActionResultContext | undefined;
      const t = trail('fail-merge', {
        blaze: () => Result.ok('ok'),
        // z.coerce.number on a non-numeric value will fail validation later,
        // but we need merge itself to fail — pass invalid JSON via input-json to
        // trigger a merge error before execution.
        input: z.object({ name: z.string() }),
      });
      const app = makeApp(t);
      const commands = buildCommands(app, {
        onResult: (ctx) => {
          captured = ctx;
          return Promise.resolve();
        },
      });

      // 'input-json' with invalid JSON causes safeMergeInput to throw and return Err.
      // Pass an arg too so we can confirm it is not dropped.
      await commands[0]?.execute(
        { name: 'from-arg' },
        { 'input-json': '{bad json}' }
      );

      expect(captured).toBeDefined();
      expect(captured?.result.isErr()).toBe(true);
      // input on the error path must be merged args + flags, not just flags.
      expect(captured?.input).toMatchObject({
        'input-json': '{bad json}',
        name: 'from-arg',
      });
    });
  });

  test('validates input before calling implementation', async () => {
    let implCalled = false;
    const t = trail('strict', {
      blaze: () => {
        implCalled = true;
        return Result.ok('done');
      },
      input: z.object({ name: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    // Pass invalid input (missing name)
    const [cmd] = commands;
    expect(cmd).toBeDefined();
    const result = await cmd?.execute({}, {});
    expect(result).toBeDefined();
    expect(result?.isErr()).toBe(true);
    expect(implCalled).toBe(false);
  });

  test('applies layers in order', async () => {
    const order: string[] = [];
    const t = trail('layered', {
      blaze: (input: { x: string }) => {
        order.push('impl');
        return Result.ok(input.x);
      },
      input: z.object({ x: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app, {
      layers: [
        {
          name: 'outer',
          wrap: (_trail, impl) => async (input, ctx) => {
            order.push('outer-before');
            const r = await impl(input, ctx);
            order.push('outer-after');
            return r;
          },
        },
        {
          name: 'inner',
          wrap: (_trail, impl) => async (input, ctx) => {
            order.push('inner-before');
            const r = await impl(input, ctx);
            order.push('inner-after');
            return r;
          },
        },
      ],
    });

    await commands[0]?.execute({}, { x: 'test' });
    expect(order).toEqual([
      'outer-before',
      'inner-before',
      'impl',
      'inner-after',
      'outer-after',
    ]);
  });

  test('composes topo, surface, and trail layers in C → B → A → blaze order', async () => {
    const order: string[] = [];

    const trailLayer = {
      name: 'A',
      wrap:
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- declarative shape
        (_t: unknown, impl: (i: unknown, c: unknown) => Promise<unknown>) =>
          async (i: unknown, c: unknown) => {
            order.push('A:before');
            const r = (await impl(i, c)) as { isOk: () => boolean };
            order.push('A:after');
            return r as never;
          },
    } as never;

    const surfaceLayer = {
      name: 'B',
      wrap:
        (_t: unknown, impl: (i: unknown, c: unknown) => Promise<unknown>) =>
        async (i: unknown, c: unknown) => {
          order.push('B:before');
          const r = await impl(i, c);
          order.push('B:after');
          return r as never;
        },
    } as never;

    const topoLayer = {
      name: 'C',
      wrap:
        (_t: unknown, impl: (i: unknown, c: unknown) => Promise<unknown>) =>
        async (i: unknown, c: unknown) => {
          order.push('C:before');
          const r = await impl(i, c);
          order.push('C:after');
          return r as never;
        },
    } as never;

    const t = trail('layered.scopes', {
      blaze: (input: { x: string }) => {
        order.push('impl');
        return Result.ok(input.x);
      },
      input: z.object({ x: z.string() }),
      layers: [trailLayer],
    });
    const app = topo('test-app', { [t.id]: t }, { layers: [topoLayer] });
    const commands = buildCommands(app, { layers: [surfaceLayer] });

    await commands[0]?.execute({}, { x: 'test' });

    expect(order).toEqual([
      'C:before',
      'B:before',
      'A:before',
      'impl',
      'A:after',
      'B:after',
      'C:after',
    ]);
  });

  test('uses provided createContext factory', async () => {
    let usedRequestId: string | undefined;
    let usedCustom = false;
    let usedSurfaceMarker = false;
    const t = trail('ctx-test', {
      blaze: (_input: Record<string, never>, ctx: TrailContext) => {
        usedRequestId = ctx.requestId;
        usedCustom = ctx.extensions?.['custom'] === true;
        usedSurfaceMarker = ctx.extensions?.[SURFACE_KEY] === 'cli';
        return Result.ok('ok');
      },
      input: z.object({}),
    });
    const app = makeApp(t);
    const commands = buildCommands(app, {
      createContext: () =>
        createTrailContext({
          extensions: { custom: true },
          requestId: 'custom-123',
        }),
    });

    await commands[0]?.execute({}, {});
    expect(usedRequestId).toBe('custom-123');
    expect(usedCustom).toBe(true);
    expect(usedSurfaceMarker).toBe(true);
  });

  test('converts kebab-case flags back to camelCase for input', async () => {
    let receivedInput: unknown;
    const t = trail('camel', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok('ok');
      },
      input: z.object({ sortOrder: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute({}, { 'sort-order': 'asc' });
    expect(receivedInput).toEqual({ sortOrder: 'asc' });
  });

  test('does not drop derived fields that collide with structured input flag names', async () => {
    let receivedInput: unknown;
    const t = trail('collision', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok('ok');
      },
      input: z.object({ inputJson: z.string() }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute({}, { 'input-json': 'literal value' });

    expect(receivedInput).toEqual({ inputJson: 'literal value' });
  });

  test('merges structured input before explicit flags and args', async () => {
    let receivedInput: unknown;
    const t = trail('search', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok(input);
      },
      input: z.object({
        limit: z.number(),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute(
      { query: 'from arg' },
      {
        'input-json': '{"query":"from json","limit":10}',
        limit: 20,
      }
    );

    expect(receivedInput).toEqual({
      limit: 20,
      query: 'from arg',
    });
  });

  test('structured input beats parsed flag defaults', async () => {
    let receivedInput: unknown;
    const t = trail('regrade-like', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok(input);
      },
      input: z.object({
        apply: z.boolean().default(false),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute(
      {},
      {
        apply: false,
        'input-json': '{"apply":true,"query":"from json"}',
      },
      undefined,
      { userSuppliedFlagKeys: new Set() }
    );

    expect(receivedInput).toEqual({
      apply: true,
      query: 'from json',
    });
  });

  test('explicit same-as-default flags beat structured input', async () => {
    let receivedInput: unknown;
    const t = trail('regrade-explicit', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok(input);
      },
      input: z.object({
        apply: z.boolean().default(false),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute(
      {},
      {
        apply: false,
        'input-json': '{"apply":true,"query":"from json"}',
      },
      undefined,
      { userSuppliedFlagKeys: new Set(['apply']) }
    );

    expect(receivedInput).toEqual({
      apply: false,
      query: 'from json',
    });
  });

  test('direct default-valued flags without provenance beat structured input', async () => {
    let receivedInput: unknown;
    const t = trail('regrade-direct-explicit', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok(input);
      },
      input: z.object({
        apply: z.boolean().default(false),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app);

    await commands[0]?.execute(
      {},
      {
        apply: false,
        'input-json': '{"apply":true,"query":"from json"}',
      }
    );

    expect(receivedInput).toEqual({
      apply: false,
      query: 'from json',
    });
  });

  test('resolveInput only fills missing values and never overwrites explicit input', async () => {
    let receivedInput: unknown;
    const t = trail('prompted', {
      blaze: (input) => {
        receivedInput = input;
        return Result.ok(input);
      },
      input: z.object({
        limit: z.number(),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const commands = buildCommands(app, {
      resolveInput: async () =>
        await Promise.resolve({
          limit: 10,
          query: 'from prompt',
        }),
    });

    await commands[0]?.execute({}, { query: 'from flag' });

    expect(receivedInput).toEqual({
      limit: 10,
      query: 'from flag',
    });
  });

  test('validation errors for complex schemas point back to structured input', async () => {
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

    const result = await commands[0]?.execute({}, {});

    expect(result?.isErr()).toBe(true);
    expect(result?.error.message).toContain(
      'Use --input <path|-> or --input-json for full structured input.'
    );
  });

  test('returns InternalError when blaze function throws', async () => {
    const throwing = trail('throw.test', {
      blaze: () => {
        throw new Error('unexpected kaboom');
      },
      input: z.object({}),
      output: z.object({}),
    });
    const app = makeApp(throwing);
    const commands = buildCommands(app);
    const cmd = requireCommand(commands);
    const result = await cmd.execute({}, {});
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain('unexpected kaboom');
  });

  test('projects live versions and executes selected version flag', async () => {
    const versioned = trail('versioned.greet', {
      blaze: (input: { name: string }) =>
        Result.ok({ message: `Hello, ${input.name}!` }),
      input: z.object({ name: z.string() }),
      output: z.object({ message: z.string() }),
      version: 3,
      versions: {
        1: {
          input: z.object({ firstName: z.string(), legacyId: z.string() }),
          output: z.object({ message: z.string() }),
          status: { state: 'archived' },
          transpose: {
            input: ({ input }) => ({ name: input.firstName }),
            output: ({ output }) => output,
          },
        },
        2: {
          input: z.object({ firstName: z.string() }),
          output: z.object({ message: z.string() }),
          status: { note: 'Use name.', state: 'deprecated' },
          transpose: {
            input: ({ input }) => ({ name: input.firstName }),
            output: ({ output }) => output,
          },
        },
      },
    });
    const cmd = requireCommand(buildCommands(makeApp(versioned)));

    expect(cmd.flags.map((flag) => flag.name)).toContain('trail-version');
    expect(cmd.versions?.map((entry) => entry.version)).toEqual([2, 3]);
    expect(cmd.versions?.[0]).toMatchObject({
      current: false,
      deprecated: true,
      version: 2,
    });

    const result = await cmd.execute(
      {},
      {
        firstName: 'Ada',
        trailVersion: '2',
      }
    );

    expect(result.isOk()).toBe(true);
    expect(result.value).toEqual({ message: 'Hello, Ada!' });
  });
});

describe('buildCommands resource overrides', () => {
  test('passes topo to executeTrail so CLI-invoked producers can fan out', async () => {
    const captured: string[] = [];
    const consumer = trail('notify.email', {
      blaze: (input: { orderId: string }) => {
        captured.push(input.orderId);
        return Result.ok({ delivered: true });
      },
      input: z.object({ orderId: z.string() }),
      on: ['order.placed'],
    });
    const producer = trail('order.create', {
      blaze: async (input: { orderId: string }, ctx) => {
        await requireFire(ctx.fire)(orderPlaced, {
          orderId: input.orderId,
        });
        return Result.ok({ ok: true });
      },
      fires: [orderPlaced],
      input: z.object({ orderId: z.string() }),
    });
    const app = topo('signal-cli', { consumer, orderPlaced, producer });

    const result = await requireCommand(buildCommands(app)).execute(
      {},
      { orderId: 'o-cli' }
    );

    expect(result.isOk()).toBe(true);
    expect(captured).toEqual(['o-cli']);
  });

  test('forwards resource overrides into executeTrail', async () => {
    const t = trail('resource-test', {
      blaze: (_input, ctx) =>
        Result.ok({ name: dbResource.from(ctx).name as string }),
      input: z.object({}),
      output: z.object({ name: z.string() }),
      resources: [dbResource],
    });
    const app = topo('test-app', {
      'db.main': dbResource,
      [t.id]: t,
    });
    const commands = buildCommands(app, {
      resources: { 'db.main': { name: 'override' } },
    });

    const result = await commands[0]?.execute({}, {});
    expect(result?.isOk()).toBe(true);
    expect(result?.unwrap()).toEqual({ name: 'override' });
  });
});

describe('buildCommands filtering', () => {
  test('internal trails are excluded by default', () => {
    const publicTrail = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
    });
    const internalTrail = trail('entity.secret.rotate', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      visibility: 'internal',
    });
    const commands = buildCommands(makeApp(publicTrail, internalTrail));

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.show',
    ]);
  });

  test('exact include can expose an internal trail', () => {
    const publicTrail = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
    });
    const internalTrail = trail('entity.secret.rotate', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      visibility: 'internal',
    });
    const commands = buildCommands(makeApp(publicTrail, internalTrail), {
      include: ['entity.secret.rotate'],
    });

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.secret.rotate',
    ]);
  });

  test('exclude patterns apply before include narrowing', () => {
    const show = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
    });
    const remove = trail('entity.remove', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
    });
    const commands = buildCommands(makeApp(show, remove), {
      exclude: ['entity.remove'],
      include: ['entity.*'],
    });

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.show',
    ]);
  });

  test('intent filters narrow the command set', () => {
    const show = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'read',
    });
    const remove = trail('entity.remove', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
    });

    const commands = buildCommands(makeApp(show, remove), {
      intent: ['read'],
    });

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.show',
    ]);
  });

  test('intent filters compose with include patterns using AND logic', () => {
    const show = trail('entity.show', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'read',
    });
    const remove = trail('entity.remove', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
    });

    const commands = buildCommands(makeApp(show, remove), {
      include: ['entity.*'],
      intent: ['destroy'],
    });

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.remove',
    ]);
  });

  test('consumer trails (on: [...]) are excluded', () => {
    const producer = trail('order.create', {
      blaze: () => Result.ok({ ok: true }),
      fires: ['order.placed'],
      input: z.object({ orderId: z.string() }),
    });
    const consumer = trail('notify.email', {
      blaze: (input: { orderId: string }) =>
        Result.ok({ delivered: true, orderId: input.orderId }),
      input: z.object({ orderId: z.string() }),
      on: ['order.placed'],
    });
    const app = topo('test-app', { consumer, orderPlaced, producer });
    const commands = buildCommands(app);

    expect(commands).toHaveLength(1);
    expect(commands[0]?.trail.id).toBe('order.create');
  });

  test('internal trails remain crossable even when they stay hidden', async () => {
    const helper = trail('entity.secret.rotate', {
      blaze: (input: { id: string }) => Result.ok({ rotated: input.id }),
      input: z.object({ id: z.string() }),
      intent: 'read',
      output: z.object({ rotated: z.string() }),
      visibility: 'internal',
    });
    const entry = trail('entity.rotate', {
      blaze: async (input: { id: string }, ctx) => {
        const result = await ctx.compose('entity.secret.rotate', input);
        return result.match({
          err: (error) => Result.err(error),
          ok: (value) => Result.ok(value),
        });
      },
      composes: ['entity.secret.rotate'],
      input: z.object({ id: z.string() }),
      intent: 'read',
      output: z.object({ rotated: z.string() }),
    });

    const commands = buildCommands(makeApp(entry, helper));

    expect(commands.map((command) => command.trail.id)).toEqual([
      'entity.rotate',
    ]);

    const result = await commands[0]?.execute({}, { id: 'abc123' });
    expect(result?.isOk()).toBe(true);
    expect(result?.unwrap()).toEqual({ rotated: 'abc123' });
  });
});

describe('positional arg derivation', () => {
  test('auto-promotes single required string field to positional arg', () => {
    const t = trail('file.read', {
      blaze: (input: { path: string }) => Result.ok(input.path),
      input: z.object({ path: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]).toMatchObject({
      name: 'path',
      required: false,
      variadic: false,
    });
    // The positional field is kept as a --path flag alias
    expect(cmd.flags.find((f) => f.name === 'path')).toBeDefined();
  });

  test('does not auto-promote when multiple required string fields exist', () => {
    const t = trail('file.copy', {
      blaze: (input: { dest: string; src: string }) =>
        Result.ok({ dest: input.dest, src: input.src }),
      input: z.object({ dest: z.string(), src: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(0);
    // Both should remain as flags
    expect(cmd.flags.find((f) => f.name === 'dest')).toBeDefined();
    expect(cmd.flags.find((f) => f.name === 'src')).toBeDefined();
  });

  test('auto-promotes single required string alongside other optional fields', () => {
    const t = trail('search', {
      blaze: () => Result.ok([]),
      input: z.object({
        limit: z.number().optional(),
        query: z.string(),
      }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]).toMatchObject({ name: 'query', required: false });
    // query kept as flag alias, limit also present
    expect(cmd.flags.find((f) => f.name === 'query')).toBeDefined();
    expect(cmd.flags.find((f) => f.name === 'limit')).toBeDefined();
  });

  test('explicit args promotes field even with multiple strings', () => {
    const t = trail('file.copy', {
      args: ['src'],
      blaze: (input: { dest: string; src: string }) =>
        Result.ok({ dest: input.dest, src: input.src }),
      input: z.object({ dest: z.string(), src: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]).toMatchObject({ name: 'src', required: false });
    // src kept as flag alias, dest also present
    expect(cmd.flags.find((f) => f.name === 'src')).toBeDefined();
    expect(cmd.flags.find((f) => f.name === 'dest')).toBeDefined();
  });

  test('multiple explicit args preserve declared order', () => {
    const t = trail('file.copy', {
      args: ['src', 'dest'],
      blaze: (input: { dest: string; src: string }) =>
        Result.ok({ dest: input.dest, src: input.src }),
      input: z.object({ dest: z.string(), src: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(2);
    expect(cmd.args[0]?.name).toBe('src');
    expect(cmd.args[1]?.name).toBe('dest');
  });

  test('args: false suppresses auto-promotion', () => {
    const t = trail('file.read', {
      args: false,
      blaze: (input: { path: string }) => Result.ok(input.path),
      input: z.object({ path: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    // Single required string would normally be auto-promoted, but args: false suppresses it
    expect(cmd.args).toHaveLength(0);
    expect(cmd.flags.find((f) => f.name === 'path')).toBeDefined();
  });

  test('args with non-existent field name is silently ignored', () => {
    const t = trail('file.read', {
      args: ['path', 'nonexistent'],
      blaze: (input: { path: string }) => Result.ok(input.path),
      input: z.object({ path: z.string() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(1);
    expect(cmd.args[0]).toMatchObject({ name: 'path', required: false });
  });

  test('no positional args when no required string fields exist', () => {
    const t = trail('config.set', {
      blaze: (input: { count: number; verbose: boolean }) =>
        Result.ok({ count: input.count, verbose: input.verbose }),
      input: z.object({ count: z.number(), verbose: z.boolean() }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(0);
  });

  test('does not auto-promote a required string field that has a default', () => {
    const t = trail('greet', {
      blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
      input: z.object({ name: z.string().default('World') }),
    });
    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    expect(cmd.args).toHaveLength(0);
  });
});

describe('buildCommands established graph enforcement', () => {
  test('throws when draft contamination remains', () => {
    const draftTrail = trail('entity.export', {
      blaze: () => Result.ok({ ok: true }),
      composes: ['_draft.entity.prepare'],
      input: z.object({}),
    });

    expect(() => buildCommands(makeApp(draftTrail))).toThrowError(/draft/i);
  });
});

const captureInput =
  (captured: {
    input?: unknown;
  }): ((ctx: ActionResultContext) => Promise<void>) =>
  (ctx) => {
    captured.input = ctx.input;
    return Promise.resolve();
  };

describe('buildCommands structured input', () => {
  test('merges --input file payloads at the top level', async () => {
    const t = trail('search', {
      blaze: (input: { query: string }) => Result.ok({ received: input }),
      input: z.object({ query: z.string() }),
    });
    const captured: { input?: unknown } = {};
    const cmd = requireCommand(
      buildCommands(makeApp(t), { onResult: captureInput(captured) })
    );
    const tmpPath = `${process.env['TMPDIR'] ?? '/tmp'}/structured-input-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`;
    await Bun.write(tmpPath, '{"query":"from file"}');

    try {
      const result = await cmd.execute({}, { input: tmpPath });
      expect(result.isOk()).toBe(true);
      expect(captured.input).toEqual({ query: 'from file' });
    } finally {
      await Bun.file(tmpPath).delete();
    }
  });

  test('keeps --input reserved for file payloads when the schema has an input field', async () => {
    const t = trail('echo-input', {
      blaze: (input: { input: string }) => Result.ok({ received: input }),
      input: z.object({ input: z.string() }),
    });
    const captured: { input?: unknown } = {};
    const cmd = requireCommand(
      buildCommands(makeApp(t), { onResult: captureInput(captured) })
    );
    const tmpPath = `${process.env['TMPDIR'] ?? '/tmp'}/structured-input-collision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.json`;
    await Bun.write(tmpPath, '{"input":"from file"}');

    try {
      const result = await cmd.execute({}, { input: tmpPath });
      expect(result.isOk()).toBe(true);
      expect(captured.input).toEqual({ input: 'from file' });
    } finally {
      await Bun.file(tmpPath).delete();
    }
  });

  test('rejects when --input and --input-json are both provided', async () => {
    const t = trail('search', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ query: z.string() }),
    });
    const cmd = requireCommand(buildCommands(makeApp(t)));

    const result = await cmd.execute(
      {},
      { input: '/tmp/in.json', inputJson: '{"query":"from json"}' }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'Use only one structured input source at a time'
      );
    }
  });

  test('merges positional inline JSON for structured-only fields', async () => {
    const t = trail('gist.create', {
      blaze: (input: {
        files: readonly {
          readonly content: string;
          readonly filename: string;
        }[];
      }) => Result.ok({ received: input }),
      input: z.object({
        files: z.array(
          z.object({
            content: z.string(),
            filename: z.string(),
          })
        ),
      }),
    });
    const captured: { input?: unknown } = {};
    const cmd = requireCommand(
      buildCommands(makeApp(t), { onResult: captureInput(captured) })
    );

    expect(cmd.args.map((arg) => arg.name)).toEqual(['inline-json']);

    const result = await cmd.execute(
      {
        'inline-json': '{"files":[{"filename":"README.md","content":"Hello"}]}',
      },
      {}
    );

    expect(result.isOk()).toBe(true);
    expect(captured.input).toEqual({
      files: [{ content: 'Hello', filename: 'README.md' }],
    });
  });

  test('rejects when positional inline JSON conflicts with structured flags', async () => {
    const t = trail('gist.create', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({
        files: z.array(
          z.object({
            content: z.string(),
            filename: z.string(),
          })
        ),
      }),
    });
    const cmd = requireCommand(buildCommands(makeApp(t)));

    const result = await cmd.execute(
      {
        'inline-json': '{"files":[{"filename":"README.md","content":"Hello"}]}',
      },
      {
        inputJson: '{"files":[{"filename":"README.md","content":"Hello"}]}',
      }
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(
        'Use only one structured input source at a time: --input, --input-json, or the positional inline-JSON argument'
      );
    }
  });

  test('rejects missing structured flag values before schema validation', async () => {
    const t = trail('search', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ query: z.string() }),
    });
    const cmd = requireCommand(buildCommands(makeApp(t)));

    const inputResult = await cmd.execute({}, { input: true });
    expect(inputResult.isErr()).toBe(true);
    if (inputResult.isErr()) {
      expect(inputResult.error.message).toContain('--input requires a value');
    }

    const inputJsonResult = await cmd.execute({}, { inputJson: true });
    expect(inputJsonResult.isErr()).toBe(true);
    if (inputJsonResult.isErr()) {
      expect(inputJsonResult.error.message).toContain(
        '--input-json requires a value'
      );
    }
  });
});

describe('buildCommands date-shortcut absorption', () => {
  // Use z.string() for the date fields so the shortcut expander runs first
  // and Zod accepts the resulting ISO string. The shortcut detection still
  // matches because the schema declares `.datetime()`.
  const eventsTrail = trail('events.list', {
    blaze: (input: {
      since?: string | undefined;
      until?: string | undefined;
    }) => Result.ok(input),
    input: z.object({
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    }),
  });

  const greetTrail = trail('greet', {
    blaze: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
    input: z.object({ name: z.string() }),
  });

  const dateOnlyTrail = trail('events.by-day', {
    blaze: (input: { day?: string | undefined }) => Result.ok(input),
    input: z.object({
      day: z.iso.date().optional(),
    }),
  });

  const nativeDateTrail = trail('events.by-instant', {
    blaze: (input: { occurredAt?: Date | undefined }) => Result.ok(input),
    input: z.object({
      occurredAt: z.date().optional(),
    }),
  });

  test("expands 'today' on a date field before validation", async () => {
    const app = makeApp(eventsTrail);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({}, { since: 'today' });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { since?: string };
    expect(typeof value.since).toBe('string');
    // The expander returned an ISO datetime that ends in start-of-day UTC.
    expect(value.since).toMatch(/T00:00:00\.000Z$/);
  });

  test("expands 'today' to YYYY-MM-DD for z.iso.date fields before validation", async () => {
    const app = makeApp(dateOnlyTrail);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({}, { day: 'today' });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { day?: string };
    expect(value.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value.day).not.toContain('T');
  });

  test("expands 'today' to a Date for z.date fields before validation", async () => {
    const app = makeApp(nativeDateTrail);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({}, { occurredAt: 'today' });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { occurredAt?: Date };
    expect(value.occurredAt).toBeInstanceOf(Date);
  });

  test("expands 'Nd' on a date field", async () => {
    const app = makeApp(eventsTrail);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({}, { since: '7d' });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { since?: string };
    expect(typeof value.since).toBe('string');
    expect(value.since).toMatch(/T00:00:00\.000Z$/);
  });

  test('plain ISO datetime strings pass through to Zod unchanged', async () => {
    const app = makeApp(eventsTrail);
    const cmd = requireCommand(buildCommands(app));

    const iso = '2025-01-15T12:00:00.000Z';
    const result = await cmd.execute({}, { since: iso });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    const value = result.value as { since?: string };
    expect(value.since).toBe(iso);
  });

  test('invalid shortcut-shaped values surface a ValidationError', async () => {
    const app = makeApp(eventsTrail);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({}, { since: '7day' });

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    // Preserve the error class so downstream surfaces (CLI exit code,
    // HTTP status, JSON-RPC code) stay aligned with the validation taxonomy.
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('7day');
    expect(result.error.message).toContain('today');
  });

  test('shortcuts are NOT expanded for trails without date fields', async () => {
    const app = makeApp(greetTrail);
    const cmd = requireCommand(buildCommands(app));

    // The trail input has only `name: z.string()`, so 'today' must not
    // be treated as a date shortcut.
    const result = await cmd.execute({}, { name: 'today' });

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    expect(result.value).toBe('Hello, today');
  });
});

describe('--dry-run wiring', () => {
  test('--dry-run flag sets ctx.dryRun to true on the trail', async () => {
    let observed: boolean | undefined;
    const t = trail('thing.delete', {
      blaze: (_input, ctx) => {
        observed = ctx.dryRun;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute(
      { id: 'abc' },
      { dryRun: true, id: 'abc' }
    );

    expect(result.isOk()).toBe(true);
    expect(observed).toBe(true);
  });

  test('omitted --dry-run leaves ctx.dryRun as false', async () => {
    let observed: boolean | undefined;
    const t = trail('thing.delete-default', {
      blaze: (_input, ctx) => {
        observed = ctx.dryRun;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute({ id: 'abc' }, { id: 'abc' });

    expect(result.isOk()).toBe(true);
    expect(observed).toBe(false);
  });

  test('omitted --dry-run preserves a context factory dryRun default', async () => {
    let observed: boolean | undefined;
    const t = trail('thing.delete-factory-default', {
      blaze: (_input, ctx) => {
        observed = ctx.dryRun;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(
      buildCommands(app, {
        createContext: () => createTrailContext({ dryRun: true }),
      })
    );

    const result = await cmd.execute({ id: 'abc' }, { id: 'abc' });

    expect(result.isOk()).toBe(true);
    expect(observed).toBe(true);
  });

  test('--dry-run does not leak into trail input', async () => {
    let receivedInput: unknown;
    const t = trail('thing.write', {
      blaze: (input: { name: string }) => {
        receivedInput = input;
        return Result.ok({ name: input.name });
      },
      input: z.object({ name: z.string() }),
      intent: 'write',
      output: z.object({ name: z.string() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute(
      { name: 'alpha' },
      { dryRun: true, name: 'alpha' }
    );

    expect(result.isOk()).toBe(true);
    expect(receivedInput).toEqual({ name: 'alpha' });
  });

  test('schema-authored dryRun remains trail input instead of a meta flag', async () => {
    let observedInput: { dryRun: boolean; id: string } | undefined;
    let observedCtxDryRun: boolean | undefined;
    const t = trail('thing.preview', {
      blaze: (input: { dryRun: boolean; id: string }, ctx) => {
        observedInput = input;
        observedCtxDryRun = ctx.dryRun;
        return Result.ok({ ok: true });
      },
      input: z.object({ dryRun: z.boolean(), id: z.string() }),
      intent: 'write',
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app));

    const result = await cmd.execute(
      { id: 'abc' },
      { dryRun: true, id: 'abc' }
    );

    expect(result.isOk()).toBe(true);
    expect(observedInput).toEqual({ dryRun: true, id: 'abc' });
    expect(observedCtxDryRun).toBe(false);
  });
});

describe('--permit wiring', () => {
  test('--permit JSON sets ctx.permit to the parsed permit object', async () => {
    let observed: TrailContext['permit'];
    const t = trail('thing.read', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', permit: '{"id":"dev","scopes":["admin:write"]}' }
    );

    expect(result.isOk()).toBe(true);
    expect(observed).toEqual({ id: 'dev', scopes: ['admin:write'] });
  });

  test('omitted --permit leaves ctx.permit undefined', async () => {
    let observed: TrailContext['permit'] = { id: 'sentinel', scopes: [] };
    const t = trail('thing.read-default', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute({ id: 'abc' }, { id: 'abc' });

    expect(result.isOk()).toBe(true);
    expect(observed).toBeUndefined();
  });

  test('--permit with invalid JSON fails with ValidationError', async () => {
    const t = trail('thing.read-bad-json', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', permit: 'not-json' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message.toLowerCase()).toContain('permit');
  });

  test('--permit missing scopes field fails with ValidationError', async () => {
    const t = trail('thing.read-missing-scopes', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', permit: '{"id":"dev"}' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
  });

  test('--permit with non-string id fails with ValidationError', async () => {
    const t = trail('thing.read-bad-id', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', permit: '{"id":42,"scopes":["x"]}' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
  });

  test('--permit does not leak into trail input', async () => {
    let receivedInput: unknown;
    const t = trail('thing.read-no-leak', {
      blaze: (input: { id: string }) => {
        receivedInput = input;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', permit: '{"id":"dev","scopes":["admin:write"]}' }
    );

    expect(result.isOk()).toBe(true);
    expect(receivedInput).toEqual({ id: 'abc' });
  });

  test('--permit satisfies permit-protected trails when scopes match', async () => {
    const t = trail('thing.write-protected', {
      blaze: (_input, ctx) => Result.ok({ ok: true, permitId: ctx.permit?.id }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean(), permitId: z.string().optional() }),
      permit: { scopes: ['entity:write'] },
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      {
        id: 'abc',
        permit: '{"id":"dev","scopes":["entity:write","entity:read"]}',
      }
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    expect(result.value).toEqual({ ok: true, permitId: 'dev' });
  });
});

describe('--token wiring', () => {
  interface StubAuthAdapter {
    readonly authenticate: (input: {
      readonly bearerToken?: string | undefined;
      readonly requestId: string;
      readonly surface: 'cli' | 'http' | 'mcp';
    }) => Promise<
      Result<
        { readonly id: string; readonly scopes: readonly string[] } | null,
        { readonly code: string; readonly message: string }
      >
    >;
  }

  /**
   * Build a topo containing a trail plus an auth resource whose adapter is
   * supplied via `options.resources` so the test does not need to instantiate
   * the real `@ontrails/permits` factory.
   */
  const authResourceDef = resource<{
    readonly authenticate: (input: {
      readonly surface: 'cli' | 'http' | 'mcp';
      readonly bearerToken?: string | undefined;
      readonly requestId: string;
    }) => Promise<
      Result<
        {
          readonly id: string;
          readonly scopes: readonly string[];
        } | null,
        { readonly code: string; readonly message: string }
      >
    >;
  }>('auth', {
    create: () =>
      Result.ok({
        // oxlint-disable-next-line require-await -- fallback adapter
        authenticate: async () => Result.ok(null),
      }),
  });

  const makeAuthApp = (t: AnyTrail) =>
    topo('auth-test-app', { auth: authResourceDef, [t.id]: t });

  const resolvePermitFromTokenForTest: ResolveCliPermitFromToken = async ({
    requestId,
    resources,
    token,
  }) => {
    const adapter = resources?.['auth'] as StubAuthAdapter | undefined;
    if (adapter === undefined) {
      return Result.err(
        new ValidationError(
          '--token requires an auth adapter. Register authResource from @ontrails/permits in your topo.'
        )
      );
    }
    const authResult = await adapter.authenticate({
      bearerToken: token,
      requestId,
      surface: 'cli',
    });
    if (authResult.isErr()) {
      return Result.err(
        new AuthError(authResult.error.message, {
          context: { code: authResult.error.code },
        })
      );
    }
    if (authResult.value === null) {
      return Result.err(
        new AuthError('Auth adapter did not produce a permit for --token', {
          context: { code: 'missing_credentials' },
        })
      );
    }
    return Result.ok(authResult.value);
  };

  const buildAuthCommands = (
    app: Parameters<typeof buildCommands>[0],
    resources?: Record<string, unknown>
  ) =>
    buildCommands(app, {
      ...(resources === undefined ? {} : { resources }),
      presets: authPresets(),
      resolvePermitFromToken: resolvePermitFromTokenForTest,
    });

  test('--token resolves a permit via the auth adapter and lands ctx.permit', async () => {
    let observed: TrailContext['permit'];
    const t = trail('thing.token-read', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      authenticate: (input: { readonly bearerToken?: string | undefined }) =>
        Promise.resolve(
          input.bearerToken === 'good-token'
            ? Result.ok({ id: 'user-42', scopes: ['read', 'write'] })
            : Result.err({ code: 'invalid_token', message: 'rejected' })
        ),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'good-token' }
    );

    expect(result.isOk()).toBe(true);
    expect(observed).toEqual({ id: 'user-42', scopes: ['read', 'write'] });
  });

  test('--token without a registered auth resource fails with ValidationError', async () => {
    const t = trail('thing.no-auth', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    // Topo without an auth resource registered.
    const app = makeApp(t);
    const cmd = requireCommand(buildAuthCommands(app));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'any-token' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message.toLowerCase()).toContain('auth');
  });

  test('--token with invalid token surfaces an AuthError (auth category, exit 9)', async () => {
    const t = trail('thing.bad-token', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      // oxlint-disable-next-line require-await -- stub adapter
      authenticate: async () =>
        Result.err({ code: 'invalid_token', message: 'bad signature' }),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'nope' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(AuthError);
    expect(result.error.message.toLowerCase()).toContain('bad signature');
    if (result.error instanceof AuthError) {
      expect(result.error.context).toMatchObject({ code: 'invalid_token' });
    }
  });

  test('--token returning a null permit fails with AuthError (missing credentials)', async () => {
    const t = trail('thing.null-permit', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      // oxlint-disable-next-line require-await -- stub adapter
      authenticate: async () => Result.ok(null),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'opaque' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(AuthError);
    if (result.error instanceof AuthError) {
      expect(result.error.context).toMatchObject({
        code: 'missing_credentials',
      });
    }
  });

  test('--token and --permit together fail with ValidationError', async () => {
    const t = trail('thing.both-flags', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      // oxlint-disable-next-line require-await -- stub adapter
      authenticate: async () => Result.ok({ id: 'u', scopes: [] }),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      {
        id: 'abc',
        permit: '{"id":"dev","scopes":["x"]}',
        token: 'good-token',
      }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message.toLowerCase()).toContain('mutually exclusive');
  });

  test('omitted --token and --permit leaves ctx.permit undefined', async () => {
    let observed: TrailContext['permit'] = { id: 'sentinel', scopes: [] };
    const t = trail('thing.no-flags', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      // oxlint-disable-next-line require-await -- stub adapter
      authenticate: async () => Result.ok({ id: 'u', scopes: [] }),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute({ id: 'abc' }, { id: 'abc' });

    expect(result.isOk()).toBe(true);
    expect(observed).toBeUndefined();
  });

  test('--token does not leak into trail input', async () => {
    let receivedInput: unknown;
    const t = trail('thing.token-no-leak', {
      blaze: (input: { id: string }) => {
        receivedInput = input;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      // oxlint-disable-next-line require-await -- stub adapter
      authenticate: async () => Result.ok({ id: 'user-42', scopes: ['read'] }),
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'good-token' }
    );

    expect(result.isOk()).toBe(true);
    expect(receivedInput).toEqual({ id: 'abc' });
  });

  test('--token forwards surface "cli" and a bearer token to the adapter', async () => {
    let seenInput:
      | {
          readonly surface?: string;
          readonly bearerToken?: string;
          readonly requestId?: string;
        }
      | undefined;
    const t = trail('thing.token-forward', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const stubAdapter = {
      authenticate: (input: {
        readonly surface: string;
        readonly bearerToken?: string | undefined;
        readonly requestId: string;
      }) => {
        seenInput = input;
        return Promise.resolve(Result.ok({ id: 'user-42', scopes: ['read'] }));
      },
    };

    const app = makeAuthApp(t);
    const cmd = requireCommand(buildAuthCommands(app, { auth: stubAdapter }));

    const result = await cmd.execute(
      { id: 'abc' },
      { id: 'abc', token: 'forward-me' }
    );

    expect(result.isOk()).toBe(true);
    expect(seenInput?.surface).toBe('cli');
    expect(seenInput?.bearerToken).toBe('forward-me');
    expect(typeof seenInput?.requestId).toBe('string');
  });
});

describe('dev permit flag wiring', () => {
  test('injects a synthetic permit covering every declared scope', async () => {
    let observed: TrailContext['permit'];
    const writer = trail('thing.dev-write', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['entity:write', 'entity:admin'] },
    });
    const reader = trail('thing.dev-read', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['entity:read'] },
    });

    const app = makeApp(writer, reader);
    const commands = buildCommands(app, { presets: authPresets() });
    const cmd = commands.find((c) => c.trail.id === 'thing.dev-write');
    expect(cmd).toBeDefined();
    if (!cmd) {
      throw new Error('expected command');
    }

    const result = await cmd.execute(
      { id: 'abc' },
      { devPermit: true, id: 'abc' }
    );

    expect(result.isOk()).toBe(true);
    expect(observed?.id).toBe('dev-permit');
    const observedScopes = observed?.scopes;
    expect(observedScopes).toBeDefined();
    if (!observedScopes) {
      throw new Error('expected scopes on synthetic permit');
    }
    const scopes = new Set(observedScopes);
    expect(scopes.has('entity:write')).toBe(true);
    expect(scopes.has('entity:admin')).toBe(true);
    expect(scopes.has('entity:read')).toBe(true);
  });

  test('satisfies a permit-protected trail without permit or token flags', async () => {
    const t = trail('thing.dev-protected', {
      blaze: (_input, ctx) => Result.ok({ ok: true, permitId: ctx.permit?.id }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean(), permitId: z.string().optional() }),
      permit: { scopes: ['entity:write'] },
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { devPermit: true, id: 'abc' }
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) {
      throw new Error('expected ok');
    }
    expect(result.value).toEqual({ ok: true, permitId: 'dev-permit' });
  });

  test('dev permit plus permit fails with ValidationError listing both flags', async () => {
    const t = trail('thing.dev-and-permit', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      {
        devPermit: true,
        id: 'abc',
        permit: '{"id":"dev","scopes":["x"]}',
      }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('--permit');
    expect(result.error.message).toContain(DEV_PERMIT_FLAG);
    expect(result.error.message.toLowerCase()).toContain('mutually exclusive');
  });

  test('dev permit plus token fails with ValidationError listing both flags', async () => {
    const stubAuth = resource<{
      readonly authenticate: (input: {
        readonly surface: 'cli' | 'http' | 'mcp';
        readonly bearerToken?: string | undefined;
        readonly requestId: string;
      }) => Promise<
        Result<
          { readonly id: string; readonly scopes: readonly string[] } | null,
          { readonly code: string; readonly message: string }
        >
      >;
    }>('auth', {
      create: () =>
        Result.ok({
          // oxlint-disable-next-line require-await -- stub adapter
          authenticate: async () => Result.ok({ id: 'u', scopes: [] }),
        }),
    });

    const t = trail('thing.dev-and-token', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = topo('dev-token-app', { auth: stubAuth, [t.id]: t });
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { devPermit: true, id: 'abc', token: 'good-token' }
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) {
      throw new Error('expected err');
    }
    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error.message).toContain('--token');
    expect(result.error.message).toContain(DEV_PERMIT_FLAG);
    expect(result.error.message.toLowerCase()).toContain('mutually exclusive');
  });

  test('omitted dev permit flag leaves ctx.permit undefined', async () => {
    let observed: TrailContext['permit'] = { id: 'sentinel', scopes: [] };
    const t = trail('thing.dev-omitted', {
      blaze: (_input, ctx) => {
        observed = ctx.permit;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute({ id: 'abc' }, { id: 'abc' });

    expect(result.isOk()).toBe(true);
    expect(observed).toBeUndefined();
  });

  test('dev permit flag does not leak into trail input', async () => {
    let receivedInput: unknown;
    const t = trail('thing.dev-no-leak', {
      blaze: (input: { id: string }) => {
        receivedInput = input;
        return Result.ok({ ok: true });
      },
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });

    const app = makeApp(t);
    const cmd = requireCommand(buildCommands(app, { presets: authPresets() }));

    const result = await cmd.execute(
      { id: 'abc' },
      { devPermit: true, id: 'abc' }
    );

    expect(result.isOk()).toBe(true);
    expect(receivedInput).toEqual({ id: 'abc' });
  });
});
