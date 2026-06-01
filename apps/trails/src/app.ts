import { topo } from '@ontrails/core';

import * as addSurface from './trails/add-surface.js';
import * as addTrail from './trails/add-trail.js';
import * as addVerify from './trails/add-verify.js';
import * as adapterCheck from './trails/adapter-check.js';
import * as compile from './trails/compile.js';
import * as completions from './trails/completions.js';
import * as completionsComplete from './trails/completions-complete.js';
import * as create from './trails/create.js';
import * as createScaffold from './trails/create-scaffold.js';
import * as deprecate from './trails/deprecate.js';
import * as devClean from './trails/dev-clean.js';
import * as devReset from './trails/dev-reset.js';
import * as devStats from './trails/dev-stats.js';
import * as doctor from './trails/doctor.js';
import * as draftPromote from './trails/draft-promote.js';
import * as guide from './trails/guide.js';
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

export const app = topo(
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
  draftPromote,
  adapterCheck,
  warden,
  wardenGuide,
  create,
  createScaffold,
  addSurface,
  addVerify,
  addTrail,
  completions,
  completionsComplete
);
