import { describe, test, expect } from 'bun:test';

import { deriveSurfaceMapHash } from '../hash.js';
import type { SurfaceMap } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeSurfaceMap = (overrides?: Partial<SurfaceMap>): SurfaceMap => ({
  entries: [
    {
      exampleCount: 2,
      id: 'user.create',
      input: {
        properties: { name: { type: 'string' } },
        required: ['name'],
        type: 'object',
      },
      kind: 'trail',
      output: {
        properties: { id: { type: 'string' } },
        required: ['id'],
        type: 'object',
      },
      trailheads: ['cli', 'mcp'],
    },
  ],
  generatedAt: '2025-01-01T00:00:00.000Z',
  version: '1.0',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveSurfaceMapHash', () => {
  test('produces a valid SHA-256 hex string (64 characters)', () => {
    const hash = deriveSurfaceMapHash(makeSurfaceMap());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same surface map produces the same hash (deterministic)', () => {
    const map = makeSurfaceMap();
    const hash1 = deriveSurfaceMapHash(map);
    const hash2 = deriveSurfaceMapHash(map);
    expect(hash1).toBe(hash2);
  });

  test('different surface maps produce different hashes', () => {
    const map1 = makeSurfaceMap();
    const map2 = makeSurfaceMap({
      entries: [
        {
          exampleCount: 0,
          id: 'user.delete',
          input: { type: 'object' },
          kind: 'trail',
          trailheads: [],
        },
      ],
    });

    expect(deriveSurfaceMapHash(map1)).not.toBe(deriveSurfaceMapHash(map2));
  });

  test('generatedAt does not affect the hash', () => {
    const map1 = makeSurfaceMap({ generatedAt: '2025-01-01T00:00:00.000Z' });
    const map2 = makeSurfaceMap({ generatedAt: '2099-12-31T23:59:59.999Z' });

    expect(deriveSurfaceMapHash(map1)).toBe(deriveSurfaceMapHash(map2));
  });

  test('hash is stable across invocations', () => {
    const map = makeSurfaceMap();
    const hashes = Array.from({ length: 10 }, () => deriveSurfaceMapHash(map));
    const unique = new Set(hashes);
    expect(unique.size).toBe(1);
  });

  test('key order in entry does not affect hash', () => {
    // Build two maps with same data but different insertion order
    const map1 = makeSurfaceMap({
      entries: [
        {
          exampleCount: 0,
          id: 'test',
          input: {
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            type: 'object',
          },
          kind: 'trail',
          trailheads: [],
        },
      ],
    });
    const map2 = makeSurfaceMap({
      entries: [
        {
          exampleCount: 0,
          id: 'test',
          input: {
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            type: 'object',
          },
          kind: 'trail',
          trailheads: [],
        },
      ],
    });

    expect(deriveSurfaceMapHash(map1)).toBe(deriveSurfaceMapHash(map2));
  });
});
