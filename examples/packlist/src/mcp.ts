/**
 * packlist MCP surface — tool names, JSON Schemas, and annotations derive
 * from the same trail contracts as the CLI and HTTP surfaces. This file is
 * the entire cost of the surface.
 */

import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/mcp';

import { graph } from './app.js';
import { createStderrLogger } from './logger.js';
import { operatorPermit } from './permit.js';

await surface(graph, {
  createContext: () =>
    createTrailContext({
      logger: createStderrLogger(),
      permit: operatorPermit,
    }),
});
