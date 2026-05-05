import { z } from 'zod';
import type { Result } from '@ontrails/core';

import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

/** Errors from auth connectors. */
export const authErrorSchema = z
  .object({
    code: z.enum([
      'expired_token',
      'insufficient_scope',
      'invalid_token',
      'missing_credentials',
    ]),
    message: z.string(),
  })
  .readonly();

export type AuthError = z.infer<typeof authErrorSchema>;

export const authConnectorSchema = z
  .object({
    authenticate: z.function(),
  })
  .readonly();

/**
 * Auth connector port. Given extraction input, produce a permit or an error.
 *
 * The connector receives the full {@link PermitExtractionInput} — surface,
 * headers, requestId, and credential fields — so it can make richer
 * decisions (e.g., rate-limit by surface or correlate via requestId).
 *
 * Deliberately narrow — no session management, no token refresh.
 */
export interface AuthConnector {
  readonly authenticate: (
    input: PermitExtractionInput
  ) => Promise<Result<Permit | null, AuthError>>;
}
