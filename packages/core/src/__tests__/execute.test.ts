/* oxlint-disable require-await -- trail implementations satisfy async interface without awaiting */
import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import {
  CancelledError,
  ConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  RetryExhaustedError,
  TrailsError,
  ValidationError,
} from '../errors';
import { executeTrail } from '../execute';
import {
  TRACE_CONTEXT_KEY,
  clearTraceSink,
  registerTraceSink,
} from '../internal/tracing';
import type { TraceRecord } from '../internal/tracing';
import { createTrailContext } from '../context';
import type { Layer } from '../layer';
import { Result } from '../result';
import { resource } from '../resource';
import { drainResources } from '../resource-config';
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

const waitForAbort = async (signal: AbortSignal): Promise<void> => {
  if (signal.aborted) {
    return;
  }

  const { promise, resolve } = Promise.withResolvers<undefined>();
  signal.addEventListener('abort', () => resolve(), { once: true });
  await promise;
};

const createConcurrentBranchResourceScopeScenario = () => {
  const id = nextResourceId('branch-scope');
  const captures = { createCalls: 0 };
  const scopedResource = resource(id, {
    create: () => {
      captures.createCalls += 1;
      return Result.ok({ source: `branch-scope-${captures.createCalls}` });
    },
  });
  const createReader = (trailId: string) =>
    trail(trailId, {
      blaze: (_input, ctx) =>
        Result.ok({ source: scopedResource.from(ctx).source }),
      input: z.object({}),
      output: z.object({ source: z.string() }),
      resources: [scopedResource],
      visibility: 'internal',
    });
  const left = createReader('entity.branch.left');
  const right = createReader('entity.branch.right');
  const entry = trail('entity.branch.resource-scope', {
    blaze: async (_input, ctx) => {
      const crossed = await requireCross(ctx)([
        [left, {}],
        [right, {}],
      ] as const);
      return Result.ok({
        sources: crossed.map((result) =>
          result.match({
            err: () => 'err',
            ok: (value) => value.source,
          })
        ),
      });
    },
    crosses: [left, right],
    input: z.object({}),
    output: z.object({ sources: z.array(z.string()) }),
  });

  return {
    app: topo('cross-branch-resource-scope-topo', {
      entry,
      left,
      right,
      scopedResource,
    }),
    captures,
    entry,
    id,
  };
};

const createAbortSignalScenario = (seenSignals: AbortSignal[]) => {
  const createCancellable = (id: string) =>
    trail(id, {
      blaze: async (_input, ctx) => {
        seenSignals.push(ctx.abortSignal);
        await waitForAbort(ctx.abortSignal);
        return Result.err(
          new CancelledError(`${id} cancelled by shared abort signal`)
        );
      },
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });
  const left = createCancellable('entity.cancel.left');
  const right = createCancellable('entity.cancel.right');
  const entry = trail('entity.branch.abort-signal', {
    blaze: async (_input, ctx) => {
      const crossed = await requireCross(ctx)([
        [left, {}],
        [right, {}],
      ] as const);
      return Result.ok({
        statuses: crossed.map((result) =>
          result.match({
            err: (error) =>
              error instanceof CancelledError ? error.category : 'err',
            ok: () => 'ok',
          })
        ),
      });
    },
    crosses: [left, right],
    input: z.object({}),
    output: z.object({ statuses: z.array(z.string()) }),
  });

  return {
    app: topo('cross-branch-abort-signal-topo', {
      entry,
      left,
      right,
    }),
    entry,
  };
};

interface PermitCapture {
  readonly permitId: string;
  readonly sameReference: boolean;
}

const createPermitScenario = (
  permit: { readonly id: string; readonly scopes: readonly string[] },
  captures: PermitCapture[]
) => {
  const createChild = (id: string) =>
    trail(id, {
      blaze: (_input, ctx) => {
        const branchPermit = ctx.permit as typeof permit;
        const permitCapture = {
          permitId: branchPermit.id,
          sameReference: branchPermit === permit,
        };
        captures.push(permitCapture);
        return Result.ok(permitCapture);
      },
      input: z.object({}),
      output: z.object({
        permitId: z.string(),
        sameReference: z.boolean(),
      }),
      visibility: 'internal',
    });
  const left = createChild('entity.permit.left');
  const right = createChild('entity.permit.right');
  const entry = trail('entity.branch.permit', {
    blaze: async (_input, ctx) => {
      const crossed = await requireCross(ctx)([
        [left, {}],
        [right, {}],
      ] as const);
      return Result.ok({
        permits: crossed.map((result) =>
          result.match({
            err: () => ({ permitId: 'err', sameReference: false }),
            ok: (value) => value,
          })
        ),
      });
    },
    crosses: [left, right],
    input: z.object({}),
    output: z.object({
      permits: z.array(
        z.object({
          permitId: z.string(),
          sameReference: z.boolean(),
        })
      ),
    }),
  });

  return {
    app: topo('cross-branch-permit-topo', {
      entry,
      left,
      right,
    }),
    entry,
  };
};

