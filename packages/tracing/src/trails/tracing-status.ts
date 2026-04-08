import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tracingProvision } from '../tracing-provision.js';

/** Output schema for the tracing.status trail. */
const tracingStatusOutput = z.object({
  active: z.boolean(),
  recordCount: z.number(),
  samplingConfig: z.object({
    destroy: z.number(),
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Reports the current status of the tracing telemetry subsystem.
 *
 * Returns whether tracing is active, the current record count, and
 * the sampling configuration for each intent. Reads all values from
 * the `tracingProvision` state.
 */
export const tracingStatus = trail('tracing.status', {
  blaze: (_input, ctx) => {
    const state = tracingProvision.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
      samplingConfig: { ...state.sampling },
    });
  },
  examples: [
    {
      input: {},
      name: 'Check tracing status',
    },
  ],
  input: z.object({}),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: tracingStatusOutput,
  resources: [tracingProvision],
});
