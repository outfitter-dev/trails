import { describe, expect, test } from 'bun:test';

import {
  isTrailsError,
  NotFoundError,
  Result,
  schedule,
  topo,
  trail,
  ValidationError,
} from '@ontrails/core';
import { z } from 'zod';

import {
  CLOUDFLARE_CRON_UTC_ONLY,
  CLOUDFLARE_CRON_WEEKDAY_UNSUPPORTED,
  createScheduledHandler,
} from '../index.js';
import type { CloudflareScheduledController } from '../index.js';
import { cloudflareKv } from '../../kv/index.js';
import { createWorkersHandler } from '../../workers/index.js';

const controller = (
  cron: string,
  noRetry: () => void = () => {}
): CloudflareScheduledController => ({
  cron,
  noRetry,
  scheduledTime: Date.UTC(2026, 9, 29, 12, 0, 0),
});

describe('createScheduledHandler', () => {
  test('runs every trail whose normalized cron matches the controller', async () => {
    const fired: string[] = [];
    const tick = schedule('tick', { cron: '*/5  *  * * *' });
    const sweep = schedule('sweep', {
      cron: '0 3 * * *',
      input: { scope: 'all' },
    });
    const onTick = trail('tick.run', {
      implementation: (_input, ctx) => {
        fired.push(`tick:${ctx.activation?.source.id ?? 'none'}`);
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [tick],
      output: z.object({ ok: z.boolean() }),
    });
    const onSweep = trail('sweep.run', {
      implementation: (input: { scope: string }) => {
        fired.push(`sweep:${input.scope}`);
        return Result.ok({ ok: true });
      },
      input: z.object({ scope: z.string() }),
      on: [sweep],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(
      topo('schedules', { onSweep, onTick })
    );

    await handler(controller('*/5 * * * *'));
    expect(fired).toEqual(['tick:tick']);

    await handler(controller('0 3 * * *'));
    expect(fired).toEqual(['tick:tick', 'sweep:all']);
  });

  test('an unmatched cron is a no-op', async () => {
    let fired = 0;
    const tick = schedule('tick', { cron: '*/5 * * * *' });
    const onTick = trail('tick.run', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [tick],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(topo('schedules', { onTick }));
    await handler(controller('0 0 1 1 *'));
    expect(fired).toBe(0);
  });

  test('a non-UTC schedule fails at materialization with a specific error', () => {
    const nightly = schedule('nightly', {
      cron: '0 3 * * *',
      timezone: 'America/Chicago',
    });
    const onNightly = trail('nightly.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [nightly],
      output: z.object({ ok: z.boolean() }),
    });
    let caught: unknown;
    try {
      createScheduledHandler(topo('schedules', { onNightly }));
    } catch (error: unknown) {
      caught = error;
    }
    expect(isTrailsError(caught)).toBe(true);
    if (!isTrailsError(caught)) {
      return;
    }
    expect(caught.category).toBe('validation');
    expect(caught.context).toMatchObject({
      code: CLOUDFLARE_CRON_UTC_ONLY,
      sourceId: 'nightly',
      timezone: 'America/Chicago',
      trailId: 'nightly.run',
    });
  });

  test.each(['0', '1', '6', '7', '1-5', '0,6', '1-5/2', '*/2', '*/1', '*,1'])(
    'refuses weekday field %s instead of changing the authored day',
    (dayOfWeek) => {
      const cron = `0 3 * * ${dayOfWeek}`;
      const weekly = schedule('weekly', { cron });
      let fired = false;
      const onWeekly = trail('weekly.run', {
        implementation: () => {
          fired = true;
          return Result.ok({ ok: true });
        },
        input: z.object({}),
        on: [weekly],
        output: z.object({ ok: z.boolean() }),
      });
      const graph = topo('schedules', { onWeekly });
      expect(() => createScheduledHandler(graph)).toThrow(ValidationError);
      expect(() => createScheduledHandler(graph)).toThrow(
        expect.objectContaining({
          context: expect.objectContaining({
            code: CLOUDFLARE_CRON_WEEKDAY_UNSUPPORTED,
            cron,
            dayOfWeek,
            sourceId: 'weekly',
            trailId: 'weekly.run',
          }),
          message: expect.stringContaining('1=Sunday through 7=Saturday'),
        })
      );
      expect(fired).toBe(false);
    }
  );

  test('excluded weekday schedules do not block eligible registrations', async () => {
    const weekly = schedule('weekly', { cron: '0 3 * * 1' });
    const onWeekly = trail('weekly.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [weekly],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(topo('schedules', { onWeekly }), {
      exclude: ['weekly.*'],
    });
    await expect(handler(controller('0 3 * * 1'))).resolves.toBeUndefined();
  });

  test('numeric fields before the wildcard weekday remain supported', async () => {
    const yearly = schedule('yearly', { cron: ' 0  3 1 1 * ' });
    let fired = 0;
    const onYearly = trail('yearly.run', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [yearly],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(topo('schedules', { onYearly }));
    await handler(controller('0 3 1 1 *'));
    expect(fired).toBe(1);
  });

  test('explicit UTC schedules materialize', async () => {
    const utc = schedule('utc', { cron: '0 * * * *', timezone: 'UTC' });
    let fired = 0;
    const onUtc = trail('utc.run', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [utc],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(topo('schedules', { onUtc }));
    await handler(controller('0 * * * *'));
    expect(fired).toBe(1);
  });

  test('trail failures rethrow and non-retryable failures call noRetry', async () => {
    const tick = schedule('tick', { cron: '* * * * *' });
    const failing = trail('tick.fail', {
      implementation: () => Result.err(new NotFoundError('nothing to tick')),
      input: z.object({}),
      on: [tick],
      output: z.object({ ok: z.boolean() }),
    });
    const handler = createScheduledHandler(topo('schedules', { failing }));
    let noRetryCalls = 0;
    let caught: unknown;
    try {
      await handler(
        controller('* * * * *', () => {
          noRetryCalls += 1;
        })
      );
    } catch (error: unknown) {
      caught = error;
    }
    expect(noRetryCalls).toBe(1);
    expect(isTrailsError(caught) && caught.category).toBe('internal');
    expect(caught instanceof Error && caught.message).toContain(
      'nothing to tick'
    );
  });

  test('a throwing where predicate skips its activation instead of failing the invocation', async () => {
    let fired = 0;
    const tick = schedule('tick', { cron: '* * * * *' });
    const guarded = trail('tick.guarded', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [
        {
          source: tick,
          where: () => {
            throw new Error('predicate exploded');
          },
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const steady = trail('tick.steady', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [tick],
      output: z.object({ ok: z.boolean() }),
    });
    const originalWarn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };
    try {
      const handler = createScheduledHandler(
        topo('schedules', { guarded, steady })
      );
      await handler(controller('* * * * *'));
    } finally {
      console.warn = originalWarn;
    }
    expect(fired).toBe(1);
    expect(warnings).toHaveLength(1);
  });

  test('an unrelated schedule with a missing binding never blocks the firing cron', async () => {
    let fired = 0;
    const flags = cloudflareKv('flags', { binding: 'FLAGS' });
    const hourly = schedule('hourly', { cron: '0 * * * *' });
    const nightly = schedule('nightly', { cron: '0 3 * * *' });
    const onHourly = trail('hourly.run', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [hourly],
      output: z.object({ ok: z.boolean() }),
    });
    const onNightly = trail('nightly.sweep', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [nightly],
      output: z.object({ ok: z.boolean() }),
      resources: [flags],
    });
    const worker = createWorkersHandler(
      topo('schedules', { flags, onHourly, onNightly })
    );
    // No FLAGS binding in env: only the nightly cron needs it.
    await worker.scheduled(controller('0 * * * *'), {});
    expect(fired).toBe(1);
    const originalError = console.error;
    console.error = () => {};
    try {
      await expect(
        worker.scheduled(controller('0 3 * * *'), {})
      ).rejects.toThrow(/FLAGS/);
    } finally {
      console.error = originalError;
    }
  });

  test('the Workers export exposes scheduled next to fetch and queue', async () => {
    let fired = 0;
    const tick = schedule('tick', { cron: '*/10 * * * *' });
    const onTick = trail('tick.run', {
      implementation: () => {
        fired += 1;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [tick],
      output: z.object({ ok: z.boolean() }),
    });
    const worker = createWorkersHandler(topo('schedules', { onTick }));
    await worker.scheduled(controller('*/10 * * * *'), {});
    expect(fired).toBe(1);
  });

  test('the Workers export refuses numeric weekdays before running the trail', async () => {
    const weekly = schedule('weekly', { cron: '0 3 * * 1' });
    let fired = false;
    const onWeekly = trail('weekly.run', {
      implementation: () => {
        fired = true;
        return Result.ok({ ok: true });
      },
      input: z.object({}),
      on: [weekly],
      output: z.object({ ok: z.boolean() }),
    });
    const worker = createWorkersHandler(topo('schedules', { onWeekly }));
    await expect(
      worker.scheduled(controller('0 3 * * 1'), {})
    ).rejects.toMatchObject({
      category: 'validation',
      context: { code: CLOUDFLARE_CRON_WEEKDAY_UNSUPPORTED },
    });
    expect(fired).toBe(false);
  });

  test('the Workers export fails loudly on a non-UTC schedule', async () => {
    const nightly = schedule('nightly', {
      cron: '0 3 * * *',
      timezone: 'Europe/Berlin',
    });
    const onNightly = trail('nightly.run', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [nightly],
      output: z.object({ ok: z.boolean() }),
    });
    const worker = createWorkersHandler(topo('schedules', { onNightly }));
    await expect(
      worker.scheduled(controller('0 3 * * *'), {})
    ).rejects.toMatchObject({
      context: { code: CLOUDFLARE_CRON_UTC_ONLY },
    });
  });
});
