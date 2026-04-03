import { topo } from '@ontrails/core';

import * as addTrailhead from './trails/add-trailhead.js';
import * as addTrail from './trails/add-trail.js';
import * as addVerify from './trails/add-verify.js';
import * as create from './trails/create.js';
import * as createScaffold from './trails/create-scaffold.js';
import * as draftPromote from './trails/draft-promote.js';
import * as guide from './trails/guide.js';
import * as survey from './trails/survey.js';
import * as warden from './trails/warden.js';

export const app = topo(
  'trails',
  survey,
  guide,
  draftPromote,
  warden,
  create,
  createScaffold,
  addTrailhead,
  addVerify,
  addTrail
);
