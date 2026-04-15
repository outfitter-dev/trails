import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { deprecated, env, secret } from '../extensions.js';
import {
  deriveConfigEnvExample,
  deriveConfigExample,
  deriveConfigJsonSchema,
} from '../derive/index.js';

/** Shared test schema used across generator tests. */
const testSchema = z.object({
  host: env(z.string().describe('The server hostname'), 'HOST').default(
    'localhost'
  ),
  port: env(z.number().describe('The server port'), 'PORT').default(3000),
  verbose: z.boolean().describe('Enable verbose logging').default(false),
});

/** Schema with deprecated and secret fields. */
const annotatedSchema = z.object({
  apiKey: secret(env(z.string().describe('API authentication key'), 'API_KEY')),
  oldEndpoint: deprecated(
    env(z.string().describe('Legacy API endpoint'), 'OLD_ENDPOINT'),
    'Use newEndpoint instead'
  ),
});

/** Schema with nested objects. */
const nestedSchema = z.object({
  db: z.object({
    host: env(z.string().describe('Database host'), 'DB_HOST').default(
      'localhost'
    ),
    port: env(z.number().describe('Database port'), 'DB_PORT').default(5432),
  }),
  server: z.object({
    name: z.string().describe('Server name').default('app'),
  }),
});

describe('deriveConfigExample()', () => {
  describe('TOML format', () => {
    test('produces valid TOML with comments for descriptions', () => {
      const result = deriveConfigExample(testSchema, 'toml');

      expect(result).toContain('# The server hostname');
      expect(result).toContain('host = "localhost"');
      expect(result).toContain('# The server port');
      expect(result).toContain('port = 3000');
      expect(result).toContain('# Enable verbose logging');
      expect(result).toContain('verbose = false');
    });

    test('annotates deprecated fields in TOML', () => {
      const result = deriveConfigExample(annotatedSchema, 'toml');

      expect(result).toContain('# DEPRECATED: Use newEndpoint instead');
    });

    test('handles nested objects as TOML sections', () => {
      const result = deriveConfigExample(nestedSchema, 'toml');

      expect(result).toContain('[db]');
      expect(result).toContain('[server]');
      expect(result).toContain('host = "localhost"');
      expect(result).toContain('port = 5432');
    });
  });

  describe('JSON format', () => {
    test('produces valid JSON without comments', () => {
      const result = deriveConfigExample(testSchema, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        host: 'localhost',
        port: 3000,
        verbose: false,
      });
    });

    test('handles nested objects', () => {
      const result = deriveConfigExample(nestedSchema, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty('db');
      expect(parsed).toHaveProperty('server');
      expect(parsed.db.host).toBe('localhost');
    });
  });

  describe('JSONC format', () => {
    test('produces JSON with // comments for descriptions', () => {
      const result = deriveConfigExample(testSchema, 'jsonc');

      expect(result).toContain('// The server hostname');
      expect(result).toContain('"host"');
      expect(result).toContain('"localhost"');
    });

    test('annotates deprecated fields in JSONC', () => {
      const result = deriveConfigExample(annotatedSchema, 'jsonc');

      expect(result).toContain('// DEPRECATED: Use newEndpoint instead');
    });

    test('handles nested objects', () => {
      const result = deriveConfigExample(nestedSchema, 'jsonc');

      expect(result).toContain('"db"');
      expect(result).toContain('"host"');
      expect(result).toContain('"localhost"');
      expect(result).not.toContain('"db": ""');
    });
  });

  describe('YAML format', () => {
    test('produces valid YAML with comments for descriptions', () => {
      const result = deriveConfigExample(testSchema, 'yaml');

      expect(result).toContain('# The server hostname');
      expect(result).toContain('host: "localhost"');
      expect(result).toContain('# The server port');
      expect(result).toContain('port: 3000');
      expect(result).toContain('# Enable verbose logging');
      expect(result).toContain('verbose: false');
    });

    test('annotates deprecated fields in YAML', () => {
      const result = deriveConfigExample(annotatedSchema, 'yaml');

      expect(result).toContain('# DEPRECATED: Use newEndpoint instead');
    });

    test('handles nested objects', () => {
      const result = deriveConfigExample(nestedSchema, 'yaml');

      expect(result).toContain('db:');
      expect(result).toContain('  host: "localhost"');
      expect(result).toContain('server:');
    });
  });
});

describe('deriveConfigJsonSchema()', () => {
  test('produces valid JSON Schema with $schema, type, and properties', () => {
    const result = deriveConfigJsonSchema(testSchema);

    expect(result.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
  });

  test('includes title and description from options', () => {
    const result = deriveConfigJsonSchema(testSchema, {
      description: 'Server configuration',
      title: 'ServerConfig',
    });

    expect(result.title).toBe('ServerConfig');
    expect(result.description).toBe('Server configuration');
  });

  test('includes descriptions from .describe()', () => {
    const result = deriveConfigJsonSchema(testSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['host']?.description).toBe('The server hostname');
    expect(props['port']?.description).toBe('The server port');
  });

  test('includes defaults', () => {
    const result = deriveConfigJsonSchema(testSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['host']?.default).toBe('localhost');
    expect(props['port']?.default).toBe(3000);
    expect(props['verbose']?.default).toBe(false);
  });

  test('maps string, number, boolean, and enum types correctly', () => {
    const enumSchema = z.object({
      color: z.enum(['red', 'green', 'blue']).describe('The color'),
      count: z.number().describe('A count'),
      enabled: z.boolean().describe('Toggle'),
      name: z.string().describe('A name'),
    });

    const result = deriveConfigJsonSchema(enumSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['name']?.type).toBe('string');
    expect(props['count']?.type).toBe('number');
    expect(props['enabled']?.type).toBe('boolean');
    expect(props['color']?.enum).toEqual(['red', 'green', 'blue']);
  });

  test('marks deprecated fields', () => {
    const result = deriveConfigJsonSchema(annotatedSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['oldEndpoint']?.deprecated).toBe(true);
  });

  test('lists required fields (those without defaults or optional)', () => {
    const result = deriveConfigJsonSchema(annotatedSchema);

    expect(result.required).toContain('apiKey');
    expect(result.required).toContain('oldEndpoint');
  });

  test('recurses into nested object fields', () => {
    const result = deriveConfigJsonSchema(nestedSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['db']?.type).toBe('object');
    const dbProps = props['db']?.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(dbProps['host']?.type).toBe('string');
    expect(dbProps['host']?.description).toBe('Database host');
    expect(dbProps['port']?.type).toBe('number');

    expect(props['server']?.type).toBe('object');
    const serverProps = props['server']?.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(serverProps['name']?.type).toBe('string');
  });
});

describe('deriveConfigEnvExample()', () => {
  test('lists env vars with type info', () => {
    const result = deriveConfigEnvExample(testSchema);

    expect(result).toContain('HOST=');
    expect(result).toContain('PORT=');
    expect(result).toContain('string');
    expect(result).toContain('number');
  });

  test('annotates secrets', () => {
    const result = deriveConfigEnvExample(annotatedSchema);

    expect(result).toContain('API_KEY=');
    expect(result).toContain('secret');
  });

  test('shows defaults as comments', () => {
    const result = deriveConfigEnvExample(testSchema);

    expect(result).toContain('default: "localhost"');
    expect(result).toContain('default: 3000');
  });

  test('returns empty string when no env vars are present', () => {
    const noEnvSchema = z.object({
      name: z.string(),
      verbose: z.boolean().default(false),
    });

    const result = deriveConfigEnvExample(noEnvSchema);

    expect(result).toBe('');
  });
});
