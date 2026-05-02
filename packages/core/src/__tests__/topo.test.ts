import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { contour } from '../contour.js';
import { ValidationError } from '../errors.js';
import {
  attachLateBoundSignalRef,
  cloneSignalWithId,
} from '../internal/signal-ref.js';
import { resource } from '../resource.js';
import { Result } from '../result.js';
import { run } from '../run.js';
import { schedule } from '../schedule.js';
import { signal } from '../signal.js';
import { trail } from '../trail.js';
import { topo } from '../topo.js';
import type { TraceRecord, TraceSink } from '../internal/tracing.js';
import type { LogRecord, LogSink } from '../types.js';
import { webhook } from '../webhook.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const mockContour = (name: string) =>
  contour(
    name,
    {
      id: z.string().uuid(),
      value: z.string(),
    },
    { identity: 'id' }
  );

const mockTrail = (
  id: string,
  crosses?: readonly string[],
  contours?: readonly ReturnType<typeof mockContour>[]
) =>
  trail(id, {
    blaze: () => Result.ok({ y: 0 }),
    contours,
    crosses,
    input: z.object({ x: z.number() }),
    output: z.object({ y: z.number() }),
  });

const mockEvent = (id: string) =>
  signal(id, {
    payload: z.object({ payload: z.string() }),
  });

const mockSignalConsumer = (on: readonly ReturnType<typeof mockEvent>[]) =>
  trail('notify.users', {
    blaze: () => Result.ok({ ok: true }),
    input: z.object({ payload: z.string() }),
    on,
    output: z.object({ ok: z.boolean() }),
  });

const mockResource = (
  id: string,
  signals?: readonly ReturnType<typeof mockEvent>[]
) =>
  resource(id, {
    create: () => Result.ok({ id }),
    description: `${id} resource`,
    signals,
  });

// Hoisted to module scope so unicorn/consistent-function-scoping does not
// flag it as recreated per test invocation. Used by the classifier
// fallback test to model a non-sink helper exported as `observe`.
const helperObserveFunction = (): string => 'not a sink';

// ---------------------------------------------------------------------------
// topo()
// ---------------------------------------------------------------------------

