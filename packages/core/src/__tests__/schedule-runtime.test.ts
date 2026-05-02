import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import type { ActivationProvenance } from '../activation-provenance.js';
import type { Layer } from '../layer.js';
import type {
  ScheduleCronFactory,
  ScheduleCronHandler,
  ScheduleCronJob,
  ScheduleRuntimeRunRecord,
} from '../schedule-runtime.js';
import { createTrailContext } from '../context.js';
import { ValidationError } from '../errors.js';
import { Result } from '../result.js';
import { resource } from '../resource.js';
import { createScheduleRuntime } from '../schedule-runtime.js';
import { schedule } from '../schedule.js';
import { topo } from '../topo.js';
import { trail } from '../trail.js';

interface FakeCronEntry extends ScheduleCronJob {
  readonly handler: ScheduleCronHandler;
  readonly stopped: boolean;
  readonly unrefCalls: number;
  trigger(): Promise<void>;
}

const createFakeCron = (): {
  readonly entries: FakeCronEntry[];
  readonly factory: ScheduleCronFactory;
} => {
  const entries: FakeCronEntry[] = [];
  const factory: ScheduleCronFactory = (cron, handler) => {
    let stopped = false;
    let unrefCalls = 0;
    const entry: FakeCronEntry = {
      cron,
      handler,
      stop() {
        stopped = true;
        return entry;
      },
      get stopped() {
        return stopped;
      },
      async trigger() {
        await handler();
      },
      unref() {
        unrefCalls += 1;
        return entry;
      },
      get unrefCalls() {
        return unrefCalls;
      },
    };
    entries.push(entry);
    return entry;
  };
  return { entries, factory };
};

const scheduleRuntimeId = (name: string): string =>
  `schedule.runtime.${name}.${Bun.randomUUIDv7()}`;

