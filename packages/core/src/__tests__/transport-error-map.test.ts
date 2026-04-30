import type { TrailsError } from '../errors.js';

import { describe, expect, test } from 'bun:test';

import {
  AlreadyExistsError,
  AmbiguousError,
  AssertionError,
  AuthError,
  CancelledError,
  ConflictError,
  DerivationError,
  InternalError,
  NetworkError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  RetryExhaustedError,
  TimeoutError,
  ValidationError,
  errorCategories,
  exitCodeMap,
  jsonRpcCodeMap,
  statusCodeMap,
} from '../errors.js';
import {
  createSurfaceErrorMapper,
  createTransportErrorMapper,
  mapSurfaceError,
  mapTransportError,
  projectErrorClassSurface,
  projectSurfaceError,
  surfaceErrorMap,
  surfaceErrorRegistry,
  surfaceNames,
  transportErrorMap,
  transportErrorRegistry,
  transportNames,
} from '../transport-error-map.js';

describe('surfaceErrorMap', () => {
  test('covers every error category for every surface', () => {
    for (const surface of surfaceNames) {
      const mappings = surfaceErrorMap[surface];
      for (const category of errorCategories) {
        expect(category in mappings).toBe(true);
      }
    }
  });

  test('reuses the owner-held public code maps', () => {
    expect(surfaceErrorMap.cli).toBe(exitCodeMap);
    expect(surfaceErrorMap.http).toBe(statusCodeMap);
    expect(surfaceErrorMap.jsonRpc).toBe(jsonRpcCodeMap);
    expect(surfaceErrorMap.mcp).toBe(jsonRpcCodeMap);
  });
});

describe('surfaceErrorRegistry', () => {
  test('exposes a callable mapper for each surface', () => {
    const notFound = new NotFoundError('missing');

    expect(surfaceErrorRegistry.cli.map(notFound)).toBe(2);
    expect(surfaceErrorRegistry.http.map(notFound)).toBe(404);
    expect(surfaceErrorRegistry.jsonRpc.map(notFound)).toBe(-32_601);
    expect(surfaceErrorRegistry.mcp.map(notFound)).toBe(-32_601);
  });
});

describe('transportErrorMap', () => {
  test('covers every error category for every transport', () => {
    for (const transport of transportNames) {
      const mappings = transportErrorMap[transport];
      for (const category of errorCategories) {
        expect(category in mappings).toBe(true);
      }
    }
  });

  test('reuses the existing public transport maps', () => {
    expect(transportErrorMap.cli).toBe(surfaceErrorMap.cli);
    expect(transportErrorMap.http).toBe(surfaceErrorMap.http);
    expect(transportErrorMap.mcp).toBe(surfaceErrorMap.mcp);
  });
});

describe('transportErrorRegistry', () => {
  test('exposes a callable mapper for each transport', () => {
    const notFound = new NotFoundError('missing');

    expect(transportErrorRegistry.cli.map(notFound)).toBe(2);
    expect(transportErrorRegistry.http.map(notFound)).toBe(404);
    expect(transportErrorRegistry.mcp.map(notFound)).toBe(-32_601);
  });
});

describe('mapTransportError', () => {
  const expectedMappings: readonly {
    readonly error: TrailsError;
    readonly name: string;
    readonly values: {
      readonly cli: number;
      readonly http: number;
      readonly mcp: number;
    };
  }[] = [
    {
      error: new ValidationError('bad input'),
      name: 'ValidationError',
      values: { cli: 1, http: 400, mcp: -32_602 },
    },
    {
      error: new AmbiguousError('ambiguous input'),
      name: 'AmbiguousError',
      values: { cli: 1, http: 400, mcp: -32_602 },
    },
    {
      error: new NotFoundError('missing'),
      name: 'NotFoundError',
      values: { cli: 2, http: 404, mcp: -32_601 },
    },
    {
      error: new AlreadyExistsError('exists'),
      name: 'AlreadyExistsError',
      values: { cli: 3, http: 409, mcp: -32_603 },
    },
    {
      error: new ConflictError('conflict'),
      name: 'ConflictError',
      values: { cli: 3, http: 409, mcp: -32_603 },
    },
    {
      error: new PermissionError('forbidden'),
      name: 'PermissionError',
      values: { cli: 4, http: 403, mcp: -32_600 },
    },
    {
      error: new TimeoutError('timed out'),
      name: 'TimeoutError',
      values: { cli: 5, http: 504, mcp: -32_603 },
    },
    {
      error: new RateLimitError('too many requests'),
      name: 'RateLimitError',
      values: { cli: 6, http: 429, mcp: -32_603 },
    },
    {
      error: new NetworkError('offline'),
      name: 'NetworkError',
      values: { cli: 7, http: 502, mcp: -32_603 },
    },
    {
      error: new InternalError('internal'),
      name: 'InternalError',
      values: { cli: 8, http: 500, mcp: -32_603 },
    },
    {
      error: new AssertionError('assertion failed'),
      name: 'AssertionError',
      values: { cli: 8, http: 500, mcp: -32_603 },
    },
    {
      error: new DerivationError('derivation failed'),
      name: 'DerivationError',
      values: { cli: 8, http: 500, mcp: -32_603 },
    },
    {
      error: new AuthError('unauthorized'),
      name: 'AuthError',
      values: { cli: 9, http: 401, mcp: -32_600 },
    },
    {
      error: new CancelledError('cancelled'),
      name: 'CancelledError',
      values: { cli: 130, http: 499, mcp: -32_603 },
    },
    {
      error: new RetryExhaustedError(new NotFoundError('missing'), {
        attempts: 5,
        detour: 'recoverMissing',
      }),
      name: 'RetryExhaustedError<NotFoundError>',
      values: { cli: 2, http: 404, mcp: -32_601 },
    },
  ];

  test('maps known error instances through each registered transport', () => {
    const validation = new ValidationError('bad input');
    const notFound = new NotFoundError('missing');
    const network = new NetworkError('offline');
    const cancelled = new CancelledError('cancelled');

    expect(mapTransportError('cli', validation)).toBe(1);
    expect(mapTransportError('http', notFound)).toBe(404);
    expect(mapTransportError('mcp', notFound)).toBe(-32_601);
    expect(mapTransportError('http', network)).toBe(502);
    expect(mapTransportError('cli', cancelled)).toBe(130);
  });

  test.each(expectedMappings)(
    'maps $name across CLI, HTTP, and JSON-RPC codes',
    ({ error, values }) => {
      expect(mapTransportError('cli', error)).toBe(values.cli);
      expect(mapTransportError('http', error)).toBe(values.http);
      expect(mapTransportError('mcp', error)).toBe(values.mcp);
    }
  );
});

