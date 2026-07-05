import { topo } from '@ontrails/core';
import {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindOverlayTrail,
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
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOutlineTrail,
  wayfindOverlayTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrailsTrail,
});
