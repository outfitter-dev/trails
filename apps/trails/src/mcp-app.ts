import { topo } from '@ontrails/core';
import {
  wayfindContractTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindSearchTrail,
  wayfindTrailsTrail,
} from '@ontrails/wayfinder';

import { app } from './app.js';

const operatorTrails = Object.fromEntries(
  app.list().map((trailItem) => [trailItem.id, trailItem])
);

export const trailsMcpApp = topo('trails', operatorTrails, {
  wayfindContractTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindSearchTrail,
  wayfindTrailsTrail,
});
