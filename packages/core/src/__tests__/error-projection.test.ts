import { describe, expect, test } from 'bun:test';

import { InternalError, PermissionError } from '../errors.js';
import {
  INTERNAL_ERROR_PUBLIC_MESSAGE,
  projectErrorDiagnostics,
  redactErrorString,
} from '../error-projection.js';
import { projectPublicSurfaceError } from '../transport-error-map.js';

describe('error projection redaction', () => {
  test('redacts key-value secrets embedded in strings', () => {
    expect(redactErrorString('database password=secret')).toBe(
      'database [REDACTED]'
    );
    expect(redactErrorString('token=secret')).toBe('[REDACTED]');
    expect(
      redactErrorString('Malformed Authorization header; expected Bearer token')
    ).toBe('Malformed Authorization header; expected Bearer token');
  });

  test('projects TrailsError messages safely for public surfaces', () => {
    const error = new PermissionError('Denied Bearer abcdefghijklmnop', {
      context: { authorization: 'Bearer abcdefghijklmnop' },
    });

    expect(projectPublicSurfaceError('http', error)).toEqual({
      category: 'permission',
      code: 403,
      message: 'Denied [REDACTED]',
      name: 'PermissionError',
      retryable: false,
      surface: 'http',
    });
  });

  test('uses a generic public projection for unknown errors', () => {
    expect(projectPublicSurfaceError('mcp', new Error('token=secret'))).toEqual(
      {
        category: 'internal',
        code: -32_603,
        message: INTERNAL_ERROR_PUBLIC_MESSAGE,
        name: 'InternalError',
        retryable: false,
        surface: 'mcp',
      }
    );
  });

  test('uses a generic public message for internal TrailsError instances', () => {
    expect(
      projectPublicSurfaceError('http', new InternalError('panic'))
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

    expect(projectErrorDiagnostics(error)).toEqual({
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
