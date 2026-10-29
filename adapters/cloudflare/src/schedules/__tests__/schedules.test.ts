import { describe, expect, test } from 'bun:test';

import {
  isTrailsError,
  NotFoundError,
  Result,
  schedule,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { CLOUDFLARE_CRON_UTC_ONLY, createScheduledHandler } from '../index.js';
import type { CloudflareScheduledController } from '../index.js';
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
