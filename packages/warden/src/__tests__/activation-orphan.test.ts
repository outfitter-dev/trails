import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  Result,
  resource,
  schedule,
  signal,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { activationOrphan } from '../rules/activation-orphan.js';

const producerSignal = signal('invoice.created', {
  payload: z.object({ invoiceId: z.string() }),
});

const producerTrail = trail('invoice.create', {
  blaze: () => Result.ok({ invoiceId: 'inv_1' }),
  fires: [producerSignal],
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const consumerTrail = trail('invoice.index', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [producerSignal],
  output: z.object({ ok: z.boolean() }),
});

describe('activation-orphan', () => {
  test('stays quiet when a signal source has producer and consumer declarations', async () => {
    const diagnostics = await activationOrphan.checkTopo(
      topo('activation-clean', {
        consumerTrail,
        producerSignal,
        producerTrail,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for schedule activation sources', async () => {
    const scheduledTrail = trail('invoice.reconcile', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [schedule('schedule.invoice.reconcile', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await activationOrphan.checkTopo(
      topo('activation-schedule', { scheduledTrail })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for resource-owned signal activation sources', async () => {
    const usersCreated = signal('db:users.created', {
      payload: z.object({ userId: z.string() }),
    });
    const db = resource('db.users', {
      create: () => Result.ok({ ok: true }),
      signals: [usersCreated],
    });
    const consumer = trail('users.index', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ userId: z.string() }),
      on: [usersCreated],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await activationOrphan.checkTopo(
      topo('activation-resource-signal', { consumer, db })
    );

    expect(diagnostics).toEqual([]);
  });

  test('warns once per consumed signal source with no producer declaration', async () => {
    const paid = signal('invoice.paid', {
      payload: z.object({ invoiceId: z.string() }),
    });
    const auditTrail = trail('invoice.audit', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ invoiceId: z.string() }),
      on: [
        paid,
        {
          source: paid,
          where: (payload) => payload.invoiceId.startsWith('inv_'),
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });
    const notifyTrail = trail('invoice.notify', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ invoiceId: z.string() }),
      on: [paid],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await activationOrphan.checkTopo(
      topo('activation-orphan', { auditTrail, notifyTrail, paid })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Signal activation source "invoice.paid" activates trails "invoice.audit", "invoice.notify" but has no producer declaration in the topo. Add a trail fires: declaration, add signal from: producer metadata, or remove the unused activation source.',
        rule: 'activation-orphan',
        severity: 'warn',
      },
    ]);
  });

  test('treats same source id with different source kinds independently', async () => {
    const sharedSignal = signal('shared.source', {
      payload: z.object({ id: z.string() }),
    });
    const signalConsumer = trail('shared.signal-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [sharedSignal],
      output: z.object({ ok: z.boolean() }),
    });
    const scheduleConsumer = trail('shared.schedule-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [
        schedule('shared.source', {
          cron: '0 * * * *',
          input: { id: 'scheduled' },
        }),
      ],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await activationOrphan.checkTopo(
      topo('activation-source-kinds', {
        scheduleConsumer,
        sharedSignal,
        signalConsumer,
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'Signal activation source "shared.source"'
    );
    expect(diagnostics[0]?.message).toContain('"shared.signal-consumer"');
    expect(diagnostics[0]?.message).not.toContain('"shared.schedule-consumer"');
  });

  test('runWarden includes activation orphan coaching when topo is supplied', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-activation-orphan-'));
    const paid = signal('invoice.paid', {
      payload: z.object({ invoiceId: z.string() }),
    });
    const auditTrail = trail('invoice.audit', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ invoiceId: z.string() }),
      on: [paid],
      output: z.object({ ok: z.boolean() }),
    });

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('activation-orphan', { auditTrail, paid }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('has no producer declaration'),
            rule: 'activation-orphan',
            severity: 'warn',
          }),
        ])
      );
      expect(report.warnCount).toBeGreaterThan(0);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('runWarden source-only runs skip topo-aware activation orphan checks', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-activation-source-'));

    try {
      const report = await runWarden({ rootDir });

      expect(
        report.diagnostics.some(
          (diagnostic) => diagnostic.rule === 'activation-orphan'
        )
      ).toBe(false);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
