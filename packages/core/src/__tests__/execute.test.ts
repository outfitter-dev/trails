/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { InternalError, ValidationError } from '../errors';
import { executeTrail } from '../execute';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';
import { Result } from '../result';
import { resource } from '../resource';
import { topo } from '../topo';
import { trail } from '../trail';
import type { TrailContext, TrailContextInit } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  blaze: (input) => Result.ok({ value: input.value }),
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
});

const failingTrail = trail('fails', {
  blaze: () => Result.err(new ValidationError('bad input')),
  input: z.object({}),
});

const throwingTrail = trail('throws', {
  blaze: () => {
    throw new Error('kaboom');
  },
  input: z.object({}),
});

const nextResourceId = (name: string): string =>
  `test.resource.${name}.${Bun.randomUUIDv7()}`;

const createResolvedValueResource = (
  id: string,
  onCreate: () => void,
  value: number
) =>
  resource(id, {
    create: () => {
      onCreate();
      return Result.ok({ value });
    },
  });

const createEagerResourceTrail = (
  id: string,
  counter: ReturnType<typeof createResolvedValueResource>,
  onRun: (value: number) => void
) =>
  trail('resource.eager', {
    blaze: (_input, ctx) => {
      const fromAccessor = ctx.resource<{ value: number }>(id);
      const fromDefinition = counter.from(ctx);
      onRun(fromDefinition.value);
      return Result.ok({ total: fromAccessor.value + 1 });
    },
    input: z.object({}),
    output: z.object({ total: z.number() }),
    resources: [counter],
  });

const createResourceProbeGate = (
  counter: ReturnType<typeof createResolvedValueResource>,
  onResolve: (value: number) => void
): Layer => ({
  name: 'uses-resource',
  wrap(_trail, impl) {
    return async (input, ctx) => {
      onResolve(ctx.resource<{ value: number }>(counter).value);
      return await impl(input, ctx);
    };
  },
});

const createSingletonResource = (id: string, onCreate: () => number) =>
  resource(id, {
    create: () => Result.ok({ createdAtCall: onCreate() }),
  });

const createSingletonTrail = (
  singleton: ReturnType<typeof createSingletonResource>
) =>
  trail('resource.singleton', {
    blaze: (_input, ctx) =>
      Result.ok({
        createdAtCall: singleton.from(ctx).createdAtCall,
      }),
    input: z.object({}),
    output: z.object({ createdAtCall: z.number() }),
    resources: [singleton],
  });

const unwrapExecution = async (
  target: ReturnType<typeof createSingletonTrail>
) => {
  const result = await executeTrail(target, {});
  return result.unwrap();
};

