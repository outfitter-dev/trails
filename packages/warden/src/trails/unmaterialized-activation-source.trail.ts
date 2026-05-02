import { Result, schedule, signal, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { unmaterializedActivationSource } from '../rules/unmaterialized-activation-source.js';
import { wrapTopoRule } from './wrap-rule.js';

const invoicePaidWebhook = webhook('webhook.invoice.paid', {
  parse: z.object({ invoiceId: z.string() }),
  path: '/webhooks/invoice/paid',
});

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
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-461-webhook-materialized', { webhookConsumer }),
      },
      name: 'Webhook activation sources are materialized by HTTP',
    },
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-496-materialized-sources', {
          invoiceCreated,
          scheduleConsumer,
          signalConsumer,
          signalProducer,
          webhookConsumer,
        }),
      },
      name: 'Signal, schedule, and webhook activation sources are materialized',
    },
  ],
  rule: unmaterializedActivationSource,
});
