import type {
  AnyResource,
  BasePermit,
  ResourceOverrideMap,
  Topo,
} from '@ontrails/core';
import {
  AuthError,
  Result,
  ValidationError,
  basePermitSchema,
} from '@ontrails/core';

import type { AuthConnector } from './connectors/connector.js';
import {
  authConnectorSchema,
  authErrorSchema,
} from './connectors/connector.js';
import type { PermitExtractionInput } from './extraction.js';
import { permitExtractionInputSchema } from './extraction.js';

/** Resource id of the auth connector resource provided by `@ontrails/permits`. */
export const AUTH_RESOURCE_ID = 'auth';

type LocatedAuthResource =
  | { readonly kind: 'override'; readonly value: unknown }
  | { readonly kind: 'declared'; readonly resource: AnyResource };

export interface ResolvePermitFromBearerTokenOptions {
  readonly bearerToken: string;
  readonly graph: Topo;
  readonly requestId: string;
  readonly surface: PermitExtractionInput['surface'];
  readonly resources?: ResourceOverrideMap | undefined;
  readonly headers?: Headers | undefined;
  readonly sessionId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly missingAuthResourceMessage?: string | undefined;
  readonly nullPermitMessage?: string | undefined;
}

/** Resolve the auth resource override or registered resource on the topo. */
const lookupAuthResource = (
  graph: Topo,
  resources: ResourceOverrideMap | undefined,
  missingAuthResourceMessage: string | undefined
): Result<LocatedAuthResource, ValidationError> => {
  if (resources !== undefined && Object.hasOwn(resources, AUTH_RESOURCE_ID)) {
    return Result.ok({
      kind: 'override',
      value: resources[AUTH_RESOURCE_ID],
    });
  }
  const declared = graph.getResource(AUTH_RESOURCE_ID);
  if (declared !== undefined) {
    return Result.ok({ kind: 'declared', resource: declared });
  }
  return Result.err(
    new ValidationError(
      missingAuthResourceMessage ??
        'Bearer token auth requires an auth connector. Register authResource from @ontrails/permits in your topo.'
    )
  );
};

/**
 * Materialize the auth connector from an override or by invoking the declared
 * resource's `create()` factory.
 */
const materializeAuthConnector = async (
  resolved: LocatedAuthResource,
  options: Pick<
    ResolvePermitFromBearerTokenOptions,
    'cwd' | 'env' | 'workspaceRoot'
  >
): Promise<Result<AuthConnector, Error>> => {
  if (resolved.kind === 'override') {
    const parsed = authConnectorSchema.safeParse(resolved.value);
    if (!parsed.success) {
      return Result.err(
        new ValidationError(
          'Override for resource "auth" does not expose an authenticate() function.'
        )
      );
    }
    return Result.ok(resolved.value as AuthConnector);
  }

  const cwd = options.cwd ?? process.cwd();
  const created = await resolved.resource.create({
    config: undefined,
    cwd,
    env: options.env ?? {},
    workspaceRoot: options.workspaceRoot ?? cwd,
  });
  if (created.isErr()) {
    return created;
  }
  const parsed = authConnectorSchema.safeParse(created.value);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        'Auth resource factory returned a value without an authenticate() function.'
      )
    );
  }
  return Result.ok(created.value as AuthConnector);
};

/**
 * Resolve a surface-extracted bearer token to a `BasePermit`.
 *
 * Surfaces own credential extraction. This helper owns the shared auth
 * connector lookup, invocation, error normalization, and BasePermit projection.
 */
export const resolvePermitFromBearerToken = async (
  options: ResolvePermitFromBearerTokenOptions
): Promise<Result<BasePermit, Error>> => {
  const located = lookupAuthResource(
    options.graph,
    options.resources,
    options.missingAuthResourceMessage
  );
  if (located.isErr()) {
    return located;
  }
  const connectorResult = await materializeAuthConnector(
    located.value,
    options
  );
  if (connectorResult.isErr()) {
    return connectorResult;
  }
  const inputResult = permitExtractionInputSchema.safeParse({
    bearerToken: options.bearerToken,
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    requestId: options.requestId,
    ...(options.sessionId === undefined
      ? {}
      : { sessionId: options.sessionId }),
    surface: options.surface,
  });
  if (!inputResult.success) {
    return Result.err(
      new ValidationError('Invalid bearer token extraction input.', {
        context: { issues: inputResult.error.issues },
      })
    );
  }
  let authResult: Awaited<ReturnType<AuthConnector['authenticate']>>;
  try {
    authResult = await connectorResult.value.authenticate(inputResult.data);
  } catch (error) {
    const errorOptions =
      error instanceof Error
        ? { cause: error, context: { code: 'invalid_token' } }
        : { context: { code: 'invalid_token' } };
    return Result.err(
      new AuthError('Auth connector threw while authenticating bearer token', {
        ...errorOptions,
      })
    );
  }
  if (authResult.isErr()) {
    const parsedError = authErrorSchema.safeParse(authResult.error);
    const { code, message } = parsedError.success
      ? parsedError.data
      : {
          code: 'invalid_token' as const,
          message: 'Auth connector returned a malformed error',
        };
    return Result.err(new AuthError(message, { context: { code } }));
  }
  if (authResult.value === null) {
    return Result.err(
      new AuthError(
        options.nullPermitMessage ??
          'Auth connector did not produce a permit for bearer token',
        {
          context: { code: 'missing_credentials' },
        }
      )
    );
  }
  const permit = basePermitSchema.safeParse(authResult.value);
  if (!permit.success) {
    return Result.err(
      new AuthError('Auth connector returned a malformed permit', {
        context: { code: 'invalid_token', issues: permit.error.issues },
      })
    );
  }
  return Result.ok(permit.data);
};
