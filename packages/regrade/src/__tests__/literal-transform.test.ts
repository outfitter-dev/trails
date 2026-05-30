import { describe, expect, test } from 'bun:test';
import { executeTrail, filterSurfaceTrails } from '@ontrails/core';
import { testExamples } from '@ontrails/testing';
import { deriveTopoGraph } from '@ontrails/topographer';

import {
  literalRegradeTopo,
  literalRegradeTrail,
  normalizeExportConstTrail,
} from '../literal-transform.js';

describe('literal Regrade transform tracer', () => {
  test('runs a parent transform trail that composes a child transform trail by object', async () => {
    const result = await executeTrail(
      literalRegradeTrail,
      { source: 'export const answer = 41;' },
      { topo: literalRegradeTopo }
    );

    expect(result.isOk()).toBe(true);
    expect(result.value).toEqual({
      changed: true,
      nextSource: 'export let answer = 41;',
      notes: ['Rewrote export const declarations to export let.'],
    });
  });

  test('keeps internal transform trails off surfaces while retaining topo evidence', () => {
    const surfaceIds = filterSurfaceTrails(literalRegradeTopo.list()).map(
      (entry) => entry.id
    );
    expect(surfaceIds).toContain(literalRegradeTrail.id);
    expect(normalizeExportConstTrail.id).toBe(
      'regrade.literal.normalize-export-const'
    );
    expect(surfaceIds).not.toContain(normalizeExportConstTrail.id);

    const topoGraph = deriveTopoGraph(literalRegradeTopo);
    const parent = topoGraph.entries.find(
      (entry) => entry.id === literalRegradeTrail.id
    );
    const child = topoGraph.entries.find(
      (entry) => entry.id === normalizeExportConstTrail.id
    );

    expect(parent?.kind).toBe('trail');
    expect(parent?.composes).toEqual([normalizeExportConstTrail.id]);
    expect(parent?.exampleCount).toBe(1);
    expect(child?.kind).toBe('trail');
    expect(child?.surfaces).toEqual([]);
  });
});

describe('literal Regrade transform examples', () => {
  testExamples(literalRegradeTopo);
});
