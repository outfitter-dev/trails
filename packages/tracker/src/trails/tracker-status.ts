import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { trackerProvision } from '../tracker-provision.js';

/** Output schema for the tracker.status trail. */
const trackerStatusOutput = z.object({
  active: z.boolean(),
  recordCount: z.number(),
  samplingConfig: z.object({
    destroy: z.number(),
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Reports the current status of the tracker telemetry subsystem.
 *
 * Returns whether tracking is active, the current record count, and
 * the sampling configuration for each intent. Reads all values from
 * the `trackerProvision` state.
 */
export const trackerStatus = trail('tracker.status', {
  blaze: (_input, ctx) => {
    const state = trackerProvision.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
      samplingConfig: { ...state.sampling },
    });
  },
  examples: [
    {
      input: {},
      name: 'Check tracker status',
    },
  ],
  input: z.object({}),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: trackerStatusOutput,
  resources: [trackerProvision],
});
