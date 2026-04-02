/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { InternalError, ValidationError } from '../errors';
import { executeTrail } from '../execute';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';
import { Result } from '../result';
import { service } from '../service';
import { trail } from '../trail';
import type { TrailContext, TrailContextInit } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const echoTrail = trail('echo', {
  input: z.object({ value: z.string() }),
  output: z.object({ value: z.string() }),
  run: (input) => Result.ok({ value: input.value }),
});

const failingTrail = trail('fails', {
  input: z.object({}),
  run: () => Result.err(new ValidationError('bad input')),
});

const throwingTrail = trail('throws', {
  input: z.object({}),
  run: () => {
    throw new Error('kaboom');
  },
});

const nextServiceId = (name: string): string =>
  `test.service.${name}.${Bun.randomUUIDv7()}`;

const createResolvedValueService = (
  id: string,
  onCreate: () => void,
  value: number
) =>
  service(id, {
    create: () => {
      onCreate();
      return Result.ok({ value });
    },
  });

const createEagerServiceTrail = (
  id: string,
  counter: ReturnType<typeof createResolvedValueService>,
  onRun: (value: number) => void
) =>
  trail('service.eager', {
    input: z.object({}),
    output: z.object({ total: z.number() }),
    run: (_input, ctx) => {
      const fromAccessor = ctx.service<{ value: number }>(id);
      const fromDefinition = counter.from(ctx);
      onRun(fromDefinition.value);
      return Result.ok({ total: fromAccessor.value + 1 });
    },
    services: [counter],
  });

const createServiceProbeLayer = (
  counter: ReturnType<typeof createResolvedValueService>,
  onResolve: (value: number) => void
): Layer => ({
  name: 'uses-service',
  wrap(_trail, impl) {
    return async (input, ctx) => {
      onResolve(ctx.service<{ value: number }>(counter).value);
      return await impl(input, ctx);
    };
  },
});

const createSingletonService = (id: string, onCreate: () => number) =>
  service(id, {
    create: () => Result.ok({ createdAtCall: onCreate() }),
  });

const createSingletonTrail = (
  singleton: ReturnType<typeof createSingletonService>
) =>
  trail('service.singleton', {
    input: z.object({}),
    output: z.object({ createdAtCall: z.number() }),
    run: (_input, ctx) =>
      Result.ok({
        createdAtCall: singleton.from(ctx).createdAtCall,
      }),
    services: [singleton],
  });