const createSiblingFailureScopeScenario = () => {
  const failingId = nextResourceId('branch-fail');
  const succeedingId = nextResourceId('branch-success');
  const failingResource = resource(failingId, {
    create: () =>
      Result.err(new ValidationError('failing branch scope exploded')),
  });
  const succeedingResource = resource(succeedingId, {
    create: () => Result.ok({ source: 'sibling-branch-scope' }),
  });
  const failing = trail('entity.scope.fail', {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({}),
    output: z.object({ ok: z.boolean() }),
    resources: [failingResource],
    visibility: 'internal',
  });
  const succeeding = trail('entity.scope.ok', {
    blaze: (_input, ctx) =>
      Result.ok({ source: succeedingResource.from(ctx).source }),
    input: z.object({}),
    output: z.object({ source: z.string() }),
    resources: [succeedingResource],
    visibility: 'internal',
  });
  const entry = trail('entity.branch.failure-scope', {
    blaze: async (_input, ctx) => {
      const [failed, succeeded] = await requireCross(ctx)([
        [failing, {}],
        [succeeding, {}],
      ] as const);
      return Result.ok({
        failed: failed.match({
          err: (error) => error.message,
          ok: () => 'ok',
        }),
        succeeded: succeeded.match({
          err: () => 'err',
          ok: (value) => value.source,
        }),
      });
    },
    crosses: [failing, succeeding],
    input: z.object({}),
    output: z.object({
      failed: z.string(),
      succeeded: z.string(),
    }),
  });

  return {
    app: topo('cross-branch-failure-scope-topo', {
      entry,
      failing,
      failingResource,
      succeeding,
      succeedingResource,
    }),
    entry,
    failingId,
    succeedingId,
  };
};

