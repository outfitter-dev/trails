import { topo } from '@ontrails/core';

import * as addSurface from './trails/add-surface.js';
import * as addTrail from './trails/add-trail.js';
import * as addVerify from './trails/add-verify.js';
import * as create from './trails/create.js';
import * as createScaffold from './trails/create-scaffold.js';
import * as guide from './trails/guide.js';
import * as survey from './trails/survey.js';
import * as warden from './trails/warden.js';

export const app = topo(
  'trails',
  survey,
  guide,
  warden,
  create,
  createScaffold,
  addSurface,
  addVerify,
  addTrail
);
