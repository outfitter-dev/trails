/**
 * Notification trails -- reactive consumers of domain signals.
 *
 * Demonstrates: `on:` activation wiring trails to signals emitted by
 * other trails. The runtime fans out to every consumer that lists the
 * signal in its `on:` array when a producer calls `ctx.fire()`.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Notification log -- in-memory side-effect sink
// ---------------------------------------------------------------------------

/**
 * Mutable in-memory log of notifications emitted by `entity.notify-updated`.
 *
 * Exists so the demo and its integration tests can observe the end-to-end
 * signal fan-out pipeline without a real notification transport. A real
 * app would replace this with an email/slack/webhook provision.
 */
export interface Notification {
  readonly action: 'created' | 'updated' | 'deleted';
  readonly entityId: string;
  readonly entityName: string;
  readonly timestamp: string;
}

const notificationLog: Notification[] = [];

/** Read the current notification log (defensive copy). */
export const getNotifications = (): readonly Notification[] => [
  ...notificationLog,
];

/** Clear the notification log. Useful between tests. */
export const clearNotifications = (): void => {
  notificationLog.length = 0;
};

// ---------------------------------------------------------------------------
// entity.notify-updated
// ---------------------------------------------------------------------------

/**
 * Consumer trail that reacts to entity.updated signals.
 *
 * Receives the validated signal payload as its input and logs a
 * notification. Serves as the proof-of-life for the signal fan-out
 * pipeline in the demo app.
 */
export const notifyEntityUpdated = trail('entity.notify-updated', {
  blaze: (input, ctx) => {
    notificationLog.push({
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
});
