/**
 * MCP surface — the agent's window into lookout.
 *
 * Tools derive from the public trail contracts (`lookout_status_summary`,
 * `lookout_probe_history`, `lookout_incident_list`, `lookout_tracing_query`,
 * ...), so an agent can answer "why did api.example.com go down last night?"
 * from incident, probe, and trace data. Admin tools require the
 * `LOOKOUT_ADMIN_TOKEN` bearer token.
 */

import { surface } from '@ontrails/mcp';

import { graph } from './app.js';
import { resolveTokenPermit } from './permits.js';

// oxlint-disable-next-line require-hook -- MCP entry point, not a test file
await surface(graph, {
  resolvePermit: ({ bearerToken }) => resolveTokenPermit(bearerToken),
});
