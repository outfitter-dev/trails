import { describe, expect, test } from 'bun:test';

import { InternalError, PermissionError } from '../errors.js';
import {
  INTERNAL_ERROR_PUBLIC_MESSAGE,
  renderPublicError,
  renderErrorDiagnostics,
  redactErrorString,
} from '../error-rendering.js';
import { renderPublicSurfaceError } from '../transport-error-map.js';

describe('error rendering redaction', () => {
  test('redacts key-value secrets embedded in strings', () => {
    expect(redactErrorString('database password=secret')).toBe(
      'database [REDACTED]'
    );
    expect(redactErrorString('token=secret')).toBe('[REDACTED]');
    expect(
      redactErrorString('Malformed Authorization header; expected Bearer token')
    ).toBe('Malformed Authorization header; expected Bearer token');
  });

  test('renders TrailsError messages safely for public surfaces', () => {
    const error = new PermissionError('Denied Bearer abcdefghijklmnop', {
      context: { authorization: 'Bearer abcdefghijklmnop' },
    });

    expect(renderPublicSurfaceError('http', error)).toEqual({
      category: 'permission',
      code: 403,
      message: 'Denied [REDACTED]',
      name: 'PermissionError',
      retryable: false,
      surface: 'http',
    });
  });

  test('uses a generic public rendering for unknown errors', () => {
    expect(renderPublicSurfaceError('mcp', new Error('token=secret'))).toEqual({
      category: 'internal',
      code: -32_603,
      message: INTERNAL_ERROR_PUBLIC_MESSAGE,
      name: 'InternalError',
      retryable: false,
      surface: 'mcp',
    });
  });

  test('projects one redacted public contract before surface mapping', () => {
    const error = new PermissionError('Denied token=secret');

    expect(renderPublicError(error)).toEqual({
      category: 'permission',
      message: 'Denied [REDACTED]',
      name: 'PermissionError',
      retryable: false,
    });
    expect(renderPublicError(new Error('token=secret'))).toEqual({
      category: 'internal',
      message: INTERNAL_ERROR_PUBLIC_MESSAGE,
      name: 'InternalError',
      retryable: false,
    });
  });

  test('keeps public projection parity while using CLI vocabulary', () => {
    const error = new Error('token=secret');

    expect(renderPublicSurfaceError('cli', error).message).toBe(
      'Internal error'
    );
    for (const surface of ['http', 'jsonRpc', 'mcp'] as const) {
      expect(renderPublicSurfaceError(surface, error).message).toBe(
        INTERNAL_ERROR_PUBLIC_MESSAGE
      );
    }
  });

  test('uses a generic public message for internal TrailsError instances', () => {
    expect(
      renderPublicSurfaceError('http', new InternalError('panic'))
    ).toEqual({
      category: 'internal',
      code: 500,
      message: INTERNAL_ERROR_PUBLIC_MESSAGE,
      name: 'InternalError',
      retryable: false,
      surface: 'http',
    });
  });

  test('redacts diagnostic message, context, and stack', () => {
    const error = new PermissionError('Denied Bearer abcdefghijklmnop', {
      context: {
        authorization: 'Bearer abcdefghijklmnop',
        requestId: 'req-1',
      },
    });
    error.stack = 'PermissionError: Denied Bearer abcdefghijklmnop';

    expect(renderErrorDiagnostics(error)).toEqual({
      category: 'permission',
      context: {
        authorization: '[REDACTED]',
        requestId: 'req-1',
      },
      message: 'Denied [REDACTED]',
      name: 'PermissionError',
      retryable: false,
      stack: 'PermissionError: Denied [REDACTED]',
    });
  });
});
