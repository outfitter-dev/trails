/**
 * Token authentication for stash.
 *
 * The topo registers the framework `authResource`; each surface entry
 * overrides it with {@link createStashAuthAdapter}, a db-backed adapter that
 * resolves a bearer token against the `tokens` table and shares the same
 * store connection the trails use. One adapter, three surfaces: the CLI
 * `--token` flag, the HTTP `Authorization` header, and MCP authorization all
 * resolve permits through this lookup.
 */

import { Result } from '@ontrails/core';
import { authResource } from '@ontrails/permits';
import type { AuthAdapter } from '@ontrails/permits';

import type { StashConnection } from './db.js';

export const auth = authResource;

/**
 * Build an auth adapter over a live stash connection.
 *
 * Unknown and revoked tokens resolve to a null permit — the caller proceeds
 * anonymously (or the surface rejects, for flows that require a permit).
 */
export const createStashAuthAdapter = (conn: StashConnection): AuthAdapter => ({
  authenticate: async (input) => {
    const secret = input.bearerToken;
    if (secret === undefined || secret.length === 0) {
      return Result.ok(null);
    }
    const matches = await conn.tokens.list({ secret });
    const [token] = matches;
    if (token === undefined || token.revoked) {
      return Result.ok(null);
    }
    return Result.ok({ id: token.userId, scopes: [...token.scopes] });
  },
});
