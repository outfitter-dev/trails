import { describe, expect, test } from 'bun:test';
import { createResourceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { configCheck } from '../trails/config-check.js';
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

    test('has infrastructure meta', () => {
      expect(configCheck.meta).toEqual({ category: 'infrastructure' });
    });

    test('has output schema', () => {
      expect(configCheck.output).toBeDefined();
    });

    test('output schema accepts reported field values', () => {
      expect(
        configCheck.output?.safeParse({
          fields: [
            {
              message: 'Config value is valid',
              path: 'port',
              status: 'valid',
              value: 6543,
            },
          ],
          valid: true,
        }).success
      ).toBe(true);
    });

    test('output schema accepts redacted field markers', () => {
      expect(
        configCheck.output?.safeParse({
          fields: [
            {
              message: 'OK',
              path: 'apiKey',
              redacted: true,
              status: 'valid',
              value: '[REDACTED]',
            },
          ],
          valid: true,
        }).success
      ).toBe(true);
    });

    test('declares configResource dependency', () => {
      expect(configCheck.resources).toBeDefined();
      expect(configCheck.resources?.length).toBe(1);
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
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.fields.length).toBeGreaterThan(0);
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
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(false);
      const missing = value.fields.filter((d) => d.status === 'missing');
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
      const result = await configCheck.blaze({ values: { port: 8080 } }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.valid).toBe(true);
      expect(value.fields.length).toBe(1);
      expect(value.fields[0]?.status).toBe('valid');
    });

    test('redacts secret values before returning surface output', async () => {
      const schema = z.object({
        apiKey: secret(z.string()),
        port: z.number(),
      });
      const state: ConfigState = {
        resolved: { apiKey: 'sk-test-secret', port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const apiKey = result.unwrap().fields.find((f) => f.path === 'apiKey');
      const port = result.unwrap().fields.find((f) => f.path === 'port');
      expect(apiKey).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(port).toEqual(
        expect.objectContaining({
          value: 3000,
        })
      );
      expect(port?.redacted).toBeUndefined();
    });

    test('does not redact missing optional secret values', async () => {
      const schema = z.object({
        apiKey: secret(z.string().optional()),
        port: z.number(),
      });
      const state: ConfigState = {
        resolved: { port: 3000 },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const apiKey = result.unwrap().fields.find((f) => f.path === 'apiKey');
      expect(apiKey).toEqual(
        expect.objectContaining({
          status: 'valid',
          value: undefined,
        })
      );
      expect(apiKey?.redacted).toBeUndefined();
    });

    test('redacts likely-secret env-backed values', async () => {
      const schema = z.object({
        apiKey: env(z.string(), 'API_KEY'),
        host: env(z.string(), 'APP_HOST'),
      });
      const state: ConfigState = {
        resolved: { apiKey: 'sk-test-secret', host: 'localhost' },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const { fields } = result.unwrap();
      expect(fields.find((f) => f.path === 'apiKey')).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(fields.find((f) => f.path === 'host')).toEqual(
        expect.objectContaining({
          status: 'valid',
          value: 'localhost',
        })
      );
      expect(fields.find((f) => f.path === 'host')?.redacted).toBeUndefined();
    });

    test('redacts descendants of likely-secret env parent objects', async () => {
      const schema = z.object({
        credentials: env(
          z.object({
            password: z.string(),
            username: z.string(),
          }),
          'DB_CREDENTIALS'
        ),
        host: z.string(),
      });
      const state: ConfigState = {
        resolved: {
          credentials: { password: 'secret-password', username: 'admin' },
          host: 'db.internal',
        },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const { fields } = result.unwrap();
      expect(fields.find((f) => f.path === 'credentials.password')).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(fields.find((f) => f.path === 'credentials.username')).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(fields.find((f) => f.path === 'host')).toEqual(
        expect.objectContaining({
          status: 'valid',
          value: 'db.internal',
        })
      );
      expect(fields.find((f) => f.path === 'host')?.redacted).toBeUndefined();
    });

    test('redacts descendants of secret parent objects', async () => {
      const schema = z.object({
        db: secret(
          z.object({
            host: z.string(),
            password: z.string(),
          })
        ),
        region: z.string(),
      });
      const state: ConfigState = {
        resolved: {
          db: { host: 'db.internal', password: 'secret-password' },
          region: 'us-east-1',
        },
        schema,
      };
      const ctx = buildCtx(state);
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const { fields } = result.unwrap();
      expect(fields.find((f) => f.path === 'db.host')).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(fields.find((f) => f.path === 'db.password')).toEqual(
        expect.objectContaining({
          redacted: true,
          status: 'valid',
          value: '[REDACTED]',
        })
      );
      expect(fields.find((f) => f.path === 'region')).toEqual(
        expect.objectContaining({
          status: 'valid',
          value: 'us-east-1',
        })
      );
      expect(fields.find((f) => f.path === 'region')?.redacted).toBeUndefined();
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
      const result = await configCheck.blaze(
        { values: { db: { port: 6543 } } },
        ctx
      );

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().valid).toBe(true);
      expect(result.unwrap().fields).toEqual([
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
      const result = await configCheck.blaze({ values: {} }, ctx);

      expect(result.isOk()).toBe(true);
      const defaults = result
        .unwrap()
        .fields.filter((d) => d.status === 'default');
      expect(defaults.length).toBe(1);
    });
  });
});
