/**
 * Public status trails — the computed reads behind the status page.
 *
 * `uptime.report` composes `probe.history` and does the math;
 * `status.summary` composes the check, incident, and uptime reads into the
 * page payload; `status.badge` is the tiny per-check payload. All three are
 * public reads that fire nothing.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { checkStateValues, db } from '../store.js';
import type { Probe } from '../store.js';

import { listIncidents } from './incident.js';
import { probeHistory } from './probe.js';

// ---------------------------------------------------------------------------
// Uptime math — pure and fixed-vector testable
// ---------------------------------------------------------------------------

export interface UptimeStats {
  readonly downCount: number;
  readonly probeCount: number;
  readonly recoveredCount: number;
  readonly upCount: number;
  /** Percentage of resolved probes that ended healthy; null with no probes. */
  readonly uptimePercent: number | null;
}

export const computeUptime = (
  probes: readonly Pick<Probe, 'outcome'>[]
): UptimeStats => {
  let upCount = 0;
  let downCount = 0;
  let recoveredCount = 0;
  for (const probe of probes) {
    if (probe.outcome === 'up') {
      upCount += 1;
    } else if (probe.outcome === 'recovered-after-retry') {
      recoveredCount += 1;
    } else {
      downCount += 1;
    }
  }
  const probeCount = probes.length;
  const uptimePercent =
    probeCount === 0
      ? null
      : Math.round(((upCount + recoveredCount) / probeCount) * 10_000) / 100;
  return { downCount, probeCount, recoveredCount, upCount, uptimePercent };
};

const uptimeReportOutputSchema = z.object({
  checkId: z.string(),
  days: z.number(),
  downCount: z.number().int(),
  probeCount: z.number().int(),
  recoveredCount: z.number().int(),
  upCount: z.number().int(),
  uptimePercent: z.number().nullable(),
});

// ---------------------------------------------------------------------------
// uptime.report
// ---------------------------------------------------------------------------

const HISTORY_WINDOW_LIMIT = 10_000;

export const uptimeReport = trail('uptime.report', {
  blaze: async (input, ctx) => {
    const history = await ctx.compose(probeHistory, {
      checkId: input.checkId,
      limit: HISTORY_WINDOW_LIMIT,
      sinceHours: input.days * 24,
    });
    if (history.isErr()) {
      return history;
    }
    const stats = computeUptime(history.value.probes);
    return Result.ok({ checkId: input.checkId, days: input.days, ...stats });
  },
  composes: [probeHistory],
  description:
    'Windowed uptime percentages computed from recorded probe outcomes.',
  examples: [
    {
      description: 'No probes yet means no uptime claim — null, not 100%',
      expected: {
        checkId: 'chk_steady',
        days: 7,
        downCount: 0,
        probeCount: 0,
        recoveredCount: 0,
        upCount: 0,
        uptimePercent: null,
      },
      input: { checkId: 'chk_steady' },
      name: 'Uptime with no history',
    },
  ],
  input: z.object({
    checkId: z.string().describe('Check id'),
    days: z
      .number()
      .int()
      .positive()
      .optional()
      .default(7)
      .describe('Window size in days'),
  }),
  intent: 'read',
  output: uptimeReportOutputSchema,
  permit: 'public',
});

// ---------------------------------------------------------------------------
// status.summary
// ---------------------------------------------------------------------------

const summaryCheckSchema = z.object({
  checkId: z.string(),
  enabled: z.boolean(),
  name: z.string(),
  state: z.enum(checkStateValues),
  uptime30d: z.number().nullable(),
  uptime7d: z.number().nullable(),
  url: z.string(),
});

export const statusSummary = trail('status.summary', {
  blaze: async (_input, ctx) => {
    const checks = await db.from(ctx).checks.list();
    const incidents = await ctx.compose(listIncidents, {});
    if (incidents.isErr()) {
      return incidents;
    }

    const rows: z.output<typeof summaryCheckSchema>[] = [];
    for (const check of checks) {
      const [week, month] = await ctx.compose([
        [uptimeReport, { checkId: check.id, days: 7 }],
        [uptimeReport, { checkId: check.id, days: 30 }],
      ]);
      rows.push({
        checkId: check.id,
        enabled: check.enabled,
        name: check.name,
        state: check.state,
        uptime30d: month.isOk() ? month.value.uptimePercent : null,
        uptime7d: week.isOk() ? week.value.uptimePercent : null,
        url: check.url,
      });
    }

    const openIncidents = incidents.value.incidents.filter(
      (incident) => incident.status !== 'resolved'
    );
    return Result.ok({
      checks: rows,
      generatedAt: new Date().toISOString(),
      openIncidents: openIncidents.length,
    });
  },
  cli: ['status'],
  composes: [listIncidents, uptimeReport],
  description:
    'The public status page payload: per-check state, 7d/30d uptime, and open incident count.',
  examples: [
    {
      description: 'The demo store seeds three checks and one open incident',
      expectedMatch: { openIncidents: 1 },
      input: {},
      name: 'Status summary',
    },
  ],
  input: z.object({}),
  intent: 'read',
  output: z.object({
    checks: z.array(summaryCheckSchema),
    generatedAt: z.string(),
    openIncidents: z.number().int(),
  }),
  permit: 'public',
  resources: [db],
});

// ---------------------------------------------------------------------------
// status.badge
// ---------------------------------------------------------------------------

export const statusBadge = trail('status.badge', {
  blaze: async (input, ctx) => {
    const check = await db.from(ctx).checks.get(input.checkId);
    if (!check) {
      return Result.err(
        new NotFoundError(`Check "${input.checkId}" not found`)
      );
    }
    const uptime = await ctx.compose(uptimeReport, {
      checkId: check.id,
      days: 7,
    });
    return Result.ok({
      checkId: check.id,
      label: check.name,
      state: check.state,
      uptime7d: uptime.isOk() ? uptime.value.uptimePercent : null,
    });
  },
  composes: [uptimeReport],
  description:
    'Tiny per-check JSON payload for embedding (badge-shaped, JSON in v1).',
  examples: [
    {
      description: 'A fresh check reports its state with no uptime claim',
      expected: {
        checkId: 'chk_steady',
        label: 'steady',
        state: 'unknown',
        uptime7d: null,
      },
      input: { checkId: 'chk_steady' },
      name: 'Badge for a check',
    },
  ],
  input: z.object({
    checkId: z.string().describe('Check id'),
  }),
  intent: 'read',
  output: z.object({
    checkId: z.string(),
    label: z.string(),
    state: z.enum(checkStateValues),
    uptime7d: z.number().nullable(),
  }),
  permit: 'public',
  resources: [db],
});
