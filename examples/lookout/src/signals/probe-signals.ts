/**
 * Probe transition signals.
 *
 * `probe.run` fires these on state *transitions*, never per probe: up→down
 * fires `probe.failed`, down→up fires `probe.recovered`. A check that stays
 * down probes silently — that is the transition dedupe the incident
 * lifecycle depends on.
 */

import { signal } from '@ontrails/core';
import { z } from 'zod';

export const probeTransitionPayloadSchema = z.object({
  at: z.string().describe('ISO timestamp of the resolving probe'),
  checkId: z.string().describe('Check that changed state'),
  checkName: z.string().describe('Human-readable check name'),
  failureReason: z
    .string()
    .nullable()
    .describe('Why the probe failed, null on recovery'),
  probeId: z.string().describe('Probe row that resolved the transition'),
  url: z.string().describe('Probed URL'),
});

export const probeFailed = signal('probe.failed', {
  description:
    'A check transitioned up→down (fired once per outage, not per probe).',
  examples: [
    {
      at: '2026-07-01T03:12:00.000Z',
      checkId: 'chk_flaky',
      checkName: 'flaky',
      failureReason: 'upstream answered 503',
      probeId: 'prb_1',
      url: 'http://localhost:4090/flaky',
    },
  ],
  from: ['probe.run'],
  payload: probeTransitionPayloadSchema,
});

export const probeRecovered = signal('probe.recovered', {
  description: 'A check transitioned down→up.',
  examples: [
    {
      at: '2026-07-01T03:20:00.000Z',
      checkId: 'chk_flaky',
      checkName: 'flaky',
      failureReason: null,
      probeId: 'prb_2',
      url: 'http://localhost:4090/flaky',
    },
  ],
  from: ['probe.run'],
  payload: probeTransitionPayloadSchema,
});
