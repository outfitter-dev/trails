import { Result, schedule, signal, topo, trail } from '@ontrails/core';
import type { ActivationSource } from '@ontrails/core';
import { z } from 'zod';

import { unmaterializedActivationSource } from '../rules/unmaterialized-activation-source.js';
import { wrapTopoRule } from './wrap-rule.js';

const invoicePaidWebhook = {
  id: 'webhook.invoice.paid',
  kind: 'webhook',
  payload: z.object({ invoiceId: z.string() }),
} as const satisfies ActivationSource;

const webhookConsumer = trail('invoice.audit-webhook', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [invoicePaidWebhook],
  output: z.object({ ok: z.boolean() }),
});

const invoiceCreated = signal('invoice.created', {
  from: ['invoice.create'],
  payload: z.object({ invoiceId: z.string() }),
});

const signalProducer = trail('invoice.create', {
  blaze: () => Result.ok({ invoiceId: 'inv_1' }),
  fires: [invoiceCreated],
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const signalConsumer = trail('invoice.index', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [invoiceCreated],
  output: z.object({ ok: z.boolean() }),
});

const scheduleConsumer = trail('invoice.reconcile', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [schedule('schedule.invoice.reconcile', { cron: '0 * * * *' })],
  output: z.object({ ok: z.boolean() }),
});

export const unmaterializedActivationSourceTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Activation source "webhook.invoice.paid" of kind "webhook" activates trail "invoice.audit-webhook" but no built-in materializer is available in this stack. Add the materializer before relying on runtime delivery, or defer the source declaration until the materializer lands.',
            rule: 'unmaterialized-activation-source',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: topo('trl-496-webhook-pending', { webhookConsumer }),
      },
      name: 'Webhook activation sources warn until materialized',
    },
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-496-materialized-sources', {
          invoiceCreated,
          scheduleConsumer,
          signalConsumer,
          signalProducer,
        }),
      },
      name: 'Signal and schedule activation sources are materialized',
    },
  ],
  rule: unmaterializedActivationSource,
});
