import { AuthError, Result } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';

import type { DeriveMcpToolsOptions, McpExtra } from './build.js';

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
  options: Pick<DeriveMcpToolsOptions, 'resolvePermit'>,
  extra: Pick<McpExtra, '_meta' | 'authorization' | 'permit'>
): Promise<Result<BasePermit | undefined, Error>> => {
  if (extra.permit !== undefined) {
    return Result.ok(extra.permit);
  }
  const token = parseBearerAuthorization(extra.authorization);
  if (options.resolvePermit === undefined) {
    return token.isErr() ? token : Result.ok();
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
