import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { createTrailContext } from '../context.js';
import { InternalError, PermissionError, ValidationError } from '../errors.js';
import { resource } from '../resource.js';
import { createResources } from '../resource-config.js';
import { Result } from '../result.js';
import {
  getWebhookHeader,
  getWebhookHeaders,
  matchWebhookPath,
  validateWebhookSource,
  verifyWebhookRequest,
  webhook,
  webhookPathPatternsOverlap,
} from '../webhook.js';

const signBody = (secret: string, body: string): string =>
  createHmac('sha256', secret).update(body).digest('hex');

const secureEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

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
      pathParams: [],
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

  test('requires verify to be a function when present', () => {
    expect(
      validateWebhookSource({
        id: 'billing.payment-received',
        kind: 'webhook',
        method: 'POST',
        parse: z.object({ paymentId: z.string() }),
        path: '/webhooks/payment',
        verify: true,
      })
    ).toEqual([
      {
        field: 'verify',
        message: 'Webhook verify must be a function when provided',
      },
    ]);
  });

  test('runs a framework-neutral Result-returning verifier against raw request data', async () => {
    const secret = 'whsec_test';
    const body = '{"paymentId":"pay_1"}';
    const source = webhook('billing.payment-received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
      verify: (request) => {
        const signature = getWebhookHeader(request, 'x-trails-signature');
        return signature !== undefined &&
          secureEqual(signature, signBody(secret, request.body.toString()))
          ? Result.ok()
          : Result.err(new PermissionError('Invalid webhook signature'));
      },
    });

    const verified = await verifyWebhookRequest(source, {
      body,
      headers: { 'X-Trails-Signature': signBody(secret, body) },
      method: 'POST',
      path: '/webhooks/payment',
    });
    const rejected = await verifyWebhookRequest(source, {
      body,
      headers: { 'x-trails-signature': 'bad' },
      method: 'POST',
      path: '/webhooks/payment',
    });

    expect(verified.isOk()).toBe(true);
    expect(rejected.isErr()).toBe(true);
    expect(rejected.isErr() ? rejected.error : undefined).toBeInstanceOf(
      PermissionError
    );
  });

  test('exposes every matching header value for verifier policies', () => {
    const request = {
      headers: {
        'X-Trails-Signature': ['primary', 'secondary'],
      },
    };

    expect(getWebhookHeader(request, 'x-trails-signature')).toBe('primary');
    expect(getWebhookHeaders(request, 'x-trails-signature')).toEqual([
      'primary',
      'secondary',
    ]);
  });

  test('merges all case-insensitive header matches across the headers object', () => {
    // Build the headers map with explicit insertion order so the assertion is
    // not at the mercy of source-text key sorting by an autoformatter.
    const entries: [string, readonly string[] | string | undefined][] = [
      ['X-Signature', 'first'],
      ['x-signature', ['second', 'third']],
      ['X-SIGNATURE', 'fourth'],
      ['X-Other', 'ignored'],
    ];
    const headers: Record<string, readonly string[] | string | undefined> =
      Object.fromEntries(entries);

    expect(getWebhookHeaders({ headers }, 'x-signature')).toEqual([
      'first',
      'second',
      'third',
      'fourth',
    ]);
  });

  test('skips undefined header values without halting the merge', () => {
    const entries: [string, readonly string[] | string | undefined][] = [
      ['X-Signature', undefined],
      ['x-signature', 'second'],
      ['X-SIGNATURE', ['third', 'fourth']],
    ];
    const headers: Record<string, readonly string[] | string | undefined> =
      Object.fromEntries(entries);

    expect(getWebhookHeaders({ headers }, 'x-signature')).toEqual([
      'second',
      'third',
      'fourth',
    ]);
  });

  test('getWebhookHeader returns the first accumulated match', () => {
    const entries: [string, readonly string[] | string | undefined][] = [
      ['X-Signature', 'first'],
      ['x-signature', ['second', 'third']],
    ];
    const headers: Record<string, readonly string[] | string | undefined> =
      Object.fromEntries(entries);

    // Object iteration follows insertion order: 'first' wins here.
    expect(getWebhookHeader({ headers }, 'x-signature')).toBe('first');
  });

  test('returns an empty array when no header matches', () => {
    expect(
      getWebhookHeaders({ headers: { 'X-Other': 'value' } }, 'x-signature')
    ).toEqual([]);
  });

  test('passes when no verify hook is defined', async () => {
    const source = webhook('billing.payment-received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
    });

    const verified = await verifyWebhookRequest(source, {
      body: '{}',
      headers: {},
      method: 'POST',
      path: '/webhooks/payment',
    });

    expect(verified.isOk()).toBe(true);
  });

  test('normalizes thrown verifier failures to InternalError', async () => {
    const source = webhook('billing.payment-received', {
      parse: z.object({ paymentId: z.string() }),
      path: '/webhooks/payment',
      verify: () => {
        throw new Error('boom');
      },
    });

    const verified = await verifyWebhookRequest(source, {
      body: '{}',
      headers: {},
      method: 'POST',
      path: '/webhooks/payment',
    });

    expect(verified.isErr()).toBe(true);
    expect(verified.isErr() ? verified.error : undefined).toBeInstanceOf(
      InternalError
    );
  });
});

