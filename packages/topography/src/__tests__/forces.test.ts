import { describe, expect, spyOn, test } from 'bun:test';

import { ValidationError } from '@ontrails/core';

import {
  annotateTopoGraphForces,
  carryForwardTopoGraphForces,
  deriveTopoGraphForceIdentity,
  stripTopoGraphForces,
} from '../forces.js';
import { TOPO_GRAPH_SCHEMA_VERSION } from '../types.js';
import type {
  DiffEntry,
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
} from '../types.js';

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

const force = (
  overrides: Partial<TopoGraphForceEntry> &
    Pick<TopoGraphForceEntry, 'id' | 'kind'>
): TopoGraphForceEntry => ({
  acceptedAt: '2026-05-20T00:00:00.000Z',
  change: 'modified',
  detail: 'Contract changed',
  severity: 'breaking',
  source: 'trails compile --force',
  ...overrides,
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

  test('matches modified diffs by kind and id', () => {
    const graph = topoGraph([
      entry({ id: 'shared', kind: 'entity' }),
      entry({ id: 'shared', kind: 'trail' }),
    ]);
    const diff: DiffEntry = {
      change: 'modified',
      details: ['Trail contract changed'],
      id: 'shared',
      kind: 'trail',
      severity: 'breaking',
    };

    const annotated = annotateTopoGraphForces(graph, [diff], {
      acceptedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(annotated.entries[0]?.forces).toBeUndefined();
    expect(annotated.entries[1]?.forces).toHaveLength(1);
  });

  test('retains multiple modifications for one container without exact duplicates', () => {
    const graph = topoGraph([entry({ id: 'hello' })]);
    const first: DiffEntry = {
      change: 'modified',
      details: ['Input changed'],
      id: 'hello',
      kind: 'trail',
      severity: 'breaking',
    };
    const second: DiffEntry = {
      ...first,
      details: ['Output changed'],
    };

    const annotated = annotateTopoGraphForces(graph, [first, first, second], {
      acceptedAt: '2026-05-20T00:00:00.000Z',
    });

    expect(annotated.entries[0]?.forces?.map((event) => event.detail)).toEqual([
      'Input changed',
      'Output changed',
    ]);
  });

  test('binds one acceptance timestamp across repeated diff facts', () => {
    const graph = topoGraph([entry({ id: 'hello' })]);
    const repeated: DiffEntry = {
      change: 'modified',
      details: ['Input changed'],
      id: 'hello',
      kind: 'trail',
      severity: 'breaking',
    };
    const toISOString = spyOn(Date.prototype, 'toISOString')
      .mockReturnValueOnce('2026-05-20T00:00:00.000Z')
      .mockReturnValueOnce('2026-05-21T00:00:00.000Z');

    try {
      const annotated = annotateTopoGraphForces(graph, [repeated, repeated]);

      expect(toISOString).toHaveBeenCalledTimes(1);
      expect(annotated.entries[0]?.forces).toHaveLength(1);
      expect(annotated.entries[0]?.forces?.[0]?.acceptedAt).toBe(
        '2026-05-20T00:00:00.000Z'
      );
    } finally {
      toISOString.mockRestore();
    }
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

describe('carryForwardTopoGraphForces', () => {
  test('unions complete event facts without duplicating common history', () => {
    const common = force({ id: 'hello', kind: 'trail' });
    const later = force({
      acceptedAt: '2026-05-21T00:00:00.000Z',
      id: 'hello',
      kind: 'trail',
      reason: 'approved migration',
    });
    const previous = topoGraph([
      entry({ forces: [common, later], id: 'hello' }),
    ]);
    const next = topoGraph([entry({ forces: [common], id: 'hello' })]);

    const carried = carryForwardTopoGraphForces(previous, next);

    expect(carried.entries[0]?.forces).toEqual([common, later]);
    expect(carryForwardTopoGraphForces(previous, carried)).toEqual(carried);
  });

  test('matches force containers by kind and id', () => {
    const trailForce = force({ id: 'shared', kind: 'trail' });
    const entityForce = force({ id: 'shared', kind: 'entity' });
    const previous = topoGraph([
      entry({ forces: [trailForce], id: 'shared', kind: 'trail' }),
      entry({ forces: [entityForce], id: 'shared', kind: 'entity' }),
    ]);
    const next = topoGraph([
      entry({ id: 'shared', kind: 'entity' }),
      entry({ id: 'shared', kind: 'trail' }),
    ]);

    const carried = carryForwardTopoGraphForces(previous, next);

    expect(carried.entries[0]?.forces).toEqual([entityForce]);
    expect(carried.entries[1]?.forces).toEqual([trailForce]);
  });

  test('relocates modified history before recording the removal', () => {
    const modified = force({ id: 'removed', kind: 'resource' });
    const previous = topoGraph([
      entry({ forces: [modified], id: 'removed', kind: 'resource' }),
    ]);
    const carried = carryForwardTopoGraphForces(previous, topoGraph([]));

    const annotated = annotateTopoGraphForces(
      carried,
      [
        {
          change: 'removed',
          details: ['Resource removed'],
          id: 'removed',
          kind: 'resource',
          severity: 'breaking',
        },
      ],
      { acceptedAt: '2026-05-22T00:00:00.000Z' }
    );

    expect(annotated.forces).toEqual([
      modified,
      force({
        acceptedAt: '2026-05-22T00:00:00.000Z',
        change: 'removed',
        detail: 'Resource removed',
        id: 'removed',
        kind: 'resource',
      }),
    ]);
    expect(annotated.entries).toEqual([]);
  });

  test('keeps graph history at graph level when the id returns', () => {
    const historical = force({
      change: 'removed',
      id: 'returning',
      kind: 'signal',
    });
    const previous = { ...topoGraph([]), forces: [historical] };
    const next = topoGraph([entry({ id: 'returning', kind: 'signal' })]);

    const carried = carryForwardTopoGraphForces(previous, next);

    expect(carried.forces).toEqual([historical]);
    expect(carried.entries[0]?.forces).toBeUndefined();
  });

  test('gives graph placement precedence over identical entry copies', () => {
    const historical = force({ id: 'hello', kind: 'trail' });
    const previous = { ...topoGraph([]), forces: [historical] };
    const next = topoGraph([entry({ forces: [historical], id: 'hello' })]);

    const carried = carryForwardTopoGraphForces(previous, next);

    expect(carried.forces).toEqual([historical]);
    expect(carried.entries[0]?.forces).toBeUndefined();
  });

  test('fails before union when an event is attached to the wrong container', () => {
    const previous = topoGraph([
      entry({
        forces: [force({ id: 'other', kind: 'trail' })],
        id: 'hello',
      }),
    ]);
    const next = topoGraph([entry({ id: 'hello' })]);

    expect(() => carryForwardTopoGraphForces(previous, next)).toThrow(
      ValidationError
    );
    expect(next.entries[0]?.forces).toBeUndefined();
  });

  test('fails before union when a graph repeats one container identity', () => {
    const previous = topoGraph([
      entry({
        forces: [force({ detail: 'First change', id: 'hello', kind: 'trail' })],
        id: 'hello',
      }),
      entry({
        forces: [
          force({
            acceptedAt: '2026-05-21T00:00:00.000Z',
            detail: 'Second change',
            id: 'hello',
            kind: 'trail',
          }),
        ],
        id: 'hello',
      }),
    ]);

    expect(() =>
      carryForwardTopoGraphForces(previous, topoGraph([entry({ id: 'hello' })]))
    ).toThrow(ValidationError);
  });
});

describe('deriveTopoGraphForceIdentity', () => {
  test('uses canonical serialized timestamp and reason facts', () => {
    const base = force({ id: 'hello', kind: 'trail' });
    const differentTime = { ...base, acceptedAt: '2026-05-21T00:00:00.000Z' };
    const reasonAbsent = deriveTopoGraphForceIdentity(base);
    const reasonUndefined = deriveTopoGraphForceIdentity({
      ...base,
      reason: undefined,
    });
    const emptyReason = deriveTopoGraphForceIdentity({
      ...base,
      reason: '',
    });

    expect(deriveTopoGraphForceIdentity(differentTime)).not.toBe(reasonAbsent);
    expect(reasonUndefined).toBe(reasonAbsent);
    expect(emptyReason).not.toBe(reasonAbsent);
  });
});
