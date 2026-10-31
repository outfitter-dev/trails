/**
 * JWT permit wiring shared by every surface.
 *
 * One `authResource` configuration (HS256, secret from `JUNCTION_JWT_SECRET`)
 * feeds three enforcements: HTTP bearer tokens, MCP bearer tokens, and the
 * CLI `--token` flag all resolve through the same
 * `resolvePermitFromBearerToken` boundary. Trails declare
 * `relay:read`/`relay:write` scopes once; viewer tokens carry `relay:read`,
 * admin tokens carry both.
 */

import type { ResolveCliPermitFromToken } from '@ontrails/cli';
import { Result } from '@ontrails/core';
import type { ResolveHttpPermit } from '@ontrails/http';
import type { ResolveMcpPermit } from '@ontrails/mcp';
import { resolvePermitFromBearerToken } from '@ontrails/permits';

import { graph } from './app.js';

export const jwtSecret = (): string =>
  process.env['JUNCTION_JWT_SECRET'] ?? 'junction-dev-secret';

/** `configValues` for the `auth` resource on every surface. */
export const authConfigValues = () => ({
  auth: { adapter: 'jwt' as const, secret: jwtSecret() },
});

// Surfaces call the configured resolver for every request. An anonymous
// request (no Authorization at all) resolves to no permit, so public trails
// run and protected trails fail at their scope check. A presented credential
// that is not a Bearer token still reaches the strict helper and is rejected.
export const resolveHttpPermit: ResolveHttpPermit = ({
  authorization,
  bearerToken,
  requestId,
}) =>
  authorization === undefined
    ? Result.ok(null)
    : resolvePermitFromBearerToken({
        bearerToken: bearerToken ?? '',
        configValues: authConfigValues(),
        graph,
        requestId: requestId ?? 'http-request',
        surface: 'http',
      });

export const resolveMcpPermit: ResolveMcpPermit = ({
  authorization,
  bearerToken,
}) =>
  authorization === undefined && bearerToken === undefined
    ? Result.ok(null)
    : resolvePermitFromBearerToken({
        bearerToken: bearerToken ?? '',
        configValues: authConfigValues(),
        graph,
        requestId: crypto.randomUUID(),
        surface: 'mcp',
      });

export const resolveCliPermit: ResolveCliPermitFromToken = ({
  requestId,
  token,
}) =>
  resolvePermitFromBearerToken({
    bearerToken: token,
    configValues: authConfigValues(),
    graph,
    requestId,
    surface: 'cli',
  });
