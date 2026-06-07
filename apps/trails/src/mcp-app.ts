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

import { operatorApp } from './app.js';

const operatorTrails = Object.fromEntries(
  operatorApp.list().map((trailItem) => [trailItem.id, trailItem])
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
