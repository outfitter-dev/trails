/* oxlint-disable max-classes-per-file -- package-facing error taxonomy stays co-located */
import {
  INTERNAL_ERROR_PUBLIC_MESSAGE,
  createSurfaceErrorMapper,
  isTrailsError,
  redactErrorString,
} from '@ontrails/core';
import type { ErrorCategory, TrailsError } from '@ontrails/core';

export interface LibraryErrorOptions {
  readonly cause?: Error | undefined;
  readonly originalName?: string | undefined;
}

/** Base class for package-facing errors thrown or returned by the library surface. */
export class LibraryError extends Error {
  readonly category: ErrorCategory;
  readonly originalName: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: LibraryErrorOptions & {
      readonly category: ErrorCategory;
      readonly name: string;
      readonly retryable: boolean;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = options.name;
    this.category = options.category;
    this.originalName = options.originalName ?? options.cause?.name ?? 'Error';
    this.retryable = options.retryable;
  }
}

export class LibraryValidationError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'validation',
      name: 'LibraryValidationError',
      retryable: false,
    });
  }
}

export class LibraryNotFoundError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'not_found',
      name: 'LibraryNotFoundError',
      retryable: false,
    });
  }
}

export class LibraryConflictError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'conflict',
      name: 'LibraryConflictError',
      retryable: false,
    });
  }
}

export class LibraryPermissionError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'permission',
      name: 'LibraryPermissionError',
      retryable: false,
    });
  }
}

export class LibraryTimeoutError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'timeout',
      name: 'LibraryTimeoutError',
      retryable: true,
    });
  }
}

export class LibraryRateLimitError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'rate_limit',
      name: 'LibraryRateLimitError',
      retryable: true,
    });
  }
}

export class LibraryNetworkError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'network',
      name: 'LibraryNetworkError',
      retryable: true,
    });
  }
}

export class LibraryShiftError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'shift',
      name: 'LibraryShiftError',
      retryable: true,
    });
  }
}

export class LibraryInternalError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'internal',
      name: 'LibraryInternalError',
      retryable: false,
    });
  }
}

export class LibraryAuthError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'auth',
      name: 'LibraryAuthError',
      retryable: false,
    });
  }
}

export class LibraryCancelledError extends LibraryError {
  constructor(message: string, options?: LibraryErrorOptions) {
    super(message, {
      ...options,
      category: 'cancelled',
      name: 'LibraryCancelledError',
      retryable: false,
    });
  }
}

const libraryErrorClasses = {
  auth: LibraryAuthError,
  cancelled: LibraryCancelledError,
  conflict: LibraryConflictError,
  internal: LibraryInternalError,
  network: LibraryNetworkError,
  not_found: LibraryNotFoundError,
  permission: LibraryPermissionError,
  rate_limit: LibraryRateLimitError,
  shift: LibraryShiftError,
  timeout: LibraryTimeoutError,
  validation: LibraryValidationError,
} as const;

const mapLibraryErrorClass = createSurfaceErrorMapper(libraryErrorClasses);

const publicMessage = (error: TrailsError): string =>
  error.category === 'internal'
    ? INTERNAL_ERROR_PUBLIC_MESSAGE
    : redactErrorString(error.message);

export const toLibraryError = (error: Error): LibraryError => {
  if (error instanceof LibraryError) {
    return error;
  }

  if (!isTrailsError(error)) {
    return new LibraryInternalError(INTERNAL_ERROR_PUBLIC_MESSAGE, {
      cause: error,
      originalName: error.name || 'Error',
    });
  }

  const ErrorClass = mapLibraryErrorClass(error);
  return new ErrorClass(publicMessage(error), {
    cause: error,
    originalName: error.name,
  });
};
