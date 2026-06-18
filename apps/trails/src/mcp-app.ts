import { topo } from '@ontrails/core';
import {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindOutlineTrail,
  wayfindSearchTrail,
  wayfindTrailsTrail,
} from '@ontrails/wayfinder';

import { operatorApp } from './app.js';

const operatorTrails = Object.fromEntries(
  operatorApp.list().map((trailItem) => [trailItem.id, trailItem])
);

export const trailsMcpApp = topo('trails', operatorTrails, {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOutlineTrail,
  wayfindOverviewTrail,
  wayfindSearchTrail,
  wayfindTrailsTrail,
});
