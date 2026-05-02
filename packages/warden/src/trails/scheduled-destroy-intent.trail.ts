import { Result, schedule, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { scheduledDestroyIntent } from '../rules/scheduled-destroy-intent.js';
import { wrapTopoRule } from './wrap-rule.js';

export const scheduledDestroyTrail = trail('billing.purge-expired', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  intent: 'destroy',
  on: [
    schedule('schedule.billing.purge-expired', {
      cron: '0 2 * * *',
    }),
  ],
  output: z.object({ ok: z.boolean() }),
  permit: { scopes: ['billing:purge'] },
});

const scheduledWriteTrail = trail('billing.reconcile', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({}),
  on: [schedule('schedule.billing.reconcile', { cron: '0 * * * *' })],
  output: z.object({ ok: z.boolean() }),
});

export const scheduledDestroyIntentTrail = wrapTopoRule({
  examples: [
    {
      expected: {
        diagnostics: [
          {
            filePath: '<topo>',
            line: 1,
            message:
              'Trail "billing.purge-expired" declares intent: \'destroy\' and is activated by schedule source "schedule.billing.purge-expired". Scheduled destroy work should make cadence, permit scope, idempotency, and recovery explicit before it runs unattended.',
            rule: 'scheduled-destroy-intent',
            severity: 'warn',
          },
        ],
      },
      input: {
        topo: topo('trl-457-scheduled-destroy', { scheduledDestroyTrail }),
      },
      name: 'Scheduled destroy trails emit coaching',
    },
    {
      expected: { diagnostics: [] },
      input: {
        topo: topo('trl-457-scheduled-write', { scheduledWriteTrail }),
      },
      name: 'Scheduled write trails do not emit destroy coaching',
    },
  ],
  rule: scheduledDestroyIntent,
});
