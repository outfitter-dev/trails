import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { tracksService } from '../tracks-service.js';

/** Output schema for the tracks.status trail. */
const tracksStatusOutput = z.object({
  active: z.boolean(),
  recordCount: z.number(),
  samplingConfig: z.object({
    destroy: z.number(),
    read: z.number(),
    write: z.number(),
  }),
});

/**
 * Reports the current status of the tracks telemetry subsystem.
 *
 * Returns whether tracking is active, the current record count, and
 * the sampling configuration for each intent. Reads all values from
 * the `tracksService` state.
 */
export const tracksStatus = trail('tracks.status', {
  examples: [
    {
      input: {},
      name: 'Check tracks status',
    },
  ],
  input: z.object({}),
  intent: 'read',
  metadata: { category: 'infrastructure' },
  output: tracksStatusOutput,
  run: (_input, ctx) => {
    const state = tracksService.from(ctx);
    return Result.ok({
      active: state.active,
      recordCount: state.store?.count() ?? 0,
      samplingConfig: { ...state.sampling },
    });
  },
  services: [tracksService],
});