describe('topo', () => {
  describe('identity', () => {
    test('preserves object identity metadata', () => {
      const t = topo({
        description: 'Demo topo',
        name: 'my-app',
        version: '1.2.3',
      });

      expect(t.name).toBe('my-app');
      expect(t.version).toBe('1.2.3');
      expect(t.description).toBe('Demo topo');
    });
  });

  describe('observe options', () => {
    test('stores an explicit trace sink from a branded options payload', () => {
      const sink: TraceSink = { write: () => {} };
      const mod = { myTrail: mockTrail('observe.trace') };
      const t = topo('app', mod, topo.options({ observe: sink }));

      expect(t.observe?.trace).toBe(sink);
      expect(t.trails.get('observe.trace')).toBe(mod.myTrail);
    });

    test('stores combined log and trace sinks', () => {
      const log: LogSink = { name: 'capture', write: () => {} };
      const trace: TraceSink = { write: () => {} };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.combined') },
        {
          observe: { log, trace },
        }
      );

      expect(t.observe?.log).toBe(log);
      expect(t.observe?.trace).toBe(trace);
    });

    test('stores a named trace sink from the explicit trace slot', () => {
      const trace = {
        name: 'named-trace',
        write: () => {},
      } satisfies TraceSink & Readonly<{ name: string }>;
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.named-trace') },
        { observe: { trace } }
      );

      expect(t.observe?.trace).toBe(trace);
    });

    test('uses trace capabilities to disambiguate named trace shorthand', () => {
      const trace = {
        name: 'trace-capable',
        observes: { trace: true } as const,
        write: () => {},
      };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.trace-capable') },
        { observe: trace }
      );

      expect(t.observe?.log).toBeUndefined();
      expect(t.observe?.trace).toBe(trace);
    });

    test('stores capability-marked combined sinks as log and trace targets', async () => {
      const records: TraceRecord[] = [];
      const combined = {
        name: 'combined',
        observes: { log: true, trace: true } as const,
        write(record: LogRecord | TraceRecord): void {
          if ('traceId' in record) {
            records.push(record);
          }
        },
      };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.capable') },
        { observe: combined }
      );

      expect(t.observe?.log).toBe(combined);
      expect(t.observe?.trace).toBe(combined);

      const result = await run(t, 'observe.capable', { x: 1 });

      expect(result.isOk()).toBe(true);
      expect(records).toHaveLength(1);
      expect(records[0]?.trailId).toBe('observe.capable');
    });

    test('leaves unconfigured topos on the default observe path', () => {
      const t = topo('app', { myTrail: mockTrail('observe.default') });

      expect(t.observe).toBeUndefined();
    });

    test('keeps an export named observe when it is a trail', () => {
      const observe = mockTrail('observe');
      const t = topo('app', { observe });

      expect(t.get('observe')).toBe(observe);
    });

    test('routes trail trace records to the topo trace sink', async () => {
      const records: TraceRecord[] = [];
      const trace: TraceSink = {
        write: (record) => {
          records.push(record);
        },
      };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.run') },
        topo.options({ observe: trace })
      );

      const result = await run(t, 'observe.run', { x: 1 });

      expect(result.isOk()).toBe(true);
      expect(records).toHaveLength(1);
      expect(records[0]?.trailId).toBe('observe.run');
    });

    test('adapts an observe log sink into ctx.logger', async () => {
      const records: LogRecord[] = [];
      const log: LogSink = {
        name: 'capture',
        write: (record) => records.push(record),
      };
      const logged = trail('observe.log', {
        blaze: (_input, ctx) => {
          ctx.logger?.info('observed trail', { step: 'blaze' });
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const t = topo('app', { logged }, { observe: { log } });

      const result = await run(t, 'observe.log', {});

      expect(result.isOk()).toBe(true);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        category: 'observe.log',
        level: 'info',
        message: 'observed trail',
        metadata: {
          step: 'blaze',
          topo: 'app',
          trailId: 'observe.log',
        },
      });
    });

    test('rebinds observe loggers for crossed trails', async () => {
      const records: LogRecord[] = [];
      const log: LogSink = {
        name: 'capture',
        write: (record) => records.push(record),
      };
      const child = trail('observe.child', {
        blaze: (_input, ctx) => {
          ctx.logger?.info('child trail');
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const parent = trail('observe.parent', {
        blaze: async (_input, ctx) => {
          ctx.logger?.info('parent trail');
          const crossed = await ctx.cross?.('observe.child', {});
          if (!crossed) {
            return Result.err(new Error('missing ctx.cross'));
          }
          if (crossed.isErr()) {
            return Result.err(crossed.error);
          }
          return Result.ok({ ok: true });
        },
        crosses: [child],
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const t = topo('app', { child, parent }, { observe: { log } });

      const result = await run(t, 'observe.parent', {});

      expect(result.isOk()).toBe(true);
      expect(records.map((record) => record.category)).toEqual([
        'observe.parent',
        'observe.child',
      ]);
      expect(records.map((record) => record.metadata?.['trailId'])).toEqual([
        'observe.parent',
        'observe.child',
      ]);
    });

    test('preserves fan-out metadata when rebinding observe logger for signal consumers', async () => {
      const records: LogRecord[] = [];
      const log: LogSink = {
        name: 'capture',
        write: (record) => records.push(record),
      };
      const orderPlaced = signal('observe.order.placed', {
        payload: z.object({ orderId: z.string() }),
      });
      const consumer = trail('observe.consumer', {
        blaze: (_input, ctx) => {
          ctx.logger?.info('consumer trail');
          return Result.ok({ ok: true });
        },
        input: z.object({ orderId: z.string() }),
        on: [orderPlaced],
        output: z.object({ ok: z.boolean() }),
      });
      const producer = trail('observe.producer', {
        blaze: async (input, ctx) => {
          ctx.logger?.info('producer trail');
          await ctx.fire?.(orderPlaced, { orderId: input.orderId });
          return Result.ok({ ok: true });
        },
        fires: [orderPlaced],
        input: z.object({ orderId: z.string() }),
        output: z.object({ ok: z.boolean() }),
      });
      const t = topo(
        'app',
        { consumer, orderPlaced, producer },
        { observe: { log } }
      );

      const result = await run(t, 'observe.producer', { orderId: 'o1' });

      expect(result.isOk()).toBe(true);
      const consumerRecord = records.find(
        (record) => record.category === 'observe.consumer'
      );
      expect(consumerRecord).toBeDefined();
      expect(consumerRecord?.metadata).toMatchObject({
        consumerId: 'observe.consumer',
        signalId: 'observe.order.placed',
        topo: 'app',
        trailId: 'observe.consumer',
      });
    });

    test('preserves cross-branch metadata when rebinding observe logger for concurrent crosses', async () => {
      const records: LogRecord[] = [];
      const log: LogSink = {
        name: 'capture',
        write: (record) => records.push(record),
      };
      const left = trail('observe.branch.left', {
        blaze: (_input, ctx) => {
          ctx.logger?.info('left branch');
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const right = trail('observe.branch.right', {
        blaze: (_input, ctx) => {
          ctx.logger?.info('right branch');
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const parent = trail('observe.branch.parent', {
        blaze: async (_input, ctx) => {
          const { cross } = ctx;
          if (cross === undefined) {
            return Result.err(new Error('missing ctx.cross'));
          }
          const crossed = await cross([
            [left, {}],
            [right, {}],
          ] as const);
          if (crossed.some((result) => result.isErr())) {
            return Result.err(new Error('branch failure'));
          }
          return Result.ok({ ok: true });
        },
        crosses: [left, right],
        input: z.object({}),
        output: z.object({ ok: z.boolean() }),
      });
      const t = topo('app', { left, parent, right }, { observe: { log } });

      const result = await run(t, 'observe.branch.parent', {});

      expect(result.isOk()).toBe(true);
      const leftRecord = records.find(
        (record) => record.category === 'observe.branch.left'
      );
      const rightRecord = records.find(
        (record) => record.category === 'observe.branch.right'
      );
      expect(leftRecord).toBeDefined();
      expect(rightRecord).toBeDefined();
      expect(leftRecord?.metadata).toMatchObject({
        branchIndex: 0,
        crossedTrailId: 'observe.branch.left',
        topo: 'app',
        trailId: 'observe.branch.left',
      });
      expect(rightRecord?.metadata).toMatchObject({
        branchIndex: 1,
        crossedTrailId: 'observe.branch.right',
        topo: 'app',
        trailId: 'observe.branch.right',
      });
    });

    test('rejects ambiguous named sink shorthand', () => {
      const sink = { name: 'named-sink', write: () => {} };

      expect(() =>
        topo(
          'app',
          { myTrail: mockTrail('observe.ambiguous') },
          { observe: sink }
        )
      ).toThrow(ValidationError);
    });

    test('rejects ambiguous bare trace sink shorthand', () => {
      // A bare TraceSink (`{ write }`) is structurally indistinguishable
      // from a module export named `observe`. The classifier must refuse
      // to guess and steer the caller toward `topo.options()` rather
      // than silently picking either interpretation.
      const sink: TraceSink = { write: () => {} };

      expect(() =>
        topo(
          'app',
          { myTrail: mockTrail('observe.ambiguous-trace') },
          { observe: sink }
        )
      ).toThrow(ValidationError);
    });

    test('treats a non-sink helper named observe as a module export', () => {
      // A function value cannot satisfy LogSink / TraceSink / Logger /
      // ObserveConfig, so the classifier should fall back to module
      // semantics: the helper is silently ignored as a non-registrable
      // export, matching how any other unrecognized module value is
      // handled. No throw.
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.helper-fn') },
        // Single-arg trailing module whose only export is `observe`.
        // The trail in the first module still registers normally.
        { observe: helperObserveFunction as unknown as never }
      );

      expect(t.observe).toBeUndefined();
      expect(t.trails.get('observe.helper-fn')).toBeDefined();
    });

    test('treats a non-sink helper object named observe as a module export', () => {
      // A plain object literal without `write` does not pass any sink
      // predicate. The classifier must fall back to module semantics
      // rather than rejecting the call as malformed.
      const helperObject = { description: 'not a sink' };

      const t = topo(
        'app',
        { myTrail: mockTrail('observe.helper-obj') },
        { observe: helperObject as unknown as never }
      );

      expect(t.observe).toBeUndefined();
      expect(t.trails.get('observe.helper-obj')).toBeDefined();
    });

    test('treats a primitive observe value as a non-registrable module export', () => {
      // A primitive (e.g. a number) cannot be confused with any sink
      // shape and is not registrable. Previously this threw; the
      // softened classifier silently ignores it as a module export.
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.bad-number') },
        { observe: 123 as unknown as never }
      );

      expect(t.observe).toBeUndefined();
      expect(t.trails.get('observe.bad-number')).toBeDefined();
    });

    test('treats an empty observe object as a non-registrable module export', () => {
      // `{}` is an object but does not pass `isLogSink` / `isTraceSink`
      // (no `write` function). The classifier falls back to module
      // semantics rather than rejecting the call.
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.empty') },
        { observe: {} as unknown as never }
      );

      expect(t.observe).toBeUndefined();
      expect(t.trails.get('observe.empty')).toBeDefined();
    });

    test('rejects unknown option keys when using topo.options()', () => {
      // Branding via topo.options() forces the trailing arg to be
      // interpreted as options. Unknown keys (typos like "observ") must
      // throw rather than be silently ignored.
      expect(() =>
        topo(
          'app',
          { myTrail: mockTrail('observe.typo') },
          topo.options({ observ: {} } as unknown as never)
        )
      ).toThrow(ValidationError);
    });

    test('topo.options() brands an explicit options payload', () => {
      const sink: TraceSink = { write: () => {} };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.branded') },
        topo.options({ observe: sink })
      );

      expect(t.observe?.trace).toBe(sink);
      expect(t.trails.get('observe.branded')).toBeDefined();
    });

    test('topo.options() accepts a frozen payload without mutating it', () => {
      // Callers passing `Object.freeze(...)` or otherwise non-extensible
      // payloads must not trigger a TypeError. Branding clones the input
      // rather than mutating it in place, so the frozen payload survives
      // unchanged and downstream classification still works.
      const sink: TraceSink = { write: () => {} };
      const frozen = Object.freeze({ observe: sink });

      expect(() => topo.options(frozen)).not.toThrow();

      const t = topo(
        'app',
        { myTrail: mockTrail('observe.frozen') },
        topo.options(frozen)
      );

      expect(t.observe?.trace).toBe(sink);
      expect(t.trails.get('observe.frozen')).toBeDefined();
      // The original frozen payload is untouched.
      expect(Object.isFrozen(frozen)).toBe(true);
      expect(Object.getOwnPropertySymbols(frozen)).toHaveLength(0);
    });

    test('topo.options() lets a module export named observe round-trip a sink', () => {
      // Without branding, a module whose sole export is `observe` and
      // whose value is a TraceSink would be misclassified as the inline
      // options shorthand. topo.options() is the documented escape hatch
      // for users who genuinely need that module shape.
      const moduleExport: TraceSink = { write: () => {} };
      const sinkOptions: TraceSink = { write: () => {} };
      const t = topo(
        'app',
        // The first argument is a module — but because the trailing
        // argument is branded, it is unambiguously options. The first
        // argument is then registered as a module (and its `observe`
        // value, not being a registrable, is silently ignored — same
        // behavior as any other non-registrable module value).
        { observe: moduleExport },
        topo.options({ observe: sinkOptions })
      );

      expect(t.observe?.trace).toBe(sinkOptions);
    });

    test('rejects topo.options() in a non-trailing position', () => {
      const sink: TraceSink = { write: () => {} };
      const mod = { myTrail: mockTrail('observe.misplaced') };

      expect(() => topo('app', topo.options({ observe: sink }), mod)).toThrow(
        ValidationError
      );
    });

    test('topo.options() routes a bare LogSink to the explicit log slot', () => {
      // The brand is the documented escape hatch for bare-sink shorthand.
      // A bare LogSink (`{ name, write }`) under branding must auto-route
      // to `{ log: sink }` rather than tripping `normalizeObserve`'s
      // ambiguity guard, which assumes no brand was applied.
      const log: LogSink = { name: 'capture', write: () => {} };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.branded-log') },
        topo.options({ observe: log })
      );

      expect(t.observe?.log).toBe(log);
      expect(t.observe?.trace).toBeUndefined();
      expect(t.trails.get('observe.branded-log')).toBeDefined();
    });

    test('topo.options() leaves an explicit { log } payload untouched', () => {
      // Already-disambiguated payloads must round-trip without rewriting.
      const log: LogSink = { name: 'capture', write: () => {} };
      const t = topo(
        'app',
        { myTrail: mockTrail('observe.branded-log-explicit') },
        topo.options({ observe: { log } })
      );

      expect(t.observe?.log).toBe(log);
      expect(t.observe?.trace).toBeUndefined();
    });

    test('rejects a bare LogSink shorthand without topo.options()', () => {
      // The auto-routing only kicks in under branding. Without the brand
      // the call remains genuinely ambiguous and must continue to throw,
      // preserving the documented behavior that only `topo.options()`
      // unlocks the escape hatch.
      const log: LogSink = { name: 'capture', write: () => {} };

      expect(() =>
        topo(
          'app',
          { myTrail: mockTrail('observe.unbranded-log') },
          { observe: log }
        )
      ).toThrow(ValidationError);
    });

    test('topo.options() rejects null input', () => {
      expect(() => topo.options(null as unknown as never)).toThrow(
        ValidationError
      );
    });

    test('topo.options() rejects undefined input', () => {
      expect(() => topo.options(undefined as unknown as never)).toThrow(
        ValidationError
      );
    });

    test('topo.options() rejects number input', () => {
      expect(() => topo.options(42 as unknown as never)).toThrow(
        ValidationError
      );
    });

    test('topo.options() rejects string input', () => {
      expect(() => topo.options('observe' as unknown as never)).toThrow(
        ValidationError
      );
    });

    test('topo.options() rejects array input', () => {
      expect(() => topo.options([] as unknown as never)).toThrow(
        ValidationError
      );
    });
  });

  describe('trail collection', () => {
    test('returns Topo with name', () => {
      const t = topo('my-app');
      expect(t.name).toBe('my-app');
    });

    test('collects trails from modules', () => {
      const mod = { myTrail: mockTrail('create-user') };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(1);
      expect(t.trails.get('create-user')).toBe(mod.myTrail);
    });

    test('auto-scans exports by kind discriminant', () => {
      const mod = {
        event1: mockEvent('e1'),
        resource1: mockResource('s1'),
        trail1: mockTrail('t1'),
        trail2: mockTrail('t2', ['t1']),
      };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(2);
      expect(t.signals.size).toBe(1);
      expect(t.resources.size).toBe(1);
    });

    test('collects from multiple modules', () => {
      const mod1 = { a: mockTrail('t1') };
      const mod2 = { b: mockTrail('t2'), c: mockTrail('t3', ['t1']) };
      const t = topo('app', mod1, mod2);

      expect(t.trails.size).toBe(3);
    });

    test('non-trail exports are silently ignored', () => {
      const mod = {
        config: { port: 3000 },
        helper: () => 'not a trail',
        name: 'some-string',
        nothing: null,
        num: 42,
        trail1: mockTrail('t1'),
        undef: undefined,
      };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(1);
      expect(t.signals.size).toBe(0);
      expect(t.resources.size).toBe(0);
    });

    test('trail with crossings registers correctly', () => {
      const mod = { t: mockTrail('trail-1', ['trail-2']) };
      const t = topo('app', mod);

      expect(t.trails.size).toBe(1);
      const registered = t.trails.get('trail-1');
      expect(registered?.crosses).toEqual(['trail-2']);
    });
  });

  describe('resource and signal collection', () => {
    test('collects resources from modules', () => {
      const mod = { db: mockResource('db.main') };
      const t = topo('app', mod);

      expect(t.resources.size).toBe(1);
      expect(t.resources.get('db.main')).toBe(mod.db);
    });

    test('registers signals declared on resources into the topo graph', () => {
      const usersCreated = mockEvent('users.created');
      const t = topo('app', {
        db: mockResource('db.main', [usersCreated]),
      });

      expect(t.signals.size).toBe(1);
      expect(t.listSignals()).toContain(usersCreated);
    });

    test('resolves late-bound store signal refs from resource-scoped signals', () => {
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created',
      });
      const consumer = mockSignalConsumer([authored]);
      const scoped = cloneSignalWithId(authored, 'identity:users.created');
      const t = topo('app', {
        consumer,
        identity: mockResource('identity', [scoped]),
      });

      expect(t.get('notify.users')?.on).toEqual(['identity:users.created']);
      expect(t.get('notify.users')?.activationSources).toEqual([
        { source: { id: 'identity:users.created', kind: 'signal' } },
      ]);
      expect(t.listSignals().map((s) => s.id)).toContain(
        'identity:users.created'
      );
    });

    test('keeps schedule and webhook activation sources inert during topo construction', () => {
      const scheduleSource = schedule('schedule.nightly-close', {
        cron: '0 2 * * *',
        input: { olderThanDays: 90 },
      });
      const webhookSource = webhook('webhook.stripe.payment', {
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/stripe/payment',
      });

      const app = topo('billing', {
        reconcile: trail('billing.reconcile', {
          blaze: () => Result.ok({ ok: true }),
          input: z.object({}),
          on: [scheduleSource, { source: webhookSource }],
          output: z.object({ ok: z.boolean() }),
        }),
      });

      expect(app.get('billing.reconcile')?.activationSources).toEqual([
        { source: scheduleSource },
        { source: webhookSource },
      ]);
    });

    test('preserves canonical scoped signal ids across multi-binding stores', () => {
      // Regression test: the same store definition bound under two resources
      // (identity + billing). A trail that registers under one resource and
      // another that registers under the other must resolve to the distinct
      // canonical scoped ids, not collide on a shared late-bound token.
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created-multi',
      });
      const identityScoped = cloneSignalWithId(
        authored,
        'identity:users.created'
      );
      const billingScoped = cloneSignalWithId(
        authored,
        'billing:users.created'
      );

      const identityConsumer = trail('notify.identity-users', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [identityScoped],
        output: z.object({ ok: z.boolean() }),
      });
      const billingConsumer = trail('notify.billing-users', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [billingScoped],
        output: z.object({ ok: z.boolean() }),
      });

      const t = topo('app', {
        billing: mockResource('billing', [billingScoped]),
        billingConsumer,
        identity: mockResource('identity', [identityScoped]),
        identityConsumer,
      });

      expect(t.get('notify.identity-users')?.on).toEqual([
        'identity:users.created',
      ]);
      expect(t.get('notify.billing-users')?.on).toEqual([
        'billing:users.created',
      ]);
    });

    test('preserves canonical scoped signal ids when resource ids contain dots', () => {
      // Regression test: the canonical-scope predicate previously disallowed
      // dots inside the scope segment, which collapsed dotted resource ids
      // like `demo.store` and `other.store` back to their shared late-bound
      // token. With `:` prohibited inside resource ids, the scope is
      // unambiguously everything before the first `:`, so dotted scopes must
      // resolve to distinct canonical ids.
      const authored = attachLateBoundSignalRef(mockEvent('gists.created'), {
        kind: 'store-derived',
        token: 'gists-created-dotted',
      });
      const demoScoped = cloneSignalWithId(
        authored,
        'demo.store:gists.created'
      );
      const otherScoped = cloneSignalWithId(
        authored,
        'other.store:gists.created'
      );

      const demoConsumer = trail('notify.demo-gists', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [demoScoped],
        output: z.object({ ok: z.boolean() }),
      });
      const otherConsumer = trail('notify.other-gists', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [otherScoped],
        output: z.object({ ok: z.boolean() }),
      });

      const t = topo('app', {
        'demo.store': mockResource('demo.store', [demoScoped]),
        demoConsumer,
        'other.store': mockResource('other.store', [otherScoped]),
        otherConsumer,
      });

      expect(t.get('notify.demo-gists')?.on).toEqual([
        'demo.store:gists.created',
      ]);
      expect(t.get('notify.other-gists')?.on).toEqual([
        'other.store:gists.created',
      ]);
    });

    test('markerizes late-bound ids containing `:` but not in canonical scoped form', () => {
      // Guard regression: `normalizeSignalRef` previously passed any id
      // containing `:` through unchanged, which would let a non-canonical
      // late-bound id like `foo:bar` slip past markerization and then fail
      // to resolve during topo finalization. The strict predicate should
      // still rewrite such ids onto the late-bound marker path, while
      // leaving canonical `<scope>:<table>.<event>` ids alone.
      const nonCanonical = attachLateBoundSignalRef(mockEvent('foo:bar'), {
        kind: 'store-derived',
        token: 'non-canonical',
      });
      const nonCanonicalConsumer = trail('notify.non-canonical', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [nonCanonical],
        output: z.object({ ok: z.boolean() }),
      });
      expect(nonCanonicalConsumer.on).not.toEqual(['foo:bar']);

      const canonical = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'canonical',
      });
      const scoped = cloneSignalWithId(canonical, 'identity:users.created');
      const canonicalConsumer = trail('notify.canonical', {
        blaze: () => Result.ok({ ok: true }),
        input: z.object({ payload: z.string() }),
        on: [scoped],
        output: z.object({ ok: z.boolean() }),
      });
      expect(canonicalConsumer.on).toEqual(['identity:users.created']);
    });

    test('rejects ambiguous late-bound store signal refs', () => {
      const authored = attachLateBoundSignalRef(mockEvent('users.created'), {
        kind: 'store-derived',
        token: 'users-created',
      });
      const consumer = mockSignalConsumer([authored]);

      expect(() =>
        topo('app', {
          billing: mockResource('billing', [
            cloneSignalWithId(authored, 'billing:users.created'),
          ]),
          consumer,
          identity: mockResource('identity', [
            cloneSignalWithId(authored, 'identity:users.created'),
          ]),
        })
      ).toThrow(
        'Trail "notify.users" references late-bound signal "users.created" but it resolves to multiple bound resource signals'
      );
    });
  });

  describe('contour collection', () => {
    test('collects contours exported directly from modules', () => {
      const user = mockContour('user');
      const t = topo('app', { user });

      expect(t.contours.size).toBe(1);
      expect(t.getContour('user')).toBe(user);
    });

    test('registers contours declared on trails into the topo graph', () => {
      const user = mockContour('user');
      const t = topo('app', {
        createUser: mockTrail('user.create', [], [user]),
      });

      expect(t.contours.size).toBe(1);
      expect(t.getContour('user')).toBe(user);
    });
  });

  describe('duplicate rejection', () => {
    test('rejects duplicate trail IDs', () => {
      const mod1 = { a: mockTrail('dup') };
      const mod2 = { b: mockTrail('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate trail ID: "dup"'
      );
    });

    test('rejects duplicate event IDs', () => {
      const mod1 = { a: mockEvent('dup') };
      const mod2 = { b: mockEvent('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate signal ID: "dup"'
      );
    });

    test('rejects duplicate resource IDs', () => {
      const mod1 = { a: mockResource('dup') };
      const mod2 = { b: mockResource('dup') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate resource ID: "dup"'
      );
    });

    test('rejects duplicate contour names', () => {
      const mod1 = { a: mockContour('user') };
      const mod2 = { b: mockContour('user') };

      expect(() => topo('app', mod1, mod2)).toThrow(ValidationError);
      expect(() => topo('app', mod1, mod2)).toThrow(
        'Duplicate contour name: "user"'
      );
    });
  });
});

