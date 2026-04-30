import { describe, expect, test } from 'bun:test';

import { intentValues } from '@ontrails/core';

import {
  deriveHttpInputSource,
  deriveHttpMethod,
  deriveHttpOperationMethod,
  httpMethodByIntent,
} from '../method.js';

describe('HTTP method derivation', () => {
  test('method map covers the core intent vocabulary', () => {
    expect(Object.keys(httpMethodByIntent).toSorted()).toEqual(
      [...intentValues].toSorted()
    );
  });

  test('derives route and OpenAPI methods from one owner table', () => {
    expect(deriveHttpMethod('read')).toBe('GET');
    expect(deriveHttpOperationMethod('read')).toBe('get');
    expect(deriveHttpMethod('write')).toBe('POST');
    expect(deriveHttpOperationMethod('write')).toBe('post');
    expect(deriveHttpMethod('destroy')).toBe('DELETE');
    expect(deriveHttpOperationMethod('destroy')).toBe('delete');
  });

  test('falls back to POST for invalid runtime intent values', () => {
    expect(deriveHttpMethod('custom' as never)).toBe('POST');
    expect(deriveHttpOperationMethod('custom' as never)).toBe('post');
  });

  test('derives input source from the HTTP method', () => {
    expect(deriveHttpInputSource('GET')).toBe('query');
    expect(deriveHttpInputSource('POST')).toBe('body');
    expect(deriveHttpInputSource('DELETE')).toBe('body');
  });
});
