import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { env } from '../extensions.js';
import { resolveConfig } from '../resolve.js';

const baseSchema = z.object({
  debug: z.boolean().default(false),
  host: z.string().default('localhost'),
  port: z.number().default(3000),
});

describe('resolveConfig', () => {
  describe('schema defaults', () => {
    test('applies schema defaults when no other source provides values', () => {
      const result = resolveConfig({ schema: baseSchema });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({
        debug: false,
        host: 'localhost',
        port: 3000,
      });
    });
  });

  describe('base config', () => {
    test('overrides schema defaults', () => {
      const result = resolveConfig({
        base: { host: 'example.com', port: 8080 },
        schema: baseSchema,
      });

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.host).toBe('example.com');
      expect(value.port).toBe(8080);
      // Schema default preserved for unspecified fields
      expect(value.debug).toBe(false);
    });
  });

  describe('loadouts', () => {
    test('overrides base config for matching loadout', () => {
      const result = resolveConfig({
        base: { host: 'example.com', port: 8080 },
        loadout: 'production',
        loadouts: {
          production: { host: 'prod.example.com', port: 443 },
        },
        schema: baseSchema,
      });

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.host).toBe('prod.example.com');
      expect(value.port).toBe(443);
      expect(value.debug).toBe(false);
    });

    test('silently ignores unrecognized loadout (base only)', () => {
      const result = resolveConfig({
        base: { host: 'example.com' },
        loadout: 'staging',
        loadouts: {
          production: { host: 'prod.example.com' },
        },
        schema: baseSchema,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().host).toBe('example.com');
    });
  });

  describe('local overrides', () => {
    test('deep-merge on top of loadout', () => {
      const nestedSchema = z.object({
        db: z
          .object({
            host: z.string().default('localhost'),
            port: z.number().default(5432),
          })
          .default({}),
      });

      const result = resolveConfig({
        base: { db: { host: 'db.example.com', port: 5432 } },
        loadout: 'production',
        loadouts: {
          production: { db: { host: 'prod-db.example.com' } },
        },
        localOverrides: { db: { port: 9999 } },
        schema: nestedSchema,
      });

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.db.host).toBe('prod-db.example.com');
      expect(value.db.port).toBe(9999);
    });
  });

  describe('env var overrides', () => {
    test('overrides all other sources', () => {
      const schema = z.object({
        host: env(z.string(), 'APP_HOST').default('localhost'),
        port: env(z.number(), 'APP_PORT').default(3000),
      });

      const result = resolveConfig({
        base: { host: 'example.com', port: 8080 },
        env: { APP_HOST: 'env-host.example.com', APP_PORT: '9090' },
        schema,
      });

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.host).toBe('env-host.example.com');
      expect(value.port).toBe(9090);
    });

    test('coerces string to number', () => {
      const schema = z.object({
        port: env(z.number(), 'PORT').default(3000),
      });

      const result = resolveConfig({
        env: { PORT: '8080' },
        schema,
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().port).toBe(8080);
    });

    test('rejects non-numeric string with Zod error instead of NaN', () => {
      const schema = z.object({
        port: env(z.number(), 'PORT').default(3000),
      });

      const result = resolveConfig({
        env: { PORT: 'abc' },
        schema,
      });

      expect(result.isErr()).toBe(true);
    });

    test('coerces string to boolean', () => {
      const schema = z.object({
        debug: env(z.boolean(), 'DEBUG').default(false),
        verbose: env(z.boolean(), 'VERBOSE').default(false),
      });

      const trueValues = resolveConfig({
        env: { DEBUG: 'true', VERBOSE: '1' },
        schema,
      });
      expect(trueValues.isOk()).toBe(true);
      expect(trueValues.unwrap().debug).toBe(true);
      expect(trueValues.unwrap().verbose).toBe(true);

      const falseValues = resolveConfig({
        env: { DEBUG: 'false', VERBOSE: '0' },
        schema,
      });
      expect(falseValues.isOk()).toBe(true);
      expect(falseValues.unwrap().debug).toBe(false);
      expect(falseValues.unwrap().verbose).toBe(false);
    });
  });

  describe('validation', () => {
    test('missing required field returns Result.err', () => {
      const schema = z.object({
        required: z.string(),
      });

      const result = resolveConfig({ schema });

      expect(result.isErr()).toBe(true);
    });
  });

  describe('mutation safety', () => {
    test('repeated resolve() calls do not mutate the original base', () => {
      const schema = z.object({
        host: env(z.string(), 'APP_HOST').default('localhost'),
      });
      const base = { host: 'dev-host' };

      const first = resolveConfig({
        base,
        env: { APP_HOST: 'env-host' },
        schema,
      });
      expect(first.isOk()).toBe(true);
      expect(first.unwrap().host).toBe('env-host');

      const second = resolveConfig({ base, schema });
      expect(second.isOk()).toBe(true);
      expect(second.unwrap().host).toBe('dev-host');
      expect(base.host).toBe('dev-host');
    });
  });

  describe('full stack', () => {
    test('all 5 sources compose correctly', () => {
      const schema = z.object({
        apiUrl: env(z.string(), 'API_URL').default('http://localhost'),
        debug: env(z.boolean(), 'DEBUG').default(false),
        local: z.string().default('default-local'),
        name: z.string().default('app'),
        port: z.number().default(3000),
      });

      const result = resolveConfig({
        // base overrides name
        base: { name: 'my-app', port: 8080 },
        // env overrides debug and apiUrl
        env: { API_URL: 'https://api.prod.com', DEBUG: 'true' },
        // loadout overrides port
        loadout: 'production',
        loadouts: { production: { port: 443 } },
        // local overrides local
        localOverrides: { local: 'my-local-value' },
        schema,
      });

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      // Schema default
      // (nothing left at just default — name was overridden by base)
      // Base
      expect(value.name).toBe('my-app');
      // Loadout overrides base port
      expect(value.port).toBe(443);
      // Local overrides
      expect(value.local).toBe('my-local-value');
      // Env overrides
      expect(value.apiUrl).toBe('https://api.prod.com');
      expect(value.debug).toBe(true);
    });
  });
});