// ---------------------------------------------------------------------------
// topo accessors
// ---------------------------------------------------------------------------

describe('topo accessors', () => {
  test('ids() returns all trail IDs', () => {
    const a = mockTrail('alpha');
    const b = mockTrail('beta');
    const app = topo('test', { a, b });
    expect([...app.ids()].toSorted()).toEqual(['alpha', 'beta']);
  });

  test('count returns number of trails', () => {
    const a = mockTrail('alpha');
    const app = topo('test', { a });
    expect(app.count).toBe(1);
  });

  test('resourceCount returns number of resources', () => {
    const db = mockResource('db.main');
    const cache = mockResource('cache.main');
    const app = topo('test', { cache, db });
    expect(app.resourceCount).toBe(2);
  });

  test('contourCount returns number of contours', () => {
    const gist = mockContour('gist');
    const user = mockContour('user');
    const app = topo('test', { gist, user });
    expect(app.contourCount).toBe(2);
  });

  test('empty topo has zero count and empty ids', () => {
    const app = topo('empty');
    expect(app.count).toBe(0);
    expect(app.contourCount).toBe(0);
    expect(app.contourIds()).toEqual([]);
    expect(app.ids()).toEqual([]);
    expect(app.resourceCount).toBe(0);
    expect(app.resourceIds()).toEqual([]);
  });

  test('resourceIds() returns all resource IDs', () => {
    const db = mockResource('db.main');
    const cache = mockResource('cache.main');
    const app = topo('test', { cache, db });
    expect([...app.resourceIds()].toSorted()).toEqual([
      'cache.main',
      'db.main',
    ]);
  });

  test('contourIds() returns all contour names', () => {
    const gist = mockContour('gist');
    const user = mockContour('user');
    const app = topo('test', { gist, user });
    expect([...app.contourIds()].toSorted()).toEqual(['gist', 'user']);
  });
});

