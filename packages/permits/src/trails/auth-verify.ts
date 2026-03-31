import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { authService } from '../auth-service.js';

/**
 * Infrastructure trail that verifies a bearer token and returns the resolved permit.
 *
 * Reads the auth adapter from `authService` — the adapter is configured at
 * bootstrap (e.g. JWT with HMAC secret). The mock adapter always succeeds with
 * a null permit, so `testAll(app)` works without configuration.
 */
export const authVerify = trail('auth.verify', {
  examples: [
    {
      input: { token: 'test-token' },
      name: 'Verify a token',
    },
  ],
  input: z.object({
    token: z.string().describe('Bearer token to verify'),
  }),
  intent: 'read',
  metadata: { category: 'infrastructure' },
  output: z.object({
    error: z.string().optional(),
    permit: z
      .object({
        id: z.string(),
        scopes: z.array(z.string()),
      })
      .optional(),
    valid: z.boolean(),
  }),
  run: async (input, ctx) => {
    const adapter = authService.from(ctx);
    const result = await adapter.authenticate({
      bearerToken: input.token,
      requestId: ctx.requestId ?? 'unknown',
      surface: 'http',
    });

    if (result.isErr()) {
      return Result.ok({ error: result.error.message, valid: false });
    }

    const permit = result.value;
    if (!permit) {
      return Result.ok({ error: 'No credentials', valid: false });
    }

    return Result.ok({
      permit: { id: permit.id, scopes: [...permit.scopes] },
      valid: true,
    });
  },
  services: [authService],
});
