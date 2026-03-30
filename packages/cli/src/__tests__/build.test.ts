import { describe, expect, test } from 'bun:test';

import {
  Result,
  createTrailContext,
  service,
  trail,
  topo,
} from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import type { ActionResultContext } from '../build.js';
import { buildCliCommands } from '../build.js';
import type { AnyTrail } from '../command.js';

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

const dbService = service('db.main', {
  create: () =>
    Result.ok({
      name: 'factory',
    }),
});

const requireCommand = (commands: ReturnType<typeof buildCliCommands>) => {
  const [command] = commands;
  expect(command).toBeDefined();
  if (!command) {
    throw new Error('Expected command');
  }
  return command;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildCliCommands', () => {
  test('builds commands from a simple app with one trail', () => {
    const t = trail('greet', {
      input: z.object({ name: z.string() }),
      run: (input: { name: string }) => Result.ok(`Hello, ${input.name}`),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.name).toBe('greet');
    expect(commands[0]?.group).toBeUndefined();
  });

  test('builds grouped subcommands from dotted trail IDs', () => {
    const show = trail('entity.show', {
      input: z.object({ id: z.string() }),
      run: (input: { id: string }) => Result.ok({ id: input.id }),
    });
    const add = trail('entity.add', {
      input: z.object({ name: z.string() }),
      run: (input: { name: string }) => Result.ok({ name: input.name }),
    });
    const app = makeApp(show, add);
    const commands = buildCliCommands(app);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.group).toBe('entity');
    expect(commands[0]?.name).toBe('show');
    expect(commands[1]?.group).toBe('entity');
    expect(commands[1]?.name).toBe('add');
  });

  test('derives flags from input schema', () => {
    const t = trail('search', {
      input: z.object({
        limit: z.number().optional(),
        query: z.string(),
      }),
      run: () => Result.ok([]),
    });
    const app = makeApp(t);
    const { flags } = requireCommand(buildCliCommands(app));

    expect(flags).toHaveLength(2);
    const queryFlag = flags.find((f) => f.name === 'query');
    const limitFlag = flags.find((f) => f.name === 'limit');
    expect(queryFlag?.required).toBe(true);
    expect(limitFlag?.required).toBe(false);
  });

  test('adds --dry-run for destroy intent trails', () => {
    const t = trail('entity.delete', {
      input: z.object({ id: z.string() }),
      intent: 'destroy',
      run: () => Result.ok(),
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);
    const dryRunFlag = commands[0]?.flags.find((f) => f.name === 'dry-run');
    expect(dryRunFlag).toBeDefined();
    expect(dryRunFlag?.type).toBe('boolean');
  });

  describe('onResult callback', () => {
    test('receives correct context', async () => {
      let captured: ActionResultContext | undefined;
      const t = trail('ping', {
        input: z.object({ msg: z.string() }),
        run: (input: { msg: string }) => Result.ok(input.msg),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app, {
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
        input: z.object({ count: z.coerce.number() }),
        run: (input: { count: number }) => Result.ok(input.count),
      });
      const app = makeApp(t);
      const commands = buildCliCommands(app, {
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
  });

  test('validates input before calling implementation', async () => {
    let implCalled = false;
    const t = trail('strict', {
      input: z.object({ name: z.string() }),
      run: () => {
        implCalled = true;
        return Result.ok('done');
      },
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);

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
      input: z.object({ x: z.string() }),
      run: (input: { x: string }) => {
        order.push('impl');
        return Result.ok(input.x);
      },
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app, {
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
    const t = trail('ctx-test', {
      input: z.object({}),
      run: (_input: Record<string, never>, ctx: TrailContext) => {
        usedRequestId = ctx.requestId;
        return Result.ok('ok');
      },
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app, {
      createContext: () => createTrailContext({ requestId: 'custom-123' }),
    });

    await commands[0]?.execute({}, {});
    expect(usedRequestId).toBe('custom-123');
  });

  test('converts kebab-case flags back to camelCase for input', async () => {
    let receivedInput: unknown;
    const t = trail('camel', {
      input: z.object({ sortOrder: z.string() }),
      run: (input) => {
        receivedInput = input;
        return Result.ok('ok');
      },
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app);

    await commands[0]?.execute({}, { 'sort-order': 'asc' });
    expect(receivedInput).toEqual({ sortOrder: 'asc' });
  });

  test('returns InternalError when run function throws', async () => {
    const throwing = trail('throw.test', {
      input: z.object({}),
      output: z.object({}),
      run: () => {
        throw new Error('unexpected kaboom');
      },
    });
    const app = makeApp(throwing);
    const commands = buildCliCommands(app);
    const cmd = requireCommand(commands);
    const result = await cmd.execute({}, {});
    expect(result.isErr()).toBe(true);
    expect(result.error.message).toContain('unexpected kaboom');
  });
});

describe('buildCliCommands service overrides', () => {
  test('forwards service overrides into executeTrail', async () => {
    const t = trail('service-test', {
      input: z.object({}),
      output: z.object({ name: z.string() }),
      run: (_input, ctx) =>
        Result.ok({ name: dbService.from(ctx).name as string }),
      services: [dbService],
    });
    const app = makeApp(t);
    const commands = buildCliCommands(app, {
      services: { 'db.main': { name: 'override' } },
    });

    const result = await commands[0]?.execute({}, {});
    expect(result?.isOk()).toBe(true);
    expect(result?.unwrap()).toEqual({ name: 'override' });
  });
});
