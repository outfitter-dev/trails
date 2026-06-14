import { describe, expect, test } from 'bun:test';

import {
  AuthError,
  CancelledError,
  ConflictError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  WorkspaceShiftError,
} from '@ontrails/core';

import {
  LibraryAuthError,
  LibraryCancelledError,
  LibraryConflictError,
  LibraryInternalError,
  LibraryNetworkError,
  LibraryNotFoundError,
  LibraryPermissionError,
  LibraryRateLimitError,
  LibraryShiftError,
  LibraryTimeoutError,
  LibraryValidationError,
  toLibraryError,
} from '../errors.js';

describe('library error mapping', () => {
  test('maps TrailsError categories to package-facing error classes', () => {
    const cases = [
      {
        ErrorClass: LibraryValidationError,
        error: new ValidationError('bad'),
      },
      {
        ErrorClass: LibraryNotFoundError,
        error: new NotFoundError('missing'),
      },
      { ErrorClass: LibraryConflictError, error: new ConflictError('dupe') },
      {
        ErrorClass: LibraryPermissionError,
        error: new PermissionError('denied'),
      },
      { ErrorClass: LibraryTimeoutError, error: new TimeoutError('slow') },
      {
        ErrorClass: LibraryRateLimitError,
        error: new RateLimitError('wait'),
      },
      { ErrorClass: LibraryNetworkError, error: new NetworkError('offline') },
      {
        ErrorClass: LibraryShiftError,
        error: new WorkspaceShiftError('workspace moved'),
      },
      { ErrorClass: LibraryInternalError, error: new InternalError('boom') },
      { ErrorClass: LibraryAuthError, error: new AuthError('login') },
      { ErrorClass: LibraryCancelledError, error: new CancelledError('stop') },
    ] as const;

    for (const { ErrorClass, error } of cases) {
      const mapped = toLibraryError(error);
      expect(mapped).toBeInstanceOf(ErrorClass);
      expect(mapped.category).toBe(error.category);
      expect(mapped.retryable).toBe(error.retryable);
      expect(mapped.originalName).toBe(error.name);
    }
  });

  test('preserves category, retryability, and original Trails error name', () => {
    const mapped = toLibraryError(new NotFoundError('Widget not found'));

    expect(mapped).toMatchObject({
      category: 'not_found',
      message: 'Widget not found',
      name: 'LibraryNotFoundError',
      originalName: 'NotFoundError',
      retryable: false,
    });
  });

  test('redacts internal and unknown errors at the package boundary', () => {
    const internal = toLibraryError(new InternalError('token=secret'));
    const native = toLibraryError(new Error('token=secret'));

    expect(internal).toBeInstanceOf(LibraryInternalError);
    expect(native).toBeInstanceOf(LibraryInternalError);
    expect(internal.message).toBe('Internal server error');
    expect(native.message).toBe('Internal server error');
    expect(internal.originalName).toBe('InternalError');
    expect(native.originalName).toBe('Error');
  });

  test('is idempotent for already package-facing errors', () => {
    const error = new LibraryNotFoundError('missing');

    expect(toLibraryError(error)).toBe(error);
  });
});
