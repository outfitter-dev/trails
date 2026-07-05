/**
 * lookout — uptime monitor & status page.
 *
 * Wires the check, probe, incident, notification, and status trails plus the
 * store and probe HTTP client into one queryable topo.
 */

import { topo } from '@ontrails/core';
import {
  tracingQuery,
  tracingResource,
  tracingStatus,
} from '@ontrails/tracing';

import { observeConfig } from './observe.js';
import * as probeHttp from './resources/probe-http.js';
import * as probeSignals from './signals/probe-signals.js';
import * as storeModule from './store.js';
import * as check from './trails/check.js';
import * as incident from './trails/incident.js';
import * as notify from './trails/notify.js';
import * as probe from './trails/probe.js';
import * as status from './trails/status.js';
import * as sweep from './trails/sweep.js';

export const graph = topo(
  {
    description:
      'Uptime monitor & status page — the fire-lookout tower for your services.',
    name: 'lookout',
    version: '0.1.0',
  },
  { db: storeModule.db },
  { probeHttp: probeHttp.probeHttp },
  {
    probeFailed: probeSignals.probeFailed,
    probeRecovered: probeSignals.probeRecovered,
  },
  check,
  probe,
  sweep,
  incident,
  notify,
  status,
  { tracingQuery, tracingResource, tracingStatus },
  topo.options({ observe: observeConfig })
);
