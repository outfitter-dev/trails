import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { deprecated, env, secret } from '../extensions.js';
import {
  generateEnvExample,
  generateExample,
  generateJsonSchema,
} from '../generate/index.js';

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

describe('generateExample()', () => {
  describe('TOML format', () => {
    test('produces valid TOML with comments for descriptions', () => {
      const result = generateExample(testSchema, 'toml');

      expect(result).toContain('# The server hostname');
      expect(result).toContain('host = "localhost"');
      expect(result).toContain('# The server port');
      expect(result).toContain('port = 3000');
      expect(result).toContain('# Enable verbose logging');
      expect(result).toContain('verbose = false');
    });

    test('annotates deprecated fields in TOML', () => {
      const result = generateExample(annotatedSchema, 'toml');

      expect(result).toContain('# DEPRECATED: Use newEndpoint instead');
    });

    test('handles nested objects as TOML sections', () => {
      const result = generateExample(nestedSchema, 'toml');

      expect(result).toContain('[db]');
      expect(result).toContain('[server]');
      expect(result).toContain('host = "localhost"');
      expect(result).toContain('port = 5432');
    });
  });

  describe('JSON format', () => {
    test('produces valid JSON without comments', () => {
      const result = generateExample(testSchema, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toEqual({
        host: 'localhost',
        port: 3000,
        verbose: false,
      });
    });

    test('handles nested objects', () => {
      const result = generateExample(nestedSchema, 'json');
      const parsed = JSON.parse(result);

      expect(parsed).toHaveProperty('db');
      expect(parsed).toHaveProperty('server');
      expect(parsed.db.host).toBe('localhost');
    });
  });

  describe('JSONC format', () => {
    test('produces JSON with // comments for descriptions', () => {
      const result = generateExample(testSchema, 'jsonc');

      expect(result).toContain('// The server hostname');
      expect(result).toContain('"host"');
      expect(result).toContain('"localhost"');
    });

    test('annotates deprecated fields in JSONC', () => {
      const result = generateExample(annotatedSchema, 'jsonc');

      expect(result).toContain('// DEPRECATED: Use newEndpoint instead');
    });
  });

  describe('YAML format', () => {
    test('produces valid YAML with comments for descriptions', () => {
      const result = generateExample(testSchema, 'yaml');

      expect(result).toContain('# The server hostname');
      expect(result).toContain('host: "localhost"');
      expect(result).toContain('# The server port');
      expect(result).toContain('port: 3000');
      expect(result).toContain('# Enable verbose logging');
      expect(result).toContain('verbose: false');
    });

    test('annotates deprecated fields in YAML', () => {
      const result = generateExample(annotatedSchema, 'yaml');

      expect(result).toContain('# DEPRECATED: Use newEndpoint instead');
    });

    test('handles nested objects', () => {
      const result = generateExample(nestedSchema, 'yaml');

      expect(result).toContain('db:');
      expect(result).toContain('  host: "localhost"');
      expect(result).toContain('server:');
    });
  });
});

describe('generateJsonSchema()', () => {
  test('produces valid JSON Schema with $schema, type, and properties', () => {
    const result = generateJsonSchema(testSchema);

    expect(result.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(result.type).toBe('object');
    expect(result.properties).toBeDefined();
  });

  test('includes title and description from options', () => {
    const result = generateJsonSchema(testSchema, {
      description: 'Server configuration',
      title: 'ServerConfig',
    });

    expect(result.title).toBe('ServerConfig');
    expect(result.description).toBe('Server configuration');
  });

  test('includes descriptions from .describe()', () => {
    const result = generateJsonSchema(testSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['host']?.description).toBe('The server hostname');
    expect(props['port']?.description).toBe('The server port');
  });

  test('includes defaults', () => {
    const result = generateJsonSchema(testSchema);
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

    const result = generateJsonSchema(enumSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['name']?.type).toBe('string');
    expect(props['count']?.type).toBe('number');
    expect(props['enabled']?.type).toBe('boolean');
    expect(props['color']?.enum).toEqual(['red', 'green', 'blue']);
  });

  test('marks deprecated fields', () => {
    const result = generateJsonSchema(annotatedSchema);
    const props = result.properties as Record<string, Record<string, unknown>>;

    expect(props['oldEndpoint']?.deprecated).toBe(true);
  });

  test('lists required fields (those without defaults or optional)', () => {
    const result = generateJsonSchema(annotatedSchema);

    expect(result.required).toContain('apiKey');
    expect(result.required).toContain('oldEndpoint');
  });

  test('recurses into nested object fields', () => {
    const result = generateJsonSchema(nestedSchema);
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

describe('generateEnvExample()', () => {
  test('lists env vars with type info', () => {
    const result = generateEnvExample(testSchema);

    expect(result).toContain('HOST=');
    expect(result).toContain('PORT=');
    expect(result).toContain('string');
    expect(result).toContain('number');
  });

  test('annotates secrets', () => {
    const result = generateEnvExample(annotatedSchema);

    expect(result).toContain('API_KEY=');
    expect(result).toContain('secret');
  });

  test('shows defaults as comments', () => {
    const result = generateEnvExample(testSchema);

    expect(result).toContain('default: "localhost"');
    expect(result).toContain('default: 3000');
  });

  test('returns empty string when no env vars are present', () => {
    const noEnvSchema = z.object({
      name: z.string(),
      verbose: z.boolean().default(false),
    });

    const result = generateEnvExample(noEnvSchema);

    expect(result).toBe('');
  });
});
