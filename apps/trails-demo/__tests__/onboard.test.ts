/**
 * Route tests for entity.onboard.
 *
 * Tests the composite route that creates an entity and verifies searchability.
 */

import { describe, test, expect } from 'bun:test';

import {
  Result,
  AlreadyExistsError,
  createTrailContext,
  validateInput,
} from '@ontrails/core';
import { expectErr } from '@ontrails/testing';
import type { Trail, TrailContext } from '@ontrails/core';

import { entityStoreProvision } from '../src/resources/entity-store.js';
import type { EntityStore } from '../src/store.js';
import { createStore } from '../src/store.js';
import { add } from '../src/trails/entity.js';
import { onboard } from '../src/trails/onboard.js';
import { search } from '../src/trails/search.js';

// ---------------------------------------------------------------------------
// Helper: create a cross function that dispatches to real trail impls
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTrail = Trail<any, any>;

const createCrossFn = (ctx: TrailContext) => {
  const trailMap = new Map<string, AnyTrail>([
    ['entity.add', add],
    ['search', search],
  ]);

  return async <O>(id: string, input: unknown): Promise<Result<O, Error>> => {
    const t = trailMap.get(id);
    if (!t) {
      return Result.err(new Error(`Unknown trail: ${id}`));
    }
    const validated = validateInput(t.input, input);
    if (validated.isErr()) {
      return validated as Result<O, Error>;
    }
    return (await t.blaze(validated.value, ctx)) as Result<O, Error>;
  };
};

const makeCtx = (store: EntityStore): TrailContext => {
  const base = createTrailContext({
    extensions: { [entityStoreProvision.id]: store },
  });
  const ctx: TrailContext = { ...base, cross: createCrossFn(base) };
  return ctx;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('entity.onboard', () => {
  test('creates entity and verifies searchability', async () => {
    const store = createStore([]);
    const ctx = makeCtx(store);

    const validated = validateInput(onboard.input, {
      name: 'Epsilon',
      tags: ['test'],
      type: 'concept',
    });
    expect(validated.isOk()).toBe(true);
    const input = validated.unwrap();

    const result = await onboard.blaze(input, ctx);
    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.entity.name).toBe('Epsilon');
    expect(value.searchable).toBe(true);
  });

  test('fails when entity already exists', async () => {
    const store = createStore([
      { name: 'Alpha', tags: ['core'], type: 'concept' },
    ]);
    const ctx = makeCtx(store);

    const validated = validateInput(onboard.input, {
      name: 'Alpha',
      type: 'concept',
    });
    expect(validated.isOk()).toBe(true);
    const input = validated.unwrap();

    const result = await onboard.blaze(input, ctx);
    expect(result.isErr()).toBe(true);
    const error = expectErr(result);
    expect(error).toBeInstanceOf(AlreadyExistsError);
  });
});
