/**
 * Notification trails -- reactive consumers of domain signals.
 *
 * Demonstrates: `on:` activation wiring trails to signals emitted by
 * other trails. The runtime fans out to every consumer that lists the
 * signal in its `on:` array when a producer calls `ctx.fire()`.
 *
 * Consumer trails inherit the producer's full context, including
 * resources, so the notification side-effect lives in a real
 * `notificationStoreResource` resource rather than a module-level array.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { notificationStoreResource } from '../resources/notification-store.js';

// ---------------------------------------------------------------------------
// entity.notify-updated
// ---------------------------------------------------------------------------

/**
 * Consumer trail that reacts to entity.updated signals.
 *
 * Receives the validated signal payload as its input and writes a
 * notification to the resource-backed notification store. Serves as
 * the proof-of-life for the signal fan-out pipeline in the demo app
 * AND for resource access from a consumer context.
 */
export const notifyEntityUpdated = trail('entity.notify-updated', {
  blaze: (input, ctx) => {
    const store = notificationStoreResource.from(ctx);
    store.push({
      action: input.action,
      entityId: input.entityId,
      entityName: input.entityName,
      timestamp: input.timestamp,
    });
    ctx.logger?.info('entity.updated notification', {
      action: input.action,
      entityId: input.entityId,
      entityName: input.entityName,
    });
    return Result.ok({ notified: true });
  },
  description: 'Log a notification whenever an entity.updated signal is fired.',
  examples: [
    {
      description: 'Notify on a created entity',
      input: {
        action: 'created',
        entityId: 'ent_1',
        entityName: 'Epsilon',
        timestamp: '2026-04-07T00:00:00.000Z',
      },
      name: 'Notify created',
    },
  ],
  input: z.object({
    action: z.enum(['created', 'updated', 'deleted']),
    entityId: z.string(),
    entityName: z.string(),
    timestamp: z.string(),
  }),
  intent: 'write',
  on: ['entity.updated'],
  output: z.object({ notified: z.boolean() }),
  resources: [notificationStoreResource],
});
