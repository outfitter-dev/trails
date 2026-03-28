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
    input: inputSchema,
    output: outputSchema,
    run: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
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
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(minimal.output).toBeUndefined();
    });

    test('implementation is callable', async () => {
      const result = await greet.run({ name: 'World' }, stubCtx);
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
        input: z.object({ text: z.string() }),
        run: (input) => Result.ok({ text: input.text }),
      });
      expect(withExamples.examples).toHaveLength(2);
      const first = withExamples.examples?.[0];
      expect(first?.name).toBe('error-case');
      const second = withExamples.examples?.[1];
      expect(second?.name).toBe('basic');
    });

    test('metadata is stored', () => {
      const withMetadata = trail('tagged', {
        input: z.object({}),
        metadata: { domain: 'billing', tier: 1 },
        run: () => Result.ok(),
      });
      expect(withMetadata.metadata).toEqual({ domain: 'billing', tier: 1 });
    });

    test('detours are stored', () => {
      const withDetours = trail('orchestrator', {
        detours: {
          onFailure: ['alert'],
          onSuccess: ['notify', 'audit'],
        },
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(withDetours.detours).toEqual({
        onFailure: ['alert'],
        onSuccess: ['notify', 'audit'],
      });
    });
  });

  describe('follow', () => {
    test('defaults to empty frozen array when omitted', () => {
      const minimal = trail('bare', {
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(minimal.follow).toEqual([]);
      expect(Object.isFrozen(minimal.follow)).toBe(true);
    });

    test('preserves follow array', () => {
      const withFollow = trail('composed', {
        follow: ['authenticate', 'validate-session'],
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(withFollow.follow).toEqual(['authenticate', 'validate-session']);
    });

    test('follow array is frozen', () => {
      const withFollow = trail('composed', {
        follow: ['authenticate'],
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(Object.isFrozen(withFollow.follow)).toBe(true);
    });
  });

  describe('intent and idempotent', () => {
    test('intent defaults to write', () => {
      const minimal = trail('bare', {
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(minimal.intent).toBe('write');
      expect(minimal.idempotent).toBeUndefined();
    });

    test('intent is preserved when set', () => {
      const readTrail = trail('reader', {
        input: z.object({}),
        intent: 'read',
        run: () => Result.ok(),
      });
      expect(readTrail.intent).toBe('read');

      const destroyTrail = trail('destroyer', {
        input: z.object({}),
        intent: 'destroy',
        run: () => Result.ok(),
      });
      expect(destroyTrail.intent).toBe('destroy');
    });

    test('idempotent is preserved when set', () => {
      const t = trail('idempotent', {
        idempotent: true,
        input: z.object({}),
        run: () => Result.ok(),
      });
      expect(t.idempotent).toBe(true);
    });
  });

  describe('single-object overload', () => {
    test('accepts spec with id property', () => {
      const t = trail({
        id: 'entity.show',
        input: inputSchema,
        run: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
      });
      expect(t.id).toBe('entity.show');
      expect(t.kind).toBe('trail');
    });

    test('preserves all spec fields', () => {
      const t = trail({
        description: 'A full trail',
        examples: [{ input: { name: 'World' }, name: 'test' }],
        id: 'full',
        input: inputSchema,
        intent: 'read',
        output: outputSchema,
        run: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
      });
      expect(t.description).toBe('A full trail');
      expect(t.intent).toBe('read');
      expect(t.examples).toHaveLength(1);
    });

    test('implementation is callable', async () => {
      const t = trail({
        id: 'callable',
        input: z.object({ x: z.number() }),
        run: (input: { x: number }) => Result.ok(input.x * 2),
      });
      const result = await t.run({ x: 5 }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(10);
    });

    test('sync implementations are normalized to an awaitable runtime function', async () => {
      const t = trail('normalized', {
        input: z.object({ value: z.number() }),
        run: (input: { value: number }) => Result.ok(input.value + 1),
      });

      const promise = t.run({ value: 2 }, stubCtx);
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(3);
    });
  });
});
