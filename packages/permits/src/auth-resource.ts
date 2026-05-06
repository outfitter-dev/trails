import { Result, resource } from '@ontrails/core';
import { z } from 'zod';

import type { AuthConnector } from './connectors/connector.js';
import { createJwtConnector } from './connectors/jwt.js';
import type { JwtConnectorOptions } from './connectors/jwt.js';

const authNoneConfigSchema = z
  .object({
    connector: z.literal('none'),
  })
  .readonly();

const authJwtConfigSchema = z
  .object({
    allowedAlgorithms: z.array(z.literal('HS256')).readonly().optional(),
    audience: z.string().optional(),
    clockSkewSeconds: z.number().int().nonnegative().optional(),
    connector: z.literal('jwt'),
    issuer: z.string().optional(),
    requireExpiration: z.boolean().optional(),
    rolesClaim: z.string().min(1).optional(),
    scopesClaim: z.string().min(1).optional(),
    secret: z.string().min(1),
  })
  .strict()
  .readonly();

export const authResourceConfigSchema = z
  .discriminatedUnion('connector', [authNoneConfigSchema, authJwtConfigSchema])
  .default({ connector: 'none' });

export type AuthResourceConfig = z.infer<typeof authResourceConfigSchema>;

const createNoopConnector = (): AuthConnector => ({
  // oxlint-disable-next-line require-await -- no-op connector satisfies async interface
  authenticate: async () => Result.ok(null),
});

const createConnector = (config: AuthResourceConfig): AuthConnector => {
  switch (config.connector) {
    case 'none': {
      return createNoopConnector();
    }
    case 'jwt': {
      const jwtOptions: JwtConnectorOptions = {
        ...(config.allowedAlgorithms === undefined
          ? {}
          : { allowedAlgorithms: config.allowedAlgorithms }),
        ...(config.audience === undefined ? {} : { audience: config.audience }),
        ...(config.clockSkewSeconds === undefined
          ? {}
          : { clockSkewSeconds: config.clockSkewSeconds }),
        ...(config.issuer === undefined ? {} : { issuer: config.issuer }),
        ...(config.requireExpiration === undefined
          ? {}
          : { requireExpiration: config.requireExpiration }),
        ...(config.rolesClaim === undefined
          ? {}
          : { rolesClaim: config.rolesClaim }),
        ...(config.scopesClaim === undefined
          ? {}
          : { scopesClaim: config.scopesClaim }),
        secret: config.secret,
      };
      return createJwtConnector(jwtOptions);
    }
    default: {
      const exhaustive: never = config;
      void exhaustive;
      return createNoopConnector();
    }
  }
};

/**
 * Auth resource — manages the auth connector lifecycle.
 *
 * Defaults to a no-op connector that always succeeds with a null permit, and
 * can be configured through `ResourceSpec.config` to materialize built-in
 * connectors such as JWT.
 */
export const authResource = resource<AuthConnector>('auth', {
  config: authResourceConfigSchema,
  create: (svc) => Result.ok(createConnector(svc.config as AuthResourceConfig)),
  description: 'Authentication connector',
  meta: { category: 'infrastructure' },
  mock: createNoopConnector,
});
