import { describe, expect, test } from 'bun:test';

import {
  CancelledError,
  NetworkError,
  NotFoundError,
  ValidationError,
  errorCategories,
  exitCodeMap,
  jsonRpcCodeMap,
  statusCodeMap,
} from '../errors.js';
import {
  createTransportErrorMapper,
  mapTransportError,
  transportErrorMap,
  transportErrorRegistry,
  transportNames,
} from '../transport-error-map.js';

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
    expect(transportErrorMap.cli).toBe(exitCodeMap);
    expect(transportErrorMap.http).toBe(statusCodeMap);
    expect(transportErrorMap.mcp).toBe(jsonRpcCodeMap);
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
