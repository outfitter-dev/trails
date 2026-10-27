import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import { Result, executeTrail, topo, trail } from '@ontrails/core';
import {
  deriveTopoGraph,
  wayfinderGraphSnapshotSchema,
  wayfinderTopo,
} from '../index.js';
import type { WayfinderGraphSnapshot } from '../index.js';

const graph = deriveTopoGraph(
  topo('fixture', {
    show: trail('fixture.show', {
      implementation: () => Result.ok({}),
      input: z.object({}),
      intent: 'read',
      version: 1,
    }),
  })
);

const snapshot: WayfinderGraphSnapshot = {
  drift: { artifacts: ['topoStore'], status: 'absent' },
  graph: { ...graph, overlays: { fixture: { generation: 'captured' } } },
  source: {
    kind: 'topoGraph',
    path: '/captured/trails.lock',
    schemaVersion: graph.topoGraphSchemaVersion,
  },
};

const reads = [
  { id: 'wayfind.overview', input: {} },
  { id: 'wayfind.trails', input: {} },
  { id: 'wayfind.search', input: { filters: { query: 'fixture' } } },
  { id: 'wayfind.entities', input: {} },
  { id: 'wayfind.resources', input: {} },
  { id: 'wayfind.signals', input: {} },
  { id: 'wayfind.surfaces', input: {} },
  { id: 'wayfind.trailheads', input: {} },
  { id: 'wayfind.versions', input: {} },
  { id: 'wayfind.examples', input: {} },
  { id: 'wayfind.errors', input: {} },
  { id: 'wayfind.overlay', input: { namespace: 'fixture' } },
  { id: 'wayfind.describe', input: { id: 'fixture.show' } },
  { id: 'wayfind.contract', input: { id: 'fixture.show' } },
  { id: 'wayfind.nearby', input: { id: 'fixture.show' } },
  { id: 'wayfind.impact', input: { id: 'fixture.show' } },
];

describe('Wayfinder composed graph snapshots', () => {
  test.each(reads)(
    '$id consumes a snapshot through real composition without disk artifacts',
    async ({ id, input }) => {
      const child = wayfinderTopo.get(id);
      if (child === undefined) {
        throw new Error(`Missing query ${id}`);
      }
      const reading = trail('fixture.read', {
        composes: [child],
        implementation: async (_, ctx) =>
          await ctx.compose(id, { ...input, graphSnapshot: snapshot }),
        input: z.object({}),
        output: z.unknown(),
      });
      const result = await executeTrail(
        reading,
        {},
        {
          topo: topo('reader', { child, reading }),
        }
      );
      expect(result.isOk()).toBe(true);
      if (result.isErr()) {
        throw result.error;
      }
      expect(result.value).toMatchObject({
        drift: snapshot.drift,
        source: snapshot.source,
      });
    }
  );

  test.each(reads)(
    '$id rejects snapshots on direct surface input',
    async ({ id, input }) => {
      const child = wayfinderTopo.get(id);
      if (child === undefined) {
        throw new Error(`Missing query ${id}`);
      }
      const result = await executeTrail(child, {
        ...input,
        graphSnapshot: snapshot,
      });
      expect(result.isErr()).toBe(true);
      expect(
        child.input.safeParse({ ...input, graphSnapshot: snapshot }).success
      ).toBe(false);
    }
  );

  test('validates captured graphs against the canonical graph schema', () => {
    expect(wayfinderGraphSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      wayfinderGraphSnapshotSchema.safeParse({
        ...snapshot,
        graph: { ...graph, topoGraphSchemaVersion: -1 },
      }).success
    ).toBe(false);
  });
});
