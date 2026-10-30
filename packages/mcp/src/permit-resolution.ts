import { AuthError, Result } from '@ontrails/core';
import type { BasePermit, TrailContextInit } from '@ontrails/core';

import type { DeriveMcpToolsOptions, McpExtra } from './build.js';

const SEEDED_PERMIT_DIAGNOSTIC =
  '[ontrails:mcp] A createContext permit was discarded on a network MCP surface. Identity enters a network surface only through resolvePermit; move the credential into a verifier (see the @ontrails/mcp changelog for TRL-1560).';

let seededPermitDiagnosed = false;

/**
 * The context factory a surface hands to the pipeline.
 *
 * On the network posture a seeded permit is discarded at runtime (once with a
 * diagnostic) so an anonymous caller can never inherit host identity; the
 * rest of the seed (logger, extensions, resources) still applies.
 */
export const surfaceContextFactory = (
  options: Pick<DeriveMcpToolsOptions, 'createContext' | 'credentialPosture'>
): (() => TrailContextInit | Promise<TrailContextInit>) | undefined => {
  const factory = options.createContext;
  if (factory === undefined || options.credentialPosture !== 'network') {
    return factory;
  }
  return async () => {
    const { permit, ...seed } = await factory();
    if (permit !== undefined && !seededPermitDiagnosed) {
      seededPermitDiagnosed = true;
      // The seed's own logger is the app's logging surface; a seed without one
      // still loses the permit, silently.
      seed.logger?.warn(SEEDED_PERMIT_DIAGNOSTIC, {
        code: 'seeded_permit_discarded',
        permitId: permit.id,
      });
    }
    return seed;
  };
};

/** Test seam: forget that the seeded-permit diagnostic was emitted. */
export const resetSeededPermitDiagnostic = (): void => {
  seededPermitDiagnosed = false;
};

const parseBearerAuthorization = (
  authorization: string | undefined
): Result<string | undefined, Error> => {
  if (authorization === undefined || authorization.length === 0) {
    return Result.ok();
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (token === undefined || token.length === 0) {
    return Result.err(
      new AuthError('Malformed MCP authorization; expected Bearer token', {
        context: { code: 'invalid_authorization_header' },
      })
    );
  }
  return Result.ok(token);
};

/**
 * Resolve one request's untrusted candidates, preserving trusted host permits.
 *
 * Shared seam for MCP invocation and resource adapters. The configured resolver
 * owns accepted credential syntax; malformed Bearer is not absence by policy.
 * Callers own subsequent trusted host-context fallback, never after an error.
 */
export const resolveMcpPermit = async (
  options: Pick<DeriveMcpToolsOptions, 'resolvePermit' | 'credentialPosture'>,
  extra: Pick<McpExtra, '_meta' | 'authorization' | 'permit'>
): Promise<Result<BasePermit | undefined, Error>> => {
  const network = options.credentialPosture === 'network';
  if (extra.permit !== undefined && !network) {
    return Result.ok(extra.permit);
  }
  const token = parseBearerAuthorization(extra.authorization);
  if (options.resolvePermit === undefined) {
    if (token.isErr()) {
      return token;
    }
    if (network && token.value !== undefined) {
      return Result.err(
        new AuthError(
          'A bearer credential was presented but this MCP surface has no permit resolver; configure resolvePermit with a verifier.',
          { context: { code: 'no_permit_resolver' } }
        )
      );
    }
    return Result.ok();
  }
  const resolved = await options.resolvePermit({
    _meta: extra._meta,
    authorization: extra.authorization,
    bearerToken: token.isOk() ? token.value : undefined,
  });
  if (resolved.isErr()) {
    return resolved;
  }
  return Result.ok(resolved.value ?? undefined);
};
