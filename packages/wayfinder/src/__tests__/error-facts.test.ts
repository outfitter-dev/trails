import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  ConflictError,
  Result,
  RetryExhaustedError,
  ValidationError,
  topo,
  trail,
} from '@ontrails/core';
import { deriveTopoGraph } from '@ontrails/topographer';

import { deriveTrailErrorFacts } from '../error-facts.js';

const findTrailFacts = (
  facts: ReturnType<typeof deriveTrailErrorFacts>,
  trailId: string
) => {
  const trailFacts = facts.find((entry) => entry.trailId === trailId);
  if (trailFacts === undefined) {
    throw new Error(`Missing facts for ${trailId}`);
  }
  return trailFacts;
};

describe('deriveTrailErrorFacts', () => {
  test('projects documented error examples and handled detours with taxonomy', () => {
    const audited = trail('audit.save', {
      detours: [
        {
          maxAttempts: 1,
          on: ConflictError,
          recover: () => Result.ok({ ok: true }),
        },
      ],
      examples: [
        {
          error: 'ValidationError',
          input: { id: '' },
          name: 'Invalid id',
        },
      ],
      implementation: () => Result.err(new ValidationError('Invalid audit')),
      input: z.object({ id: z.string() }),
      output: z.object({ ok: z.boolean() }),
    });
    const graph = deriveTopoGraph(topo('errors', { audited }));

    const facts = findTrailFacts(deriveTrailErrorFacts(graph), 'audit.save');

    expect(facts.completeness.emitted).toEqual({
      reason: 'no-exhaustive-emitted-error-contract',
      status: 'unknown',
    });
    expect(facts.facts).toHaveLength(2);
    expect(facts.facts).toContainEqual(
      expect.objectContaining({
        kind: 'documented',
        provenance: {
          exampleName: 'Invalid id',
          source: 'trail.examples',
          trailId: 'audit.save',
        },
        taxonomy: expect.objectContaining({
          category: 'validation',
          known: true,
          name: 'ValidationError',
        }),
      })
    );
    expect(facts.facts).toContainEqual(
      expect.objectContaining({
        kind: 'handled',
        provenance: {
          detourIndex: 0,
          source: 'trail.detours',
          trailId: 'audit.save',
        },
        taxonomy: expect.objectContaining({
          category: 'conflict',
          known: true,
          name: 'ConflictError',
        }),
      })
    );
    expect(
      facts.facts.find((fact) => fact.taxonomy.name === 'ValidationError')
        ?.taxonomy.surfaces
    ).toContainEqual(
      expect.objectContaining({
        code: 1,
        name: 'ValidationError',
        surface: 'cli',
      })
    );
  });

  test('does not invent fixed surface codes for dynamic-category errors', () => {
    const withDynamic = trail('batch.retry', {
      detours: [
        {
          maxAttempts: 1,
          on: RetryExhaustedError,
          recover: () => Result.ok({ ok: true }),
        },
      ],
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const graph = deriveTopoGraph(topo('errors', { withDynamic }));

    const facts = findTrailFacts(deriveTrailErrorFacts(graph), 'batch.retry');
    const [dynamic] = facts.facts;

    expect(dynamic?.taxonomy).toEqual({
      dynamicCategory: { inheritsCategoryFrom: 'wrapped-error' },
      known: true,
      name: 'RetryExhaustedError',
      retryable: false,
      surfaces: [],
    });
  });

  test('represents supplied inferred and observed facts without source scanning', () => {
    const read = trail('user.read', {
      implementation: () => Result.ok({ id: 'u1' }),
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
    });
    const graph = deriveTopoGraph(topo('errors', { read }));

    const facts = findTrailFacts(
      deriveTrailErrorFacts(graph, {
        inferred: [
          {
            detail: 'static Result.err branch in fixture',
            errorName: 'NotFoundError',
            trailId: 'user.read',
          },
        ],
        observed: [
          {
            detail: 'trace sample 2026-06-09',
            errorName: 'ServiceSpecificError',
            trailId: 'user.read',
          },
        ],
      }),
      'user.read'
    );

    expect(facts.completeness.inferred).toEqual({
      reason: 'inferred-facts-supplied',
      status: 'partial',
    });
    expect(facts.completeness.observed).toEqual({
      reason: 'observed-facts-supplied',
      status: 'partial',
    });
    expect(facts.facts).toContainEqual(
      expect.objectContaining({
        kind: 'inferred',
        taxonomy: expect.objectContaining({
          category: 'not_found',
          known: true,
          name: 'NotFoundError',
        }),
      })
    );
    expect(facts.facts).toContainEqual(
      expect.objectContaining({
        kind: 'observed',
        taxonomy: {
          known: false,
          name: 'ServiceSpecificError',
          surfaces: [],
        },
      })
    );
  });

  test('keeps empty trails explicit about unknown emitted-error completeness', () => {
    const empty = trail('empty.read', {
      implementation: () => Result.ok({ ok: true }),
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
    });
    const graph = deriveTopoGraph(topo('errors', { empty }));

    const facts = findTrailFacts(deriveTrailErrorFacts(graph), 'empty.read');

    expect(facts.facts).toEqual([]);
    expect(facts.completeness).toEqual({
      documented: { reason: 'authored-facts-exhausted', status: 'complete' },
      emitted: {
        reason: 'no-exhaustive-emitted-error-contract',
        status: 'unknown',
      },
      handled: { reason: 'authored-facts-exhausted', status: 'complete' },
      inferred: { reason: 'not-evaluated', status: 'unknown' },
      observed: { reason: 'not-evaluated', status: 'unknown' },
    });
  });
});
