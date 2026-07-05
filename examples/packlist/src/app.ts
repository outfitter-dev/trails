/**
 * packlist application — wires the store, resource, and trails into a topo.
 *
 * This module stays side-effect-free: surfaces open in the dedicated entry
 * points (`bin/packlist.ts`, `src/http.ts`, `src/mcp.ts`).
 */

import { topo } from '@ontrails/core';

import * as dbResource from './resources/db.js';
import * as signals from './signals.js';
import * as gear from './trails/gear.js';
import * as pack from './trails/pack.js';
import * as reconcileTrails from './trails/reconcile.js';
import * as seed from './trails/seed.js';
import * as trip from './trails/trip.js';
import * as weight from './trails/weight.js';

export const graph = topo(
  {
    description:
      'Gear & trip checklist manager — the Trails "normal app" showcase',
    name: 'packlist',
    version: '0.1.0',
  },
  dbResource,
  signals,
  gear,
  pack,
  trip,
  weight,
  seed,
  reconcileTrails
);
