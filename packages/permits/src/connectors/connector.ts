import type { Result } from '@ontrails/core';

import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

/**
 * @deprecated Use {@link PermitExtractionInput} instead. Kept as an alias
 * for backward compatibility during migration.
 */
export type AuthCredentials = PermitExtractionInput;

/** Errors from auth connectors. */
export interface AuthError {
  readonly code:
    | 'expired_token'
    | 'insufficient_scope'
    | 'invalid_token'
    | 'missing_credentials';
  readonly message: string;
}

/**
 * Auth connector port. Given extraction input, produce a permit or an error.
 *
 * The connector receives the full {@link PermitExtractionInput} — trailhead,
 * headers, requestId, and credential fields — so it can make richer
 * decisions (e.g., rate-limit by trailhead or correlate via requestId).
 *
 * Deliberately narrow — no session management, no token refresh.
 */
export interface AuthConnector {
  readonly authenticate: (
    input: PermitExtractionInput
  ) => Promise<Result<Permit | null, AuthError>>;
}