// ---------------------------------------------------------------------------
// Topo
// ---------------------------------------------------------------------------

describe('Topo', () => {
  const mod = {
    e1: mockEvent('event-1'),
    p1: mockResource('resource-1'),
    t1: mockTrail('trail-1'),
    t2: mockTrail('trail-2'),
    t3: mockTrail('trail-3', ['trail-1']),
  };

  // Build once for the describe block
  const app = topo('app', mod);

  describe('get()', () => {
    test('retrieves contour by name', () => {
      const user = mockContour('user');
      const contourApp = topo('app', { user });

      expect(contourApp.getContour('user')).toBe(user);
    });

    test('retrieves trail by ID', () => {
      expect(app.get('trail-1')).toBe(mod.t1);
    });

    test('retrieves trail with crossings by ID', () => {
      expect(app.get('trail-3')).toBe(mod.t3);
    });

    test('returns undefined for unknown ID', () => {
      expect(app.get('nope')).toBeUndefined();
    });
  });

  describe('has()', () => {
    test('returns true for known contour', () => {
      const user = mockContour('user');
      const contourApp = topo('app', { user });

      expect(contourApp.hasContour('user')).toBe(true);
    });

    test('returns true for known trail', () => {
      expect(app.has('trail-1')).toBe(true);
    });

    test('returns true for trail with crossings', () => {
      expect(app.has('trail-3')).toBe(true);
    });

    test('returns false for unknown ID', () => {
      expect(app.has('nope')).toBe(false);
    });

    test('returns false for unknown contour', () => {
      const contourApp = topo('app');

      expect(contourApp.hasContour('missing')).toBe(false);
    });

    test('returns false for event ID (signals are not trails)', () => {
      expect(app.has('event-1')).toBe(false);
    });
  });

  describe('getResource()', () => {
    test('retrieves resource by ID', () => {
      expect(app.getResource('resource-1')).toBe(mod.p1);
    });

    test('returns undefined for unknown resource ID', () => {
      expect(app.getResource('missing-resource')).toBeUndefined();
    });
  });

  describe('hasResource()', () => {
    test('returns true for known resource', () => {
      expect(app.hasResource('resource-1')).toBe(true);
    });

    test('returns false for unknown resource', () => {
      expect(app.hasResource('missing-resource')).toBe(false);
    });
  });

  describe('listing', () => {
    test('list() returns all trails (with and without crossings)', () => {
      const items = app.list();
      expect(items).toHaveLength(3);
      expect(items).toContain(mod.t1);
      expect(items).toContain(mod.t2);
      expect(items).toContain(mod.t3);
    });

    test('listEvents() returns all signals', () => {
      const items = app.listSignals();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.e1);
    });

    test('listResources() returns all resources', () => {
      const items = app.listResources();
      expect(items).toHaveLength(1);
      expect(items).toContain(mod.p1);
    });

    test('listContours() returns all contours', () => {
      const gist = mockContour('gist');
      const user = mockContour('user');
      const contourApp = topo('app', { gist, user });

      expect(contourApp.listContours()).toEqual([gist, user]);
    });
  });
});
