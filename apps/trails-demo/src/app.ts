/**
 * trails-demo application -- wires all trails, routes, and events into a topo.
 */

import { topo } from '@ontrails/core';

import * as entityEvents from './events/entity-events.js';
import * as demoServices from './services/entity-store.js';
import * as entity from './trails/entity.js';
import * as kv from './trails/kv.js';
import * as onboard from './trails/onboard.js';
import * as search from './trails/search.js';

export const app = topo(
  'demo',
  demoServices,
  entity,
  search,
  onboard,
  entityEvents,
  kv
);
