/**
 * packlist HTTP surface — routes, verbs, and error statuses derive from the
 * same trail contracts the CLI uses. Serves the same SQLite file, so data
 * written from the CLI is readable here immediately.
 */

import { createTrailContext } from '@ontrails/core';
import { surface } from '@ontrails/hono';

import { graph } from './app.js';
import { createStderrLogger } from './logger.js';
import { operatorPermit } from './permit.js';

await surface(graph, {
  createContext: () =>
    createTrailContext({
      logger: createStderrLogger(),
      permit: operatorPermit,
    }),
  port: Number(Bun.env['PACKLIST_PORT'] ?? 3210),
});
