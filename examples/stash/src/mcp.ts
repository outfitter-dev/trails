/**
 * MCP entry point for stash — the hero surface.
 *
 * Usage:
 *   bun run src/mcp.ts
 */

import { AuthError, Result } from '@ontrails/core';
import { surface } from '@ontrails/mcp';

import { graph } from './app.js';
import { stashMcpOptions } from './mcp-options.js';
import { createStashAuthAdapter } from './resources/auth.js';
import { db } from './resources/db.js';
import { openStashDb } from './server.js';

const conn = await openStashDb();
const adapter = createStashAuthAdapter(conn);

await surface(graph, {
  ...stashMcpOptions,
  resolvePermit: async ({ bearerToken }) => {
    const authed = await adapter.authenticate({
      ...(bearerToken === undefined ? {} : { bearerToken }),
      requestId: 'stash-mcp',
      surface: 'mcp',
    });
    if (authed.isErr()) {
      return Result.err(new AuthError(authed.error.message));
    }
    return Result.ok(authed.value);
  },
  resources: { [db.id]: conn, auth: adapter },
});
