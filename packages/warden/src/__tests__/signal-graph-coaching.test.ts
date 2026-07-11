import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  attachLateBoundSignalRef,
  Result,
  resource,
  signal,
  topo,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { signalGraphCoaching } from '../rules/signal-graph-coaching.js';

const invoiceCreated = signal('invoice.created', {
  payload: z.object({ invoiceId: z.string() }),
});

const invoiceProducer = trail('invoice.create', {
  fires: [invoiceCreated],
  implementation: () => Result.ok({ invoiceId: 'inv_1' }),
  input: z.object({}),
  output: z.object({ invoiceId: z.string() }),
});

const invoiceConsumer = trail('invoice.index', {
  implementation: () => Result.ok({ ok: true }),
  input: z.object({ invoiceId: z.string() }),
  on: [invoiceCreated],
  output: z.object({ ok: z.boolean() }),
});

describe('signal-graph-coaching', () => {
  test('stays quiet when a typed signal has producer and consumer trail edges', async () => {
    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-clean', {
        invoiceConsumer,
        invoiceCreated,
        invoiceProducer,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('warns for a declared signal with no producer or consumer edges', async () => {
    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-dead', { invoiceCreated })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Signal "invoice.created" is declared in the topo but has no producer trails, producer resources, or consumer trails. Add fires:/on: edges, attach producer metadata, or remove the unused signal contract.',
        rule: 'signal-graph-coaching',
        severity: 'warn',
      },
    ]);
  });

  test('warns for a produced signal with no consumers', async () => {
    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-produced-no-consumer', {
        invoiceCreated,
        invoiceProducer,
      })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Signal "invoice.created" is produced by producer trail "invoice.create" but has no consumer trails. Add an on: consumer if the signal is meant to drive reactive work, or remove the unused fires:/producer declaration.',
        rule: 'signal-graph-coaching',
        severity: 'warn',
      },
    ]);
  });

  test('includes signal from: producer metadata when no trail fires declaration exists', async () => {
    const metadataProduced = signal('invoice.metadata-produced', {
      from: ['invoice.external-producer'],
      payload: z.object({ invoiceId: z.string() }),
    });

    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-from-metadata', { metadataProduced })
    );

    expect(diagnostics[0]?.message).toContain(
      'producer trail "invoice.external-producer"'
    );
  });

  test('includes resource producer ids for resource-owned signals', async () => {
    const stored = signal('store:invoice.created', {
      payload: z.object({ invoiceId: z.string() }),
    });
    const store = resource('store', {
      create: () => Result.ok({ ok: true }),
      signals: [stored],
    });

    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-resource-produced', { store })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'Signal "store:invoice.created" is produced by producer resource "store" but has no consumer trails. Add an on: consumer if the signal is meant to drive reactive work, or remove the unused fires:/producer declaration.',
        rule: 'signal-graph-coaching',
        severity: 'warn',
      },
    ]);
  });

  test('stays quiet for store-derived producer signals without consumers', async () => {
    const packCreated = attachLateBoundSignalRef(
      signal('store:pack.created', {
        payload: z.object({ id: z.string() }),
      }),
      { kind: 'store-derived', token: 'test-token-pack-created' }
    );
    const store = resource('store', {
      create: () => Result.ok({ ok: true }),
      signals: [packCreated],
    });

    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-store-derived', { store })
    );

    expect(diagnostics).toEqual([]);
  });

  test('still warns for non-store resource-produced signals without consumers', async () => {
    const emitted = signal('queue:job.enqueued', {
      payload: z.object({ jobId: z.string() }),
    });
    const queue = resource('queue', {
      create: () => Result.ok({ ok: true }),
      signals: [emitted],
    });

    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-non-store-resource', { queue })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('"queue:job.enqueued"');
  });

  test('leaves consumed-without-producer coaching to activation-orphan', async () => {
    const diagnostics = await signalGraphCoaching.checkTopo(
      topo('signal-graph-consumer-only', {
        invoiceConsumer,
        invoiceCreated,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('runWarden includes signal graph coaching when topo is supplied', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-signal-graph-'));

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('signal-graph-run-warden', {
          invoiceCreated,
          invoiceProducer,
        }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('has no consumer trails'),
            rule: 'signal-graph-coaching',
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
