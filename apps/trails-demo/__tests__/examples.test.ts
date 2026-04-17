/**
 * The one-liner: validates the topo, tests every example, checks contracts,
 * and verifies detour targets.
 */

import { testAll } from '@ontrails/testing';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAll registers tests at module level by design
testAll(graph);
