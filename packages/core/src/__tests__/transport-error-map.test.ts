import type { TrailsError } from '../errors.js';

import { describe, expect, test } from 'bun:test';

import {
  CancelledError,
  NetworkError,
  NotFoundError,
  RetryExhaustedError,
  ValidationError,
  codesByCategory,
  errorCategories,
  exitCodeMap,
  jsonRpcCodeMap,
  statusCodeMap,
} from '../errors.js';
import {
  createSurfaceErrorMapper,
  mapSurfaceError,
  projectErrorClassSurface,
  projectSurfaceError,
  surfaceErrorMap,
  surfaceErrorRegistry,
  surfaceNames,
} from '../transport-error-map.js';
import { fixedErrorEntries } from './test-helpers.js';
import type { TestErrorConstructor } from './test-helpers.js';

const instantiate = (ctor: unknown, message: string): TrailsError =>
  new (ctor as TestErrorConstructor)(message);

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

describe('mapSurfaceError', () => {
  const expectedMappings: readonly {
    readonly error: TrailsError;
    readonly name: string;
    readonly values: {
      readonly cli: number;
      readonly http: number;
      readonly jsonRpc: number;
      readonly mcp: number;
    };
  }[] = [
    ...fixedErrorEntries.map((entry) => ({
      error: instantiate(entry.ctor, `test ${entry.name}`),
      name: entry.name,
      values: {
        cli: codesByCategory[entry.category].exit,
        http: codesByCategory[entry.category].http,
        jsonRpc: codesByCategory[entry.category].jsonRpc,
        mcp: codesByCategory[entry.category].jsonRpc,
      },
    })),
    {
      error: new RetryExhaustedError(new NotFoundError('missing'), {
        attempts: 5,
        detour: 'recoverMissing',
      }),
      name: 'RetryExhaustedError<NotFoundError>',
      values: { cli: 2, http: 404, jsonRpc: -32_601, mcp: -32_601 },
    },
  ];

  test('maps known error instances through each registered surface', () => {
    const validation = new ValidationError('bad input');
    const notFound = new NotFoundError('missing');
    const network = new NetworkError('offline');
    const cancelled = new CancelledError('cancelled');

    expect(mapSurfaceError('cli', validation)).toBe(1);
    expect(mapSurfaceError('http', notFound)).toBe(404);
    expect(mapSurfaceError('jsonRpc', notFound)).toBe(-32_601);
    expect(mapSurfaceError('mcp', notFound)).toBe(-32_601);
    expect(mapSurfaceError('http', network)).toBe(502);
    expect(mapSurfaceError('cli', cancelled)).toBe(130);
  });

  test.each(expectedMappings)(
    'maps $name across CLI, HTTP, and JSON-RPC codes',
    ({ error, values }) => {
      expect(mapSurfaceError('cli', error)).toBe(values.cli);
      expect(mapSurfaceError('http', error)).toBe(values.http);
      expect(mapSurfaceError('jsonRpc', error)).toBe(values.jsonRpc);
      expect(mapSurfaceError('mcp', error)).toBe(values.mcp);
    }
  );
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
  test('projects every fixed error class name without constructing errors', () => {
    for (const entry of fixedErrorEntries) {
      expect(projectErrorClassSurface('http', entry.name)).toEqual({
        category: entry.category,
        code: codesByCategory[entry.category].http,
        name: entry.name,
        retryable: entry.retryable,
        surface: 'http',
      });
    }
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
