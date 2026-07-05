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

export const resolveHttpPermit: ResolveHttpPermit = ({
  bearerToken,
  requestId,
}) =>
  resolvePermitFromBearerToken({
    bearerToken: bearerToken ?? '',
    configValues: authConfigValues(),
    graph,
    requestId: requestId ?? 'http-request',
    surface: 'http',
  });

export const resolveMcpPermit: ResolveMcpPermit = ({
  bearerToken,
  sessionId,
}) =>
  resolvePermitFromBearerToken({
    bearerToken: bearerToken ?? '',
    configValues: authConfigValues(),
    graph,
    requestId: sessionId ?? 'mcp-session',
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
