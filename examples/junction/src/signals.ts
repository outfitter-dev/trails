/**
 * Domain signals for the relay pipeline.
 *
 * `event.received` is the seam between ingest and relay: `webhook.receive`
 * and `event.replay` fire it, and `relay.dispatch` consumes it through
 * `on:` to fan the event out across matching routes.
 */

import { signal } from '@ontrails/core';
import { z } from 'zod';

export const eventReceivedPayloadSchema = z.object({
  endpointId: z.string().describe('Endpoint the event arrived on'),
  eventId: z.string().describe('Stored event awaiting relay'),
});

export const eventReceived = signal('event.received', {
  description: 'A verified webhook event was stored and awaits relay.',
  examples: [{ endpointId: 'ep_github_demo', eventId: 'evt_seed_push' }],
  from: ['webhook.receive', 'event.replay'],
  payload: eventReceivedPayloadSchema,
});
