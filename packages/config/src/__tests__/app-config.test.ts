import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

import type { AppConfig } from '../app-config.js';
import { appConfig } from '../app-config.js';
import { deriveConfigFields } from '../derive-fields.js';
import { checkConfig } from '../doctor.js';
import { configRef } from '../ref.js';

const testSchema = z.object({
  output: z.string().describe('Output directory').default('./output'),
  verbose: z.boolean().default(false),
});

const createJsonConfig = () =>
  appConfig('myapp', {
    formats: ['json'],
    schema: testSchema,
  });

const writeJsonConfig = (filePath: string, output: string) =>
  Bun.write(filePath, JSON.stringify({ output }));

const resolveOutput = async (
  config: AppConfig<typeof testSchema>,
  filePath: string
): Promise<string> => {
  const result = await config.resolve({ path: filePath });
  expect(result.isOk()).toBe(true);
  return result.unwrap().output;
};

describe('appConfig()', () => {
  describe('creation', () => {
    test('returns an object with the provided name', () => {
      const config = appConfig('myapp', { schema: testSchema });
      expect(config.name).toBe('myapp');
    });

    test('returns the provided schema', () => {
      const config = appConfig('myapp', { schema: testSchema });
      expect(config.schema).toBe(testSchema);
    });

    test('defaults formats to toml, json, yaml when not specified', () => {
      const config = appConfig('myapp', { schema: testSchema });
      expect(config.formats).toEqual(['toml', 'json', 'yaml']);
    });

    test('uses provided formats', () => {
      const config = appConfig('myapp', {
        formats: ['json', 'jsonc'],
        schema: testSchema,
      });
      expect(config.formats).toEqual(['json', 'jsonc']);
    });

    test('defaults dotfile to false when not specified', () => {
      const config = appConfig('myapp', { schema: testSchema });
      expect(config.dotfile).toBe(false);
    });

    test('uses provided dotfile value', () => {
      const config = appConfig('myapp', {
        dotfile: true,
        schema: testSchema,
      });
      expect(config.dotfile).toBe(true);
    });
  });

  describe('resolve() with explicit path', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'trails-config-'));
    });

    afterEach(async () => {
      await rm(tempDir, { force: true, recursive: true });
    });

    test('reads and validates a JSON config file', async () => {
      const filePath = join(tempDir, 'myapp.config.json');
      await Bun.write(
        filePath,
        JSON.stringify({ output: './dist', verbose: true })
      );

      const config = createJsonConfig();
      const result = await config.resolve({ path: filePath });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ output: './dist', verbose: true });
    });

    test('reads and validates a TOML config file', async () => {
      const filePath = join(tempDir, 'myapp.config.toml');
      await Bun.write(filePath, 'output = "./build"\nverbose = true\n');

      const config = appConfig('myapp', {
        formats: ['toml'],
        schema: testSchema,
      });
      const result = await config.resolve({ path: filePath });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ output: './build', verbose: true });
    });

    test('applies schema defaults for missing fields', async () => {
      const filePath = join(tempDir, 'myapp.config.json');
      await Bun.write(filePath, JSON.stringify({}));

      const config = createJsonConfig();
      const result = await config.resolve({ path: filePath });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap()).toEqual({ output: './output', verbose: false });
    });

    test('re-reads config files after they change on disk', async () => {
      const filePath = join(tempDir, 'myapp.config.json');
      await writeJsonConfig(filePath, './first');

      const config = createJsonConfig();

      expect(await resolveOutput(config, filePath)).toBe('./first');

      await Bun.sleep(10);
      await writeJsonConfig(filePath, './second');

      expect(await resolveOutput(config, filePath)).toBe('./second');
    });

    test('returns Result.err when file does not exist', async () => {
      const filePath = join(tempDir, 'nonexistent.json');

      const config = createJsonConfig();
      const result = await config.resolve({ path: filePath });

      expect(result.isErr()).toBe(true);
    });

    test('returns Result.err when file has invalid content', async () => {
      const filePath = join(tempDir, 'myapp.config.json');
      await Bun.write(
        filePath,
        JSON.stringify({ output: 42, verbose: 'not-a-bool' })
      );

      const config = createJsonConfig();
      const result = await config.resolve({ path: filePath });

      expect(result.isErr()).toBe(true);
    });
  });

  describe('resolve() with discovery', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'trails-config-'));
    });

    afterEach(async () => {
      await rm(tempDir, { force: true, recursive: true });
    });

    test('discovers config file in cwd', async () => {
      const filePath = join(tempDir, 'myapp.config.json');
      await writeJsonConfig(filePath, './found');

      const config = createJsonConfig();
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().output).toBe('./found');
    });

    test('discovers config file by walking up directories', async () => {
      const nested = join(tempDir, 'a', 'b', 'c');
      await mkdir(nested, { recursive: true });

      const filePath = join(tempDir, 'myapp.config.json');
      await Bun.write(filePath, JSON.stringify({ output: './parent' }));

      const config = appConfig('myapp', {
        formats: ['json'],
        schema: testSchema,
      });
      const result = await config.resolve({ cwd: nested });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().output).toBe('./parent');
    });

    test('tries formats in order', async () => {
      await Bun.write(
        join(tempDir, 'myapp.config.toml'),
        'output = "./from-toml"\n'
      );
      await Bun.write(
        join(tempDir, 'myapp.config.json'),
        JSON.stringify({ output: './from-json' })
      );

      const config = appConfig('myapp', {
        formats: ['toml', 'json'],
        schema: testSchema,
      });
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().output).toBe('./from-toml');
    });

    test('returns Result.err when no config file found', async () => {
      const config = appConfig('myapp', { schema: testSchema });
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isErr()).toBe(true);
    });
  });

  describe('file naming conventions', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'trails-config-'));
    });

    afterEach(async () => {
      await rm(tempDir, { force: true, recursive: true });
    });

    test('dotfile: true searches for .myapprc.* files', async () => {
      await Bun.write(
        join(tempDir, '.myapprc.json'),
        JSON.stringify({ output: './dotfile' })
      );

      const config = appConfig('myapp', {
        dotfile: true,
        formats: ['json'],
        schema: testSchema,
      });
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().output).toBe('./dotfile');
    });

    test('dotfile: false searches for myapp.config.* files', async () => {
      await Bun.write(
        join(tempDir, 'myapp.config.json'),
        JSON.stringify({ output: './standard' })
      );

      const config = appConfig('myapp', {
        dotfile: false,
        formats: ['json'],
        schema: testSchema,
      });
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().output).toBe('./standard');
    });

    test('dotfile: true does NOT find myapp.config.* files', async () => {
      await Bun.write(
        join(tempDir, 'myapp.config.json'),
        JSON.stringify({ output: './nope' })
      );

      const config = appConfig('myapp', {
        dotfile: true,
        formats: ['json'],
        schema: testSchema,
      });
      const result = await config.resolve({ cwd: tempDir });

      expect(result.isErr()).toBe(true);
    });
  });

  describe('method delegations', () => {
    test('describe() returns same result as deriveConfigFields(schema)', () => {
      const config = appConfig('myapp', { schema: testSchema });
      const methodResult = config.describe();
      const standaloneResult = deriveConfigFields(testSchema);

      expect(methodResult).toEqual(standaloneResult);
    });

    test('check() returns same result as checkConfig(schema, values)', () => {
      const config = appConfig('myapp', { schema: testSchema });
      const values = { output: './dist', verbose: true };

      const methodResult = config.check(values);
      const standaloneResult = checkConfig(testSchema, values);

      expect(methodResult).toEqual(standaloneResult);
    });

    test('ref() returns same result as configRef(path)', () => {
      const config = appConfig('myapp', { schema: testSchema });
      const methodResult = config.ref('output');
      const standaloneResult = configRef('output');

      expect(methodResult).toEqual(standaloneResult);
    });

    test('explain() delegates to deriveConfigProvenance with bound schema', () => {
      const config = appConfig('myapp', { schema: testSchema });
      const resolved = { output: './dist', verbose: true };

      const result = config.explain({ resolved });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0]?.path).toBeDefined();
      expect(result[0]?.source).toBeDefined();
    });
  });
});
