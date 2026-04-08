/**
 * trails-demo application -- wires all trails, routes, and signals into a topo.
 */

import { topo } from '@ontrails/core';

import * as entitySignals from './signals/entity-signals.js';
import * as demoProvisions from './resources/entity-store.js';
import * as entity from './trails/entity.js';
import * as kv from './trails/kv.js';
import * as notify from './trails/notify.js';
import * as onboard from './trails/onboard.js';
import * as search from './trails/search.js';

export const app = topo(
  'demo',
  demoProvisions,
  entity,
  search,
  onboard,
  entitySignals,
  kv,
  notify
);