describe('createScheduleRuntime()', () => {
  test('keeps topo construction and runtime creation inert until start', async () => {
    const fakeCron = createFakeCron();
    const worker = trail('billing.close', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ olderThanDays: z.number() }),
      on: [
        schedule('schedule.billing.close', {
          cron: '0 2 * * *',
          input: { olderThanDays: 90 },
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });

    const graph = topo('billing', { worker });
    const runtime = createScheduleRuntime(graph, { cron: fakeCron.factory });

    expect(fakeCron.entries).toHaveLength(0);

    const started = await runtime.start();

    expect(started.isOk()).toBe(true);
    expect(started.unwrap()).toEqual({
      registered: [
        {
          cron: '0 2 * * *',
          sourceId: 'schedule.billing.close',
          trailId: 'billing.close',
        },
      ],
      warnings: [],
    });
    expect(fakeCron.entries).toHaveLength(1);
    expect(fakeCron.entries[0]?.cron).toBe('0 2 * * *');
  });

  test('manual fake ticks run the target trail with source input', async () => {
    const fakeCron = createFakeCron();
    const seenInputs: unknown[] = [];
    const worker = trail('data.archive-old', {
      blaze: (input) => {
        seenInputs.push(input);
        return Result.ok({ archived: true });
      },
      input: z.object({ olderThanDays: z.number() }),
      on: [
        schedule('schedule.data.archive-old', {
          cron: '0 2 * * *',
          input: { olderThanDays: 90 },
        }),
      ],
      output: z.object({ archived: z.boolean() }),
    });
    const graph = topo('archive', { worker });
    const runtime = createScheduleRuntime(graph, { cron: fakeCron.factory });

    await runtime.start();
    await fakeCron.entries[0]?.trigger();

    expect(seenInputs).toEqual([{ olderThanDays: 90 }]);
  });

  test('scheduled runs seed activation provenance on context and run records', async () => {
    const fakeCron = createFakeCron();
    const activations: ActivationProvenance[] = [];
    const records: ScheduleRuntimeRunRecord[] = [];
    const worker = trail('provenance.run', {
      blaze: (_input, ctx) => {
        if (ctx.activation !== undefined) {
          activations.push(ctx.activation);
        }
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [
        schedule('schedule.provenance', {
          cron: '0 3 * * *',
          timezone: 'UTC',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('schedule-provenance', { worker });
    const runtime = createScheduleRuntime(graph, {
      cron: fakeCron.factory,
      onRun: (record) => {
        records.push(record);
      },
    });

    await runtime.start();
    await fakeCron.entries[0]?.trigger();

    expect(activations).toHaveLength(1);
    expect(records).toHaveLength(1);
    const [activation] = activations;
    const [record] = records;
    expect(activation?.fireId).toBeString();
    expect(activation?.parentFireId).toBeUndefined();
    expect(activation?.rootFireId).toBe(activation?.fireId);
    expect(activation?.source).toEqual({
      cron: '0 3 * * *',
      id: 'schedule.provenance',
      kind: 'schedule',
      timezone: 'UTC',
    });
    expect(record?.activation).toEqual(activation);
    expect(record).toMatchObject({
      sourceId: 'schedule.provenance',
      status: 'ok',
      trailId: 'provenance.run',
    });
  });

  test('stop cancels cron handles and ignores ticks after stop', async () => {
    const fakeCron = createFakeCron();
    const seenInputs: unknown[] = [];
    const worker = trail('heartbeat.run', {
      blaze: (input) => {
        seenInputs.push(input);
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [schedule('schedule.heartbeat', { cron: '*/5 * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('heartbeat', { worker });
    const runtime = createScheduleRuntime(graph, { cron: fakeCron.factory });

    await runtime.start();
    const stopped = await runtime.stop();
    await fakeCron.entries[0]?.trigger();

    expect(stopped.isOk()).toBe(true);
    expect(stopped.unwrap().stopped).toEqual([
      {
        cron: '*/5 * * * *',
        sourceId: 'schedule.heartbeat',
        trailId: 'heartbeat.run',
      },
    ]);
    expect(fakeCron.entries[0]?.stopped).toBe(true);
    expect(seenInputs).toEqual([]);
  });

  test('stop waits for in-flight scheduled trails before draining resources', async () => {
    const fakeCron = createFakeCron();
    const canFinish = Promise.withResolvers<undefined>();
    const startedRun = Promise.withResolvers<undefined>();
    const events: string[] = [];
    const db = resource(scheduleRuntimeId('db'), {
      create: () => {
        events.push('create');
        return Result.ok({ label: 'db' });
      },
      dispose: (instance) => {
        events.push(`dispose:${instance.label}`);
      },
    });
    const worker = trail('resource.cleanup', {
      blaze: async (_input, ctx) => {
        db.from(ctx);
        events.push('run:start');
        startedRun.resolve();
        await canFinish.promise;
        events.push('run:end');
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [schedule('schedule.resource.cleanup', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
      resources: [db],
    });
    const graph = topo('resource-cleanup', { db, worker });
    const runtime = createScheduleRuntime(graph, { cron: fakeCron.factory });

    await runtime.start();
    const tick = fakeCron.entries[0]?.trigger();
    await startedRun.promise;
    const stopping = runtime.stop();

    expect(fakeCron.entries[0]?.stopped).toBe(true);
    expect(events).toEqual(['create', 'run:start']);

    canFinish.resolve();
    const stopped = await stopping;
    await tick;

    expect(stopped.isOk()).toBe(true);
    expect(stopped.unwrap()).toMatchObject({
      resources: { disposed: [db.id], evicted: [db.id] },
      settledRuns: 1,
    });
    expect(events).toEqual(['create', 'run:start', 'run:end', 'dispose:db']);
  });

  test('stop reports drain context failures without getting stuck stopping', async () => {
    const fakeCron = createFakeCron();
    const worker = trail('drain-context.run', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [schedule('schedule.drain-context', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('drain-context', { worker });
    const runtime = createScheduleRuntime(graph, {
      createContext: () => {
        throw new Error('drain context failed');
      },
      cron: fakeCron.factory,
    });

    const started = await runtime.start();
    const stopped = await runtime.stop();
    const stoppedAgain = await runtime.stop();

    expect(started.isOk()).toBe(true);
    expect(stopped.isErr()).toBe(true);
    expect(stopped.error.message).toBe('Schedule runtime stop failed');
    expect(stopped.error.cause).toBeInstanceOf(Error);
    expect((stopped.error.cause as Error | undefined)?.message).toBe(
      'drain context failed'
    );
    expect(runtime.state()).toBe('stopped');
    expect(fakeCron.entries[0]?.stopped).toBe(true);
    expect(stoppedAgain.isOk()).toBe(true);
  });

  test('failed scheduled trail results are reported and later ticks continue', async () => {
    const fakeCron = createFakeCron();
    const records: ScheduleRuntimeRunRecord[] = [];
    let calls = 0;
    const worker = trail('flaky.run', {
      blaze: () => {
        calls += 1;
        return calls === 1
          ? Result.err(new ValidationError('first run failed'))
          : Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [schedule('schedule.flaky', { cron: '* * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('flaky', { worker });
    const runtime = createScheduleRuntime(graph, {
      cron: fakeCron.factory,
      onRun: (record) => {
        records.push(record);
      },
    });

    await runtime.start();
    await fakeCron.entries[0]?.trigger();
    await fakeCron.entries[0]?.trigger();

    expect(calls).toBe(2);
    expect(records.map((record) => record.status)).toEqual(['err', 'ok']);
    expect(records[0]?.result?.isErr()).toBe(true);
    expect(records[1]?.result?.isOk()).toBe(true);
  });

  test('multiple trails using the same schedule source each register and run', async () => {
    const fakeCron = createFakeCron();
    const runs: string[] = [];
    const sharedSchedule = schedule('schedule.shared', {
      cron: '*/15 * * * *',
    });
    const first = trail('shared.first', {
      blaze: () => {
        runs.push('first');
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [sharedSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const second = trail('shared.second', {
      blaze: () => {
        runs.push('second');
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [sharedSchedule],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('shared', { first, second });
    const runtime = createScheduleRuntime(graph, { cron: fakeCron.factory });

    const started = await runtime.start();
    await fakeCron.entries[0]?.trigger();
    await fakeCron.entries[1]?.trigger();

    expect(started.unwrap().registered).toEqual([
      {
        cron: '*/15 * * * *',
        sourceId: 'schedule.shared',
        trailId: 'shared.first',
      },
      {
        cron: '*/15 * * * *',
        sourceId: 'schedule.shared',
        trailId: 'shared.second',
      },
    ]);
    expect(runs).toEqual(['first', 'second']);
  });

  test('reports non-UTC timezone metadata as advisory during start', async () => {
    const fakeCron = createFakeCron();
    const warnings: unknown[] = [];
    const worker = trail('timezone.run', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [
        schedule('schedule.timezone', {
          cron: '0 9 * * *',
          timezone: 'America/New_York',
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('timezone', { worker });
    const runtime = createScheduleRuntime(graph, {
      cron: fakeCron.factory,
      logger: {
        debug: () => {},
        error: () => {},
        warn: (_message, fields) => {
          warnings.push(fields);
        },
      },
    });

    const started = await runtime.start();

    expect(started.isOk()).toBe(true);
    expect(started.unwrap().warnings).toEqual([
      {
        code: 'schedule_timezone_metadata_only',
        message:
          'The built-in Bun cron runtime records schedule timezone metadata but does not apply timezone-aware scheduling.',
        sourceId: 'schedule.timezone',
        timezone: 'America/New_York',
        trailId: 'timezone.run',
      },
    ]);
    expect(warnings).toEqual([
      {
        code: 'schedule_timezone_metadata_only',
        sourceId: 'schedule.timezone',
        timezone: 'America/New_York',
        trailId: 'timezone.run',
      },
    ]);
  });

  test('schedule where predicates can skip without crashing the runtime', async () => {
    const fakeCron = createFakeCron();
    const records: ScheduleRuntimeRunRecord[] = [];
    const runs: string[] = [];
    const skipped = trail('where.skipped', {
      blaze: () => {
        runs.push('skipped');
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [
        {
          source: schedule('schedule.where.false', { cron: '* * * * *' }),
          where: () => false,
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const broken = trail('where.broken', {
      blaze: () => {
        runs.push('broken');
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [
        {
          source: schedule('schedule.where.error', { cron: '* * * * *' }),
          where: () => {
            throw new Error('where exploded');
          },
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const graph = topo('where', { broken, skipped });
    const runtime = createScheduleRuntime(graph, {
      cron: fakeCron.factory,
      onRun: (record) => {
        records.push(record);
      },
    });

    await runtime.start();
    await fakeCron.entries[0]?.trigger();
    await fakeCron.entries[1]?.trigger();

    expect(runs).toEqual([]);
    expect(records.map((record) => record.skipReason)).toEqual([
      'where_error',
      'where_false',
    ]);
  });

  test('passes execution options through the normal run pipeline', async () => {
    const fakeCron = createFakeCron();
    const events: string[] = [];
    const configured = resource(scheduleRuntimeId('configured'), {
      config: z.object({ label: z.string() }),
      create: (ctx) => Result.ok({ label: ctx.config.label }),
    });
    const layer: Layer = {
      name: 'test-layer',
      wrap: (_trail, implementation) => async (input, ctx) => {
        events.push('layer');
        return await implementation(input, ctx);
      },
    };
    const worker = trail('options.run', {
      blaze: (_input, ctx) => {
        events.push(
          `${configured.from(ctx).label}:${ctx.requestId}:${String(ctx.extensions?.['marker'])}`
        );
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [schedule('schedule.options', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
      resources: [configured],
    });
    const graph = topo('options', { configured, worker });
    const runtime = createScheduleRuntime(graph, {
      configValues: { [configured.id]: { label: 'configured' } },
      createContext: () =>
        createTrailContext({
          extensions: { marker: 'ctx' },
          requestId: 'scheduled-request',
        }),
      cron: fakeCron.factory,
      layers: [layer],
      unref: true,
    });

    const started = await runtime.start();
    await fakeCron.entries[0]?.trigger();

    expect(started.isOk()).toBe(true);
    expect(fakeCron.entries[0]?.unrefCalls).toBe(1);
    expect(events).toEqual(['layer', 'configured:scheduled-request:ctx']);
  });
});
