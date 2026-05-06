import { describe, expect, test } from 'bun:test';

import {
  AuthError,
  Result,
  ValidationError,
  resource,
  topo,
} from '@ontrails/core';

import { authResource } from '../auth-resource.js';
import { resolvePermitFromBearerToken } from '../boundary.js';
import type { PermitExtractionInput } from '../extraction.js';
import { TEST_SECRET, signJwt } from './helpers/jwt.js';

const authResourceDef = resource<{
  readonly authenticate: (
    input: PermitExtractionInput
  ) => Promise<
    Result<
      { readonly id: string; readonly scopes: readonly string[] } | null,
      { readonly code: 'invalid_token'; readonly message: string }
    >
  >;
}>('auth', {
  create: () =>
    Result.ok({
      authenticate: async () =>
        Result.ok({ id: 'created-user', scopes: ['created:read'] }),
    }),
});

const app = topo('auth-boundary-test', { auth: authResourceDef });
const configuredApp = topo('auth-boundary-config-test', {
  auth: authResource,
});

describe('resolvePermitFromBearerToken', () => {
  test('resolves a bearer token through an override auth connector', async () => {
    let observed: PermitExtractionInput | undefined;
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'good-token',
      graph: app,
      requestId: 'req-1',
      resources: {
        auth: {
          authenticate: async (input: PermitExtractionInput) => {
            observed = input;
            return Result.ok({ id: 'override-user', scopes: ['entity:read'] });
          },
        },
      },
      surface: 'http',
    });

    expect(result.unwrap()).toEqual({
      id: 'override-user',
      scopes: ['entity:read'],
    });
    expect(observed).toMatchObject({
      bearerToken: 'good-token',
      requestId: 'req-1',
      surface: 'http',
    });
  });

  test('uses the declared auth resource when no override is supplied', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'declared-token',
      graph: app,
      requestId: 'req-2',
      surface: 'mcp',
    });

    expect(result.unwrap()).toEqual({
      id: 'created-user',
      scopes: ['created:read'],
    });
  });

  test('materializes a declared auth resource with configValues', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      { exp: now + 3600, scope: 'read write', sub: 'configured-user' },
      TEST_SECRET
    );

    const result = await resolvePermitFromBearerToken({
      bearerToken: token,
      configValues: {
        [authResource.id]: { connector: 'jwt', secret: TEST_SECRET },
      },
      graph: configuredApp,
      requestId: 'req-config',
      surface: 'cli',
    });

    expect(result.unwrap()).toEqual({
      id: 'configured-user',
      scopes: ['read', 'write'],
    });
  });

  test('returns ValidationError when no auth connector is registered', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'no-auth',
      graph: topo('without-auth'),
      missingAuthResourceMessage: 'missing auth connector',
      requestId: 'req-3',
      surface: 'cli',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe('missing auth connector');
    }
  });

  test('normalizes connector errors to AuthError', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'bad-token',
      graph: app,
      requestId: 'req-4',
      resources: {
        auth: {
          authenticate: async () =>
            Result.err({ code: 'invalid_token', message: 'bad signature' }),
        },
      },
      surface: 'http',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.message).toBe('bad signature');
      expect(result.error.context).toMatchObject({ code: 'invalid_token' });
    }
  });

  test('normalizes null permits to missing-credentials AuthError', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'null-token',
      graph: app,
      nullPermitMessage: 'no permit',
      requestId: 'req-5',
      resources: {
        auth: {
          authenticate: async () => Result.ok(null),
        },
      },
      surface: 'mcp',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.message).toBe('no permit');
      expect(result.error.context).toMatchObject({
        code: 'missing_credentials',
      });
    }
  });

  test('returns ValidationError for invalid extraction input instead of throwing', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'bad-surface-token',
      graph: app,
      requestId: 'req-6',
      resources: {
        auth: {
          authenticate: async () =>
            Result.ok({ id: 'unused', scopes: ['unused:read'] }),
        },
      },
      surface: 'smtp' as never,
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(ValidationError);
      expect(result.error.message).toBe(
        'Invalid bearer token extraction input.'
      );
    }
  });

  test('normalizes thrown connector failures to AuthError', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'throw-token',
      graph: app,
      requestId: 'req-7',
      resources: {
        auth: {
          authenticate: async () => {
            throw new Error('connector exploded');
          },
        },
      },
      surface: 'mcp',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.message).toBe(
        'Auth connector threw while authenticating bearer token'
      );
      expect(result.error.context).toMatchObject({ code: 'invalid_token' });
    }
  });

  test('normalizes malformed connector permits to AuthError', async () => {
    const result = await resolvePermitFromBearerToken({
      bearerToken: 'malformed-token',
      graph: app,
      requestId: 'req-8',
      resources: {
        auth: {
          authenticate: async () =>
            Result.ok({ id: 'missing-scopes' } as never),
        },
      },
      surface: 'cli',
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toBeInstanceOf(AuthError);
      expect(result.error.message).toBe(
        'Auth connector returned a malformed permit'
      );
      expect(result.error.context).toMatchObject({ code: 'invalid_token' });
    }
  });
});