describe('mapSurfaceError', () => {
  test('maps known error instances through public surface names', () => {
    const notFound = new NotFoundError('missing');

    expect(mapSurfaceError('cli', notFound)).toBe(2);
    expect(mapSurfaceError('http', notFound)).toBe(404);
    expect(mapSurfaceError('jsonRpc', notFound)).toBe(-32_601);
    expect(mapSurfaceError('mcp', notFound)).toBe(-32_601);
  });

  test('keeps mapTransportError as a compatibility alias', () => {
    const error = new ValidationError('bad input');

    expect(mapTransportError('cli', error)).toBe(mapSurfaceError('cli', error));
    expect(mapTransportError('http', error)).toBe(
      mapSurfaceError('http', error)
    );
    expect(mapTransportError('mcp', error)).toBe(mapSurfaceError('mcp', error));
  });
});

describe('projectSurfaceError', () => {
  test('returns surface metadata for a runtime error', () => {
    const error = new RetryExhaustedError(new NotFoundError('missing'), {
      attempts: 5,
      detour: 'recoverMissing',
    });

    expect(projectSurfaceError('http', error)).toEqual({
      category: 'not_found',
      code: 404,
      message: 'Recovery exhausted after 5 attempts: missing',
      name: 'RetryExhaustedError',
      retryable: false,
      surface: 'http',
    });
  });
});

describe('projectErrorClassSurface', () => {
  test('projects fixed error class names without constructing errors', () => {
    expect(projectErrorClassSurface('http', 'DerivationError')).toEqual({
      category: 'internal',
      code: 500,
      name: 'DerivationError',
      retryable: false,
      surface: 'http',
    });
    expect(projectErrorClassSurface('mcp', 'PermissionError')).toEqual({
      category: 'permission',
      code: -32_600,
      name: 'PermissionError',
      retryable: false,
      surface: 'mcp',
    });
  });

  test('does not invent fixed projections for dynamic or unknown class names', () => {
    expect(
      projectErrorClassSurface('http', 'RetryExhaustedError')
    ).toBeUndefined();
    expect(projectErrorClassSurface('http', 'CustomError')).toBeUndefined();
  });
});

describe('createSurfaceErrorMapper', () => {
  test('uses the error category to project into surface-specific values', () => {
    const mapper = createSurfaceErrorMapper({
      auth: 'auth',
      cancelled: 'cancelled',
      conflict: 'conflict',
      internal: 'internal',
      network: 'network',
      not_found: 'not_found',
      permission: 'permission',
      rate_limit: 'rate_limit',
      timeout: 'timeout',
      validation: 'validation',
    });

    expect(mapper(new ValidationError('bad input'))).toBe('validation');
    expect(mapper(new NetworkError('offline'))).toBe('network');
    expect(mapper(new CancelledError('cancelled'))).toBe('cancelled');
  });
});

describe('createTransportErrorMapper', () => {
  test('uses the error category to project into transport-specific values', () => {
    const mapper = createTransportErrorMapper({
      auth: 'auth',
      cancelled: 'cancelled',
      conflict: 'conflict',
      internal: 'internal',
      network: 'network',
      not_found: 'not_found',
      permission: 'permission',
      rate_limit: 'rate_limit',
      timeout: 'timeout',
      validation: 'validation',
    });

    expect(mapper(new ValidationError('bad input'))).toBe('validation');
    expect(mapper(new NetworkError('offline'))).toBe('network');
    expect(mapper(new CancelledError('cancelled'))).toBe('cancelled');
  });
});
