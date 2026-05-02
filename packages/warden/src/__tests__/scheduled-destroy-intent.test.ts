import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, schedule, signal, topo, trail } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { scheduledDestroyIntent } from '../rules/scheduled-destroy-intent.js';
import { scheduledDestroyTrail } from '../trails/scheduled-destroy-intent.trail.js';

describe('scheduled-destroy-intent', () => {
  test('warns when a destroy trail is activated by a schedule source', async () => {
    const diagnostics = await scheduledDestroyIntent.checkTopo(
      topo('scheduled-destroy', { scheduledDestroyTrail })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Trail "billing.purge-expired" declares intent: \'destroy\' and is activated by schedule source "schedule.billing.purge-expired". Scheduled destroy work should make cadence, permit scope, idempotency, and recovery explicit before it runs unattended.',
        rule: 'scheduled-destroy-intent',
        severity: 'warn',
      },
    ]);
  });

  test('aggregates multiple schedule sources on the same destroy trail', async () => {
    const worker = trail('billing.purge-expired', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
      on: [
        schedule('schedule.billing.nightly', { cron: '0 2 * * *' }),
        schedule('schedule.billing.monthly', { cron: '0 1 1 * *' }),
      ],
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['billing:purge'] },
    });

    const diagnostics = await scheduledDestroyIntent.checkTopo(
      topo('scheduled-destroy-multi', { worker })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      '"schedule.billing.nightly", "schedule.billing.monthly"'
    );
  });

  test('warns for object-form schedule activation entries', async () => {
    const source = schedule('schedule.billing.object-form', {
      cron: '0 3 * * *',
    });
    const worker = trail('billing.object-form-purge', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      intent: 'destroy',
      on: [{ source }],
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['billing:purge'] },
    });

    const diagnostics = await scheduledDestroyIntent.checkTopo(
      topo('scheduled-destroy-object-form', { worker })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('schedule.billing.object-form');
  });

  test('stays quiet for non-destroy schedule activation and destroy signal activation', async () => {
    const accountClosed = signal('account.closed', {
      payload: z.object({ accountId: z.string() }),
    });
    const scheduledWrite = trail('billing.reconcile', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [schedule('schedule.billing.reconcile', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });
    const signalDestroy = trail('account.remove', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ accountId: z.string() }),
      intent: 'destroy',
      on: [accountClosed],
      output: z.object({ ok: z.boolean() }),
      permit: { scopes: ['account:remove'] },
    });

    const diagnostics = await scheduledDestroyIntent.checkTopo(
      topo('scheduled-destroy-clean', {
        accountClosed,
        scheduledWrite,
        signalDestroy,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('runWarden includes scheduled destroy coaching when topo is supplied', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-scheduled-destroy-'));

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('scheduled-destroy', { scheduledDestroyTrail }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('runs unattended'),
            rule: 'scheduled-destroy-intent',
            severity: 'warn',
          }),
        ])
      );
      expect(report.warnCount).toBeGreaterThan(0);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