describe('webhook ingress v2 (TRL-1194)', () => {
  test('accepts dynamic path segments and derives pathParams', () => {
    const source = webhook('relay.ingress', {
      headers: ['Content-Type', 'X-Junction-Signature'],
      parse: z.object({ endpoint: z.string(), rawBody: z.string() }),
      path: '/hooks/:endpoint',
      rawBody: true,
    });

    expect(source.pathParams).toEqual(['endpoint']);
    expect(source.rawBody).toBe(true);
    expect(source.headers).toEqual(['content-type', 'x-junction-signature']);
  });

  test('rejects malformed and duplicate path segments', () => {
    expect(() =>
      webhook('relay.bad-segment', {
        parse: z.object({}),
        path: '/hooks/:1endpoint',
      })
    ).toThrow(ValidationError);
    expect(() =>
      webhook('relay.duplicate-segment', {
        parse: z.object({}),
        path: '/hooks/:endpoint/:endpoint',
      })
    ).toThrow(ValidationError);
  });

  test('rejects path segments that shadow reserved envelope fields', () => {
    for (const reserved of ['body', 'headers', 'rawBody']) {
      expect(() =>
        webhook(`relay.reserved-${reserved}`, {
          parse: z.object({}),
          path: `/hooks/:${reserved}`,
        })
      ).toThrow(ValidationError);
    }
  });

  test('matchWebhookPath keeps raw text for malformed percent-encoding', () => {
    expect(matchWebhookPath('/hooks/:endpoint', '/hooks/%E0%A4%A')).toEqual({
      endpoint: '%E0%A4%A',
    });
    expect(matchWebhookPath('/hooks/:endpoint', '/hooks/gh%20hub')).toEqual({
      endpoint: 'gh hub',
    });
  });

  test('matchWebhookPath captures segment values and rejects mismatches', () => {
    expect(matchWebhookPath('/hooks/:endpoint', '/hooks/github')).toEqual({
      endpoint: 'github',
    });
    expect(
      matchWebhookPath('/hooks/:endpoint/:event', '/hooks/github/push')
    ).toEqual({ endpoint: 'github', event: 'push' });
    expect(matchWebhookPath('/hooks/:endpoint', '/hooks')).toBeUndefined();
    expect(
      matchWebhookPath('/hooks/:endpoint', '/other/github')
    ).toBeUndefined();
    expect(matchWebhookPath('/hooks/payment', '/hooks/payment')).toEqual({});
    expect(matchWebhookPath('/hooks/:endpoint', '/hooks/')).toBeUndefined();
  });

  test('webhookPathPatternsOverlap detects overlapping patterns', () => {
    expect(
      webhookPathPatternsOverlap('/hooks/:endpoint', '/hooks/github')
    ).toBe(true);
    expect(webhookPathPatternsOverlap('/hooks/:a', '/hooks/:b')).toBe(true);
    expect(webhookPathPatternsOverlap('/hooks/:a', '/api/:b')).toBe(false);
    expect(webhookPathPatternsOverlap('/hooks/:a', '/hooks/:a/extra')).toBe(
      false
    );
  });

  test('verifyWebhookRequest forwards a context to resource-capable verifiers', async () => {
    let seenSecret: string | undefined;
    const secrets = resource('webhook.secrets', {
      create: () => Result.ok({ github: 'shh' }),
    });
    const source = webhook('relay.verified', {
      parse: z.object({}),
      path: '/hooks/:endpoint',
      resources: [secrets],
      verify: (request, ctx) => {
        if (ctx === undefined) {
          return Result.err(new PermissionError('No context provided'));
        }
        seenSecret = (secrets.from(ctx) as Record<string, string>)['github'];
        return getWebhookHeader(request, 'x-signature') === seenSecret
          ? Result.ok()
          : Result.err(new PermissionError('Bad signature'));
      },
    });

    const scope = await createResources(
      { resources: [secrets] },
      createTrailContext()
    );
    expect(scope.isOk()).toBe(true);
    if (!scope.isOk()) {
      return;
    }

    const accepted = await verifyWebhookRequest(
      source,
      {
        body: '{}',
        headers: { 'x-signature': 'shh' },
        method: 'POST',
        path: '/hooks/github',
      },
      scope.value.ctx
    );
    expect(accepted.isOk()).toBe(true);
    expect(seenSecret).toBe('shh');
    scope.value.release();
  });
});
