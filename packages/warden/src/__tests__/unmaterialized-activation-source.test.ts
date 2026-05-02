import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, schedule, signal, topo, trail } from '@ontrails/core';
import type { ActivationSource } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { unmaterializedActivationSource } from '../rules/unmaterialized-activation-source.js';

const webhookSource = {
  id: 'webhook.invoice.paid',
  kind: 'webhook',
  payload: z.object({ invoiceId: z.string() }),
} as const satisfies ActivationSource;

const webhookConsumer = trail('invoice.audit-webhook', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [webhookSource],
  output: z.object({ ok: z.boolean() }),
});

const created = signal('invoice.created', {
  from: ['invoice.create'],
  payload: z.object({ invoiceId: z.string() }),
});

const signalProducer = trail('invoice.create', {
  blaze: () => Result.ok({ invoiceId: 'inv_1' }),
  fires: [created],
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const signalConsumer = trail('invoice.index', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [created],
  output: z.object({ ok: z.boolean() }),
});

describe('unmaterialized-activation-source', () => {
  test('warns once for a webhook source and lists all consuming trails', async () => {
    const notifyConsumer = trail('invoice.notify-webhook', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ invoiceId: z.string() }),
      on: [
        {
          source: webhookSource,
          where: (payload) => payload.invoiceId.startsWith('inv_'),
        },
      ],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await unmaterializedActivationSource.checkTopo(
      topo('unmaterialized-webhook', {
        notifyConsumer,
        webhookConsumer,
      })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Activation source "webhook.invoice.paid" of kind "webhook" activates trails "invoice.audit-webhook", "invoice.notify-webhook" but no built-in materializer is available in this stack. Add the materializer before relying on runtime delivery, or defer the source declaration until the materializer lands.',
        rule: 'unmaterialized-activation-source',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet for schedule and signal activation sources', async () => {
    const scheduleConsumer = trail('invoice.reconcile', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      on: [schedule('schedule.invoice.reconcile', { cron: '0 * * * *' })],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await unmaterializedActivationSource.checkTopo(
      topo('materialized-sources', {
        created,
        scheduleConsumer,
        signalConsumer,
        signalProducer,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('keeps source kind in the materialization key', async () => {
    const sameIdWebhook = {
      id: 'shared.source',
      kind: 'webhook',
      payload: z.object({ id: z.string() }),
    } as const satisfies ActivationSource;
    const sameIdSignal = signal('shared.source', {
      from: ['shared.producer'],
      payload: z.object({ id: z.string() }),
    });
    const webhookTrail = trail('shared.webhook-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [sameIdWebhook],
      output: z.object({ ok: z.boolean() }),
    });
    const signalTrail = trail('shared.signal-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ id: z.string() }),
      on: [sameIdSignal],
      output: z.object({ ok: z.boolean() }),
    });
    const producer = trail('shared.producer', {
      blaze: () => Result.ok({ id: 's1' }),
      fires: [sameIdSignal],
      input: z.object({}),
      output: z.object({ id: z.string() }),
    });

    const diagnostics = await unmaterializedActivationSource.checkTopo(
      topo('materialization-source-kinds', {
        producer,
        sameIdSignal,
        signalTrail,
        webhookTrail,
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(
      'Activation source "shared.source" of kind "webhook"'
    );
    expect(diagnostics[0]?.message).toContain('"shared.webhook-consumer"');
    expect(diagnostics[0]?.message).not.toContain('"shared.signal-consumer"');
  });

  test('runWarden includes unmaterialized source coaching when topo is supplied', async () => {
    const rootDir = mkdtempSync(
      join(tmpdir(), 'warden-unmaterialized-source-')
    );

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('unmaterialized-webhook', { webhookConsumer }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('no built-in materializer'),
            rule: 'unmaterialized-activation-source',
            severity: 'warn',
          }),
        ])
      );
      expect(report.warnCount).toBeGreaterThan(0);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });

  test('runWarden source-only runs skip topo-aware materializer checks', async () => {
    const rootDir = mkdtempSync(
      join(tmpdir(), 'warden-unmaterialized-source-only-')
    );

    try {
      const report = await runWarden({ rootDir });

      expect(
        report.diagnostics.some(
          (diagnostic) => diagnostic.rule === 'unmaterialized-activation-source'
        )
      ).toBe(false);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
