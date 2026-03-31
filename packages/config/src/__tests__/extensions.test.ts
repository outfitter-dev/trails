import { describe, expect, test } from 'bun:test';
import { z, globalRegistry } from 'zod';

import { env, secret, deprecated } from '../extensions.js';
import type { ConfigFieldMeta } from '../extensions.js';
import { collectConfigMeta } from '../collect.js';

describe('env()', () => {
  test('attaches env var name to schema metadata', () => {
    const schema = env(z.string(), 'DATABASE_URL');
    const meta = globalRegistry.get(schema) as ConfigFieldMeta | undefined;

    expect(meta).toBeDefined();
    expect(meta?.env).toBe('DATABASE_URL');
  });
});

describe('secret()', () => {
  test('attaches secret flag to schema metadata', () => {
    const schema = secret(z.string());
    const meta = globalRegistry.get(schema) as ConfigFieldMeta | undefined;

    expect(meta).toBeDefined();
    expect(meta?.secret).toBe(true);
  });
});

describe('deprecated()', () => {
  test('attaches deprecation message to schema metadata', () => {
    const schema = deprecated(z.string(), 'Use NEW_VAR instead');
    const raw = globalRegistry.get(schema) as
      | Record<string, unknown>
      | undefined;

    expect(raw).toBeDefined();
    // Zod 4 reserves `deprecated` as boolean, so the message is stored
    // under `deprecationMessage` and the boolean flag is set.
    expect(raw?.['deprecated']).toBe(true);
    expect(raw?.['deprecationMessage']).toBe('Use NEW_VAR instead');
  });
});

describe('wrapper ordering', () => {
  test('metadata survives through .default() when applied BEFORE the transform', () => {
    const schema = env(z.string(), 'HOST').default('localhost');
    // Metadata lives on the inner type, not the wrapper
    const innerMeta = globalRegistry.get(schema.def.innerType) as
      | ConfigFieldMeta
      | undefined;

    expect(innerMeta).toBeDefined();
    expect(innerMeta?.env).toBe('HOST');
  });

  test('metadata is NOT on the wrapper when applied AFTER .default()', () => {
    // Applying env() after .default() attaches metadata to the ZodDefault wrapper,
    // but collectConfigMeta walks .def.innerType — so the inner string has no metadata.
    const schema = env(z.string().default('localhost'), 'HOST');
    // The wrapper itself has the metadata
    const wrapperMeta = globalRegistry.get(schema) as
      | ConfigFieldMeta
      | undefined;
    expect(wrapperMeta?.env).toBe('HOST');

    // But the inner type does NOT
    const innerMeta = globalRegistry.get(schema.def.innerType) as
      | ConfigFieldMeta
      | undefined;
    expect(innerMeta?.env).toBeUndefined();
  });
});

describe('composition', () => {
  test('multiple wrappers compose: secret(env()) has both env and secret', () => {
    const schema = secret(env(z.string(), 'DB_URL'));
    const meta = globalRegistry.get(schema) as ConfigFieldMeta | undefined;

    expect(meta).toBeDefined();
    expect(meta?.env).toBe('DB_URL');
    expect(meta?.secret).toBe(true);
  });
});

describe('describe() preservation', () => {
  test('.describe() text is preserved alongside custom metadata', () => {
    const schema = env(z.string().describe('The database host'), 'DB_HOST');
    const meta = globalRegistry.get(schema) as
      | Record<string, unknown>
      | undefined;

    expect(meta).toBeDefined();
    expect(meta?.env).toBe('DB_HOST');
    expect(meta?.description).toBe('The database host');
  });
});

describe('collectConfigMeta()', () => {
  test('walks an object schema and returns all field metadata', () => {
    const schema = z.object({
      apiKey: secret(env(z.string(), 'API_KEY')),
      host: env(z.string(), 'HOST').default('localhost'),
      oldVar: deprecated(z.string(), 'Use newVar instead').optional(),
      port: env(z.number(), 'PORT'),
    });

    const meta = collectConfigMeta(schema);

    expect(meta.get('host')).toEqual({ env: 'HOST' });
    expect(meta.get('port')).toEqual({ env: 'PORT' });
    expect(meta.get('apiKey')).toEqual({ env: 'API_KEY', secret: true });
    expect(meta.get('oldVar')).toEqual({ deprecated: 'Use newVar instead' });
  });

  test('handles nested objects with dot-separated paths', () => {
    const schema = z.object({
      cache: z.object({
        ttl: env(z.number(), 'CACHE_TTL').default(3600),
      }),
      db: z.object({
        host: env(z.string(), 'DB_HOST'),
        password: secret(env(z.string(), 'DB_PASSWORD')),
      }),
    });

    const meta = collectConfigMeta(schema);

    expect(meta.get('db.host')).toEqual({ env: 'DB_HOST' });
    expect(meta.get('db.password')).toEqual({
      env: 'DB_PASSWORD',
      secret: true,
    });
    expect(meta.get('cache.ttl')).toEqual({ env: 'CACHE_TTL' });
  });
});
