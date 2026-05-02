import { Result, resource, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { signalGraphCoaching } from '../rules/signal-graph-coaching.js';
import { wrapTopoRule } from './wrap-rule.js';

const unusedSignal = signal('invoice.unused', {
  payload: z.object({ invoiceId: z.string() }),
});

const producedSignal = signal('invoice.created', {
  payload: z.object({ invoiceId: z.string() }),
});

const producerTrail = trail('invoice.create', {
  blaze: () => Result.ok({ invoiceId: 'inv_1' }),
  fires: [producedSignal],
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const resourceSignal = signal('store:invoice.created', {
  payload: z.object({ invoiceId: z.string() }),
});

const invoiceStore = resource('store', {
  create: () => Result.ok({ ok: true }),
  signals: [resourceSignal],
});

export const signalGraphCoachingTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Signal "invoice.created" is produced by producer trail "invoice.create" but has no consumer trails. Add an on: consumer if the signal is meant to drive reactive work, or remove the unused fires:/producer declaration.',
            rule: 'signal-graph-coaching',
            severity: 'warn',
          },
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Signal "invoice.unused" is declared in the topo but has no producer trails, producer resources, or consumer trails. Add fires:/on: edges, attach producer metadata, or remove the unused signal contract.',
            rule: 'signal-graph-coaching',
            severity: 'warn',
          },
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Signal "store:invoice.created" is produced by producer resource "store" but has no consumer trails. Add an on: consumer if the signal is meant to drive reactive work, or remove the unused fires:/producer declaration.',
            rule: 'signal-graph-coaching',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: topo('trl-447-signal-graph-coaching', {
          invoiceStore,
          producedSignal,
          producerTrail,
          unusedSignal,
        }),
      },
      name: 'Declared and produced signals without consumers get coaching',
    },
  ],
  rule: signalGraphCoaching,
});
