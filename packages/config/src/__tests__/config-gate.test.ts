import { describe, expect, test } from 'bun:test';
import { Result } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configGate } from '../config-gate.js';

const stubTrail = {
  blaze: (_input: unknown, _ctx: TrailContext) => Result.ok({}),
  crosses: [],
  description: undefined,
  detours: undefined,
  examples: undefined,
  fields: undefined,
  id: 'test.stub',
  idempotent: undefined,
  input: z.object({}),
  intent: 'read' as const,
  kind: 'trail' as const,
  meta: undefined,
  output: undefined,
  provisions: [],
};

describe('configGate', () => {
  describe('identity', () => {
    test('has name "config"', () => {
      expect(configGate.name).toBe('config');
    });

    test('has a description', () => {
      expect(configGate.description).toBeDefined();
    });
  });

  describe('wrap', () => {
    test('passes through to the base implementation', async () => {
      const impl = (_input: unknown, _ctx: TrailContext) =>
        Result.ok({ called: true });

      const wrapped = configGate.wrap(stubTrail, impl);
      const ctx = {
        cwd: '/tmp',
        env: {},
        workspaceRoot: '/tmp',
      } as TrailContext;
      const result = await wrapped({}, ctx);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ called: true });
    });
  });
});
