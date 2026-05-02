import { Result, schedule, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { activationOrphan } from '../rules/activation-orphan.js';
import { wrapTopoRule } from './wrap-rule.js';

const orphanSignal = signal('invoice.paid', {
  payload: z.object({ invoiceId: z.string() }),
});

const orphanConsumer = trail('invoice.audit', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [orphanSignal],
  output: z.object({ ok: z.boolean() }),
});

const producedSignal = signal('invoice.created', {
  from: ['invoice.create'],
  payload: z.object({ invoiceId: z.string() }),
});

const producerTrail = trail('invoice.create', {
  blaze: () => Result.ok({ invoiceId: 'inv_1' }),
  fires: [producedSignal],
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const producedConsumer = trail('invoice.index', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [producedSignal],
  output: z.object({ ok: z.boolean() }),
});

const scheduledConsumer = trail('invoice.reconcile', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [schedule('schedule.invoice.reconcile', { cron: '0 * * * *' })],
  output: z.object({ ok: z.boolean() }),
});

export const activationOrphanTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Signal activation source "invoice.paid" activates trail "invoice.audit" but has no producer declaration in the topo. Add a trail fires: declaration, add signal from: producer metadata, or remove the unused activation source.',
            rule: 'activation-orphan',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: topo('trl-452-activation-orphan', {
          orphanConsumer,
          orphanSignal,
        }),
      },
      name: 'Signal activation consumers need producer declarations',
    },
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-452-activation-clean', {
          producedConsumer,
          producedSignal,
          producerTrail,
          scheduledConsumer,
        }),
      },
      name: 'Produced signals and schedules are not activation orphans',
    },
  ],
  rule: activationOrphan,
});
