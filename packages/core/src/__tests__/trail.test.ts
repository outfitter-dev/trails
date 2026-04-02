import { describe, test, expect } from 'bun:test';

import { z } from 'zod';

import { createTrailContext } from '../context';
import { Result } from '../result';
import { service } from '../service';
import { trail } from '../trail';
import type { TrailContext } from '../types';

const stubCtx: TrailContext = createTrailContext({
  abortSignal: AbortSignal.timeout(5000),
  requestId: 'test-123',
});

const dbService = service('db.main', {
  create: () =>
    Result.ok({
      query(sql: string) {
        return sql.length;
      },
    }),
  description: 'Primary database service',
});

describe('trail()', () => {
  const inputSchema = z.object({ name: z.string() });
  const outputSchema = z.object({ greeting: z.string() });

  const greet = trail('greet', {
    blaze: (input) => Result.ok({ greeting: `Hello, ${input.name}!` }),
    description: 'Greet someone',
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
        blaze: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.output).toBeUndefined();
    });

    test('implementation is callable', async () => {
      const result = await greet.blaze({ name: 'World' }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ greeting: 'Hello, World!' });
    });
  });

  describe('metadata', () => {
    test('examples are stored', () => {
      const withExamples = trail('echo', {
        blaze: (input) => Result.ok({ text: input.text }),
        examples: [
          { error: 'ValidationError', input: { text: '' }, name: 'error-case' },
          { expected: { text: 'hi' }, input: { text: 'hi' }, name: 'basic' },
        ],
        input: z.object({ text: z.string() }),
      });
      expect(withExamples.examples).toHaveLength(2);
      const first = withExamples.examples?.[0];
      expect(first?.name).toBe('error-case');
      const second = withExamples.examples?.[1];
      expect(second?.name).toBe('basic');
    });

    test('metadata is stored', () => {
      const withMetadata = trail('tagged', {
        blaze: () => Result.ok(),
        input: z.object({}),
        metadata: { domain: 'billing', tier: 1 },
      });
      expect(withMetadata.metadata).toEqual({ domain: 'billing', tier: 1 });
    });

    test('detours are stored', () => {
      const withDetours = trail('orchestrator', {
        blaze: () => Result.ok(),
        detours: {
          onFailure: ['alert'],
          onSuccess: ['notify', 'audit'],
        },
        input: z.object({}),
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
        blaze: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.follow).toEqual([]);
      expect(Object.isFrozen(minimal.follow)).toBe(true);
    });

    test('preserves follow array', () => {
      const withFollow = trail('composed', {
        blaze: () => Result.ok(),
        follow: ['authenticate', 'validate-session'],
        input: z.object({}),
      });
      expect(withFollow.follow).toEqual(['authenticate', 'validate-session']);
    });

    test('follow array is frozen', () => {
      const withFollow = trail('composed', {
        blaze: () => Result.ok(),
        follow: ['authenticate'],
        input: z.object({}),
      });
      expect(Object.isFrozen(withFollow.follow)).toBe(true);
    });
  });

  describe('services', () => {
    test('defaults to empty frozen array when omitted', () => {
      const minimal = trail('bare', {
        blaze: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.services).toEqual([]);
      expect(Object.isFrozen(minimal.services)).toBe(true);
    });

    test('preserves declared service objects', () => {
      const withServices = trail('search', {
        blaze: () => Result.ok(),
        input: z.object({}),
        services: [dbService],
      });
      expect(withServices.services).toEqual([dbService]);
      expect(withServices.services[0]).toBe(dbService);
    });

    test('services array is frozen', () => {
      const withServices = trail('search', {
        blaze: () => Result.ok(),
        input: z.object({}),
        services: [dbService],
      });
      expect(Object.isFrozen(withServices.services)).toBe(true);
    });
  });

  describe('intent and idempotent', () => {
    test('intent defaults to write', () => {
      const minimal = trail('bare', {
        blaze: () => Result.ok(),
        input: z.object({}),
      });
      expect(minimal.intent).toBe('write');
      expect(minimal.idempotent).toBeUndefined();
    });

    test('intent is preserved when set', () => {
      const readTrail = trail('reader', {
        blaze: () => Result.ok(),
        input: z.object({}),
        intent: 'read',
      });
      expect(readTrail.intent).toBe('read');

      const destroyTrail = trail('destroyer', {
        blaze: () => Result.ok(),
        input: z.object({}),
        intent: 'destroy',
      });
      expect(destroyTrail.intent).toBe('destroy');
    });

    test('idempotent is preserved when set', () => {
      const t = trail('idempotent', {
        blaze: () => Result.ok(),
        idempotent: true,
        input: z.object({}),
      });
      expect(t.idempotent).toBe(true);
    });
  });

  describe('single-object overload', () => {
    test('accepts spec with id property', () => {
      const t = trail({
        blaze: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        id: 'entity.show',
        input: inputSchema,
      });
      expect(t.id).toBe('entity.show');
      expect(t.kind).toBe('trail');
    });

    test('preserves all spec fields', () => {
      const t = trail({
        blaze: (input: { name: string }, _ctx: TrailContext) =>
          Result.ok({ greeting: `Hi, ${input.name}` }),
        description: 'A full trail',
        examples: [{ input: { name: 'World' }, name: 'test' }],
        id: 'full',
        input: inputSchema,
        intent: 'read',
        output: outputSchema,
        services: [dbService],
      });
      expect(t.description).toBe('A full trail');
      expect(t.intent).toBe('read');
      expect(t.examples).toHaveLength(1);
      expect(t.services).toEqual([dbService]);
    });

    test('implementation is callable', async () => {
      const t = trail({
        blaze: (input: { x: number }) => Result.ok(input.x * 2),
        id: 'callable',
        input: z.object({ x: z.number() }),
      });
      const result = await t.blaze({ x: 5 }, stubCtx);
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(10);
    });

    test('sync implementations are normalized to an awaitable runtime function', async () => {
      const t = trail('normalized', {
        blaze: (input: { value: number }) => Result.ok(input.value + 1),
        input: z.object({ value: z.number() }),
      });

      const promise = t.blaze({ value: 2 }, stubCtx);
      expect(promise).toBeInstanceOf(Promise);

      const result = await promise;
      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toBe(3);
    });
  });
});