const unwrapExecution = async (
  target: ReturnType<typeof createSingletonTrail>
) => {
  const result = await executeTrail(target, {});
  return result.unwrap();
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

    test('eagerly resolves declared services before layers and implementation run', async () => {
      const id = nextServiceId('eager');
      const captures = {
        createCalls: 0,
        layerResolved: undefined as number | undefined,
        runResolved: undefined as number | undefined,
      };
      const counter = createResolvedValueService(
        id,
        () => {
          captures.createCalls += 1;
        },
        41
      );
      const layeredTrail = createEagerServiceTrail(id, counter, (value) => {
        captures.runResolved = value;
      });
      const layer = createServiceProbeLayer(counter, (value) => {
        captures.layerResolved = value;
      });

      const result = await executeTrail(layeredTrail, {}, { layers: [layer] });

      expect(result.unwrap()).toEqual({ total: 42 });
      expect(captures.createCalls).toBe(1);
      expect(captures.layerResolved).toBe(41);
      expect(captures.runResolved).toBe(41);
    });

    test('awaits async service factories before running the trail', async () => {
      const db = service(nextServiceId('async-factory'), {
        create: async () => {
          await Bun.sleep(0);
          return Result.ok({ source: 'async-factory' });
        },
      });
      const serviceTrail = trail('service.async-factory', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        services: [db],
      });

      const result = await executeTrail(serviceTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'async-factory' });
    });

    test('reuses cached singleton services across executions', async () => {
      const id = nextServiceId('singleton');
      const captures = { createCalls: 0 };
      const singleton = createSingletonService(id, () => {
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

    test('scopes cached singleton services to compatible service contexts', async () => {
      const id = nextServiceId('singleton-context');
      const envAwareService = service(id, {
        create: (ctx) => Result.ok({ value: String(ctx.env?.VAL) }),
      });
      const envAwareTrail = trail('service.singleton-context', {
        input: z.object({}),
        output: z.object({ value: z.string() }),
        run: (_input, ctx) =>
          Result.ok({ value: envAwareService.from(ctx).value }),
        services: [envAwareService],
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
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
      });

      await executeTrail(ctxTrail, {}, { ctx: { requestId: 'override-id' } });

      expect(capturedCtx?.requestId).toBe('override-id');
    });

    test('accepts abortSignal override', async () => {
      let capturedSignal: AbortSignal | undefined;
      const sigTrail = trail('sig-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedSignal = ctx.abortSignal;
          return Result.ok(null);
        },
      });

      const abortSignal = AbortSignal.timeout(9999);
      await executeTrail(sigTrail, {}, { abortSignal });

      expect(capturedSignal).toBe(abortSignal);
    });

    test('accepts context factory', async () => {
      let capturedCtx: TrailContext | undefined;
      const ctxTrail = trail('factory-test', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
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
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
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
        input: z.object({}),
        output: z.object({}),
        run: (_input, ctx) => {
          captured = ctx;
          return Result.ok({});
        },
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
      expect(captured?.extensions).toEqual({ store: 'db', userId: '123' });
    });

    test('rebinds ctx.service after merging extension overrides from createContext', async () => {
      let resolvedSource: string | undefined;
      const db = service(nextServiceId('context-override'), {
        create: () => Result.ok({ source: 'factory' }),
      });
      const serviceTrail = trail('ctx.service.override', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) => {
          resolvedSource = ctx.service<{ source: string }>(db).source;
          return Result.ok({ source: resolvedSource });
        },
        services: [db],
      });

      const result = await executeTrail(
        serviceTrail,
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

    test('context factory seeds the service accessor when omitted', async () => {
      let capturedCtx: TrailContext | undefined;
      const id = nextServiceId('factory-seed');
      const widget = { id: 'widget-1' };
      const widgetTrail = trail('service.factory-seed', {
        input: z.object({}),
        run: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        services: [],
      });

      await executeTrail(
        widgetTrail,
        {},
        {
          createContext: () => ({
            abortSignal: new AbortController().signal,
            extensions: { [id]: widget },
            requestId: 'seeded-service',
          }),
        }
      );

      expect(capturedCtx?.service(id)).toBe(widget);
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

    test('short-circuits when a service factory returns Result.err', async () => {
      const failingService = service(nextServiceId('factory-error'), {
        create: () =>
          Result.err(new ValidationError('DATABASE_URL is required')),
      });
      let ran = false;
      const serviceTrail = trail('service.factory-error', {
        input: z.object({}),
        run: () => {
          ran = true;
          return Result.ok(null);
        },
        services: [failingService],
      });

      const result = await executeTrail(serviceTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('DATABASE_URL is required');
      expect(ran).toBe(false);
    });

    test('wraps thrown service factory exceptions with the service ID in context', async () => {
      const explodingService = service(nextServiceId('factory-throw'), {
        create: () => {
          throw new Error('boom');
        },
      });
      const serviceTrail = trail('service.factory-throw', {
        input: z.object({}),
        run: () => Result.ok(null),
        services: [explodingService],
      });

      const result = await executeTrail(serviceTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain(explodingService.id);
      expect(result.error.context).toEqual({ serviceId: explodingService.id });
    });

    test('prefers explicit service overrides over cached or created instances', async () => {
      const id = nextServiceId('override');
      let createCalls = 0;
      const db = service(id, {
        create: () => {
          createCalls += 1;
          return Result.ok({ source: 'factory' });
        },
      });
      const serviceTrail = trail('service.override', {
        input: z.object({}),
        output: z.object({ source: z.string() }),
        run: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        services: [db],
      });

      const result = await executeTrail(
        serviceTrail,
        {},
        {
          services: { [id]: { source: 'override' } },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'override' });
      expect(createCalls).toBe(0);
    });
  });
});
