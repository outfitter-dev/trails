import { ProtocolError } from '@modelcontextprotocol/server';
import { Result, renderJsonRpcError } from '@ontrails/core';
import type { BasePermit } from '@ontrails/core';

import type { McpExtra } from './build.js';
import { resolveMcpPermit } from './permit-resolution.js';
import type { McpResourceDefinition } from './resources.js';
import type { CreateServerOptions } from './surface.js';

/** Verified caller and canonical resource descriptor, without invocation scopes. */
export interface AuthorizeMcpResourceReadInput {
  readonly permit: BasePermit | undefined;
  readonly resource: McpResourceDefinition;
}

/**
 * Authorize one resource URI for listing or reading.
 *
 * Return `Result.ok()` to allow it, or a `PermissionError` to deny it. Listing
 * omits denied resources; other errors fail the request. Direct reads report
 * the error through the shared JSON-RPC rendering. Omission means public reads.
 */
export type AuthorizeMcpResourceRead = (
  input: AuthorizeMcpResourceReadInput
) => Result<void, Error> | Promise<Result<void, Error>>;

/**
 * Preserve tool execution's request-permit precedence over trusted host context.
 *
 * Mirrors the context permit fallback in packages/core/src/execute.ts:294.
 * Credential errors return before consulting the host factory.
 */
export const resolveMcpResourcePermit = async (
  options: Pick<CreateServerOptions, 'resolvePermit' | 'createContext'>,
  extra: Pick<McpExtra, '_meta' | 'authorization' | 'permit'>
): Promise<Result<BasePermit | undefined, Error>> => {
  const resolved = await resolveMcpPermit(options, extra);
  if (resolved.isErr() || resolved.value !== undefined) {
    return resolved;
  }
  const context = await options.createContext?.();
  return Result.ok(context?.permit);
};

/** Render expected failures and unexpected app exceptions through one public boundary. */
export const runMcpResourceRequest = async <T>(
  method: 'resources/read' | undefined,
  operation: () => Promise<Result<T, Error>>
): Promise<T> => {
  let result: Result<T, Error>;
  try {
    result = await operation();
  } catch (error) {
    result = Result.err(
      error instanceof Error ? error : new Error('MCP resource request failed')
    );
  }
  if (result.isErr()) {
    const error = renderJsonRpcError('mcp', result.error, method);
    throw new ProtocolError(error.code, error.message, error.data);
  }
  return result.value;
};
