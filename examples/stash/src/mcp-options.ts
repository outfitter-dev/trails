/**
 * MCP surface options — the hero surface.
 *
 * Trailheads group the dense topo into four entries an agent can scan in one
 * tool listing. A trailhead call is `{ trail, input }` and the response
 * carries `{ trail, output }`: member trail identity is preserved at
 * invocation and response time (ADR-0050), never merged away.
 */

import type {
  CreateServerOptions,
  McpSurfaceTrailheadMap,
} from '@ontrails/mcp';

export const stashTrailheads = {
  account: {
    description:
      'Token self-service and identity: mint, list, and revoke API tokens; check who a token belongs to.',
    trails: ['token.create', 'token.list', 'token.revoke', 'user.me'],
  },
  history: {
    description:
      'Immutable revision history: list revisions, read one in full, diff two seqs, fetch raw file bytes.',
    trails: ['revision.list', 'revision.get', 'revision.diff', 'file.raw'],
  },
  search: {
    description:
      'Keyword search over the signal-maintained index of public snippets.',
    trails: ['search.query'],
  },
  snippets: {
    description:
      'Create, read, update, fork, star, and delete snippets. Updates append revisions; secret snippets are owner-only.',
    trails: [
      'snippet.create',
      'snippet.get',
      'snippet.list',
      'snippet.update',
      'snippet.delete',
      'snippet.fork',
      'snippet.star',
      'snippet.unstar',
    ],
  },
} satisfies McpSurfaceTrailheadMap;

export const stashMcpOptions = {
  description:
    'Self-hosted gists for agents: save, search, fork, and retrieve snippets with immutable revision history.',
  name: 'stash',
  trailheads: stashTrailheads,
  version: '0.1.0',
} satisfies CreateServerOptions;
