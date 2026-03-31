import { PermissionError } from '@ontrails/core';

/**
 * Error returned when permit scope enforcement fails.
 *
 * Extends `PermissionError` (category `'permission'`, HTTP 403) because
 * it represents an *authorization* failure — the caller's identity is known
 * but lacks the required scopes.
 */
export class PermitError extends PermissionError {
  constructor(
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message, options);
    this.name = 'PermitError';
  }
}
