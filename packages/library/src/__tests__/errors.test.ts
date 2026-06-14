import { describe, expect, test } from 'bun:test';

import {
  InternalError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from '@ontrails/core';

import {
  LibraryInternalError,
  LibraryNetworkError,
  LibraryNotFoundError,
  LibraryValidationError,
  toLibraryError,
} from '../errors.js';

describe('library error mapping', () => {
  test('maps TrailsError categories to package-facing error classes', () => {
    expect(toLibraryError(new ValidationError('bad'))).toBeInstanceOf(
      LibraryValidationError
    );
    expect(toLibraryError(new NotFoundError('missing'))).toBeInstanceOf(
      LibraryNotFoundError
    );
    expect(toLibraryError(new NetworkError('offline'))).toBeInstanceOf(
      LibraryNetworkError
    );
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
