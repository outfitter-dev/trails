import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { crumbsService } from '../crumbs-service.js';

/** Output schema for the crumbs.status trail. */
const crumbsStatusOutput = z.object({
  active: z.boolean(),
  recordCount: z.number(),
  samplingConfig: z.object({
    destroy: z.number(),
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Reports the current status of the crumbs telemetry subsystem.
 *
 * Returns whether tracking is active, the current record count, and
 * the sampling configuration for each intent. Reads all values from
 * the `crumbsService` state.
 */
export const crumbsStatus = trail('crumbs.status', {
  blaze: (_input, ctx) => {
    const state = crumbsService.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
      samplingConfig: { ...state.sampling },
    });
  },
  examples: [
    {
      input: {},
      name: 'Check crumbs status',
    },
  ],
  input: z.object({}),
  intent: 'read',
  metadata: { category: 'infrastructure' },
  output: crumbsStatusOutput,
  services: [crumbsService],
});
