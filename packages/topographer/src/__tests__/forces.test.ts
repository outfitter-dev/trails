import { describe, expect, test } from 'bun:test';

import { annotateTopoGraphForces, stripTopoGraphForces } from '../forces.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type { DiffEntry, TopoGraph, TopoGraphEntry } from '../types.js';

const entry = (
  overrides: Partial<TopoGraphEntry> & { id: string }
): TopoGraphEntry => ({
  exampleCount: 0,
  kind: 'trail',
  surfaces: [],
  ...overrides,
});

const topoGraph = (entries: TopoGraphEntry[]): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries,
  generatedAt: '2026-05-20T00:00:00.000Z',
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

describe('annotateTopoGraphForces', () => {
  test('records modified force events on the affected entry', () => {
    const graph = topoGraph([entry({ id: 'hello' })]);
    const diff: DiffEntry = {
      change: 'modified',
      details: ['Required input field "name" added'],
      id: 'hello',
      kind: 'trail',
      severity: 'breaking',
    };

    const annotated = annotateTopoGraphForces(graph, [diff], {
      acceptedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(annotated.entries[0]?.forces?.[0]).toMatchObject({
      change: 'modified',
      detail: 'Required input field "name" added',
      id: 'hello',
      kind: 'trail',
    });
    expect(annotated.forces).toBeUndefined();
  });

  test('records removed force events on the graph without tombstone entries', () => {
    const graph = topoGraph([]);
    const diff: DiffEntry = {
      change: 'removed',
      details: ['Trail "bye" removed'],
      id: 'bye',
      kind: 'trail',
      severity: 'breaking',
    };

    const annotated = annotateTopoGraphForces(graph, [diff], {
      acceptedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(annotated.entries).toEqual([]);
    expect(annotated.forces?.[0]).toMatchObject({
      change: 'removed',
      detail: 'Trail "bye" removed',
      id: 'bye',
      kind: 'trail',
    });
  });
});

describe('stripTopoGraphForces', () => {
  test('removes entry and graph force metadata for live graph comparison', () => {
    const graph = annotateTopoGraphForces(
      topoGraph([entry({ id: 'hello' })]),
      [
        {
          change: 'modified',
          details: ['Required input field "name" added'],
          id: 'hello',
          kind: 'trail',
          severity: 'breaking',
        },
      ],
      { acceptedAt: '2026-05-20T00:00:00.000Z' }
    );

    const stripped = stripTopoGraphForces({
      ...graph,
      forces: [
        {
          acceptedAt: '2026-05-20T00:00:00.000Z',
          change: 'removed',
          detail: 'Trail "bye" removed',
          id: 'bye',
          kind: 'trail',
          severity: 'breaking',
          source: 'trails compile --force',
        },
      ],
    });

    expect(stripped.forces).toBeUndefined();
    expect(stripped.entries[0]?.forces).toBeUndefined();
  });
});
