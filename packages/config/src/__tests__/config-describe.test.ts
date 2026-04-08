import { describe, expect, test } from 'bun:test';
import { createResourceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configDescribe } from '../trails/config-describe.js';
import { env, secret } from '../extensions.js';
import type { ConfigState } from '../registry.js';

/**
 * Build a TrailContext with configResource resolved in extensions.
 */
const buildCtx = (state: ConfigState): TrailContext => {
  const extensions = { config: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    resource: undefined as unknown as TrailContext['resource'],
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    resource: createResourceLookup(() => withLookup),
  };
  return withLookup;
};

describe('config.describe trail', () => {
  describe('identity', () => {
    test('has id "config.describe"', () => {
      expect(configDescribe.id).toBe('config.describe');
    });

    test('has kind "trail"', () => {
      expect(configDescribe.kind).toBe('trail');
    });

    test('has intent "read"', () => {
      expect(configDescribe.intent).toBe('read');
    });

    test('has infrastructure meta', () => {
      expect(configDescribe.meta).toEqual({ category: 'infrastructure' });
    });

    test('has output schema', () => {
      expect(configDescribe.output).toBeDefined();
    });

    test('declares configResource dependency', () => {
      expect(configDescribe.resources).toBeDefined();
      expect(configDescribe.resources?.length).toBe(1);
    });
  });

  describe('examples', () => {
    test('has at least one example', () => {
      expect(configDescribe.examples?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('wired behavior', () => {
    test('returns one field description per schema field', async () => {
      const schema = z.object({
        host: z.string().default('localhost'),
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        resolved: { host: 'localhost', port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configDescribe.blaze({}, ctx);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().fields.length).toBe(2);
    });

    test('includes path and type for each field', async () => {
      const schema = z.object({
        host: z.string().default('localhost'),
        port: z.number().default(3000),
      });
      const state: ConfigState = {
        resolved: { host: 'localhost', port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configDescribe.blaze({}, ctx);
      const { fields } = result.unwrap();

      expect(fields[0]?.path).toBe('host');
      expect(fields[0]?.type).toBe('string');
      expect(fields[1]?.path).toBe('port');
      expect(fields[1]?.type).toBe('number');
    });

    test('includes env annotation when present', async () => {
      const schema = z.object({
        port: env(z.number(), 'PORT').default(3000),
      });
      const state: ConfigState = {
        resolved: { port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configDescribe.blaze({}, ctx);

      expect(result.isOk()).toBe(true);
      const [field] = result.unwrap().fields;
      expect(field?.env).toBe('PORT');
    });

    test('includes secret annotation when present', async () => {
      const schema = z.object({
        token: secret(z.string()).default('tok'),
      });
      const state: ConfigState = {
        resolved: { token: 'tok' },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configDescribe.blaze({}, ctx);

      expect(result.isOk()).toBe(true);
      const [field] = result.unwrap().fields;
      expect(field?.secret).toBe(true);
    });

    test('reports required status correctly', async () => {
      const schema = z.object({
        optional: z.string().optional(),
        required: z.string(),
        withDefault: z.string().default('val'),
      });
      const state: ConfigState = {
        resolved: { required: 'x', withDefault: 'val' },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configDescribe.blaze({}, ctx);

      expect(result.isOk()).toBe(true);
      const { fields } = result.unwrap();
      const findField = (path: string) => fields.find((f) => f.path === path);
      expect(findField('required')?.required).toBe(true);
      expect(findField('optional')?.required).toBe(false);
      expect(findField('withDefault')?.required).toBe(false);
    });
  });
});
