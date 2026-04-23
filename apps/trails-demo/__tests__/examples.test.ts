/**
 * The one-liner for shipped surfaces: validates the established topo, tests
 * every example, checks contracts, verifies detours, and ensures CLI/MCP
 * projections still build.
 */

import { testAllEstablished } from '@ontrails/testing';

import { graph } from '../src/app.js';

// oxlint-disable-next-line require-hook -- testAllEstablished registers tests at module level by design
testAllEstablished(graph);
