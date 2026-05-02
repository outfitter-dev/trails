import { Result, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { webhookRouteCollision } from '../rules/webhook-route-collision.js';
import { wrapTopoRule } from './wrap-rule.js';

const paymentWebhook = webhook('webhook.payment.received', {
  parse: z.object({ paymentId: z.string() }),
  path: '/webhooks/payment',
});

const paymentReceiver = trail('payment.receive', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ paymentId: z.string() }),
  on: [paymentWebhook],
  output: z.object({ ok: z.boolean() }),
});

const directRoute = trail('webhooks.payment', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
});

export const webhookRouteCollisionTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'HTTP webhook route collision on POST /webhooks/payment: derived trail route "webhooks.payment", webhook source "webhook.payment.received" on trail "payment.receive". Give each webhook source a distinct method/path pair or move the direct trail route before materializing the HTTP surface.',
            rule: 'webhook-route-collision',
            severity: 'error',
          },
        ],
      },
      input: {
        topo: topo('trl-461-webhook-route-collision', {
          directRoute,
          paymentReceiver,
        }),
      },
      name: 'Webhook route colliding with a derived direct HTTP route',
    },
  ],
  rule: webhookRouteCollision,
});
