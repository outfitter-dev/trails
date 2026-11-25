/**
 * MCP entry: viewer/admin tools over stdio.
 *
 * Tools derive from the same graph and carry the same permit requirements
 * as HTTP and CLI. Stdio transports carry no per-request Authorization, so
 * the operator supplies a JWT through `JUNCTION_MCP_TOKEN` when launching
 * the server; it resolves through the same JWT boundary as the other two
 * surfaces and becomes the host-configured permit. This is local host policy;
 * stdio is outside OAuth and creates no protocol session authority.
 */

import type { BasePermit } from '@ontrails/core';
import { surface } from '@ontrails/mcp';

import { graph } from './app.js';
import { authConfigValues, resolveMcpPermit } from './permits.js';

const token = process.env['JUNCTION_MCP_TOKEN'];
let configuredPermit: BasePermit | undefined;
if (token !== undefined) {
  const resolved = await resolveMcpPermit({
    authorization: `Bearer ${token}`,
    bearerToken: token,
  });
  if (resolved.isErr()) {
    process.stderr.write(
      `JUNCTION_MCP_TOKEN did not resolve to a permit: ${resolved.error.message}\n`
    );
    process.exit(9);
  }
  configuredPermit = resolved.value ?? undefined;
}

const permit = configuredPermit;

// oxlint-disable-next-line require-hook -- MCP entry point, not a test file
await surface(graph, {
  configValues: authConfigValues(),
  ...(permit === undefined
    ? {}
    : {
        createContext: () => ({
          abortSignal: new AbortController().signal,
          permit,
          requestId: crypto.randomUUID(),
        }),
      }),
});
