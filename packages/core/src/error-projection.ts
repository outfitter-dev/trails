import type { ErrorCategory } from './errors.js';
import { isTrailsError } from './errors.js';
import { createRedactor } from './redaction/index.js';

const errorRedactor = createRedactor();

export const INTERNAL_ERROR_PUBLIC_MESSAGE = 'Internal server error';

export interface ErrorDiagnosticsProjection {
  readonly category?: ErrorCategory | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly message: string;
  readonly name: string;
  readonly retryable?: boolean | undefined;
  readonly stack?: string | undefined;
}

export const redactErrorString = (value: string): string =>
  errorRedactor.redact(value);

export const redactErrorContext = (
  context: Record<string, unknown> | undefined
): Record<string, unknown> | undefined =>
  context === undefined ? undefined : errorRedactor.redactObject(context);

export const redactErrorStack = (
  stack: string | undefined
): string | undefined =>
  stack === undefined ? undefined : redactErrorString(stack);

export const projectErrorDiagnostics = (
  error: Error
): ErrorDiagnosticsProjection => {
  const context = isTrailsError(error)
    ? redactErrorContext(error.context)
    : undefined;
  const stack = redactErrorStack(error.stack);

  return {
    ...(isTrailsError(error)
      ? {
          category: error.category,
          retryable: error.retryable,
        }
      : {}),
    ...(context === undefined ? {} : { context }),
    message: redactErrorString(error.message),
    name: error.name || error.constructor.name || 'Error',
    ...(stack === undefined ? {} : { stack }),
  };
};
