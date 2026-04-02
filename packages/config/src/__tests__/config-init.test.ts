import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServiceLookup } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import { env } from '../extensions.js';
import type { ConfigState } from '../registry.js';
import { configInit } from '../trails/config-init.js';

/**
 * Build a TrailContext with configService resolved in extensions.
 */
const buildCtx = (state: ConfigState): TrailContext => {
  const extensions = { config: state };
  const ctx: TrailContext = {
    abortSignal: AbortSignal.timeout(5000),
    cwd: '/tmp',
    env: {},
    extensions,
    requestId: 'test',
    service: undefined as unknown as TrailContext['service'],
    workspaceRoot: '/tmp',
  };
  const withLookup = {
    ...ctx,
    service: createServiceLookup(() => withLookup),
  };
  return withLookup;
};

const testSchema = z.object({
  host: z.string().default('localhost'),
  port: z.number().default(3000),
});

const testState: ConfigState = {
  resolved: { host: 'localhost', port: 3000 },
  schema: testSchema,
};

describe('config.init trail', () => {
  describe('identity', () => {
    test('has id "config.init"', () => {
      expect(configInit.id).toBe('config.init');
    });

    test('has kind "trail"', () => {
      expect(configInit.kind).toBe('trail');
    });

    test('has intent "write"', () => {
      expect(configInit.intent).toBe('write');
    });

    test('has infrastructure metadata', () => {
      expect(configInit.metadata).toEqual({ category: 'infrastructure' });
    });

    test('has output schema', () => {
      expect(configInit.output).toBeDefined();
    });

    test('declares configService dependency', () => {
      expect(configInit.services).toBeDefined();
      expect(configInit.services?.length).toBe(1);
    });
  });

  describe('examples', () => {
    test('has at least one example', () => {
      expect(configInit.examples?.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('wired behavior', () => {
    test('generates TOML output by default', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'toml' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.format).toBe('toml');
      expect(value.content).toContain('host');
      expect(value.content).toContain('port');
      expect(value.content.length).toBeGreaterThan(0);
    });

    test('generates JSON output when requested', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'json' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.format).toBe('json');
      expect(value.content).toContain('"host"');
      expect(value.content).toContain('"port"');
    });

    test('generates YAML output when requested', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'yaml' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.format).toBe('yaml');
      expect(value.content).toContain('host:');
    });

    test('generates JSONC output when requested', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'jsonc' }, ctx);

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.format).toBe('jsonc');
      expect(value.content).toContain('"host"');
    });

    test('output content is non-empty for schema with fields', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'toml' }, ctx);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().content.trim().length).toBeGreaterThan(0);
    });

    test('returns content without writtenFiles when dir is not provided', async () => {
      const ctx = buildCtx(testState);
      const result = await configInit.run({ format: 'toml' }, ctx);

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().writtenFiles).toBeUndefined();
    });
  });

  describe('artifact generation', () => {
    let tempDir: string;

    const envSchema = z.object({
      host: env(z.string(), 'APP_HOST').default('localhost'),
      port: z.number().default(3000),
    });

    const envState: ConfigState = {
      resolved: { host: 'localhost', port: 3000 },
      schema: envSchema,
    };

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'trails-config-init-'));
    });

    afterEach(async () => {
      await rm(tempDir, { force: true, recursive: true });
    });

    test('writes .schema.json when dir is provided', async () => {
      const ctx = buildCtx(envState);
      const result = await configInit.run(
        { dir: tempDir, format: 'toml' },
        ctx
      );

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.writtenFiles).toBeDefined();
      expect(value.writtenFiles).toContainEqual(join(tempDir, '.schema.json'));

      const schemaContent = await readFile(
        join(tempDir, '.schema.json'),
        'utf8'
      );
      const parsed = JSON.parse(schemaContent);
      expect(parsed['$schema']).toBe(
        'https://json-schema.org/draft/2020-12/schema'
      );
    });

    test('writes .env.example when schema has env bindings', async () => {
      const ctx = buildCtx(envState);
      const result = await configInit.run(
        { dir: tempDir, format: 'toml' },
        ctx
      );

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.writtenFiles).toContainEqual(join(tempDir, '.env.example'));

      const envContent = await readFile(join(tempDir, '.env.example'), 'utf8');
      expect(envContent).toContain('APP_HOST');
    });

    test('still returns content alongside written files', async () => {
      const ctx = buildCtx(envState);
      const result = await configInit.run(
        { dir: tempDir, format: 'json' },
        ctx
      );

      expect(result.isOk()).toBe(true);
      const value = result.unwrap();
      expect(value.content.length).toBeGreaterThan(0);
      expect(value.format).toBe('json');
    });
  });
});
