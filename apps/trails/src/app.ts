import { topo } from '@ontrails/core';
import {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
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
  wayfindVersionsTrail,
} from '@ontrails/wayfinder';

import * as addSurface from './trails/add-surface.js';
import * as addTrail from './trails/add-trail.js';
import * as addVerify from './trails/add-verify.js';
import * as adapterCheck from './trails/adapter-check.js';
import * as compile from './trails/compile.js';
import * as completions from './trails/completions.js';
import * as completionsComplete from './trails/completions-complete.js';
import * as create from './trails/create.js';
import * as createAdapter from './trails/create-adapter.js';
import * as createScaffold from './trails/create-scaffold.js';
import * as createVersions from './trails/create-versions.js';
import * as deprecate from './trails/deprecate.js';
import * as devClean from './trails/dev-clean.js';
import * as devReset from './trails/dev-reset.js';
import * as devStats from './trails/dev-stats.js';
import * as doctor from './trails/doctor.js';
import * as draftPromote from './trails/draft-promote.js';
import * as guide from './trails/guide.js';
import * as regrade from './trails/regrade.js';
import * as releaseCheck from './trails/release-check.js';
import * as releaseSmoke from './trails/release-smoke.js';
import * as revise from './trails/revise.js';
import * as run from './trails/run.js';
import * as runExample from './trails/run-example.js';
import * as runExamples from './trails/run-examples.js';
import * as survey from './trails/survey.js';
import * as topoHistory from './trails/topo-history.js';
import * as topoPin from './trails/topo-pin.js';
import * as topoCommand from './trails/topo.js';
import * as topoUnpin from './trails/topo-unpin.js';
import * as validate from './trails/validate.js';
import * as warden from './trails/warden.js';
import * as wardenGuide from './trails/warden-guide.js';
import * as wayfind from './trails/wayfind.js';

export const operatorApp = topo(
  'trails',
  run,
  runExamples,
  runExample,
  survey,
  topoCommand,
  compile,
  topoHistory,
  topoPin,
  topoUnpin,
  validate,
  revise,
  deprecate,
  doctor,
  devStats,
  devClean,
  devReset,
  guide,
  regrade,
  releaseCheck,
  releaseSmoke,
  draftPromote,
  adapterCheck,
  warden,
  wardenGuide,
  create,
  createAdapter,
  createScaffold,
  createVersions,
  addSurface,
  addVerify,
  addTrail,
  completions,
  completionsComplete
);

const operatorTrails = Object.fromEntries(
  operatorApp.list().map((trailItem) => [trailItem.id, trailItem])
);

const cliWayfinderTrails = {
  wayfindAdaptersTrail,
  wayfindContractTrail,
  wayfindDescribeTrail,
  wayfindDiffTrail,
  wayfindErrorsTrail,
  wayfindExamplesTrail,
  wayfindImpactTrail,
  wayfindNearbyTrail,
  wayfindOutlineTrail,
  wayfindOverviewTrail,
  wayfindResourcesTrail,
  wayfindSearchTrail,
  wayfindSurfacesTrail,
  wayfindTrail: wayfind.wayfindTrail,
  wayfindTrailsTrail,
  wayfindVersionsTrail,
};

export const trailsCliIncludedTrails = [
  ...operatorApp.list().map((trailItem) => trailItem.id),
  ...Object.values(cliWayfinderTrails).map((trailItem) => trailItem.id),
];

export const trailsCliAliases = {
  'survey.diff': [['diff']],
} as const;

export const app = topo('trails', operatorTrails, cliWayfinderTrails);
