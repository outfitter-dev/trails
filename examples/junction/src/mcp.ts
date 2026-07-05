/**
 * MCP entry: viewer/admin tools over stdio.
 *
 * Tools derive from the same graph and carry the same permit requirements
 * as HTTP and CLI. Stdio transports carry no per-request Authorization, so
 * the operator supplies a JWT through `JUNCTION_MCP_TOKEN` when launching
 * the server; it resolves through the same JWT boundary as the other two
 * surfaces and becomes the session permit. HTTP-transported MCP clients
 * with OAuth still resolve per-request through `resolvePermit`.
 */

import type { BasePermit } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import { resolvePermitFromBearerToken } from '@ontrails/permits';

import { graph } from './app.js';
import { authConfigValues, resolveMcpPermit } from './permits.js';

const token = process.env['JUNCTION_MCP_TOKEN'];
let sessionPermit: BasePermit | undefined;
if (token !== undefined) {
  const resolved = await resolvePermitFromBearerToken({
    bearerToken: token,
    configValues: authConfigValues(),
    graph,
    requestId: 'mcp-stdio-session',
    surface: 'mcp',
  });
  if (resolved.isErr()) {
    process.stderr.write(
      `JUNCTION_MCP_TOKEN did not resolve to a permit: ${resolved.error.message}\n`
    );
    process.exit(9);
  }
  sessionPermit = resolved.value;
}

const permit = sessionPermit;

// oxlint-disable-next-line require-hook -- MCP entry point, not a test file
await surface(graph, {
  configValues: authConfigValues(),
  ...(permit === undefined
    ? {}
    : {
        createContext: () => ({
          abortSignal: new AbortController().signal,
          permit,
          requestId: 'mcp-stdio-session',
        }),
      }),
  resolvePermit: resolveMcpPermit,
});