const createConcurrencyWorkerScenario = () => {
  const captures = {
    active: 0,
    completionOrder: [] as string[],
    maxActive: 0,
  };
  const worker = trail('entity.concurrent.worker', {
    blaze: async (input: { delayMs: number; label: string }) => {
      captures.active += 1;
      captures.maxActive = Math.max(captures.maxActive, captures.active);
      await Bun.sleep(input.delayMs);
      captures.completionOrder.push(input.label);
      captures.active -= 1;
      return Result.ok({ label: input.label });
    },
    input: z.object({
      delayMs: z.number(),
      label: z.string(),
    }),
    output: z.object({ label: z.string() }),
    visibility: 'internal',
  });

  return { captures, worker };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeTrail', () => {
  describe('happy path', () => {
    describe('execution and resources', () => {
      test('validates input and executes trail', async () => {
        const result = await executeTrail(echoTrail, { value: 'hello' });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual({ value: 'hello' });
      });

      test('validates successful output before returning it', async () => {
        const invalidOutputTrail = trail('output.invalid', {
          blaze: () => Result.ok({ value: 42 }),
          input: z.object({}),
          output: z.object({ value: z.string() }),
        });

        const result = await executeTrail(invalidOutputTrail, {});

        expect(result.isErr()).toBe(true);
        if (result.isErr()) {
          expect(result.error).toBeInstanceOf(ValidationError);
          expect(result.error.message).toContain('Output validation failed');
        }
      });

      test('returns parsed output schema values', async () => {
        const defaultedOutputTrail = trail('output.defaulted', {
          blaze: () => Result.ok({}),
          input: z.object({}),
          output: z.object({ ok: z.boolean().default(true) }),
        });

        const result = await executeTrail(defaultedOutputTrail, {});

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual({ ok: true });
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

        const result = await executeTrail(
          layeredTrail,
          {},
          { layers: [layer] }
        );

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

      test('rolls back newly created resources when a later resource fails', async () => {
        const events: string[] = [];
        const created = resource(nextResourceId('rollback-created'), {
          create: () => {
            events.push('create:first');
            return Result.ok({ label: 'first' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const failing = resource(nextResourceId('rollback-failing'), {
          create: () => {
            events.push('create:second');
            return Result.err(new ValidationError('second unavailable'));
          },
        });
        const resourceTrail = trail('resource.rollback', {
          blaze: () => Result.ok(null),
          input: z.object({}),
          resources: [created, failing],
        });

        const first = await executeTrail(resourceTrail, {});
        const second = await executeTrail(resourceTrail, {});

        expect(first.isErr()).toBe(true);
        expect(first.error).toBeInstanceOf(ValidationError);
        expect(second.isErr()).toBe(true);
        expect(events).toEqual([
          'create:first',
          'create:second',
          'dispose:first',
          'create:first',
          'create:second',
          'dispose:first',
        ]);
      });

      test('reports rollback disposal failures with the original create failure as cause', async () => {
        const original = new ValidationError('second unavailable');
        const created = resource(nextResourceId('rollback-dispose-failure'), {
          create: () => Result.ok({ label: 'first' }),
          dispose: () => {
            throw new Error('dispose exploded');
          },
        });
        const failing = resource(nextResourceId('rollback-original'), {
          create: () => Result.err(original),
        });
        const resourceTrail = trail('resource.rollback-dispose-failure', {
          blaze: () => Result.ok(null),
          input: z.object({}),
          resources: [created, failing],
        });

        const result = await executeTrail(resourceTrail, {});

        expect(result.isErr()).toBe(true);
        expect(result.error).toBeInstanceOf(InternalError);
        expect(result.error.message).toContain('rollback also failed');
        expect(result.error.cause).toBe(original);
        expect(result.error.context?.failures).toEqual([
          {
            context: {
              failures: [
                {
                  context: { resourceId: created.id },
                  message: `Resource "${created.id}" failed to dispose: dispose exploded`,
                  name: 'InternalError',
                },
              ],
            },
            message: 'Resource rollback failed during resource resolution',
            name: 'InternalError',
          },
        ]);
      });

      test('does not dispose rollback resources shared with another in-flight execution', async () => {
        const sharedCreated = Promise.withResolvers<undefined>();
        const secondCanRead = Promise.withResolvers<undefined>();
        const events: string[] = [];
        const shared = resource(nextResourceId('rollback-shared'), {
          create: async () => {
            events.push('create:shared');
            await sharedCreated.promise;
            return Result.ok({ closed: false });
          },
          dispose: (instance) => {
            instance.closed = true;
            events.push('dispose:shared');
          },
        });
        const failing = resource(nextResourceId('rollback-shared-failing'), {
          create: () => Result.err(new ValidationError('second unavailable')),
        });
        const firstTrail = trail('resource.rollback-shared.first', {
          blaze: () => Result.ok(null),
          input: z.object({}),
          resources: [shared, failing],
        });
        const secondTrail = trail('resource.rollback-shared.second', {
          blaze: async (_input, ctx) => {
            await secondCanRead.promise;
            return Result.ok({ closed: shared.from(ctx).closed });
          },
          input: z.object({}),
          output: z.object({ closed: z.boolean() }),
          resources: [shared],
        });

        const first = executeTrail(firstTrail, {});
        const second = executeTrail(secondTrail, {});
        await Bun.sleep(0);
        sharedCreated.resolve();
        const firstResult = await first;
        secondCanRead.resolve();
        const secondResult = await second;

        expect(firstResult.isErr()).toBe(true);
        expect(secondResult.unwrap()).toEqual({ closed: false });
        expect(events).toEqual(['create:shared']);
      });

      test('releases duplicate resource declarations before rollback disposal', async () => {
        const events: string[] = [];
        const shared = resource(nextResourceId('rollback-duplicate'), {
          create: () => {
            events.push('create:shared');
            return Result.ok({ label: 'shared' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const failing = resource(nextResourceId('rollback-duplicate-failing'), {
          create: () => {
            events.push('create:failing');
            return Result.err(new ValidationError('second unavailable'));
          },
        });
        const resourceTrail = trail('resource.rollback-duplicate', {
          blaze: () => Result.ok(null),
          input: z.object({}),
          resources: [shared, shared, failing],
        });

        const result = await executeTrail(resourceTrail, {});
        const drained = await drainResources([shared], createTrailContext());

        expect(result.isErr()).toBe(true);
        expect(result.error).toBeInstanceOf(ValidationError);
        expect(drained.unwrap()).toEqual({ disposed: [], evicted: [] });
        expect(events).toEqual([
          'create:shared',
          'create:failing',
          'dispose:shared',
        ]);
      });

      test('releases leases acquired from cached unconfigured resources', async () => {
        const events: string[] = [];
        const cached = resource(nextResourceId('cached-unconfigured'), {
          create: () => {
            events.push('create:cached');
            return Result.ok({ label: 'cached' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const resourceTrail = trail('resource.cached-unconfigured', {
          blaze: (_input, ctx) => Result.ok(cached.from(ctx).label),
          input: z.object({}),
          output: z.string(),
          resources: [cached],
        });

        const first = await executeTrail(resourceTrail, {});
        const second = await executeTrail(resourceTrail, {});
        const drained = await drainResources([cached], createTrailContext());

        expect(first.unwrap()).toBe('cached');
        expect(second.unwrap()).toBe('cached');
        expect(drained.unwrap()).toEqual({
          disposed: [cached.id],
          evicted: [cached.id],
        });
        expect(events).toEqual(['create:cached', 'dispose:cached']);
      });

      test('drain reports resources with in-flight creation as in use', async () => {
        const createCanFinish = Promise.withResolvers<undefined>();
        const events: string[] = [];
        const pending = resource(nextResourceId('drain-pending'), {
          create: async () => {
            events.push('create:start');
            await createCanFinish.promise;
            events.push('create:finish');
            return Result.ok({ label: 'pending' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const resourceTrail = trail('resource.drain-pending', {
          blaze: (_input, ctx) =>
            Result.ok({ label: pending.from(ctx).label as string }),
          input: z.object({}),
          output: z.object({ label: z.string() }),
          resources: [pending],
        });

        const executing = executeTrail(resourceTrail, {});
        await Bun.sleep(0);
        const drainedWhilePending = await drainResources(
          [pending],
          createTrailContext()
        );
        createCanFinish.resolve();
        const execution = await executing;
        const drainedAfterExecution = await drainResources(
          [pending],
          createTrailContext()
        );

        expect(drainedWhilePending.isErr()).toBe(true);
        expect(drainedWhilePending.error).toBeInstanceOf(InternalError);
        expect(drainedWhilePending.error.message).toBe('Resource drain failed');
        expect(drainedWhilePending.error.context).toMatchObject({
          disposed: [],
          evicted: [],
          failures: [
            {
              context: {
                activeLeases: 1,
                resourceId: pending.id,
              },
              message: `Resource "${pending.id}" is still in use`,
              name: 'InternalError',
            },
          ],
        });
        expect(execution.unwrap()).toEqual({ label: 'pending' });
        expect(drainedAfterExecution.unwrap()).toEqual({
          disposed: [pending.id],
          evicted: [pending.id],
        });
        expect(events).toEqual([
          'create:start',
          'create:finish',
          'dispose:pending',
        ]);
      });

      test('draining an uncached configured resource is a no-op without config values', async () => {
        const configured = resource(nextResourceId('drain-uncached-config'), {
          config: z.object({ token: z.string() }),
          create: () => Result.ok({ label: 'configured' }),
          dispose: () => {
            throw new Error('should not dispose');
          },
        });

        const drained = await drainResources(
          [configured],
          createTrailContext()
        );

        expect(drained.unwrap()).toEqual({ disposed: [], evicted: [] });
      });

      test('drains cached resources in reverse order and evicts them', async () => {
        const events: string[] = [];
        const first = resource(nextResourceId('drain-first'), {
          create: () => {
            events.push('create:first');
            return Result.ok({ label: 'first' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const second = resource(nextResourceId('drain-second'), {
          create: () => {
            events.push('create:second');
            return Result.ok({ label: 'second' });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const resourceTrail = trail('resource.drain', {
          blaze: (_input, ctx) =>
            Result.ok({
              first: first.from(ctx).label,
              second: second.from(ctx).label,
            }),
          input: z.object({}),
          output: z.object({ first: z.string(), second: z.string() }),
          resources: [first, second],
        });

        const beforeDrain = await executeTrail(resourceTrail, {});
        const drained = await drainResources(
          [first, second],
          createTrailContext()
        );
        const afterDrain = await executeTrail(resourceTrail, {});

        expect(beforeDrain.isOk()).toBe(true);
        expect(afterDrain.isOk()).toBe(true);
        expect(drained.unwrap()).toEqual({
          disposed: [second.id, first.id],
          evicted: [second.id, first.id],
        });
        expect(events).toEqual([
          'create:first',
          'create:second',
          'dispose:second',
          'dispose:first',
          'create:first',
          'create:second',
        ]);
      });

      test('drain evicts cached configured resources even when supplied config is invalid', async () => {
        const events: string[] = [];
        const configured = resource(nextResourceId('drain-invalid-config'), {
          config: z.object({ token: z.string() }),
          create: (ctx) => {
            events.push(`create:${ctx.config.token}`);
            return Result.ok({ token: ctx.config.token });
          },
          dispose: (instance) => {
            events.push(`dispose:${instance.token}`);
          },
        });
        const resourceTrail = trail('resource.drain-invalid-config', {
          blaze: (_input, ctx) =>
            Result.ok({ token: configured.from(ctx).token }),
          input: z.object({}),
          output: z.object({ token: z.string() }),
          resources: [configured],
        });

        const beforeDrain = await executeTrail(
          resourceTrail,
          {},
          {
            configValues: { [configured.id]: { token: 'valid' } },
          }
        );
        const drained = await drainResources(
          [configured],
          createTrailContext(),
          { [configured.id]: { token: 42 } }
        );
        const afterDrain = await executeTrail(
          resourceTrail,
          {},
          {
            configValues: { [configured.id]: { token: 'valid' } },
          }
        );

        expect(beforeDrain.unwrap()).toEqual({ token: 'valid' });
        expect(drained.isErr()).toBe(true);
        expect(drained.error).toBeInstanceOf(InternalError);
        expect(drained.error.context).toMatchObject({
          disposed: [configured.id],
          evicted: [configured.id],
        });
        expect(afterDrain.unwrap()).toEqual({ token: 'valid' });
        expect(events).toEqual([
          'create:valid',
          'dispose:valid',
          'create:valid',
        ]);
      });

      test('drain reports disposal failures and still drains sibling resources', async () => {
        const events: string[] = [];
        const failing = resource(nextResourceId('drain-failing'), {
          create: () => Result.ok({ label: 'failing' }),
          dispose: () => {
            events.push('dispose:failing');
            throw new Error('close failed');
          },
        });
        const succeeding = resource(nextResourceId('drain-succeeding'), {
          create: () => Result.ok({ label: 'succeeding' }),
          dispose: (instance) => {
            events.push(`dispose:${instance.label}`);
          },
        });
        const resourceTrail = trail('resource.drain-failure', {
          blaze: (_input, ctx) =>
            Result.ok({
              failing: failing.from(ctx).label,
              succeeding: succeeding.from(ctx).label,
            }),
          input: z.object({}),
          output: z.object({ failing: z.string(), succeeding: z.string() }),
          resources: [failing, succeeding],
        });

        const beforeDrain = await executeTrail(resourceTrail, {});
        const drained = await drainResources(
          [failing, succeeding],
          createTrailContext()
        );

        expect(beforeDrain.isOk()).toBe(true);
        expect(drained.isErr()).toBe(true);
        expect(drained.error).toBeInstanceOf(InternalError);
        expect(drained.error.message).toBe('Resource drain failed');
        expect(drained.error.context).toMatchObject({
          disposed: [succeeding.id],
          evicted: [succeeding.id, failing.id],
        });
        expect(events).toEqual(['dispose:succeeding', 'dispose:failing']);
      });
    });

    describe('crossing execution', () => {
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

        const result = await executeTrail(
          entry,
          { id: 'abc123' },
          { topo: app }
        );

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

        const result = await executeTrail(
          entry,
          { id: 'abc123' },
          { topo: app }
        );

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
                  ok: (value) => (value as { id: string }).id,
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

      test('limits batch ctx.cross() execution to sequential flow when concurrency is 1', async () => {
        const { captures, worker } = createConcurrencyWorkerScenario();
        const entry = trail('entity.batch.sequential-limit', {
          blaze: async (_input, ctx) => {
            const crossed = await requireCross(ctx)(
              [
                [worker, { delayMs: 5, label: 'first' }],
                [worker, { delayMs: 0, label: 'second' }],
                [worker, { delayMs: 0, label: 'third' }],
              ] as const,
              { concurrency: 1 }
            );
            return Result.ok({
              completionOrder: captures.completionOrder,
              maxActive: captures.maxActive,
              resultOrder: crossed.map((result) =>
                result.match({
                  err: () => 'err',
                  ok: (value) => value.label,
                })
              ),
            });
          },
          crosses: [worker],
          input: z.object({}),
          output: z.object({
            completionOrder: z.array(z.string()),
            maxActive: z.number(),
            resultOrder: z.array(z.string()),
          }),
        });
        const app = topo('cross-batch-sequential-limit-topo', {
          entry,
          worker,
        });

        const result = await executeTrail(entry, {}, { topo: app });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual({
          completionOrder: ['first', 'second', 'third'],
          maxActive: 1,
          resultOrder: ['first', 'second', 'third'],
        });
      });

      test('caps concurrent batch ctx.cross() execution and preserves input order', async () => {
        const { captures, worker } = createConcurrencyWorkerScenario();
        const labels = Array.from(
          { length: 10 },
          (_, index) => `task-${index}`
        );
        const entry = trail('entity.batch.concurrent-limit', {
          blaze: async (_input, ctx) => {
            const crossed = await requireCross(ctx)(
              labels.map((label) => [worker, { delayMs: 5, label }] as const),
              { concurrency: 3 }
            );
            return Result.ok({
              completionCount: captures.completionOrder.length,
              maxActive: captures.maxActive,
              resultOrder: crossed.map((result) =>
                result.match({
                  err: () => 'err',
                  ok: (value) => value.label,
                })
              ),
            });
          },
          crosses: [worker],
          input: z.object({}),
          output: z.object({
            completionCount: z.number(),
            maxActive: z.number(),
            resultOrder: z.array(z.string()),
          }),
        });
        const app = topo('cross-batch-concurrent-limit-topo', {
          entry,
          worker,
        });

        const result = await executeTrail(entry, {}, { topo: app });

        expect(result.isOk()).toBe(true);
        expect(result.unwrap()).toEqual({
          completionCount: 10,
          maxActive: 3,
          resultOrder: labels,
        });
      });

      describe.each([
        { label: '0', value: 0 },
        { label: '-1', value: -1 },
        { label: '1.5', value: 1.5 },
        { label: 'NaN', value: Number.NaN },
      ])(
        'rejects batch ctx.cross() calls with invalid concurrency $label',
        ({ value }) => {
          test('produces a ValidationError for every branch without running any', async () => {
            const branchRuns: string[] = [];
            const child = trail('entity.batch.invalid-concurrency.child', {
              blaze: async () => {
                branchRuns.push('ran');
                return Result.ok({ id: 'child' });
              },
              input: z.object({}),
              output: z.object({ id: z.string() }),
              visibility: 'internal',
            });
            const entry = trail('entity.batch.invalid-concurrency.entry', {
              blaze: async (_input, ctx) => {
                const crossed = await requireCross(ctx)(
                  [
                    [child, {}],
                    [child, {}],
                  ] as const,
                  { concurrency: value }
                );
                return Result.ok({
                  statuses: crossed.map((result) =>
                    result.match({
                      err: (error) => ({
                        isValidation: error instanceof ValidationError,
                        message: error.message,
                      }),
                      ok: () => ({ isValidation: false, message: 'ok' }),
                    })
                  ),
                });
              },
              crosses: [child],
              input: z.object({}),
              output: z.object({
                statuses: z.array(
                  z.object({
                    isValidation: z.boolean(),
                    message: z.string(),
                  })
                ),
              }),
            });
            const app = topo(
              `cross-batch-invalid-concurrency-${String(value)}-topo`,
              { child, entry }
            );

            const result = await executeTrail(entry, {}, { topo: app });

            expect(result.isOk()).toBe(true);
            expect(result.unwrap()).toEqual({
              statuses: [
                {
                  isValidation: true,
                  message:
                    'ctx.cross() batch concurrency must be a positive integer',
                },
                {
                  isValidation: true,
                  message:
                    'ctx.cross() batch concurrency must be a positive integer',
                },
              ],
            });
            expect(branchRuns).toEqual([]);
          });
        }
      );
    });
  });

  describe('concurrent crossings', () => {
    test('resolves concurrent branch resources from branch scope instead of inheriting parent resources', async () => {
      const { app, captures, entry, id } =
        createConcurrentBranchResourceScopeScenario();

      const result = await executeTrail(
        entry,
        {},
        {
          ctx: { extensions: { [id]: { source: 'parent-scope' } } },
          topo: app,
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        sources: ['branch-scope-1', 'branch-scope-1'],
      });
      expect(captures.createCalls).toBe(1);
    });

    test('propagates the same AbortSignal to every concurrent branch', async () => {
      const seenSignals: AbortSignal[] = [];
      const { app, entry } = createAbortSignalScenario(seenSignals);
      const abortSignal = AbortSignal.timeout(5);

      const result = await executeTrail(entry, {}, { abortSignal, topo: app });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        statuses: ['cancelled', 'cancelled'],
      });
      expect(seenSignals).toEqual([abortSignal, abortSignal]);
    });

    test('propagates the parent permit to every concurrent branch', async () => {
      const permit = Object.freeze({
        id: 'permit-orders',
        scopes: ['orders:read'] as const,
      });
      const captures: PermitCapture[] = [];
      const { app, entry } = createPermitScenario(permit, captures);

      const result = await executeTrail(
        entry,
        {},
        { ctx: { permit }, topo: app }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        permits: [
          { permitId: 'permit-orders', sameReference: true },
          { permitId: 'permit-orders', sameReference: true },
        ],
      });
      expect(captures).toEqual([
        { permitId: 'permit-orders', sameReference: true },
        { permitId: 'permit-orders', sameReference: true },
      ]);
    });

    test("keeps one branch's failure from poisoning sibling branch scopes", async () => {
      const { app, entry, failingId, succeedingId } =
        createSiblingFailureScopeScenario();

      const result = await executeTrail(
        entry,
        {},
        {
          ctx: {
            extensions: {
              [failingId]: { source: 'parent-failing-scope' },
              [succeedingId]: { source: 'parent-success-scope' },
            },
          },
          topo: app,
        }
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        failed: 'failing branch scope exploded',
        succeeded: 'sibling-branch-scope',
      });
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
      // User-authored extension keys must stay intact regardless of whether
      // tracing later adds its own internal bookkeeping.
      expect(captured?.extensions?.store).toBe('db');
      expect(captured?.extensions?.userId).toBe('123');
    });

    test('keeps ctx.trace in passthrough mode when NOOP_SINK is installed', async () => {
      clearTraceSink();

      let sawTraceContext = true;
      const probe = trail('ctx.trace.noop-sink', {
        blaze: async (_input, ctx) => {
          const value = await ctx.trace('inner', () => Promise.resolve(42));
          sawTraceContext = ctx.extensions?.[TRACE_CONTEXT_KEY] !== undefined;
          return Result.ok({ value });
        },
        input: z.object({}),
        output: z.object({ value: z.number() }),
      });

      const result = await executeTrail(probe, {});

      expect(result).toEqual(Result.ok({ value: 42 }));
      expect(sawTraceContext).toBe(false);
    });

    test('records output validation failures as validation trace errors', async () => {
      const records: TraceRecord[] = [];
      registerTraceSink({ write: (record) => records.push(record) });

      try {
        const invalidOutputTrail = trail('trace.output.invalid', {
          blaze: () => Result.ok({ value: 42 }),
          input: z.object({}),
          output: z.object({ value: z.string() }),
        });

        const result = await executeTrail(invalidOutputTrail, {});

        expect(result.isErr()).toBe(true);
        const root = records.find(
          (record) => record.trailId === 'trace.output.invalid'
        );
        expect(root?.status).toBe('err');
        expect(root?.errorCategory).toBe('validation');
      } finally {
        clearTraceSink();
      }
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

  // ---------------------------------------------------------------------------
  // Detour execution
  // ---------------------------------------------------------------------------

  describe('detour execution', () => {
    test('detour recovers successfully from matching error', async () => {
      const detourTrail = trail('detour.recover', {
        blaze: () => Result.err(new ConflictError('version mismatch')),
        detours: [
          {
            on: ConflictError,
            recover: async () => Result.ok({ recovered: true }),
          },
        ],
        input: z.object({}),
        output: z.object({ recovered: z.boolean() }),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ recovered: true });
    });

    test('exhaustion produces RetryExhaustedError with category inheritance', async () => {
      const detourTrail = trail('detour.exhaust', {
        blaze: () => Result.err(new ConflictError('version mismatch')),
        detours: [
          {
            maxAttempts: 2,
            on: ConflictError,
            recover: async () =>
              Result.err(new ConflictError('still conflicting')),
          },
        ],
        input: z.object({}),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isErr()).toBe(true);
      const { error } = result;
      expect(error).toBeInstanceOf(RetryExhaustedError);
      expect(error).toBeInstanceOf(InternalError);
      const exhausted = error as RetryExhaustedError;
      expect(exhausted.category).toBe('conflict');
      expect(exhausted.retryable).toBe(false);
      expect(exhausted.cause).toBeInstanceOf(ConflictError);
    });

    test('non-matching error passes through unchanged', async () => {
      const detourTrail = trail('detour.nomatch', {
        blaze: () => Result.err(new NotFoundError('missing')),
        detours: [
          {
            on: ConflictError,
            recover: async () => Result.ok({ recovered: true }),
          },
        ],
        input: z.object({}),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(NotFoundError);
    });

    test('declaration-order matching — first matching detour wins', async () => {
      const calls: string[] = [];
      const detourTrail = trail('detour.order', {
        blaze: () => Result.err(new ConflictError('conflict')),
        detours: [
          {
            on: TrailsError,
            recover: async () => {
              calls.push('TrailsError');
              return Result.ok({ winner: 'superclass' });
            },
          },
          {
            on: ConflictError,
            recover: async () => {
              calls.push('ConflictError');
              return Result.ok({ winner: 'subclass' });
            },
          },
        ],
        input: z.object({}),
        output: z.object({ winner: z.string() }),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ winner: 'superclass' });
      expect(calls).toEqual(['TrailsError']);
    });

    test('multi-attempt success on 2nd try', async () => {
      let recoverCalls = 0;
      const responses: Result<{ attempt: number }, TrailsError>[] = [
        Result.err(new ConflictError('still conflicting')),
        Result.ok({ attempt: 2 }),
      ];
      const detourTrail = trail('detour.multi', {
        blaze: () => Result.err(new ConflictError('conflict')),
        detours: [
          {
            maxAttempts: 3,
            on: ConflictError,
            recover: async () => {
              recoverCalls += 1;
              return responses.shift() as Result<never, TrailsError>;
            },
          },
        ],
        input: z.object({}),
        output: z.object({ attempt: z.number() }),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ attempt: 2 });
      expect(recoverCalls).toBe(2);
    });

    test('non-TrailsError throw inside recover becomes InternalError', async () => {
      const detourTrail = trail('detour.throw', {
        blaze: () => Result.err(new ConflictError('conflict')),
        detours: [
          {
            on: ConflictError,
            recover: async () => {
              throw new Error('plain error in recover');
            },
          },
        ],
        input: z.object({}),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(InternalError);
    });

    test('maxAttempts hard cap at 5', async () => {
      let recoverCalls = 0;
      const detourTrail = trail('detour.cap', {
        blaze: () => Result.err(new ConflictError('conflict')),
        detours: [
          {
            maxAttempts: 100,
            on: ConflictError,
            recover: async () => {
              recoverCalls += 1;
              return Result.err(new ConflictError('still conflicting'));
            },
          },
        ],
        input: z.object({}),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(RetryExhaustedError);
      expect(recoverCalls).toBe(5);
    });

    test('no detours declared — baseline unchanged', async () => {
      const noDetourTrail = trail('detour.none', {
        blaze: () => Result.err(new ConflictError('conflict')),
        input: z.object({}),
      });

      const result = await executeTrail(noDetourTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(ConflictError);
    });

    test('cross-detour termination — different error type stops recovery', async () => {
      const detourTrail = trail('detour.cross-terminate', {
        blaze: () => Result.err(new ConflictError('conflict')),
        detours: [
          {
            maxAttempts: 3,
            on: ConflictError,
            recover: async () => Result.err(new NetworkError('disconnected')),
          },
        ],
        input: z.object({}),
      });

      const result = await executeTrail(detourTrail, {});

      expect(result.isErr()).toBe(true);
      expect(result.error).toBeInstanceOf(NetworkError);
    });

    describe('layer interaction', () => {
      const createCountingLayer = () => {
        let wrapCalls = 0;
        let execCalls = 0;
        const layer: Layer = {
          name: 'counting',
          wrap(_trail, impl) {
            wrapCalls += 1;
            return async (input, ctx) => {
              execCalls += 1;
              return await impl(input, ctx);
            };
          },
        };
        return {
          execCalls: () => execCalls,
          layer,
          wrapCalls: () => wrapCalls,
        };
      };

      test('layer wraps once per logical execution, not per attempt', async () => {
        const counting = createCountingLayer();
        let recoverCalls = 0;
        const responses: Result<{ done: boolean }, TrailsError>[] = [
          Result.err(new ConflictError('still conflicting')),
          Result.err(new ConflictError('still conflicting')),
          Result.ok({ done: true }),
        ];
        const detourTrail = trail('detour.layer-count', {
          blaze: () => Result.err(new ConflictError('conflict')),
          detours: [
            {
              maxAttempts: 3,
              on: ConflictError,
              recover: async () => {
                recoverCalls += 1;
                return responses.shift() as Result<never, TrailsError>;
              },
            },
          ],
          input: z.object({}),
          output: z.object({ done: z.boolean() }),
        });

        const result = await executeTrail(
          detourTrail,
          {},
          { layers: [counting.layer] }
        );

        expect(result.isOk()).toBe(true);
        expect(counting.wrapCalls()).toBe(1);
        expect(counting.execCalls()).toBe(1);
        expect(recoverCalls).toBe(3);
      });
    });
  });
});
