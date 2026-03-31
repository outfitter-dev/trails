import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { deprecated, env, secret } from '../extensions.js';
import { describeConfig } from '../describe.js';

describe('describeConfig', () => {
  describe('basic field descriptions', () => {
    test('returns path, type, and required for each field', () => {
      const schema = z.object({
        debug: z.boolean(),
        host: z.string(),
        port: z.number(),
      });

      const fields = describeConfig(schema);

      expect(fields).toHaveLength(3);
      const host = fields.find((f) => f.path === 'host');
      expect(host?.type).toBe('string');
      expect(host?.required).toBe(true);

      const port = fields.find((f) => f.path === 'port');
      expect(port?.type).toBe('number');
      expect(port?.required).toBe(true);
    });
  });

  describe('Zod describe() metadata', () => {
    test('includes description from .describe()', () => {
      const schema = z.object({
        host: z.string().describe('The server hostname'),
      });

      const fields = describeConfig(schema);
      const host = fields.find((f) => f.path === 'host');
      expect(host?.description).toBe('The server hostname');
    });
  });

  describe('config metadata', () => {
    test('includes env, secret, deprecated from metadata', () => {
      const schema = z.object({
        apiKey: secret(env(z.string(), 'API_KEY')),
        legacyMode: deprecated(z.boolean(), 'Use "mode" instead').default(
          false
        ),
      });

      const fields = describeConfig(schema);

      const apiKey = fields.find((f) => f.path === 'apiKey');
      expect(apiKey?.env).toBe('API_KEY');
      expect(apiKey?.secret).toBe(true);

      const legacy = fields.find((f) => f.path === 'legacyMode');
      expect(legacy?.deprecated).toBe('Use "mode" instead');
    });
  });

  describe('defaults', () => {
    test('detects default values', () => {
      const schema = z.object({
        debug: z.boolean().default(false),
        port: z.number().default(3000),
      });

      const fields = describeConfig(schema);

      const port = fields.find((f) => f.path === 'port');
      expect(port?.default).toBe(3000);
      expect(port?.required).toBe(false);

      const debug = fields.find((f) => f.path === 'debug');
      expect(debug?.default).toBe(false);
    });
  });

  describe('nested objects', () => {
    test('handles nested object schemas with dot paths', () => {
      const schema = z.object({
        db: z.object({
          host: z.string(),
          port: z.number().default(5432),
        }),
      });

      const fields = describeConfig(schema);

      const dbHost = fields.find((f) => f.path === 'db.host');
      expect(dbHost?.type).toBe('string');
      expect(dbHost?.required).toBe(true);

      const dbPort = fields.find((f) => f.path === 'db.port');
      expect(dbPort?.type).toBe('number');
      expect(dbPort?.default).toBe(5432);
    });
  });

  describe('constraints', () => {
    test('detects enum values', () => {
      const schema = z.object({
        env: z.enum(['development', 'production', 'test']),
      });

      const fields = describeConfig(schema);
      const envField = fields.find((f) => f.path === 'env');
      expect(envField?.type).toBe('enum');
      expect(envField?.constraints?.values).toEqual([
        'development',
        'production',
        'test',
      ]);
    });

    test('detects number min/max constraints', () => {
      const schema = z.object({
        port: z.number().min(1).max(65_535),
      });

      const fields = describeConfig(schema);
      const port = fields.find((f) => f.path === 'port');
      expect(port?.constraints?.min).toBe(1);
      expect(port?.constraints?.max).toBe(65_535);
    });
  });

  describe('optional fields', () => {
    test('marks optional fields as not required', () => {
      const schema = z.object({
        host: z.string(),
        nickname: z.string().optional(),
      });

      const fields = describeConfig(schema);
      const nickname = fields.find((f) => f.path === 'nickname');
      expect(nickname?.required).toBe(false);
    });
  });
});
