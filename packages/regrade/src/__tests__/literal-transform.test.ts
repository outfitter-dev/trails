import { describe, expect, test } from 'bun:test';
import {
  executeTrail,
  filterSurfaceTrails,
  validateInput,
} from '@ontrails/core';
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
    if (result.isOk()) {
      expect(result.value).toEqual({
        changed: true,
        nextSource: 'export let answer = 41;',
        notes: ['Rewrote export const declarations to export let.'],
      });
    }
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

describe('transformed input schema validation (TRL-842)', () => {
  test('validates raw pre-transform input and projects it to implementation input', () => {
    // The parent trail's input schema is a `.transform()` schema. Examples and
    // testExamples() feed RAW pre-transform input ({ source }); validation must
    // accept it and project it into the post-transform implementation input
    // ({ child: { source } }). This pins the runtime contract that the
    // type-level divergence documented in literal-transform.ts depends on.
    const validated = validateInput(literalRegradeTrail.input, {
      source: 'export const answer = 41;',
    });

    expect(validated.isOk()).toBe(true);
    if (validated.isOk()) {
      expect(validated.value).toEqual({
        child: { source: 'export const answer = 41;' },
      });
    }
  });

  test('rejects input missing the raw pre-transform field', () => {
    const validated = validateInput(literalRegradeTrail.input, {
      // Post-transform shape is NOT valid raw input — the schema expects
      // `source`, proving validation runs against the raw input contract.
      child: { source: 'export const answer = 41;' },
    });

    expect(validated.isErr()).toBe(true);
  });
});

describe('literal Regrade transform examples', () => {
  testExamples(literalRegradeTopo);
});
