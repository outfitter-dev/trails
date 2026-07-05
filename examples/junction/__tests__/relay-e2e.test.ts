/**
 * End-to-end relay: a signed webhook arrives over HTTP through the
 * `webhook.inbound` activation source (`POST /hooks/:endpointId`),
 * verification passes against the endpoint's stored secret, the event is
 * recorded, `event.received` fires, `relay.dispatch` matches the enabled
 * route, and `delivery.send` POSTs the payload to the target — all
 * offline against the mocked store and outbound client.
 */

import { describe, expect, test } from 'bun:test';

import { createMockOutboundClient } from '../src/resources/outbound-http.js';
import {
  mockEndpoints,
  relayStoreResource,
} from '../src/resources/relay-store.js';
import { createServerApp } from '../src/server.js';
import { signPayload } from '../src/verify.js';

const githubSecret = mockEndpoints[0].secret;

const setup = () => {
  const client = createMockOutboundClient();
  const store = relayStoreResource.mock?.();
  if (store === undefined || store instanceof Promise) {
    throw new Error('relay store must expose a synchronous mock factory');
  }
  const app = createServerApp({
    resources: { 'junction.http': client, 'junction.store': store },
  });
  return { app, client, store };
};

describe('receive → route → delivery', () => {
  test('a validly signed webhook is stored, relayed, and delivered', async () => {
    const { app, client, store } = setup();
    const rawBody = JSON.stringify({
      action: 'opened',
      repository: 'outfitter-dev/trails',
    });
    const response = await app.request('/hooks/ep_github_demo', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-github-event': 'pull_request',
        'x-hub-signature-256': signPayload('github', {
          rawBody,
          secret: githubSecret,
        }),
      },
      method: 'POST',
    });

    expect(response.status).toBe(202);
    const { data } = (await response.json()) as {
      data: { eventId: string; signatureValid: boolean };
    };
    expect(data.signatureValid).toBe(true);

    const event = await store.event.get(data.eventId);
    expect(event?.status).toBe('relayed');
    expect(event?.payload).toEqual({
      action: 'opened',
      repository: 'outfitter-dev/trails',
    });

    const deliveries = await store.delivery.list({ eventId: data.eventId });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('delivered');
    expect(deliveries[0]?.targetId).toBe('tgt_logbook');

    const call = client.calls.find((entry) => entry.url.endsWith('/logbook'));
    expect(call?.body).toBe(rawBody);
  });

  test('a tampered signature returns 401 and records the dead event', async () => {
    const { app, client, store } = setup();
    const rawBody = JSON.stringify({ action: 'opened' });
    const response = await app.request('/hooks/ep_github_demo', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
      },
      method: 'POST',
    });

    expect(response.status).toBe(401);
    const events = await store.event.list({ endpointId: 'ep_github_demo' });
    const dead = events.find((event) => !event.signatureValid);
    expect(dead?.status).toBe('dead');
    expect(client.calls).toHaveLength(0);
  });

  test('an unknown endpoint returns 404', async () => {
    const { app } = setup();
    const response = await app.request('/hooks/ep_missing', {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(404);
  });

  test('a filtered route only relays matching payloads', async () => {
    const { app, client } = setup();
    const rawBody = JSON.stringify({
      id: 'evt_1',
      type: 'payment_intent.failed',
    });
    const response = await app.request('/hooks/ep_stripe_demo', {
      body: rawBody,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signPayload('stripe', {
          rawBody,
          secret: 'whsec_test_junction_secret',
          timestamp: 1_751_500_000,
        }),
      },
      method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(client.calls).toHaveLength(0);
  });
});
