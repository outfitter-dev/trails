import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

import { createSignalTraceRecord, writeSignalTraceRecord } from '../index.js';

describe('@ontrails/core public barrel', () => {
  test('does not root-export helpers from internal modules', () => {
    const source = readFileSync(
      new URL('../index.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toMatch(/from ['"]\.\/internal\//);
  });

  test('exports signal trace helpers from the intrinsic tracing owner', () => {
    expect(typeof createSignalTraceRecord).toBe('function');
    expect(typeof writeSignalTraceRecord).toBe('function');
  });
});
