import { Result, resource } from '@ontrails/core';
import { z } from 'zod';

import type { AuthAdapter } from './adapters/adapter.js';
import { createJwtAdapter } from './adapters/jwt.js';
import type { JwtAdapterOptions } from './adapters/jwt.js';

const authNoneConfigSchema = z
  .object({
    adapter: z.literal('none'),
  })
  .readonly();

const authJwtConfigSchema = z
  .object({
    adapter: z.literal('jwt'),
    allowedAlgorithms: z.array(z.literal('HS256')).readonly().optional(),
    audience: z.string().optional(),
    clockSkewSeconds: z.number().int().nonnegative().optional(),
    issuer: z.string().optional(),
    requireExpiration: z.boolean().optional(),
    rolesClaim: z.string().min(1).optional(),
    scopesClaim: z.string().min(1).optional(),
    secret: z.string().min(1),
  })
  .strict()
  .readonly();

export const authResourceConfigSchema = z
  .discriminatedUnion('adapter', [authNoneConfigSchema, authJwtConfigSchema])
  .default({ adapter: 'none' });

export type AuthResourceConfig = z.infer<typeof authResourceConfigSchema>;

const createNoopAdapter = (): AuthAdapter => ({
  // oxlint-disable-next-line require-await -- no-op adapter satisfies async interface
  authenticate: async () => Result.ok(null),
});

const createAdapter = (config: AuthResourceConfig): AuthAdapter => {
  switch (config.adapter) {
    case 'none': {
      return createNoopAdapter();
    }
    case 'jwt': {
      const jwtOptions: JwtAdapterOptions = {
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
      return createJwtAdapter(jwtOptions);
    }
    default: {
      const exhaustive: never = config;
      void exhaustive;
      return createNoopAdapter();
    }
  }
};

/**
 * Auth resource — manages the auth adapter lifecycle.
 *
 * Defaults to a no-op adapter that always succeeds with a null permit, and
 * can be configured through `ResourceSpec.config` to materialize built-in
 * adapters such as JWT.
 */
export const authResource = resource<AuthAdapter>('auth', {
  config: authResourceConfigSchema,
  create: (resourceCtx) =>
    Result.ok(createAdapter(resourceCtx.config as AuthResourceConfig)),
  description: 'Authentication adapter',
  meta: { category: 'infrastructure' },
  mock: createNoopAdapter,
});
