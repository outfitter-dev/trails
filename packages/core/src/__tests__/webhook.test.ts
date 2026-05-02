import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { ValidationError } from '../errors.js';
import { validateWebhookSource, webhook } from '../webhook.js';

describe('webhook()', () => {
  test('creates an inert webhook activation source with POST as the default method', () => {
    const source = webhook('billing.payment-received', {
      meta: { owner: 'billing' },
      parse: z.object({ paymentId: z.string() }),
      path: ' /webhooks/payment ',
    });

    expect(source).toEqual({
      id: 'billing.payment-received',
      kind: 'webhook',
      meta: { owner: 'billing' },
      method: 'POST',
      parse: expect.any(Object),
      path: '/webhooks/payment',
    });
    expect(Object.isFrozen(source)).toBe(true);
    expect(Object.isFrozen(source.meta)).toBe(true);
  });

  test('normalizes supported lowercase methods', () => {
    const source = webhook({
      id: 'github.issue',
      method: 'put',
      parse: z.object({ issueId: z.string() }),
      path: '/webhooks/github/issue',
    });

    expect(source.method).toBe('PUT');
  });

  test('requires an absolute webhook path', () => {
    expect(() =>
      webhook('billing.payment-received', {
        parse: z.object({ paymentId: z.string() }),
        path: 'webhooks/payment',
      })
    ).toThrow(ValidationError);
  });

  test('rejects unsupported webhook methods', () => {
    expect(() =>
      webhook('billing.payment-received', {
        method: 'OPTIONS' as never,
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
      })
    ).toThrow(ValidationError);
  });

  test('requires parse for trail input materialization', () => {
    expect(
      validateWebhookSource({
        id: 'billing.payment-received',
        kind: 'webhook',
        method: 'POST',
        path: '/webhooks/payment',
      })
    ).toEqual([
      {
        field: 'parse',
        message: 'Webhook sources must define parse',
      },
    ]);
  });

  test('requires parse in the webhook factory', () => {
    expect(() =>
      webhook('billing.payment-received', {
        path: '/webhooks/payment',
      } as never)
    ).toThrow(ValidationError);
  });

  test('requires parse objects to expose an output schema', () => {
    expect(
      validateWebhookSource({
        id: 'billing.payment-received',
        kind: 'webhook',
        method: 'POST',
        parse: {},
        path: '/webhooks/payment',
      })
    ).toEqual([
      {
        field: 'parse',
        message: 'Webhook parse must be a Zod schema or define parse.output',
      },
    ]);
  });
});
