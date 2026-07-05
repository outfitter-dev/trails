/**
 * Authored signals for the packlist app.
 *
 * The store already derives `db:gear.created` / `db:gear.updated` /
 * `db:gear.removed` (and the same for pack and trip) from the table
 * definitions. `pack.weight-stale` sits one level up: `gear.update` fires it
 * only when a weight change touches gear that some pack actually carries,
 * and `pack.recalculate` consumes it to recompute those packs.
 */

import { signal } from '@ontrails/core';
import { z } from 'zod';

export const packWeightStale = signal('pack.weight-stale', {
  description:
    'Fired when a gear weight change invalidates the derived weight of packs carrying that gear',
  from: ['gear.update'],
  payload: z.object({
    gearId: z.string().describe('Gear whose weight changed'),
    gearName: z.string().describe('Name of the changed gear'),
    packIds: z
      .array(z.string())
      .describe('Packs whose derived weight is now stale'),
    previousWeightGrams: z.number().describe('Weight before the update'),
    weightGrams: z.number().describe('Weight after the update'),
  }),
});
