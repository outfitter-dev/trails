/**
 * Inbound webhook ingest: the activation source and its consumer trail.
 *
 * `webhook.inbound` declares the ingress route `POST /hooks/:endpointId`
 * with dynamic path segments, raw-body delivery, and an allowlisted
 * header subset — the surface hands the trail exactly the envelope it
 * needs for HMAC verification over the sender's exact bytes.
 *
 * `webhook.receive` is the consumer: it verifies the signature against
 * the endpoint's stored secret, records the event either way
 * (`signatureValid` marks failures), and fires `event.received` so
 * `relay.dispatch` fans the event out. Verification lives in the implementation
 * rather than the source's `verify` hook because a rejected signature
 * must still leave an audit record behind before the AuthError → 401
 * response.
 */

import {
  AuthError,
  NotFoundError,
  Result,
  trail,
  ValidationError,
  webhook,
} from '@ontrails/core';
import { z } from 'zod';

import { relayStoreResource } from '../resources/relay-store.js';
import { eventReceived } from '../signals.js';
import { signatureHeaderBySource, verifySignature } from '../verify.js';

const headerAllowlist = [
  'content-type',
  'stripe-signature',
  'user-agent',
  'x-github-event',
  'x-hub-signature-256',
  'x-junction-event',
  'x-junction-signature',
] as const;

const allowlistedHeaders = new Set<string>(headerAllowlist);

const receiveInputSchema = z.object({
  endpointId: z.string().describe('Endpoint the webhook was addressed to'),
  headers: z
    .record(z.string(), z.string())
    .describe('Inbound request headers (lowercased names)'),
  rawBody: z.string().describe('Exact raw request body the sender signed'),
});

export const inboundWebhook = webhook('webhook.inbound', {
  headers: headerAllowlist,
  parse: receiveInputSchema,
  path: '/hooks/:endpointId',
  rawBody: true,
});

const pickAllowlistedHeaders = (
  headers: Readonly<Record<string, string>>
): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (allowlistedHeaders.has(normalized)) {
      kept[normalized] = value;
    }
  }
  return kept;
};

const parseJsonObject = (
  rawBody: string
): Result<Record<string, unknown>, ValidationError> => {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return Result.err(
        new ValidationError('Webhook payload must be a JSON object')
      );
    }
    return Result.ok(parsed as Record<string, unknown>);
  } catch {
    return Result.err(new ValidationError('Webhook payload is not valid JSON'));
  }
};

export const receive = trail('webhook.receive', {
  description:
    'Receive a webhook, verify its HMAC signature over the raw body, record the event, and fire event.received',
  examples: [
    {
      description:
        "Valid GitHub delivery signed with the endpoint secret (GitHub's published docs vector)",
      input: {
        endpointId: 'ep_github_demo',
        headers: {
          'x-github-event': 'ping',
          'x-hub-signature-256':
            'sha256=81a7433d2a01f5cc903dfe82dab32559f4fef3203a0e8c1da4eea0ff07ed701a',
        },
        rawBody: '{"zen":"Design for failure."}',
      },
      name: 'Valid GitHub webhook',
    },
    {
      description: 'Valid Stripe delivery with a timestamped v1 signature',
      input: {
        endpointId: 'ep_stripe_demo',
        headers: {
          'stripe-signature':
            't=1751500000,v1=431b963fbb5a3d5152ae923741576fe1503dc213c25473d61487007b001fec54',
        },
        rawBody: '{"id":"evt_123","type":"payment_intent.succeeded"}',
      },
      name: 'Valid Stripe webhook',
    },
    {
      description: 'Valid generic HMAC-SHA256 delivery',
      input: {
        endpointId: 'ep_generic_demo',
        headers: {
          'x-junction-signature':
            '4a226af3f20e3c5b45acafa69811a392be579d5ad5e6dfade7285b9a33b08aa8',
        },
        rawBody: '{"event":"ping","ok":true}',
      },
      name: 'Valid generic webhook',
    },
    {
      description:
        'A tampered signature is rejected with AuthError and recorded with signatureValid: false',
      error: 'AuthError',
      input: {
        endpointId: 'ep_github_demo',
        headers: { 'x-hub-signature-256': `sha256=${'0'.repeat(64)}` },
        rawBody: '{"zen":"Design for failure."}',
      },
      name: 'Invalid signature',
    },
    {
      description: 'Unknown endpoints return NotFoundError',
      error: 'NotFoundError',
      input: {
        endpointId: 'ep_missing',
        headers: {},
        rawBody: '{}',
      },
      name: 'Unknown endpoint',
    },
  ],
  fires: [eventReceived],
  implementation: async (input, ctx) => {
    const store = relayStoreResource.from(ctx);
    const endpoint = await store.endpoint.get(input.endpointId);
    if (!endpoint || !endpoint.enabled) {
      return Result.err(
        new NotFoundError(`Endpoint "${input.endpointId}" not found`)
      );
    }

    const headers = pickAllowlistedHeaders(input.headers);
    const signatureHeader = signatureHeaderBySource[endpoint.source];
    const signature = headers[signatureHeader];

    const payload = parseJsonObject(input.rawBody);
    if (payload.isErr()) {
      return payload;
    }

    const signatureValid =
      signature !== undefined &&
      verifySignature(endpoint.source, {
        rawBody: input.rawBody,
        secret: endpoint.secret,
        signature,
      });

    const event = await store.event.insert({
      endpointId: endpoint.id,
      headers,
      payload: payload.value,
      receivedAt: new Date().toISOString(),
      signatureValid,
      status: signatureValid ? 'received' : 'dead',
    });

    if (!signatureValid) {
      return Result.err(
        new AuthError(
          `Signature verification failed for endpoint "${endpoint.id}"`,
          { context: { eventId: event.id, source: endpoint.source } }
        )
      );
    }

    await ctx.fire?.(eventReceived, {
      endpointId: endpoint.id,
      eventId: event.id,
    });

    return Result.ok({
      eventId: event.id,
      signatureValid: true,
      status: event.status,
    });
  },
  input: receiveInputSchema,
  intent: 'write',
  on: [inboundWebhook],
  output: z.object({
    eventId: z.string().describe('Stored event identifier'),
    signatureValid: z
      .boolean()
      .describe('Whether the signature verified against the endpoint secret'),
    status: z.string().describe('Initial relay status of the event'),
  }),
  permit: 'public',
  resources: [relayStoreResource],
});
