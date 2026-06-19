import { topo } from '@ontrails/core';
import {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOverviewTrail,
  wayfindOutlineTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
} from '@ontrails/wayfinder';

import { operatorApp } from './app.js';

const operatorTrails = Object.fromEntries(
  operatorApp.list().map((trailItem) => [trailItem.id, trailItem])
);

export const trailsMcpApp = topo('trails', operatorTrails, {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOutlineTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
});
