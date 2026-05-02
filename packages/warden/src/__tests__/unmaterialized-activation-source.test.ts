import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, schedule, signal, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { unmaterializedActivationSource } from '../rules/unmaterialized-activation-source.js';

const webhookSource = webhook('webhook.invoice.paid', {
  parse: z.object({ invoiceId: z.string() }),
  path: '/webhooks/invoice/paid',
});

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
  test('stays quiet for webhook sources now that HTTP materializes them', async () => {
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

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet for schedule, signal, and webhook activation sources', async () => {
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
        webhookConsumer,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('keeps source kind in the materialization key', async () => {
    const sameIdWebhook = webhook('shared.source', {
      parse: z.object({ id: z.string() }),
      path: '/webhooks/shared',
    });
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

    expect(diagnostics).toEqual([]);
  });

  test('runWarden does not warn for webhook sources once materialized', async () => {
    const rootDir = mkdtempSync(
      join(tmpdir(), 'warden-unmaterialized-source-')
    );

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('unmaterialized-webhook', { webhookConsumer }),
      });

      expect(
        report.diagnostics.some(
          (diagnostic) => diagnostic.rule === 'unmaterialized-activation-source'
        )
      ).toBe(false);
      expect(report.warnCount).toBe(
        report.diagnostics.filter(
          (diagnostic) => diagnostic.severity === 'warn'
        ).length
      );
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
