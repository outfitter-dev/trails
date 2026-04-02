import { describe, expect, test } from 'bun:test';
import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configExplain } from '../trails/config-explain.js';
import { env } from '../extensions.js';
import type { ConfigState } from '../registry.js';

/**
 * Build a TrailContext with configService resolved in extensions.
 */
const buildCtx = (state: ConfigState): TrailContext => {
  const extensions = { config: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    service: undefined as unknown as TrailContext['service'],
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    service: createServiceLookup(() => withLookup),
  };
  return withLookup;
};

describe('config.explain trail', () => {
  describe('identity', () => {
    test('has id "config.explain"', () => {
      expect(configExplain.id).toBe('config.explain');
    });

    test('has kind "trail"', () => {
      expect(configExplain.kind).toBe('trail');
    });

    test('has intent "read"', () => {
      expect(configExplain.intent).toBe('read');
    });

    test('has infrastructure metadata', () => {
      expect(configExplain.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has output schema', () => {
      expect(configExplain.output).toBeDefined();
    });

    test('declares configService dependency', () => {
      expect(configExplain.services).toBeDefined();
      expect(configExplain.services?.length).toBe(1);
    });
  });

  describe('examples', () => {
    test('has at least one example', () => {
      expect(configExplain.examples?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('wired behavior', () => {
    test('returns provenance entries for all fields', async () => {
      const schema = z.object({
        host: z.string().default('localhost'),
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        resolved: { host: 'localhost', port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configExplain.run({ path: '' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.entries.length).toBe(2);
      expect(value.entries[0]?.path).toBe('host');
      expect(value.entries[0]?.source).toBe('default');
      expect(value.entries[1]?.path).toBe('port');
    });

    test('filters entries by path prefix', async () => {
      const schema = z.object({
        db: z.object({
          host: z.string().default('localhost'),
          port: z.number().default(5432),
        }),
        name: z.string().default('app'),
      });
      const state: ConfigState = {
        resolved: { db: { host: 'localhost', port: 5432 }, name: 'app' },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configExplain.run({ path: 'db' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.entries.length).toBe(2);
      expect(value.entries[0]?.path).toBe('db.host');
    });

    test('does not match sibling roots that only share a prefix', async () => {
      const schema = z.object({
        db: z.object({
          host: z.string().default('localhost'),
        }),
        dbReplica: z.object({
          host: z.string().default('replica.local'),
        }),
      });
      const state: ConfigState = {
        resolved: {
          db: { host: 'localhost' },
          dbReplica: { host: 'replica.local' },
        },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configExplain.run({ path: 'db' }, ctx);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().entries).toEqual([
        expect.objectContaining({ path: 'db.host' }),
      ]);
    });

    test('shows base layer as source when base provides value', async () => {
      const schema = z.object({
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        base: { port: 8080 },
        resolved: { port: 8080 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configExplain.run({ path: '' }, ctx);

      expect(result.isOk()).toBe(true);
      const [entry] = result.unwrap().entries;
      expect(entry?.source).toBe('base');
      expect(entry?.value).toBe(8080);
    });

    test('shows env as source when env provides value', async () => {
      const schema = z.object({
        token: env(z.string(), 'TOKEN').default('fallback'),
      });
      const state: ConfigState = {
        env: { TOKEN: 'real-secret' },
        resolved: { token: 'real-secret' },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configExplain.run({ path: '' }, ctx);

      expect(result.isOk()).toBe(true);
      const [entry] = result.unwrap().entries;
      expect(entry?.source).toBe('env');
    });
  });
});
