import { Result } from '@ontrails/core';

import type { AuthAdapter, AuthError } from './adapter.js';
import type { PermitExtractionInput } from '../extraction.js';
import type { Permit } from '../permit.js';

/** Credential selection and lookup for a token-callback auth adapter. */
export interface TokenCallbackAdapterOptions {
  /**
   * Select one trusted source before verification. Undefined means absence;
   * an empty string means a selected but malformed credential. Preserve the
   * accepted token bytes and never treat verification failure as absence.
   */
  readonly extractToken: (input: PermitExtractionInput) => string | undefined;
  /**
   * Verify the already-selected token through a portable store or provider.
   * Null means lookup miss and becomes invalid_token, never anonymous access.
   * The original input supports correlation; do not use it to retry selection.
   */
  readonly lookup: (
    token: string,
    input: PermitExtractionInput
  ) => Promise<Result<Permit | null, AuthError>>;
}

/**
 * Delegate opaque-token verification while preserving absence versus failure.
 *
 * Extraction and lookup run at most once. Exceptions become sanitized auth
 * errors. Runtime permit validation remains in the shared auth boundary.
 *
 * @example
 * const adapter = createTokenCallbackAdapter({
 *   extractToken: input => input.apiKey,
 *   lookup: async token => Result.ok(await keys.get(token)),
 * });
 */
export const createTokenCallbackAdapter = (
  options: TokenCallbackAdapterOptions
): AuthAdapter => ({
  authenticate: async (input) => {
    try {
      const token = options.extractToken(input);
      if (token === undefined) {
        return Result.ok(null);
      }
      if (token.length === 0) {
        return Result.err({
          code: 'invalid_token',
          message: 'Selected credential is empty',
        });
      }
      const result = await options.lookup(token, input);
      if (result.isErr()) {
        return result;
      }
      if (result.value === null) {
        return Result.err({
          code: 'invalid_token',
          message: 'Selected credential was not found',
        });
      }
      return result;
    } catch {
      return Result.err({
        code: 'invalid_token',
        message: 'Credential callback failed',
      });
    }
  },
});
