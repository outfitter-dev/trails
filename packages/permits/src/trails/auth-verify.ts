import { Result, SURFACE_KEY, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { authService } from '../auth-service.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

const permitSchema = z.object({
  id: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  roles: z.array(z.string()).optional(),
  scopes: z.array(z.string()),
  tenantId: z.string().optional(),
});
const authErrorCodeSchema = z.enum([
  'expired_token',
  'insufficient_scope',
  'invalid_token',
  'missing_credentials',
]);

const toOutputPermit = (permit: Permit) => ({
  ...(permit.metadata === undefined
    ? {}
    : { metadata: { ...permit.metadata } }),
  ...(permit.roles === undefined ? {} : { roles: [...permit.roles] }),
  ...(permit.tenantId === undefined ? {} : { tenantId: permit.tenantId }),
  id: permit.id,
  scopes: [...permit.scopes],
});

const isSurface = (value: unknown): value is PermitExtractionInput['surface'] =>
  value === 'http' || value === 'mcp' || value === 'cli';

const getSurface = (ctx: TrailContext): PermitExtractionInput['surface'] => {
  const surface = ctx.extensions?.[SURFACE_KEY];
  return isSurface(surface) ? surface : 'http';
};

/**
 * Infrastructure trail that verifies a bearer token and returns the resolved permit.
 *
 * Reads the auth adapter from `authService` — the adapter is configured at
 * bootstrap (e.g. JWT with HMAC secret). The mock adapter always succeeds with
 * a null permit, so `testAll(app)` works without configuration.
 */
export const authVerify = trail('auth.verify', {
  blaze: async (input, ctx) => {
    const adapter = authService.from(ctx);
    const result = await adapter.authenticate({
      bearerToken: input.token,
      requestId: ctx.requestId,
      surface: getSurface(ctx),
    });

    if (result.isErr()) {
      return Result.ok({
        error: result.error.message,
        errorCode: result.error.code,
        valid: false,
      });
    }

    const permit = result.value;
    if (!permit) {
      return Result.ok({
        error: 'No credentials',
        errorCode: 'missing_credentials',
        valid: false,
      });
    }

    return Result.ok({
      permit: toOutputPermit(permit),
      valid: true,
    });
  },
  examples: [
    {
      input: { token: 'test-token' },
      name: 'Verify a token',
    },
  ],
  input: z.object({
    token: z.string().min(1).describe('Bearer token to verify'),
  }),
  intent: 'read',
  metadata: { category: 'infrastructure' },
  output: z.object({
    error: z.string().optional(),
    errorCode: authErrorCodeSchema.optional(),
    permit: permitSchema.optional(),
    valid: z.boolean(),
  }),
  services: [authService],
});
