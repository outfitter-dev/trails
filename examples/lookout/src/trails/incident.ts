/**
 * Incident lifecycle — the reactive consumers of probe transition signals.
 *
 * `incident.open` reacts to `probe.failed`, `incident.resolve` reacts to
 * `probe.recovered`. Incidents track transitions, not probes: a check that
 * keeps failing while already down produces no new signal, and even a
 * repeated `probe.failed` payload dedupes against the already-open incident.
 * Both lifecycle trails compose `notify.dispatch`.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import {
  probeFailed,
  probeRecovered,
  probeTransitionPayloadSchema,
} from '../signals/probe-signals.js';
import { db, incidentSchema } from '../store.js';
import type { Incident } from '../store.js';

import { dispatchNotification } from './notify.js';

const ADMIN_SCOPES = ['lookout:admin'] as const;

const openIncidentFor = async (
  ctx: TrailContext,
  checkId: string
): Promise<Incident | undefined> => {
  const incidents = await db.from(ctx).incidents.list({ checkId });
  return incidents.find((incident) => incident.status !== 'resolved');
};

// ---------------------------------------------------------------------------
// incident.open — on: probe.failed
// ---------------------------------------------------------------------------

export const openIncident = trail('incident.open', {
  composes: [dispatchNotification],
  description:
    'Open an incident when a check transitions to down; dedupes when one is already open.',
  examples: [
    {
      description: 'A fresh up→down transition opens an incident and notifies',
      expectedMatch: { deduped: false, notified: true },
      input: {
        at: '2026-07-01T03:12:00.000Z',
        checkId: 'chk_steady',
        checkName: 'steady',
        failureReason: 'upstream answered 503',
        probeId: 'prb_1',
        url: 'http://localhost:4090/steady',
      },
      name: 'Open an incident',
    },
    {
      description:
        'A failure signal for a check with an open incident dedupes to a no-op',
      expectedMatch: { deduped: true, notified: false },
      input: {
        at: '2026-07-01T03:13:00.000Z',
        checkId: 'chk_retired',
        checkName: 'retired',
        failureReason: 'upstream answered 503',
        probeId: 'prb_2',
        url: 'http://localhost:4090/flaky',
      },
      name: 'Dedupe against an open incident',
    },
  ],
  implementation: async (input, ctx) => {
    const existing = await openIncidentFor(ctx, input.checkId);
    if (existing) {
      // Transition dedupe: a failure signal for an already-open incident is
      // a no-op, never a second incident.
      return Result.ok({ deduped: true, incident: existing, notified: false });
    }
    const incident = await db.from(ctx).incidents.insert({
      acknowledgedBy: null,
      checkId: input.checkId,
      openedAt: input.at,
      probeCount: 1,
      resolvedAt: null,
      status: 'open',
    });
    const notify = await ctx.compose(dispatchNotification, {
      incidentId: incident.id,
      kind: 'opened',
      message: `check "${input.checkName}" is down (${input.failureReason ?? 'unknown reason'})`,
    });
    return Result.ok({ deduped: false, incident, notified: notify.isOk() });
  },
  input: probeTransitionPayloadSchema,
  intent: 'write',
  on: [probeFailed],
  output: z.object({
    deduped: z.boolean(),
    incident: incidentSchema,
    notified: z.boolean(),
  }),
  resources: [db],
  visibility: 'internal',
});

// ---------------------------------------------------------------------------
// incident.resolve — on: probe.recovered
// ---------------------------------------------------------------------------

export const resolveIncident = trail('incident.resolve', {
  composes: [dispatchNotification],
  description: 'Resolve the open incident when a check transitions back to up.',
  examples: [
    {
      description: 'A down→up transition resolves the open incident',
      expectedMatch: { notified: true, resolved: true },
      input: {
        at: '2026-07-01T03:20:00.000Z',
        checkId: 'chk_retired',
        checkName: 'retired',
        failureReason: null,
        probeId: 'prb_3',
        url: 'http://localhost:4090/steady',
      },
      name: 'Resolve an incident',
    },
    {
      description: 'A recovery with no open incident is a no-op',
      expectedMatch: { notified: false, resolved: false },
      input: {
        at: '2026-07-01T03:21:00.000Z',
        checkId: 'chk_steady',
        checkName: 'steady',
        failureReason: null,
        probeId: 'prb_4',
        url: 'http://localhost:4090/steady',
      },
      name: 'Recovery without an incident',
    },
  ],
  implementation: async (input, ctx) => {
    const existing = await openIncidentFor(ctx, input.checkId);
    if (!existing) {
      return Result.ok({ incident: null, notified: false, resolved: false });
    }
    const incident = await db.from(ctx).incidents.update(existing.id, {
      resolvedAt: input.at,
      status: 'resolved',
    });
    if (!incident) {
      return Result.ok({ incident: null, notified: false, resolved: false });
    }
    const notify = await ctx.compose(dispatchNotification, {
      incidentId: incident.id,
      kind: 'resolved',
      message: `check "${input.checkName}" recovered`,
    });
    return Result.ok({ incident, notified: notify.isOk(), resolved: true });
  },
  input: probeTransitionPayloadSchema,
  intent: 'write',
  on: [probeRecovered],
  output: z.object({
    incident: incidentSchema.nullable(),
    notified: z.boolean(),
    resolved: z.boolean(),
  }),
  resources: [db],
  visibility: 'internal',
});

// ---------------------------------------------------------------------------
// incident.list / incident.get / incident.acknowledge
// ---------------------------------------------------------------------------

export const listIncidents = trail('incident.list', {
  description: 'List incidents, newest first.',
  examples: [
    {
      description: 'The demo store seeds one open incident',
      expectedMatch: { total: 1 },
      input: {},
      name: 'List incidents',
    },
  ],
  implementation: async (input, ctx) => {
    const filters =
      input.status === undefined ? undefined : { status: input.status };
    const incidents = await db.from(ctx).incidents.list(filters);
    const sorted = [...incidents].toSorted((a, b) =>
      b.openedAt.localeCompare(a.openedAt)
    );
    return Result.ok({ incidents: sorted, total: sorted.length });
  },
  input: z.object({
    status: z
      .enum(['open', 'acknowledged', 'resolved'])
      .optional()
      .describe('Filter by incident status'),
  }),
  intent: 'read',
  output: z.object({
    incidents: z.array(incidentSchema),
    total: z.number().int(),
  }),
  permit: 'public',
  resources: [db],
});

export const getIncident = trail('incident.get', {
  description: 'Show one incident by id.',
  examples: [
    {
      description: 'Look up the seeded demo incident',
      expectedMatch: { checkId: 'chk_retired', id: 'inc_demo' },
      input: { id: 'inc_demo' },
      name: 'Get an incident',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'inc_missing' },
      name: 'Get a missing incident',
    },
  ],
  implementation: async (input, ctx) => {
    const incident = await db.from(ctx).incidents.get(input.id);
    if (!incident) {
      return Result.err(new NotFoundError(`Incident "${input.id}" not found`));
    }
    return Result.ok(incident);
  },
  input: z.object({
    id: z.string().describe('Incident id'),
  }),
  intent: 'read',
  output: incidentSchema,
  permit: 'public',
  resources: [db],
});

export const acknowledgeIncident = trail('incident.acknowledge', {
  description: 'Acknowledge an incident so on-call knows it is being handled.',
  examples: [
    {
      description: 'Acknowledge the seeded demo incident',
      expectedMatch: { id: 'inc_demo', status: 'acknowledged' },
      input: { by: 'matt', id: 'inc_demo' },
      name: 'Acknowledge an incident',
    },
  ],
  implementation: async (input, ctx) => {
    const existing = await db.from(ctx).incidents.get(input.id);
    if (!existing) {
      return Result.err(new NotFoundError(`Incident "${input.id}" not found`));
    }
    const acknowledgedBy = input.by ?? ctx.permit?.id ?? 'operator';
    const incident = await db.from(ctx).incidents.update(input.id, {
      acknowledgedBy,
      status: existing.status === 'resolved' ? 'resolved' : 'acknowledged',
    });
    if (!incident) {
      return Result.err(new NotFoundError(`Incident "${input.id}" not found`));
    }
    return Result.ok(incident);
  },
  input: z.object({
    by: z.string().optional().describe('Who is acknowledging'),
    id: z.string().describe('Incident id'),
  }),
  intent: 'write',
  output: incidentSchema,
  permit: { scopes: ADMIN_SCOPES },
  resources: [db],
});
