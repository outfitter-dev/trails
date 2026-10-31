import type {
  AnyResource,
  BasePermit,
  ResourceOverrideMap,
  SurfaceConfigValues,
  Topo,
} from '@ontrails/core';
import {
  AuthError,
  Result,
  ValidationError,
  resolveResourceConfig,
} from '@ontrails/core';

import type { AuthAdapter } from './adapters/adapter.js';
import { authAdapterSchema, authErrorSchema } from './adapters/adapter.js';
import type { PermitExtractionInput } from './extraction.js';
import { permitExtractionInputSchema } from './extraction.js';
import { permitSchema } from './permit.js';

/** Resource id of the auth adapter resource provided by `@ontrails/permits`. */
export const AUTH_RESOURCE_ID = 'auth';

type LocatedAuthResource =
  | { readonly kind: 'override'; readonly value: unknown }
  | { readonly kind: 'declared'; readonly resource: AnyResource };

export interface ResolvePermitFromInputOptions {
  readonly bearerToken?: string | undefined;
  readonly authorization?: string | undefined;
  readonly apiKey?: string | undefined;
  readonly authToken?: string | undefined;
  readonly graph: Topo;
  readonly requestId: string;
  readonly surface: PermitExtractionInput['surface'];
  readonly resources?: ResourceOverrideMap | undefined;
  readonly configValues?: SurfaceConfigValues | undefined;
  readonly headers?: Headers | undefined;
  readonly sessionId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string | undefined> | undefined;
  readonly workspaceRoot?: string | undefined;
  readonly missingAuthResourceMessage?: string | undefined;
}

/** Options for the strict Bearer-token compatibility boundary. */
export interface ResolvePermitFromBearerTokenOptions extends ResolvePermitFromInputOptions {
  readonly bearerToken: string;
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
        'Bearer token auth requires an auth adapter. Register authResource from @ontrails/permits in your topo.'
    )
  );
};

/**
 * Materialize the auth adapter from an override or by invoking the declared
 * resource's `create()` factory.
 */
const materializeAuthAdapter = async (
  resolved: LocatedAuthResource,
  options: Pick<
    ResolvePermitFromInputOptions,
    'configValues' | 'cwd' | 'env' | 'workspaceRoot'
  >
): Promise<Result<AuthAdapter, Error>> => {
  if (resolved.kind === 'override') {
    const parsed = authAdapterSchema.safeParse(resolved.value);
    if (!parsed.success) {
      return Result.err(
        new ValidationError(
          'Override for resource "auth" does not expose an authenticate() function.'
        )
      );
    }
    return Result.ok(resolved.value as AuthAdapter);
  }

  const cwd = options.cwd ?? process.cwd();
  const configResult = resolveResourceConfig(
    resolved.resource,
    options.configValues
  );
  if (configResult.isErr()) {
    return configResult;
  }
  const created = await resolved.resource.create({
    config: configResult.value,
    cwd,
    env: options.env ?? {},
    workspaceRoot: options.workspaceRoot ?? cwd,
  });
  if (created.isErr()) {
    return created;
  }
  const parsed = authAdapterSchema.safeParse(created.value);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        'Auth resource factory returned a value without an authenticate() function.'
      )
    );
  }
  return Result.ok(created.value as AuthAdapter);
};

/**
 * Resolve normalized credential candidates through the configured auth adapter.
 *
 * Surfaces own credential extraction. This helper owns the shared auth
 * adapter lookup, invocation, error normalization, and BasePermit rendering.
 * An adapter's null outcome means no accepted credential was selected; a
 * selected credential that fails verification must return an error.
 *
 * @example
 * const result = await resolvePermitFromInput({
 *   graph, requestId: 'request-1', surface: 'http', apiKey: 'selected-key',
 * });
 */
const resolveCredentialPermit = async (
  options: ResolvePermitFromInputOptions,
  bearerCompatibility: boolean
): Promise<Result<BasePermit | null, Error>> => {
  const located = lookupAuthResource(
    options.graph,
    options.resources,
    options.missingAuthResourceMessage ??
      (bearerCompatibility
        ? undefined
        : 'Credential auth requires an auth adapter. Register authResource from @ontrails/permits in your topo.')
  );
  if (located.isErr()) {
    return located;
  }
  const adapterResult = await materializeAuthAdapter(located.value, options);
  if (adapterResult.isErr()) {
    return adapterResult;
  }
  const inputResult = permitExtractionInputSchema.safeParse({
    ...(options.bearerToken === undefined
      ? {}
      : { bearerToken: options.bearerToken }),
    ...(options.authorization === undefined
      ? {}
      : { authorization: options.authorization }),
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.authToken === undefined
      ? {}
      : { authToken: options.authToken }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
    requestId: options.requestId,
    ...(options.sessionId === undefined
      ? {}
      : { sessionId: options.sessionId }),
    surface: options.surface,
  });
  if (!inputResult.success) {
    return Result.err(
      new ValidationError(
        bearerCompatibility
          ? 'Invalid bearer token extraction input.'
          : 'Invalid credential extraction input.',
        {
          context: { issues: inputResult.error.issues },
        }
      )
    );
  }
  let authResult: Awaited<ReturnType<AuthAdapter['authenticate']>>;
  try {
    authResult = await adapterResult.value.authenticate(inputResult.data);
  } catch (error) {
    const errorOptions =
      error instanceof Error
        ? { cause: error, context: { code: 'invalid_token' } }
        : { context: { code: 'invalid_token' } };
    return Result.err(
      new AuthError(
        bearerCompatibility
          ? 'Auth adapter threw while authenticating bearer token'
          : 'Auth adapter threw while authenticating credentials',
        {
          ...errorOptions,
        }
      )
    );
  }
  if (authResult.isErr()) {
    const parsedError = authErrorSchema.safeParse(authResult.error);
    const { code, message } = parsedError.success
      ? parsedError.data
      : {
          code: 'invalid_token' as const,
          message: 'Auth adapter returned a malformed error',
        };
    return Result.err(new AuthError(message, { context: { code } }));
  }
  if (authResult.value === null) {
    return Result.ok(null);
  }
  const permit = permitSchema.safeParse(authResult.value);
  if (!permit.success) {
    return Result.err(
      new AuthError('Auth adapter returned a malformed permit', {
        context: { code: 'invalid_token', issues: permit.error.issues },
      })
    );
  }
  return Result.ok(permit.data);
};

/**
 * Resolve normalized input; null means the adapter selected no credential.
 *
 * @example
 * const result = await resolvePermitFromInput({
 *   graph, requestId: 'request-1', surface: 'http', apiKey: 'selected-key',
 * });
 */
export const resolvePermitFromInput = (
  options: ResolvePermitFromInputOptions
): Promise<Result<BasePermit | null, Error>> =>
  resolveCredentialPermit(options, false);

/**
 * Resolve a Bearer token, rejecting an adapter's null outcome as before.
 *
 * @example
 * const result = await resolvePermitFromBearerToken({
 *   graph, requestId: 'request-1', surface: 'http', bearerToken: 'token',
 * });
 */
export const resolvePermitFromBearerToken = async (
  options: ResolvePermitFromBearerTokenOptions
): Promise<Result<BasePermit, Error>> => {
  const result = await resolveCredentialPermit(options, true);
  if (result.isErr()) {
    return result;
  }
  if (result.value !== null) {
    return Result.ok(result.value);
  }
  return Result.err(
    new AuthError(
      options.nullPermitMessage ??
        'Auth adapter did not produce a permit for bearer token',
      { context: { code: 'missing_credentials' } }
    )
  );
};
