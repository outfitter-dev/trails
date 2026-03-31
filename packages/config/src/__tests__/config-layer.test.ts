import { describe, expect, test } from 'bun:test';
import { Result } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configLayer } from '../config-layer.js';

const stubTrail = {
  description: undefined,
  detours: undefined,
  examples: undefined,
  fields: undefined,
  follow: [],
  id: 'test.stub',
  idempotent: undefined,
  input: z.object({}),
  intent: 'read' as const,
  kind: 'trail' as const,
  metadata: undefined,
  output: undefined,
  run: (_input: unknown, _ctx: TrailContext) => Result.ok({}),
  services: [],
};

describe('configLayer', () => {
  describe('identity', () => {
    test('has name "config"', () => {
      expect(configLayer.name).toBe('config');
    });

    test('has a description', () => {
      expect(configLayer.description).toBeDefined();
    });
  });

  describe('wrap', () => {
    test('passes through to the base implementation', async () => {
      const impl = (_input: unknown, _ctx: TrailContext) =>
        Result.ok({ called: true });

      const wrapped = configLayer.wrap(stubTrail, impl);
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
