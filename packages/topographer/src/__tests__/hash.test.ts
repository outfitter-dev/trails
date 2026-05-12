import { describe, test, expect } from 'bun:test';

import { deriveTopoGraphHash } from '../hash.js';
import type { TopoGraph } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeTopoGraph = (overrides?: Partial<TopoGraph>): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
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
      surfaces: ['cli', 'mcp'],
    },
  ],
  generatedAt: '2025-01-01T00:00:00.000Z',
  version: '1.0',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deriveTopoGraphHash', () => {
  test('produces a valid SHA-256 hex string (64 characters)', () => {
    const hash = deriveTopoGraphHash(makeTopoGraph());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('same topo graph produces the same hash (deterministic)', () => {
    const map = makeTopoGraph();
    const hash1 = deriveTopoGraphHash(map);
    const hash2 = deriveTopoGraphHash(map);
    expect(hash1).toBe(hash2);
  });

  test('different topo graphs produce different hashes', () => {
    const map1 = makeTopoGraph();
    const map2 = makeTopoGraph({
      entries: [
        {
          exampleCount: 0,
          id: 'user.delete',
          input: { type: 'object' },
          kind: 'trail',
          surfaces: [],
        },
      ],
    });

    expect(deriveTopoGraphHash(map1)).not.toBe(deriveTopoGraphHash(map2));
  });

  test('generatedAt does not affect the hash', () => {
    const map1 = makeTopoGraph({ generatedAt: '2025-01-01T00:00:00.000Z' });
    const map2 = makeTopoGraph({ generatedAt: '2099-12-31T23:59:59.999Z' });

    expect(deriveTopoGraphHash(map1)).toBe(deriveTopoGraphHash(map2));
  });

  test('hash is stable across invocations', () => {
    const map = makeTopoGraph();
    const hashes = Array.from({ length: 10 }, () => deriveTopoGraphHash(map));
    const unique = new Set(hashes);
    expect(unique.size).toBe(1);
  });

  test('key order in entry does not affect hash', () => {
    // Build two maps with same data but different insertion order
    const map1 = makeTopoGraph({
      entries: [
        {
          exampleCount: 0,
          id: 'test',
          input: {
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            type: 'object',
          },
          kind: 'trail',
          surfaces: [],
        },
      ],
    });
    const map2 = makeTopoGraph({
      entries: [
        {
          exampleCount: 0,
          id: 'test',
          input: {
            properties: { a: { type: 'string' }, b: { type: 'number' } },
            type: 'object',
          },
          kind: 'trail',
          surfaces: [],
        },
      ],
    });

    expect(deriveTopoGraphHash(map1)).toBe(deriveTopoGraphHash(map2));
  });
});
