/**
 * junction — self-hosted webhook relay.
 *
 * Assembles the relay graph: endpoint/event/target/route/delivery trails,
 * the `event.received` signal seam, the SQLite relay store, and the
 * outbound HTTP client. This module stays side-effect-free — surfaces open
 * in `bin/junction.ts` (CLI), `bin/serve.ts` (HTTP), and `src/mcp.ts`
 * (MCP).
 */

import { topo } from '@ontrails/core';
import { authResource } from '@ontrails/permits';

import { outboundHttpResource } from './resources/outbound-http.js';
import { relayStoreResource } from './resources/relay-store.js';
import * as signals from './signals.js';
import * as deliveryTrails from './trails/delivery.js';
import * as endpointTrails from './trails/endpoint.js';
import * as eventTrails from './trails/event.js';
import * as relayTrails from './trails/relay.js';
import * as routeTrails from './trails/route.js';
import * as statusTrails from './trails/status.js';
import * as targetTrails from './trails/target.js';
import * as webhookTrails from './trails/webhook.js';

export const graph = topo(
  {
    description:
      'Self-hosted webhook relay: receive, verify, store, re-deliver.',
    name: 'junction',
    version: '0.1.0',
  },
  { authResource, outboundHttpResource, relayStoreResource },
  signals,
  deliveryTrails,
  endpointTrails,
  eventTrails,
  relayTrails,
  routeTrails,
  statusTrails,
  targetTrails,
  webhookTrails
);
