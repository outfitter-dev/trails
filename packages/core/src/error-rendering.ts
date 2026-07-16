import type { ErrorCategory } from './errors.js';
import { isTrailsError } from './errors.js';
import { createRedactor } from './redaction/index.js';

const errorRedactor = createRedactor();

export const INTERNAL_ERROR_PUBLIC_MESSAGE = 'Internal server error';

export interface ErrorDiagnosticsRendering {
  readonly category?: ErrorCategory | undefined;
  readonly context?: Record<string, unknown> | undefined;
  readonly message: string;
  readonly name: string;
  readonly retryable?: boolean | undefined;
  readonly stack?: string | undefined;
}

export interface PublicErrorRendering {
  readonly category: ErrorCategory;
  readonly message: string;
  readonly name: string;
  readonly retryable: boolean;
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

export const renderErrorDiagnostics = (
  error: Error
): ErrorDiagnosticsRendering => {
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

/**
 * Render an error through the shared public redaction policy.
 *
 * @example
 * ```ts
 * const rendering = renderPublicError(new NotFoundError('missing'));
 * ```
 */
export const renderPublicError = (error: Error): PublicErrorRendering => {
  if (isTrailsError(error)) {
    return {
      category: error.category,
      message:
        error.category === 'internal'
          ? INTERNAL_ERROR_PUBLIC_MESSAGE
          : redactErrorString(error.message),
      name: error.name,
      retryable: error.retryable,
    };
  }

  return {
    category: 'internal',
    message: INTERNAL_ERROR_PUBLIC_MESSAGE,
    name: 'InternalError',
    retryable: false,
  };
};
