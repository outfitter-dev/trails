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

      const hostDiag = result.diagnostics.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('valid');
      expect(hostDiag?.value).toBe('localhost');
    });
  });

  describe('missing required fields', () => {
    test('reports status "missing" for absent required fields', () => {
      const result = checkConfig(schema, { port: 8080 });

      const hostDiag = result.diagnostics.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('missing');
      expect(hostDiag?.message).toContain('host');
    });
  });

  describe('default fields', () => {
    test('reports status "default" when field uses schema default', () => {
      const result = checkConfig(schema, { host: 'localhost' });

      const portDiag = result.diagnostics.find((d) => d.path === 'port');
      expect(portDiag?.status).toBe('default');
      expect(portDiag?.value).toBe(3000);

      const debugDiag = result.diagnostics.find((d) => d.path === 'debug');
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

      const portDiag = result.diagnostics.find((d) => d.path === 'port');
      expect(portDiag?.status).toBe('invalid');
      expect(portDiag?.message).toBeDefined();
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

      const legacyDiag = result.diagnostics.find(
        (d) => d.path === 'legacyMode'
      );
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
      const hostDiag = result.diagnostics.find((d) => d.path === 'host');
      expect(hostDiag?.status).toBe('valid');
      expect(hostDiag?.value).toBe('envhost');
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
      const dbHostDiag = result.diagnostics.find((d) => d.path === 'db.host');
      expect(dbHostDiag?.status).toBe('valid');
      expect(dbHostDiag?.value).toBe('dbhost.local');
    });
  });
});
