import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { deprecated, env } from '../extensions.js';
import { checkConfig } from '../doctor.js';

const schema = z.object({
  debug: z.boolean().default(false),
  host: z.string(),
  port: z.number().default(3000),
});

describe('checkConfig', () => {
  describe('valid fields', () => {
    test('reports status "valid" for present and valid fields', () => {
      const result = checkConfig(schema, { host: 'localhost', port: 8080 });

      const hostDiag = result.fields.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('valid');
      expect(hostDiag?.value).toBe('localhost');
    });
  });

  describe('missing required fields', () => {
    test('reports status "missing" for absent required fields', () => {
      const result = checkConfig(schema, { port: 8080 });

      const hostDiag = result.fields.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('missing');
      expect(hostDiag?.message).toContain('host');
    });
  });

  describe('default fields', () => {
    test('reports status "default" when field uses schema default', () => {
      const result = checkConfig(schema, { host: 'localhost' });

      const portDiag = result.fields.find((d) => d.path === 'port');
      expect(portDiag?.status).toBe('default');
      expect(portDiag?.value).toBe(3000);

      const debugDiag = result.fields.find((d) => d.path === 'debug');
      expect(debugDiag?.status).toBe('default');
      expect(debugDiag?.value).toBe(false);
    });
  });

  describe('invalid fields', () => {
    test('reports status "invalid" with message for wrong-type values', () => {
      const result = checkConfig(schema, {
        host: 'localhost',
        port: 'not-a-number',
      });

      const portDiag = result.fields.find((d) => d.path === 'port');
      expect(portDiag?.status).toBe('invalid');
      expect(portDiag?.message).toBeDefined();
    });

    test('preserves catch semantics for object fields', () => {
      const catchSchema = z.object({
        db: z
          .object({
            host: z.string(),
          })
          .catch({ host: 'fallback' }),
      });

      const result = checkConfig(catchSchema, { db: 'bad' });

      expect(result.valid).toBe(true);
      expect(result.fields).toEqual([
        expect.objectContaining({
          path: 'db',
          status: 'valid',
          value: 'bad',
        }),
      ]);
    });
  });

  describe('deprecated fields', () => {
    test('reports status "deprecated" with migration message', () => {
      const deprecatedSchema = z.object({
        host: z.string(),
        legacyMode: deprecated(z.boolean(), 'Use "mode" instead').default(
          false
        ),
      });

      const result = checkConfig(deprecatedSchema, {
        host: 'localhost',
        legacyMode: true,
      });

      const legacyDiag = result.fields.find((d) => d.path === 'legacyMode');
      expect(legacyDiag?.status).toBe('deprecated');
      expect(legacyDiag?.message).toContain('Use "mode" instead');
    });
  });

  describe('valid flag', () => {
    test('returns valid: true when no missing or invalid fields', () => {
      const result = checkConfig(schema, { host: 'localhost', port: 8080 });
      expect(result.valid).toBe(true);
    });

    test('returns valid: false when required field is missing', () => {
      const result = checkConfig(schema, { port: 8080 });
      expect(result.valid).toBe(false);
    });

    test('returns valid: false when field is invalid', () => {
      const result = checkConfig(schema, {
        host: 'localhost',
        port: 'bad',
      });
      expect(result.valid).toBe(false);
    });

    test('returns valid: true when deprecated fields are present', () => {
      const deprecatedSchema = z.object({
        host: z.string(),
        legacyMode: deprecated(z.boolean(), 'Use "mode" instead').default(
          false
        ),
      });

      const result = checkConfig(deprecatedSchema, {
        host: 'localhost',
        legacyMode: true,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('env resolution', () => {
    test('treats env-provided value as valid', () => {
      const envSchema = z.object({
        host: env(z.string(), 'APP_HOST'),
      });

      const result = checkConfig(
        envSchema,
        {},
        { env: { APP_HOST: 'envhost' } }
      );
      const hostDiag = result.fields.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('valid');
      expect(hostDiag?.value).toBe('envhost');
    });

    test('coerces primitive env vars before reporting field validity', () => {
      const envSchema = z.object({
        debug: env(z.boolean(), 'DEBUG'),
        port: env(z.number(), 'PORT'),
      });

      const result = checkConfig(
        envSchema,
        {},
        { env: { DEBUG: 'true', PORT: '8080' } }
      );

      const debugDiag = result.fields.find((d) => d.path === 'debug');
      const portDiag = result.fields.find((d) => d.path === 'port');

      expect(result.valid).toBe(true);
      expect(debugDiag?.status).toBe('valid');
      expect(debugDiag?.value).toBe(true);
      expect(portDiag?.status).toBe('valid');
      expect(portDiag?.value).toBe(8080);
    });

    test('resolves env vars for nested schema fields', () => {
      const nestedSchema = z.object({
        db: z.object({
          host: env(z.string(), 'DB_HOST'),
          port: z.number().default(5432),
        }),
      });

      const result = checkConfig(
        nestedSchema,
        { db: {} },
        { env: { DB_HOST: 'dbhost.local' } }
      );
      const dbHostDiag = result.fields.find((d) => d.path === 'db.host');
      expect(dbHostDiag?.status).toBe('valid');
      expect(dbHostDiag?.value).toBe('dbhost.local');
    });

    test('walks optional nested object schemas for env overrides', () => {
      const nestedSchema = z.object({
        db: z
          .object({
            host: env(z.string(), 'DB_HOST'),
          })
          .optional(),
      });

      const result = checkConfig(
        nestedSchema,
        {},
        { env: { DB_HOST: 'dbhost.local' } }
      );
      const dbHostDiag = result.fields.find((d) => d.path === 'db.host');

      expect(dbHostDiag?.status).toBe('valid');
      expect(dbHostDiag?.value).toBe('dbhost.local');
    });

    test('skips object env bindings instead of replacing nested values with a string', () => {
      const envSchema = z.object({
        db: env(
          z.object({
            host: z.string(),
            port: z.number(),
          }),
          'DB_CONFIG'
        ),
      });

      const result = checkConfig(
        envSchema,
        { db: { host: 'db.local', port: 5432 } },
        { env: { DB_CONFIG: '{"host":"env.local","port":9999}' } }
      );

      expect(result.valid).toBe(true);
      expect(result.fields.find((d) => d.path === 'db.host')?.value).toBe(
        'db.local'
      );
      expect(result.fields.find((d) => d.path === 'db.port')?.value).toBe(5432);
    });

    test('skips catch-wrapped object env bindings', () => {
      const envSchema = z.object({
        db: env(
          z
            .object({
              host: z.string(),
            })
            .catch({ host: 'fallback' }),
          'DB_CONFIG'
        ),
      });

      const result = checkConfig(
        envSchema,
        { db: { host: 'db.local' } },
        { env: { DB_CONFIG: '{"host":"env.local"}' } }
      );

      expect(result.valid).toBe(true);
      expect(result.fields).toEqual([
        expect.objectContaining({
          path: 'db',
          status: 'valid',
          value: { host: 'db.local' },
        }),
      ]);
    });
  });
});
