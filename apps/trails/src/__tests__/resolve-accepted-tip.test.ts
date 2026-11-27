import { describe, expect, test } from 'bun:test';

import {
  deriveTopoGraphDiff,
  deriveTopoGraphForceEntries,
  deriveTopoGraphHash,
  TRAILS_LOCK_SCHEMA_VERSION,
  trailsLockSchema,
  TOPO_GRAPH_SCHEMA_VERSION,
} from '@ontrails/topography';
import type {
  DiffEntry,
  TopoGraph,
  TopoGraphEntry,
  TopoGraphForceEntry,
  TrailsLock,
} from '@ontrails/topography';

import { isRecordedTipTransition } from '../trails/resolve-accepted-tip.js';

const entry = (
  kind: TopoGraphEntry['kind'],
  overrides: Partial<TopoGraphEntry> = {}
): TopoGraphEntry => ({
  exampleCount: 0,
  id: `${kind}.fixture`,
  kind,
  surfaces: [],
  ...overrides,
});

const graph = (
  entries: readonly TopoGraphEntry[],
  forces: readonly TopoGraphForceEntry[] = []
): TopoGraph => ({
  activationGraph: {
    edgeCount: 0,
    edges: [],
    sourceCount: 0,
    sourceKeys: [],
    trailIds: [],
  },
  activationSources: {},
  entries: [...entries],
  ...(forces.length > 0 ? { forces: [...forces] } : {}),
  topoGraphSchemaVersion: TOPO_GRAPH_SCHEMA_VERSION,
});

const summary = (topoGraph: TopoGraph): TrailsLock['summary'] => ({
  entities: topoGraph.entries.filter(({ kind }) => kind === 'entity').length,
  resources: topoGraph.entries.filter(({ kind }) => kind === 'resource').length,
  signals: topoGraph.entries.filter(({ kind }) => kind === 'signal').length,
  trails: topoGraph.entries.filter(({ kind }) => kind === 'trail').length,
});

const lock = (topoGraph: TopoGraph): TrailsLock =>
  trailsLockSchema.parse({
    scope: { app: 'accepted-tip-fixture' },
    summary: summary(topoGraph),
    topoGraph,
    topoGraphHash: deriveTopoGraphHash(topoGraph),
    version: TRAILS_LOCK_SCHEMA_VERSION,
  });

const onlyBreaking = (before: TopoGraph, after: TopoGraph): DiffEntry => {
  const { breaking } = deriveTopoGraphDiff(before, after);
  expect(breaking).toHaveLength(1);
  const [diff] = breaking;
  if (diff === undefined) {
    throw new Error('Expected one breaking transition');
  }
  return diff;
};

const acceptedAt = '2026-10-28T12:00:00.000Z';

describe('isRecordedTipTransition', () => {
  test.each(['trail', 'entity', 'resource', 'signal'] as const)(
    'recognizes an exactly recorded %s removal',
    (kind) => {
      const baseGraph = graph([entry(kind)]);
      const freshGraph = graph([]);
      const diff = onlyBreaking(baseGraph, freshGraph);
      const events = deriveTopoGraphForceEntries(diff, {
        acceptedAt,
        reason: `approved ${kind} removal`,
      });
      const tipGraph = graph([], events);

      expect(
        isRecordedTipTransition(
          diff,
          lock(baseGraph),
          freshGraph,
          [lock(tipGraph)],
          lock(baseGraph)
        )
      ).toBe(true);

      for (const mutation of [
        { change: 'modified' as const },
        { detail: `${events[0]?.detail} (different)` },
        { id: `${kind}.other` },
        { kind: (kind === 'trail' ? 'entity' : 'trail') as 'entity' | 'trail' },
      ]) {
        const mutated = { ...events[0], ...mutation } as TopoGraphForceEntry;
        expect(
          isRecordedTipTransition(
            diff,
            lock(baseGraph),
            freshGraph,
            [lock(graph([], [mutated]))],
            lock(baseGraph)
          )
        ).toBe(false);
      }
    }
  );

  test('rejects a competing modification when the recorded tip removed the entry', () => {
    const fixture = entry('trail');
    const baseGraph = graph([fixture]);
    const removedGraph = graph([]);
    const removal = onlyBreaking(baseGraph, removedGraph);
    const tipGraph = graph(
      [],
      deriveTopoGraphForceEntries(removal, { acceptedAt })
    );
    const freshGraph = graph([
      {
        ...fixture,
        input: {
          properties: { required: { type: 'string' } },
          required: ['required'],
          type: 'object',
        },
      },
    ]);
    const modification = onlyBreaking(baseGraph, freshGraph);

    expect(
      isRecordedTipTransition(
        modification,
        lock(baseGraph),
        freshGraph,
        [lock(tipGraph)],
        lock(baseGraph)
      )
    ).toBe(false);
  });

  test('rejects matching coarse detail when the complete post-state differs', () => {
    const fixture = entry('trail');
    const baseGraph = graph([fixture]);
    const requiredInput = {
      properties: { required: { type: 'string' } },
      required: ['required'],
      type: 'object',
    };
    const recordedGraph = graph([{ ...fixture, input: requiredInput }]);
    const recordedDiff = onlyBreaking(baseGraph, recordedGraph);
    const [event] = deriveTopoGraphForceEntries(recordedDiff, { acceptedAt });
    if (event === undefined) {
      throw new Error('Expected a force event for the recorded transition');
    }
    const tipGraph = graph([
      { ...recordedGraph.entries[0], forces: [event] } as TopoGraphEntry,
    ]);
    const freshGraph = graph([
      { ...fixture, input: requiredInput, meta: { owner: 'different' } },
    ]);
    const candidateDiff = onlyBreaking(baseGraph, freshGraph);
    expect(candidateDiff.details).toEqual(recordedDiff.details);

    expect(
      isRecordedTipTransition(
        candidateDiff,
        lock(baseGraph),
        freshGraph,
        [lock(tipGraph)],
        lock(baseGraph)
      )
    ).toBe(false);
  });

  test('requires a verified base and a newly recorded event', () => {
    const fixture = entry('signal');
    const baseWithoutHistory = graph([fixture]);
    const freshGraph = graph([]);
    const diff = onlyBreaking(baseWithoutHistory, freshGraph);
    const [oldEvent] = deriveTopoGraphForceEntries(diff, { acceptedAt });
    if (oldEvent === undefined) {
      throw new Error('Expected a force event for the removal');
    }
    const baseGraph = graph([fixture], [oldEvent]);
    const tipGraph = graph([], [oldEvent]);

    expect(
      isRecordedTipTransition(diff, lock(baseGraph), freshGraph, [
        lock(tipGraph),
      ])
    ).toBe(false);
    expect(
      isRecordedTipTransition(
        diff,
        lock(baseGraph),
        freshGraph,
        [lock(tipGraph)],
        lock(baseGraph)
      )
    ).toBe(false);
  });

  test('declines ambiguous same-kind entry endpoints', () => {
    const duplicate = entry('resource');
    const baseGraph = graph([duplicate, { ...duplicate }]);
    const freshGraph = graph([]);
    const diff: DiffEntry = {
      change: 'removed',
      details: ['Resource "resource.fixture" removed'],
      id: duplicate.id,
      kind: duplicate.kind,
      severity: 'breaking',
    };
    const tipGraph = graph(
      [],
      deriveTopoGraphForceEntries(diff, { acceptedAt })
    );

    expect(
      isRecordedTipTransition(
        diff,
        lock(baseGraph),
        freshGraph,
        [lock(tipGraph)],
        lock(baseGraph)
      )
    ).toBe(false);
  });
});
