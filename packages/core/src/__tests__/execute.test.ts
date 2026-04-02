/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { InternalError, ValidationError } from '../errors';
import { executeTrail } from '../execute';
import { createTrailContext } from '../context';
import type { Gate } from '../gate';
import { Result } from '../result';
import { provision } from '../provision';
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

const nextProvisionId = (name: string): string =>
  `test.provision.${name}.${Bun.randomUUIDv7()}`;

const createResolvedValueProvision = (
  id: string,
  onCreate: () => void,
  value: number
) =>
  provision(id, {
    create: () => {
      onCreate();
      return Result.ok({ value });
    },
  });

const createEagerProvisionTrail = (
  id: string,
  counter: ReturnType<typeof createResolvedValueProvision>,
  onRun: (value: number) => void
) =>
  trail('provision.eager', {
    blaze: (_input, ctx) => {
      const fromAccessor = ctx.provision<{ value: number }>(id);
      const fromDefinition = counter.from(ctx);
      onRun(fromDefinition.value);
      return Result.ok({ total: fromAccessor.value + 1 });
    },
    input: z.object({}),
    output: z.object({ total: z.number() }),
    provisions: [counter],
  });

const createProvisionProbeGate = (
  counter: ReturnType<typeof createResolvedValueProvision>,
  onResolve: (value: number) => void
): Gate => ({
  name: 'uses-provision',
  wrap(_trail, impl) {
    return async (input, ctx) => {
      onResolve(ctx.provision<{ value: number }>(counter).value);
      return await impl(input, ctx);
    };
  },
});

const createSingletonProvision = (id: string, onCreate: () => number) =>
  provision(id, {
    create: () => Result.ok({ createdAtCall: onCreate() }),
  });

const createSingletonTrail = (
  singleton: ReturnType<typeof createSingletonProvision>
) =>
  trail('provision.singleton', {
    blaze: (_input, ctx) =>
      Result.ok({
        createdAtCall: singleton.from(ctx).createdAtCall,
      }),
    input: z.object({}),
    output: z.object({ createdAtCall: z.number() }),
    provisions: [singleton],
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

    test('eagerly resolves declared provisions before gates and implementation run', async () => {
      const id = nextProvisionId('eager');
      const captures = {
        createCalls: 0,
        gateResolved: undefined as number | undefined,
        runResolved: undefined as number | undefined,
      };
      const counter = createResolvedValueProvision(
        id,
        () => {
          captures.createCalls += 1;
        },
        41
      );
      const layeredTrail = createEagerProvisionTrail(id, counter, (value) => {
        captures.runResolved = value;
      });
      const gate = createProvisionProbeGate(counter, (value) => {
        captures.gateResolved = value;
      });

      const result = await executeTrail(layeredTrail, {}, { gates: [gate] });

      expect(result.unwrap()).toEqual({ total: 42 });
      expect(captures.createCalls).toBe(1);
      expect(captures.gateResolved).toBe(41);
      expect(captures.runResolved).toBe(41);
    });

    test('awaits async provision factories before running the trail', async () => {
      const db = provision(nextProvisionId('async-factory'), {
        create: async () => {
          await Bun.sleep(0);
          return Result.ok({ source: 'async-factory' });
        },
      });
      const provisionTrail = trail('provision.async-factory', {
        blaze: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        provisions: [db],
      });

      const result = await executeTrail(provisionTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'async-factory' });
    });

    test('reuses cached singleton provisions across executions', async () => {
      const id = nextProvisionId('singleton');
      const captures = { createCalls: 0 };
      const singleton = createSingletonProvision(id, () => {
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

    test('scopes cached singleton provisions to compatible provision contexts', async () => {
      const id = nextProvisionId('singleton-context');
      const envAwareProvision = provision(id, {
        create: (ctx) => Result.ok({ value: String(ctx.env?.VAL) }),
      });
      const envAwareTrail = trail('provision.singleton-context', {
        blaze: (_input, ctx) =>
          Result.ok({ value: envAwareProvision.from(ctx).value }),
        input: z.object({}),
        output: z.object({ value: z.string() }),
        provisions: [envAwareProvision],
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

  describe('gates', () => {
    test('composes gates around execution', async () => {
      const log: string[] = [];
      const gate: Gate = {
        name: 'test-gate',
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
        { gates: [gate] }
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
      expect(captured?.extensions).toEqual({ store: 'db', userId: '123' });
    });

    test('rebinds ctx.provision after merging extension overrides from createContext', async () => {
      let resolvedSource: string | undefined;
      const db = provision(nextProvisionId('context-override'), {
        create: () => Result.ok({ source: 'factory' }),
      });
      const provisionTrail = trail('ctx.provision.override', {
        blaze: (_input, ctx) => {
          resolvedSource = ctx.provision<{ source: string }>(db).source;
          return Result.ok({ source: resolvedSource });
        },
        input: z.object({}),
        output: z.object({ source: z.string() }),
        provisions: [db],
      });

      const result = await executeTrail(
        provisionTrail,
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

    test('context factory seeds the provision accessor when omitted', async () => {
      let capturedCtx: TrailContext | undefined;
      const id = nextProvisionId('factory-seed');
      const widget = { id: 'widget-1' };
      const widgetTrail = trail('provision.factory-seed', {
        blaze: (_input, ctx) => {
          capturedCtx = ctx;
          return Result.ok(null);
        },
        input: z.object({}),
        provisions: [],
      });

      await executeTrail(
        widgetTrail,
        {},
        {
          createContext: () => ({
            abortSignal: new AbortController().signal,
            extensions: { [id]: widget },
            requestId: 'seeded-provision',
          }),
        }
      );

      expect(capturedCtx?.provision(id)).toBe(widget);
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

    test('short-circuits when a provision factory returns Result.err', async () => {
      const failingProvision = provision(nextProvisionId('factory-error'), {
        create: () =>
          Result.err(new ValidationError('DATABASE_URL is required')),
      });
      let ran = false;
      const provisionTrail = trail('provision.factory-error', {
        blaze: () => {
          ran = true;
          return Result.ok(null);
        },
        input: z.object({}),
        provisions: [failingProvision],
      });

      const result = await executeTrail(provisionTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('DATABASE_URL is required');
      expect(ran).toBe(false);
    });

    test('wraps thrown provision factory exceptions with the provision ID in context', async () => {
      const explodingProvision = provision(nextProvisionId('factory-throw'), {
        create: () => {
          throw new Error('boom');
        },
      });
      const provisionTrail = trail('provision.factory-throw', {
        blaze: () => Result.ok(null),
        input: z.object({}),
        provisions: [explodingProvision],
      });

      const result = await executeTrail(provisionTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
      expect(result.error.message).toContain(explodingProvision.id);
      expect(result.error.context).toEqual({
        provisionId: explodingProvision.id,
      });
    });

    test('prefers explicit provision overrides over cached or created instances', async () => {
      const id = nextProvisionId('override');
      let createCalls = 0;
      const db = provision(id, {
        create: () => {
          createCalls += 1;
          return Result.ok({ source: 'factory' });
        },
      });
      const provisionTrail = trail('provision.override', {
        blaze: (_input, ctx) =>
          Result.ok({ source: db.from(ctx).source as string }),
        input: z.object({}),
        output: z.object({ source: z.string() }),
        provisions: [db],
      });

      const result = await executeTrail(
        provisionTrail,
        {},
        {
          provisions: { [id]: { source: 'override' } },
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ source: 'override' });
      expect(createCalls).toBe(0);
    });
  });
});
