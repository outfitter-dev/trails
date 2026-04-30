import { topo } from '@ontrails/core';

import * as addSurface from './trails/add-surface.js';
import * as addTrail from './trails/add-trail.js';
import * as addVerify from './trails/add-verify.js';
import * as create from './trails/create.js';
import * as createScaffold from './trails/create-scaffold.js';
import * as devClean from './trails/dev-clean.js';
import * as devReset from './trails/dev-reset.js';
import * as devStats from './trails/dev-stats.js';
import * as draftPromote from './trails/draft-promote.js';
import * as guide from './trails/guide.js';
import * as survey from './trails/survey.js';
import * as topoExport from './trails/topo-export.js';
import * as topoHistory from './trails/topo-history.js';
import * as topoPin from './trails/topo-pin.js';
import * as topoCommand from './trails/topo.js';
import * as topoUnpin from './trails/topo-unpin.js';
import * as topoVerify from './trails/topo-verify.js';
import * as warden from './trails/warden.js';

export const app = topo(
  'trails',
  survey,
  topoCommand,
  topoHistory,
  topoPin,
  topoUnpin,
  topoExport,
  topoVerify,
  devStats,
  devClean,
  devReset,
  guide,
  draftPromote,
  warden,
  create,
  createScaffold,
  addSurface,
  addVerify,
  addTrail
);
