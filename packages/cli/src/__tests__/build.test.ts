import { describe, expect, test } from 'bun:test';

import {
  Result,
  TRAILHEAD_KEY,
  createTrailContext,
  resource,
  signal,
  trail,
  topo,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import type { ActionResultContext } from '../build.js';
import { deriveCliCommands } from '../build.js';
import type { AnyTrail, CliCommand } from '../command.js';

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

  test('uses provided createContext factory', async () => {
    let usedRequestId: string | undefined;
    let usedCustom = false;
    let usedTrailheadMarker = false;
    const t = trail('ctx-test', {
      blaze: (_input: Record<string, never>, ctx: TrailContext) => {
        usedRequestId = ctx.requestId;
        usedCustom = ctx.extensions?.['custom'] === true;
        usedTrailheadMarker = ctx.extensions?.[TRAILHEAD_KEY] === 'cli';
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
    expect(usedTrailheadMarker).toBe(true);
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
      'Use --input-json, --input-file, or --stdin for full structured input.'
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
        const fired = await requireFire(ctx.fire)('order.placed', {
          orderId: input.orderId,
        });
        return fired.match({
          err: (error) => Result.err(error),
          ok: () => Result.ok({ ok: true }),
        });
      },
      fires: ['order.placed'],
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
        const result = await ctx.cross('entity.secret.rotate', input);
        return result.match({
          err: (error) => Result.err(error),
          ok: (value) => Result.ok(value),
        });
      },
      crosses: ['entity.secret.rotate'],
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
      crosses: ['_draft.entity.prepare'],
      input: z.object({}),
    });

    expect(() => buildCommands(makeApp(draftTrail))).toThrowError(/draft/i);
  });
});
