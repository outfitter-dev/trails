/**
 * Notification dispatch — channel fan-out for incident lifecycle events.
 *
 * The console channel reports through the structured logger (blazes stay
 * pure — no direct console output); the webhook channel posts JSON through
 * the shared HTTP resource when `LOOKOUT_WEBHOOK_URL` is configured. Every
 * delivery records a notification row.
 */

import { Result, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { probeHttp } from '../resources/probe-http.js';
import { db } from '../store.js';

const deliverySchema = z.object({
  channel: z.enum(['console', 'webhook']),
  ok: z.boolean(),
});

const webhookUrl = (ctx: TrailContext): string | undefined =>
  ctx.env?.['LOOKOUT_WEBHOOK_URL'];

export const dispatchNotification = trail('notify.dispatch', {
  blaze: async (input, ctx) => {
    const store = db.from(ctx);
    const sentAt = new Date().toISOString();
    const deliveries: z.output<typeof deliverySchema>[] = [];

    ctx.logger?.info(`lookout notification: ${input.message}`, {
      incidentId: input.incidentId,
      kind: input.kind,
    });
    await store.notifications.insert({
      channel: 'console',
      incidentId: input.incidentId,
      ok: true,
      sentAt,
    });
    deliveries.push({ channel: 'console', ok: true });

    const url = webhookUrl(ctx);
    if (url !== undefined) {
      const reply = await probeHttp.from(ctx).post({
        body: {
          incidentId: input.incidentId,
          kind: input.kind,
          message: input.message,
        },
        url,
      });
      const ok = reply.kind === 'response' && reply.status < 300;
      await store.notifications.insert({
        channel: 'webhook',
        incidentId: input.incidentId,
        ok,
        sentAt,
      });
      deliveries.push({ channel: 'webhook', ok });
    }

    return Result.ok({ deliveries });
  },
  description:
    'Fan an incident lifecycle event out to the configured channels and record each delivery.',
  examples: [
    {
      description: 'Console delivery always runs; webhook only when configured',
      expected: { deliveries: [{ channel: 'console', ok: true }] },
      input: {
        incidentId: 'inc_demo',
        kind: 'opened',
        message: 'check "flaky" is down',
      },
      name: 'Dispatch to console',
    },
  ],
  input: z.object({
    incidentId: z.string().describe('Incident this notification belongs to'),
    kind: z
      .enum(['opened', 'resolved'])
      .describe('Incident lifecycle event being announced'),
    message: z.string().describe('Human-readable notification text'),
  }),
  intent: 'write',
  output: z.object({
    deliveries: z.array(deliverySchema),
  }),
  resources: [db, probeHttp],
  visibility: 'internal',
});
