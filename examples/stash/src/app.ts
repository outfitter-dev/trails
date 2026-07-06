/**
 * stash application — wires trails, signals, and resources into a topo.
 */

import { surfaceOverlay, topo } from '@ontrails/core';

import * as authResource from './resources/auth.js';
import * as dbResource from './resources/db.js';
import * as snippetSignals from './signals/snippet-signals.js';
import * as fileTrails from './trails/file.js';
import * as forkTrails from './trails/fork.js';
import * as reconcileTrails from './trails/reconcile.js';
import * as revisionTrails from './trails/revision.js';
import * as searchTrails from './trails/search.js';
import * as snippetTrails from './trails/snippet.js';
import * as starTrails from './trails/star.js';
import * as tokenTrails from './trails/token.js';
import * as userTrails from './trails/user.js';

export const graph = topo(
  {
    description: 'Self-hosted gists: snippets with immutable revisions',
    name: 'stash',
    version: '0.1.0',
  },
  dbResource,
  authResource,
  snippetSignals,
  snippetTrails,
  revisionTrails,
  forkTrails,
  starTrails,
  searchTrails,
  fileTrails,
  tokenTrails,
  userTrails,
  reconcileTrails
);

/**
 * App-authored surface bindings. `trails compile` embeds them in
 * `trails.lock` under `overlays.surfaces`, so the four MCP trailheads are
 * lock-visible facts. The call-site map in `mcp-options.ts` overrides these
 * defaults at runtime with richer metadata (descriptions) over the same
 * member trails.
 */
export const trailsOverlays = [
  surfaceOverlay({
    mcp: {
      account: ['token.create', 'token.list', 'token.revoke', 'user.me'],
      history: ['revision.list', 'revision.get', 'revision.diff', 'file.raw'],
      search: ['search.query'],
      snippets: [
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
  }),
];
