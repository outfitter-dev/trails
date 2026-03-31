import { describe, expect, test } from 'bun:test';
import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configCheck } from '../trails/config-check.js';
import type { ConfigState } from '../registry.js';

/**
 * Build a TrailContext with configService resolved in extensions.
 */
const buildCtx = (state: ConfigState): TrailContext => {
  const extensions = { config: state };
  const ctx: TrailContext = {
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    service: undefined as unknown as TrailContext['service'],
    signal: AbortSignal.timeout(5000),
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    service: createServiceLookup(() => withLookup),
  };
  return withLookup;
};

describe('config.check trail', () => {
  describe('identity', () => {
    test('has id "config.check"', () => {
      expect(configCheck.id).toBe('config.check');
    });

    test('has kind "trail"', () => {
      expect(configCheck.kind).toBe('trail');
    });

    test('has intent "read"', () => {
      expect(configCheck.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(configCheck.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has output schema', () => {
      expect(configCheck.output).toBeDefined();
    });

    test('declares configService dependency', () => {
      expect(configCheck.services).toBeDefined();
      expect(configCheck.services?.length).toBe(1);
    });
  });

  describe('examples', () => {
    test('has at least one example', () => {
      expect(configCheck.examples?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('wired behavior', () => {
    test('reports valid when all required fields present', async () => {
      const schema = z.object({
        host: z.string().default('localhost'),
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        resolved: { host: 'localhost', port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.run({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.diagnostics.length).toBeGreaterThan(0);
    });

    test('reports missing for required fields without values', async () => {
      const schema = z.object({
        host: z.string(),
        port: z.number(),
      });
      const state: ConfigState = {
        resolved: {},
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.run({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      const missing = value.diagnostics.filter((d) => d.status === 'missing');
      expect(missing.length).toBe(2);
    });

    test('uses input values when provided to override resolved', async () => {
      const schema = z.object({
        port: z.number(),
      });
      const state: ConfigState = {
        resolved: {},
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.run({ values: { port: 8080 } }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.diagnostics.length).toBe(1);
      expect(value.diagnostics[0]?.status).toBe('valid');
    });

    test('deep merges nested input overrides with resolved values', async () => {
      const schema = z.object({
        db: z.object({
          host: z.string(),
          port: z.number(),
        }),
      });
      const state: ConfigState = {
        resolved: { db: { host: 'localhost', port: 5432 } },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.run(
        { values: { db: { port: 6543 } } },
        ctx
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().valid).toBe(true);
      expect(result.unwrap().diagnostics).toEqual([
        expect.objectContaining({
          path: 'db.host',
          status: 'valid',
          value: 'localhost',
        }),
        expect.objectContaining({
          path: 'db.port',
          status: 'valid',
          value: 6543,
        }),
      ]);
    });

    test('reports default status for fields using defaults', async () => {
      const schema = z.object({
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        resolved: {},
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.run({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const defaults = result
        .unwrap()
        .diagnostics.filter((d) => d.status === 'default');
      expect(defaults.length).toBe(1);
    });
  });
});
