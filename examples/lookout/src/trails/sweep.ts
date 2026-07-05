/**
 * Cron-activated probe scheduling.
 *
 * One schedule source ticks `probe.sweep` every minute. The sweep reads the
 * enabled checks, works out which are due from each check's own
 * `intervalSeconds` and latest probe, and composes `probe.run` for every due
 * check. Pausing a check flips `enabled`, which is exactly what removes it
 * from scheduling; resuming puts it back.
 *
 * `lookout dev --fast` materializes the same source with a seconds-scale
 * cron factory and `LOOKOUT_INTERVAL_SCALE`, so the whole reactive loop is
 * watchable in one terminal minute.
 */

import { Result, schedule, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../store.js';
import type { Check } from '../store.js';

import { runProbe } from './probe.js';

export const probeSweepSchedule = schedule('schedule.probe.sweep', {
  cron: '* * * * *',
  input: {},
});

const intervalScale = (ctx: TrailContext): number => {
  const raw = ctx.env?.['LOOKOUT_INTERVAL_SCALE'];
  const parsed = raw === undefined ? 1 : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const isDue = async (
  ctx: TrailContext,
  check: Check,
  nowMs: number,
  scale: number
): Promise<boolean> => {
  const probes = await db.from(ctx).probes.list({ checkId: check.id });
  const latest = [...probes]
    .map((probe) => probe.startedAt)
    .toSorted()
    .at(-1);
  if (latest === undefined) {
    return true;
  }
  const intervalMs = (check.intervalSeconds * 1000) / scale;
  return nowMs - Date.parse(latest) >= intervalMs;
};

const sweepResultSchema = z.object({
  checkId: z.string(),
  ok: z.boolean(),
  outcome: z.string().nullable(),
});

export const sweepProbes = trail('probe.sweep', {
  blaze: async (_input, ctx) => {
    const store = db.from(ctx);
    const enabled = await store.checks.list({ enabled: true });
    const nowMs = Date.now();
    const scale = intervalScale(ctx);

    const due: Check[] = [];
    for (const check of enabled) {
      if (await isDue(ctx, check, nowMs, scale)) {
        due.push(check);
      }
    }

    const results: z.output<typeof sweepResultSchema>[] = [];
    for (const check of due) {
      const result = await ctx.compose(runProbe, { checkId: check.id });
      results.push({
        checkId: check.id,
        ok: result.isOk(),
        outcome: result.isOk() ? result.value.outcome : null,
      });
    }

    return Result.ok({
      due: due.map((check) => check.id),
      probed: results.length,
      results,
    });
  },
  composes: [runProbe],
  description:
    'Probe every enabled check that is due per its own interval; the cron source ticks this each minute.',
  examples: [
    {
      description: 'Both enabled demo checks are due on a fresh store',
      expectedMatch: { probed: 2 },
      input: {},
      name: 'Sweep due checks',
    },
  ],
  input: z.object({}),
  intent: 'write',
  on: [probeSweepSchedule],
  output: z.object({
    due: z.array(z.string()),
    probed: z.number().int(),
    results: z.array(sweepResultSchema),
  }),
  resources: [db],
});
