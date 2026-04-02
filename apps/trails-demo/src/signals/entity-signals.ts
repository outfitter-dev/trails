/**
 * Entity signals -- domain notifications emitted by entity trails.
 *
 * Demonstrates: signal() with from linking signals to their producing trails.
 */

import { signal } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// entity.updated
// ---------------------------------------------------------------------------

export const updated = signal('entity.updated', {
  description: 'Fired when an entity is created, modified, or deleted',
  from: ['entity.add', 'entity.delete'],
  payload: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
    entityName: z.string(),
    timestamp: z.string(),
  }),
});
