import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { env, secret } from '../extensions.js';
import { explainConfig } from '../explain.js';

const schema = z.object({
  debug: z.boolean().default(false),
  host: z.string().default('localhost'),
  port: z.number().default(3000),
});

describe('explainConfig', () => {
  describe('default source', () => {
    test('reports "default" when no other source provides value', () => {
      const entries = explainConfig({
        resolved: { debug: false, host: 'localhost', port: 3000 },
        schema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.source).toBe('default');
      expect(host?.value).toBe('localhost');
    });
  });

  describe('base overrides default', () => {
    test('reports "base" when base provides value', () => {
      const entries = explainConfig({
        base: { host: 'base.example.com' },
        resolved: { debug: false, host: 'base.example.com', port: 3000 },
        schema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.source).toBe('base');
      expect(host?.value).toBe('base.example.com');
    });
  });

  describe('profile overrides base', () => {
    test('reports "profile" when profile provides winning value', () => {
      const entries = explainConfig({
        base: { host: 'base.example.com' },
        profile: { host: 'profile.example.com' },
        resolved: { debug: false, host: 'profile.example.com', port: 3000 },
        schema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.source).toBe('profile');
      expect(host?.value).toBe('profile.example.com');
    });
  });

  describe('local overrides profile', () => {
    test('reports "local" when local provides winning value', () => {
      const entries = explainConfig({
        base: { host: 'base.example.com' },
        local: { host: 'local.example.com' },
        profile: { host: 'profile.example.com' },
        resolved: { debug: false, host: 'local.example.com', port: 3000 },
        schema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.source).toBe('local');
    });
  });

  describe('env overrides everything', () => {
    test('reports "env" when env provides winning value', () => {
      const envSchema = z.object({
        host: env(z.string(), 'APP_HOST').default('localhost'),
        port: z.number().default(3000),
      });

      const entries = explainConfig({
        base: { host: 'base.example.com' },
        env: { APP_HOST: 'env.example.com' },
        resolved: { host: 'env.example.com', port: 3000 },
        schema: envSchema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.source).toBe('env');
      expect(host?.value).toBe('env.example.com');
    });

    test('walks optional nested object schemas for env-backed entries', () => {
      const envSchema = z.object({
        db: z
          .object({
            host: env(z.string(), 'DB_HOST').default('localhost'),
          })
          .optional(),
      });

      const entries = explainConfig({
        env: { DB_HOST: 'env.example.com' },
        resolved: { db: { host: 'env.example.com' } },
        schema: envSchema,
      });

      const host = entries.find((entry) => entry.path === 'db.host');
      expect(host?.source).toBe('env');
      expect(host?.value).toBe('env.example.com');
    });
  });

  describe('secret redaction', () => {
    test('redacts secret fields', () => {
      const secretSchema = z.object({
        apiKey: secret(env(z.string(), 'API_KEY')),
        host: z.string().default('localhost'),
      });

      const entries = explainConfig({
        env: { API_KEY: 'super-secret-key' },
        resolved: { apiKey: 'super-secret-key', host: 'localhost' },
        schema: secretSchema,
      });

      const apiKey = entries.find((e) => e.path === 'apiKey');
      expect(apiKey?.redacted).toBe(true);
      expect(apiKey?.value).toBe('[REDACTED]');
    });

    test('does not redact non-secret fields', () => {
      const entries = explainConfig({
        resolved: { debug: false, host: 'localhost', port: 3000 },
        schema,
      });

      const host = entries.find((e) => e.path === 'host');
      expect(host?.redacted).toBe(false);
    });
  });
});
