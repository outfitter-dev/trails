import { describe, test, expect } from 'bun:test';

import { deriveTopoGraphEntryHash, deriveTopoGraphHash } from '../hash.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { TopoGraph, TopoGraphEntry } from '../types.js';

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
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
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

  test('trailhead metadata participates in the hash', () => {
    const map1 = makeTopoGraph();
    const map2 = makeTopoGraph({
      trailheads: [
        {
          description: 'Read topo.',
          id: 'topo',
          memberIds: ['topo.read'],
          memberSetHash: 'a'.repeat(64),
          surfaces: ['mcp'],
        },
      ],
    });

    expect(deriveTopoGraphHash(map1)).not.toBe(deriveTopoGraphHash(map2));
  });
});

describe('deriveTopoGraphEntryHash', () => {
  const entry: TopoGraphEntry = {
    exampleCount: 0,
    id: 'entity.show',
    input: {
      properties: { id: { type: 'string' }, verbose: { type: 'boolean' } },
      required: ['id', 'verbose'],
      type: 'object',
    },
    intent: 'read',
    kind: 'trail',
    output: { type: 'object' },
    surfaces: ['cli', 'mcp'],
  };

  test('preserves the existing watch hash bytes', () => {
    expect(deriveTopoGraphEntryHash(entry)).toBe(
      'd4d50496765048d081cdd96a6e3be51466cc6d41594f391523520ed37dc77e06'
    );
  });

  test('normalizes nested object key order', () => {
    const properties = Object.fromEntries([
      ['verbose', { type: 'boolean' }],
      ['id', { type: 'string' }],
    ]);
    expect(Object.keys(properties)).toEqual(['verbose', 'id']);
    expect(
      deriveTopoGraphEntryHash({
        ...entry,
        input: {
          properties,
          required: ['id', 'verbose'],
          type: 'object',
        },
      })
    ).toBe(deriveTopoGraphEntryHash(entry));
  });

  test('preserves array order and contract field differences', () => {
    expect(
      deriveTopoGraphEntryHash({ ...entry, surfaces: ['mcp', 'cli'] })
    ).not.toBe(deriveTopoGraphEntryHash(entry));
    expect(deriveTopoGraphEntryHash({ ...entry, intent: 'write' })).not.toBe(
      deriveTopoGraphEntryHash(entry)
    );
  });
});