const requireCross = (
  ctx: TrailContext
): NonNullable<TrailContext['cross']> => {
  expect(ctx.cross).toBeDefined();
  return ctx.cross as NonNullable<TrailContext['cross']>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeTrail', () => {
  describe('happy path', () => {
    test('validates input and executes trail', async () => {
      const result = await executeTrail(echoTrail, { value: 'hello' });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ value: 'hello' });
    });

    test('eagerly resolves declared resources before layers and implementation run', async () => {
      const id = nextResourceId('eager');
      const captures = {
        createCalls: 0,
        gateResolved: undefined as number | undefined,
        runResolved: undefined as number | undefined,
      };
      const counter = createResolvedValueResource(
        id,
        () => {
          captures.createCalls += 1;
        },
        41
      );
      const layeredTrail = createEagerResourceTrail(id, counter, (value) => {
        captures.runResolved = value;
      });
      const layer = createResourceProbeGate(counter, (value) => {
        captures.gateResolved = value;
      });

      const result = await executeTrail(layeredTrail, {}, { layers: [layer] });

      expect(result.unwrap()).toEqual({ total: 42 });
      expect(captures.createCalls).toBe(1);
      expect(captures.gateResolved).toBe(41);
      expect(captures.runResolved).toBe(41);
    });

    test('awaits async resource factories before running the trail', async () => {
      const db = resource(nextResourceId('async-factory'), {
        create: async () => {
          await Bun.sleep(0);
          return Result.ok({ source: 'async-factory' });
        },
      });
      const resourceTrail = trail('resource.async-factory', {
        blaze: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [db],
      });

      const result = await executeTrail(resourceTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'async-factory' });
    });

    test('reuses cached singleton resources across executions', async () => {
      const id = nextResourceId('singleton');
      const captures = { createCalls: 0 };
      const singleton = createSingletonResource(id, () => {
        captures.createCalls += 1;
        return captures.createCalls;
      });
      const singletonTrail = createSingletonTrail(singleton);

      const outputs = [
        await unwrapExecution(singletonTrail),
        await unwrapExecution(singletonTrail),
      ];

      expect(outputs).toEqual([{ createdAtCall: 1 }, { createdAtCall: 1 }]);
      expect(captures.createCalls).toBe(1);
    });

    test('scopes cached singleton resources to compatible resource contexts', async () => {
      const id = nextResourceId('singleton-context');
      const envAwareResource = resource(id, {
        create: (ctx) => Result.ok({ value: String(ctx.env?.VAL) }),
      });
      const envAwareTrail = trail('resource.singleton-context', {
        blaze: (_input, ctx) =>
          Result.ok({ value: envAwareResource.from(ctx).value }),
        input: z.object({}),
        output: z.object({ value: z.string() }),
        resources: [envAwareResource],
      });

      const first = await executeTrail(
        envAwareTrail,
        {},
        {
          createContext: () =>
            createTrailContext({
              env: { VAL: 'first' },
            }),
        }
      );
      const second = await executeTrail(
        envAwareTrail,
        {},
        {
          createContext: () =>
            createTrailContext({
              env: { VAL: 'second' },
            }),
        }
      );

      expect(first.unwrap()).toEqual({ value: 'first' });
      expect(second.unwrap()).toEqual({ value: 'second' });
    });

    test('binds ctx.cross when topo access is available', async () => {
      const helper = trail('entity.secret.rotate', {
        blaze: (input: { id: string }) => Result.ok({ rotated: input.id }),
        input: z.object({ id: z.string() }),
        output: z.object({ rotated: z.string() }),
        visibility: 'internal',
      });
      const entry = trail('entity.rotate', {
        blaze: async (input: { id: string }, ctx) => {
          const crossed = await requireCross(ctx)(
            'entity.secret.rotate',
            input
          );
          return crossed.match({
            err: (error) => Result.err(error),
            ok: (value) => Result.ok(value),
          });
        },
        crosses: ['entity.secret.rotate'],
        input: z.object({ id: z.string() }),
        output: z.object({ rotated: z.string() }),
      });
      const app = topo('cross-topo', { entry, helper });

      const result = await executeTrail(entry, { id: 'abc123' }, { topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ rotated: 'abc123' });
    });

    test('validates merged crossInput fields when invoking through ctx.cross', async () => {
      const helper = trail('entity.prepare', {
        blaze: (input: { forkedFrom: string; id: string }) =>
          Result.ok({ summary: `${input.id}:${input.forkedFrom}` }),
        crossInput: z.object({ forkedFrom: z.string() }),
        input: z.object({ id: z.string() }),
        output: z.object({ summary: z.string() }),
        visibility: 'internal',
      });
      const entry = trail('entity.run', {
        blaze: async (input: { id: string }, ctx) => {
          const crossed = await requireCross(ctx)(helper, {
            forkedFrom: 'entity.run',
            id: input.id,
          });
          return crossed.match({
            err: (error) => Result.err(error),
            ok: (value) => Result.ok(value),
          });
        },
        crosses: [helper],
        input: z.object({ id: z.string() }),
        output: z.object({ summary: z.string() }),
      });
      const app = topo('cross-input-topo', { entry, helper });

      const result = await executeTrail(entry, { id: 'abc123' }, { topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ summary: 'abc123:entity.run' });
    });

    test('executes batch ctx.cross() calls concurrently and preserves tuple order', async () => {
      const completionOrder: string[] = [];
      const slow = trail('entity.slow', {
        blaze: async () => {
          await Bun.sleep(10);
          completionOrder.push('slow');
          return Result.ok({ id: 'slow' });
        },
        input: z.object({}),
        output: z.object({ id: z.string() }),
        visibility: 'internal',
      });
      const fast = trail('entity.fast', {
        blaze: async () => {
          await Bun.sleep(0);
          completionOrder.push('fast');
          return Result.ok({ id: 'fast' });
        },
        input: z.object({}),
        output: z.object({ id: z.string() }),
        visibility: 'internal',
      });
      const entry = trail('entity.batch', {
        blaze: async (_input, ctx) => {
          const crossed = await requireCross(ctx)([
            ['entity.slow', {}],
            ['entity.fast', {}],
          ]);
          return Result.ok({
            completionOrder,
            resultOrder: crossed.map((result) =>
              result.match({
                err: () => 'err',
                ok: (value) => value.id,
              })
            ),
          });
        },
        crosses: ['entity.fast', 'entity.slow'],
        input: z.object({}),
        output: z.object({
          completionOrder: z.array(z.string()),
          resultOrder: z.array(z.string()),
        }),
      });
      const app = topo('cross-batch-topo', { entry, fast, slow });

      const result = await executeTrail(entry, {}, { topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        completionOrder: ['fast', 'slow'],
        resultOrder: ['slow', 'fast'],
      });
    });

    test('returns every batch cross result without short-circuiting on errors', async () => {
      const completions: string[] = [];
      const failing = trail('entity.fail', {
        blaze: async () => {
          await Bun.sleep(0);
          completions.push('fail');
          return Result.err(new ValidationError('nope'));
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        visibility: 'internal',
      });
      const succeeding = trail('entity.ok', {
        blaze: async () => {
          await Bun.sleep(5);
          completions.push('ok');
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
        visibility: 'internal',
      });
      const entry = trail('entity.batch.errors', {
        blaze: async (_input, ctx) => {
          const crossed = await requireCross(ctx)([
            [failing, {}],
            [succeeding, {}],
          ] as const);
          return Result.ok({
            completions,
            statuses: crossed.map((result) =>
              result.match({
                err: () => 'err',
                ok: () => 'ok',
              })
            ),
          });
        },
        crosses: [failing, succeeding],
        input: z.object({}),
        output: z.object({
          completions: z.array(z.string()),
          statuses: z.array(z.string()),
        }),
      });
      const app = topo('cross-batch-errors-topo', {
        entry,
        failing,
        succeeding,
      });

      const result = await executeTrail(entry, {}, { topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        completions: ['fail', 'ok'],
        statuses: ['err', 'ok'],
      });
    });

    test('returns an empty array for empty batch ctx.cross() calls', async () => {
      const entry = trail('entity.batch.empty', {
        blaze: async (_input, ctx) => {
          const crossed = await requireCross(ctx)([]);
          return Result.ok({ count: crossed.length });
        },
        input: z.object({}),
        output: z.object({ count: z.number() }),
      });
      const app = topo('cross-batch-empty-topo', { entry });

      const result = await executeTrail(entry, {}, { topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ count: 0 });
    });
  });

  describe('validation', () => {
    test('returns validation error for invalid input', async () => {
      const result = await executeTrail(echoTrail, { value: 42 });

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
    });
  });

  describe('layers', () => {
    test('composes layers around execution', async () => {
      const log: string[] = [];
      const layer: Layer = {
        name: 'test-layer',
        wrap(_trail, impl) {
          return async (input, ctx) => {
            log.push('before');
            const r = await impl(input, ctx);
            log.push('after');
            return r;
          };
        },
      };

      const result = await executeTrail(
        echoTrail,
        { value: 'x' },
        { layers: [layer] }
      );

      expect(result.isOk()).toBe(true);
      expect(log).toEqual(['before', 'after']);
    });
  });

  describe('context', () => {
    test('accepts context overrides', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('ctx-test', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      await executeTrail(ctxTrail, {}, { ctx: { requestId: 'override-id' } });

      expect(capturedCtx?.requestId).toBe('override-id');
    });

    test('accepts abortSignal override', async () => {
      let capturedSignal: AbortSignal | undefined;
      const sigTrail = trail('sig-test', {
        blaze: (_input, ctx) => {
          capturedSignal = ctx.abortSignal;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      const abortSignal = AbortSignal.timeout(9999);
      await executeTrail(sigTrail, {}, { abortSignal });

      expect(capturedSignal).toBe(abortSignal);
    });

    test('accepts context factory', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('factory-test', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      const customCtx: TrailContextInit = {
        abortSignal: new AbortController().signal,
        cwd: '/custom',
        requestId: 'factory-id',
      };

      await executeTrail(ctxTrail, {}, { createContext: () => customCtx });

      expect(capturedCtx?.requestId).toBe('factory-id');
      expect(capturedCtx?.cwd).toBe('/custom');
    });

    test('context factory + ctx overrides merge correctly', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('merge-test', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
      });

      const baseCtx: TrailContextInit = {
        abortSignal: new AbortController().signal,
        cwd: '/factory',
        requestId: 'factory-id',
      };

      await executeTrail(
        ctxTrail,
        {},
        {
          createContext: () => baseCtx,
          ctx: { requestId: 'overridden-id' },
        }
      );

      expect(capturedCtx?.requestId).toBe('overridden-id');
      expect(capturedCtx?.cwd).toBe('/factory');
    });

    test('deep-merges extensions from factory and overrides', async () => {
      let captured: TrailContext | undefined;
      const t = trail('ext.test', {
        blaze: (_input, ctx) => {
          captured = ctx;
          return Result.ok({});
        },
        input: z.object({}),
        output: z.object({}),
      });
      await executeTrail(
        t,
        {},
        {
          createContext: () =>
            createTrailContext({ extensions: { store: 'db' } }),
          ctx: { extensions: { userId: '123' } },
        }
      );
      // Intrinsic tracing injects TRACE_CONTEXT_KEY into extensions; the
      // user-authored keys must still be present and untouched.
      expect(captured?.extensions?.store).toBe('db');
      expect(captured?.extensions?.userId).toBe('123');
    });

    test('rebinds ctx.resource after merging extension overrides from createContext', async () => {
      let resolvedSource: string | undefined;
      const db = resource(nextResourceId('context-override'), {
        create: () => Result.ok({ source: 'factory' }),
      });
      const resourceTrail = trail('ctx.resource.override', {
        blaze: (_input, ctx) => {
          resolvedSource = ctx.resource<{ source: string }>(db).source;
          return Result.ok({ source: resolvedSource });
        },
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [db],
      });

      const result = await executeTrail(
        resourceTrail,
        {},
        {
          createContext: () =>
            createTrailContext({
              extensions: {
                [db.id]: { source: 'factory-context' },
              },
            }),
          ctx: {
            extensions: {
              [db.id]: { source: 'override-context' },
            },
          },
        }
      );

      expect(result.unwrap()).toEqual({ source: 'override-context' });
      expect(resolvedSource).toBe('override-context');
    });

    test('context factory seeds the resource accessor when omitted', async () => {
      let capturedCtx: TrailContext | undefined;
      const id = nextResourceId('factory-seed');
      const widget = { id: 'widget-1' };
      const widgetTrail = trail('resource.factory-seed', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
        resources: [],
      });

      await executeTrail(
        widgetTrail,
        {},
        {
          createContext: () => ({
            abortSignal: new AbortController().signal,
            extensions: { [id]: widget },
            requestId: 'seeded-resource',
          }),
        }
      );

      expect(capturedCtx?.resource(id)).toBe(widget);
    });
  });

  describe('error handling', () => {
    test('propagates Result.err from run function', async () => {
      const result = await executeTrail(failingTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('bad input');
    });

    test('catches thrown exceptions and returns InternalError', async () => {
      const result = await executeTrail(throwingTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toBe('kaboom');
    });

    test('short-circuits when a resource factory returns Result.err', async () => {
      const failingResource = resource(nextResourceId('factory-error'), {
        create: () =>
          Result.err(new ValidationError('DATABASE_URL is required')),
      });
      let ran = false;
      const resourceTrail = trail('resource.factory-error', {
        blaze: () => {
          ran = true;
          return Result.ok(null);
        },
        input: z.object({}),
        resources: [failingResource],
      });

      const result = await executeTrail(resourceTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('DATABASE_URL is required');
      expect(ran).toBe(false);
    });

    test('wraps thrown resource factory exceptions with the resource ID in context', async () => {
      const explodingResource = resource(nextResourceId('factory-throw'), {
        create: () => {
          throw new Error('boom');
        },
      });
      const resourceTrail = trail('resource.factory-throw', {
        blaze: () => Result.ok(null),
        input: z.object({}),
        resources: [explodingResource],
      });

      const result = await executeTrail(resourceTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain(explodingResource.id);
      expect(result.error.context).toEqual({
        resourceId: explodingResource.id,
      });
    });

    test('prefers explicit resource overrides over cached or created instances', async () => {
      const id = nextResourceId('override');
      let createCalls = 0;
      const db = resource(id, {
        create: () => {
          createCalls += 1;
          return Result.ok({ source: 'factory' });
        },
      });
      const resourceTrail = trail('resource.override', {
        blaze: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        resources: [db],
      });

      const result = await executeTrail(
        resourceTrail,
        {},
        {
          resources: { [id]: { source: 'override' } },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'override' });
      expect(createCalls).toBe(0);
    });
  });
});
