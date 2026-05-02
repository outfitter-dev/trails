import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Result, topo, trail, webhook } from '@ontrails/core';
import { z } from 'zod';

import { runWarden } from '../cli.js';
import { webhookRouteCollision } from '../rules/webhook-route-collision.js';

const paymentWebhook = webhook('webhook.payment.received', {
  parse: z.object({ paymentId: z.string() }),
  path: '/webhooks/payment',
});

const paymentReceiver = trail('payment.receive', {
  blaze: () => Result.ok({ ok: true }),
  input: z.object({ paymentId: z.string() }),
  on: [paymentWebhook],
  output: z.object({ ok: z.boolean() }),
});

describe('webhook-route-collision', () => {
  test('stays quiet for distinct webhook route paths', async () => {
    const invoiceWebhook = webhook('webhook.invoice.received', {
      parse: z.object({ invoiceId: z.string() }),
      path: '/webhooks/invoice',
    });
    const invoiceReceiver = trail('invoice.receive', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ invoiceId: z.string() }),
      on: [invoiceWebhook],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-clean', {
        invoiceReceiver,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('errors when two webhook sources share method and path', async () => {
    const duplicateWebhook = webhook('webhook.payment.duplicate', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const duplicateReceiver = trail('payment.duplicate-receive', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [duplicateWebhook],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-duplicate', {
        duplicateReceiver,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([
      {
        filePath: '<topo>',
        line: 1,
        message:
          'HTTP webhook route collision on POST /webhooks/payment: webhook source "webhook.payment.duplicate" on trail "payment.duplicate-receive", webhook source "webhook.payment.received" on trail "payment.receive". Give each webhook source a distinct method/path pair or move the direct trail route before materializing the HTTP surface.',
        rule: 'webhook-route-collision',
        severity: 'error',
      },
    ]);
  });

  test('allows one webhook source to fan out to multiple trails', async () => {
    const auditReceiver = trail('payment.audit-receive', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [paymentWebhook],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-fanout', {
        auditReceiver,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('allows the same webhook path with different methods', async () => {
    const patchWebhook = webhook('webhook.payment.patch', {
      method: 'PATCH',
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const patchReceiver = trail('payment.patch-receive', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [patchWebhook],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-method-distinct', {
        patchReceiver,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('errors when a webhook route collides with a derived direct HTTP route', async () => {
    const directRoute = trail('webhooks.payment', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-direct-collision', {
        directRoute,
        paymentReceiver,
      })
    );

    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      line: 1,
      rule: 'webhook-route-collision',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain(
      'derived trail route "webhooks.payment"'
    );
    expect(diagnostics[0]?.message).toContain(
      'webhook source "webhook.payment.received" on trail "payment.receive"'
    );
  });

  test('stays quiet when a webhook overlaps an internal direct trail (not materialized by default)', async () => {
    const directRoute = trail('webhooks.payment', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-internal-direct-noop', {
        directRoute,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when a webhook overlaps a legacy meta.internal direct trail', async () => {
    const directRoute = trail('webhooks.payment', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      meta: { internal: true },
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-legacy-internal-direct-noop', {
        directRoute,
        paymentReceiver,
      })
    );

    expect(diagnostics).toEqual([]);
  });

  test('stays quiet when an internal trail consumes a webhook (not materialized by default)', async () => {
    const internalConsumer = trail('payment.internal-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [paymentWebhook],
      output: z.object({ ok: z.boolean() }),
      visibility: 'internal',
    });

    const distinctWebhook = webhook('webhook.payment.distinct', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });
    const publicConsumer = trail('payment.public-consumer', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [distinctWebhook],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-internal-webhook-noop', {
        internalConsumer,
        publicConsumer,
      })
    );

    // Two distinct webhook ids share method/path, but the only public consumer
    // claims one of them. The internal consumer would not be materialized.
    expect(diagnostics).toEqual([]);
  });

  test('errors when two trails share a webhook id but declare different verify functions', async () => {
    const sharedId = 'webhook.payment.shared';
    const sharedPath = '/webhooks/payment-shared';
    const verifierA = async (): Promise<Result<void, Error>> => Result.ok();
    const verifierB = async (): Promise<Result<void, Error>> => Result.ok();

    const sourceA = webhook(sharedId, {
      parse: z.object({ paymentId: z.string() }),
      path: sharedPath,
      verify: verifierA,
    });
    const sourceB = webhook(sharedId, {
      parse: z.object({ paymentId: z.string() }),
      path: sharedPath,
      verify: verifierB,
    });

    const trailA = trail('payment.shared-a', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [sourceA],
      output: z.object({ ok: z.boolean() }),
    });
    const trailB = trail('payment.shared-b', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [sourceB],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-verifier-mismatch', {
        trailA,
        trailB,
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      line: 1,
      rule: 'webhook-route-collision',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain('verifier');
    expect(diagnostics[0]?.message).toContain(`"${sharedId}"`);
  });

  test('errors when two trails share a webhook id but declare different parse contracts', async () => {
    const sharedId = 'webhook.payment.shared-parse';
    const sharedPath = '/webhooks/payment-shared-parse';

    const sourceA = webhook(sharedId, {
      parse: z.object({ paymentId: z.string() }),
      path: sharedPath,
    });
    const sourceB = webhook(sharedId, {
      parse: z.object({ paymentId: z.string() }),
      path: sharedPath,
    });

    const trailA = trail('payment.shared-parse-a', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [sourceA],
      output: z.object({ ok: z.boolean() }),
    });
    const trailB = trail('payment.shared-parse-b', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({ paymentId: z.string() }),
      on: [sourceB],
      output: z.object({ ok: z.boolean() }),
    });

    const diagnostics = await webhookRouteCollision.checkTopo(
      topo('webhook-routes-parse-mismatch', {
        trailA,
        trailB,
      })
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      filePath: '<topo>',
      line: 1,
      rule: 'webhook-route-collision',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain('parse');
    expect(diagnostics[0]?.message).toContain(`"${sharedId}"`);
  });

  test('runWarden includes webhook route collision checks when topo is supplied', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'warden-webhook-route-'));
    const directRoute = trail('webhooks.payment', {
      blaze: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });

    try {
      const report = await runWarden({
        rootDir,
        topo: topo('webhook-routes-run-warden', {
          directRoute,
          paymentReceiver,
        }),
      });

      expect(report.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            rule: 'webhook-route-collision',
            severity: 'error',
          }),
        ])
      );
      expect(report.errorCount).toBeGreaterThan(0);
    } finally {
      rmSync(rootDir, { force: true, recursive: true });
    }
  });
});
