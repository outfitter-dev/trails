import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { Result } from '../result';
import { trail } from '../trail';
import type { TrailContext } from '../types';

const stubCtx: TrailContext = {
  requestId: 'test-123',
  signal: AbortSignal.timeout(5000),
};

describe('trail()', () => {
  const inputSchema = z.object({ name: z.string() });
  const outputSchema = z.object({ greeting: z.string() });

  const greet = trail('greet', {
    description: 'Greet someone',
    implementation: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
    input: inputSchema,
    output: outputSchema,
  });

  describe('basics', () => {
    test('returns correct id', () => {
      expect(greet.id).toBe('greet');
    });

    test("returns kind 'trail'", () => {
      expect(greet.kind).toBe('trail');
    });

    test('preserves input schema', () => {
      const parsed = greet.input.safeParse({ name: 'World' });
      expect(parsed.success).toBe(true);

      const bad = greet.input.safeParse({ name: 42 });
      expect(bad.success).toBe(false);
    });

    test('output schema is optional', () => {
      const minimal = trail('noop', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.output).toBeUndefined();
    });

    test('implementation is callable', async () => {
      const result = await greet.implementation({ name: 'World' }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ greeting: 'Hello, World!' });
    });
  });

  describe('metadata', () => {
    test('examples are stored', () => {
      const withExamples = trail('echo', {
        examples: [
          { error: 'ValidationError', input: { text: '' }, name: 'error-case' },
          { expected: { text: 'hi' }, input: { text: 'hi' }, name: 'basic' },
        ],
        implementation: (input) => Result.ok({ text: input.text }),
        input: z.object({ text: z.string() }),
      });
      expect(withExamples.examples).toHaveLength(2);
      const first = withExamples.examples?.[0];
      expect(first?.name).toBe('error-case');
      const second = withExamples.examples?.[1];
      expect(second?.name).toBe('basic');
    });

    test('markers are stored', () => {
      const withMarkers = trail('tagged', {
        implementation: () => Result.ok(),
        input: z.object({}),
        markers: { domain: 'billing', tier: 1 },
      });
      expect(withMarkers.markers).toEqual({ domain: 'billing', tier: 1 });
    });

    test('detours are stored', () => {
      const withDetours = trail('orchestrator', {
        detours: {
          onFailure: ['alert'],
          onSuccess: ['notify', 'audit'],
        },
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(withDetours.detours).toEqual({
        onFailure: ['alert'],
        onSuccess: ['notify', 'audit'],
      });
    });
  });

  describe('boolean flags', () => {
    test('boolean flags default to undefined', () => {
      const minimal = trail('bare', {
        implementation: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.readOnly).toBeUndefined();
      expect(minimal.destructive).toBeUndefined();
      expect(minimal.idempotent).toBeUndefined();
    });

    test('boolean flags are preserved when set', () => {
      const withFlags = trail('flagged', {
        destructive: false,
        idempotent: true,
        implementation: () => Result.ok(),
        input: z.object({}),
        readOnly: true,
      });
      expect(withFlags.readOnly).toBe(true);
      expect(withFlags.destructive).toBe(false);
      expect(withFlags.idempotent).toBe(true);
    });
  });

  describe('single-object overload', () => {
    test('accepts spec with id property', () => {
      const t = trail({
        id: 'entity.show',
        implementation: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        input: inputSchema,
      });
      expect(t.id).toBe('entity.show');
      expect(t.kind).toBe('trail');
    });

    test('preserves all spec fields', () => {
      const t = trail({
        description: 'A full trail',
        destructive: false,
        examples: [{ input: { name: 'World' }, name: 'test' }],
        id: 'full',
        implementation: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        input: inputSchema,
        output: outputSchema,
        readOnly: true,
      });
      expect(t.description).toBe('A full trail');
      expect(t.readOnly).toBe(true);
      expect(t.examples).toHaveLength(1);
    });

    test('implementation is callable', async () => {
      const t = trail({
        id: 'callable',
        implementation: (input: { x: number }) => Result.ok(input.x * 2),
        input: z.object({ x: z.number() }),
      });
      const result = await t.implementation({ x: 5 }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(10);
    });

    test('sync implementations are normalized to an awaitable runtime function', async () => {
      const t = trail('normalized', {
        implementation: (input: { value: number }) =>
          Result.ok(input.value + 1),
        input: z.object({ value: z.number() }),
      });

      const promise = t.implementation({ value: 2 }, stubCtx);
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(3);
    });
  });
});
