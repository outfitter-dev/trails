/**
 * Entity events -- domain events emitted by entity trails.
 *
 * Demonstrates: event() with from linking events to their producing trails.
 */

import { event } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// entity.updated
// ---------------------------------------------------------------------------

export const updated = event('entity.updated', {
  description: 'Emitted when an entity is created, modified, or deleted',
  from: ['entity.add', 'entity.delete'],
  payload: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
    entityName: z.string(),
    timestamp: z.string(),
  }),
});
