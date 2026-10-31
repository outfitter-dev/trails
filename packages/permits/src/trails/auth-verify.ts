import { Result, SURFACE_KEY, trail } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { authResource } from '../auth-resource.js';
import type { PermitExtractionInput } from '../extraction.js';
import { permitSchema } from '../permit.js';

const authErrorCodeSchema = z.enum([
  'expired_token',
  'insufficient_scope',
  'invalid_token',
  'missing_credentials',
]);

const isSurfaceName = (
  value: unknown
): value is PermitExtractionInput['surface'] =>
  value === 'http' || value === 'mcp' || value === 'cli';

const getSurface = (ctx: TrailContext): PermitExtractionInput['surface'] => {
  const surface = ctx.extensions?.[SURFACE_KEY];
  return isSurfaceName(surface) ? surface : 'http';
};

/**
 * Infrastructure trail that verifies a bearer token and returns the resolved permit.
 *
 * Reads the auth adapter from `authResource` — the adapter is configured
 * at bootstrap (e.g. JWT with HMAC secret). The mock adapter always
 * succeeds with a null permit, so `testAll(app)` works without configuration.
 */
export const authVerify = trail('auth.verify', {
  examples: [
    {
      input: { token: 'test-token' },
      name: 'Verify a token',
    },
  ],
  implementation: async (input, ctx) => {
    const adapter = authResource.from(ctx);
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

    const validated = permitSchema.safeParse(permit);
    if (!validated.success) {
      return Result.ok({
        error: 'Auth adapter returned a malformed permit',
        errorCode: 'invalid_token',
        valid: false,
      });
    }
    return Result.ok({
      permit: validated.data,
      valid: true,
    });
  },
  input: z.object({
    token: z.string().min(1).describe('Bearer token to verify'),
  }),
  intent: 'read',
  meta: { category: 'infrastructure' },
  output: z.object({
    error: z.string().optional(),
    errorCode: authErrorCodeSchema.optional(),
    permit: permitSchema.optional(),
    valid: z.boolean(),
  }),
  resources: [authResource],
});
