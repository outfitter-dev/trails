import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

import { defineConfig } from '../define-config.js';

const schema = z.object({
  debug: z.boolean().default(false),
  host: z.string().default('localhost'),
  port: z.number().default(3000),
});

type EnvKey = 'NODE_ENV' | 'TRAILS_ENV';

interface EnvSnapshot {
  readonly NODE_ENV: string | undefined;
  readonly TRAILS_ENV: string | undefined;
}

const readEnvSnapshot = (): EnvSnapshot => ({
  NODE_ENV: process.env.NODE_ENV,
  TRAILS_ENV: process.env.TRAILS_ENV,
});

const setEnvVar = (key: EnvKey, value: string | undefined): void => {
  if (value === undefined) {
    if (key === 'NODE_ENV') {
      delete process.env.NODE_ENV;
    } else {
      delete process.env.TRAILS_ENV;
    }
    return;
  }
  if (key === 'NODE_ENV') {
    process.env.NODE_ENV = value;
  } else {
    process.env.TRAILS_ENV = value;
  }
};

const restoreEnv = (snapshot: EnvSnapshot): void => {
  setEnvVar('NODE_ENV', snapshot.NODE_ENV);
  setEnvVar('TRAILS_ENV', snapshot.TRAILS_ENV);
};

describe('defineConfig', () => {
  test('returns an object with schema, base, and loadouts', () => {
    const base = { host: 'example.com' };
    const loadouts = { production: { port: 443 } };

    const config = defineConfig({ base, loadouts, schema });

    expect(config.schema).toBe(schema);
    expect(config.base).toBe(base);
    expect(config.loadouts).toBe(loadouts);
  });

  test('resolve() uses TRAILS_ENV to select loadout', async () => {
    const config = defineConfig({
      base: { host: 'example.com' },
      loadouts: {
        production: { host: 'prod.example.com', port: 443 },
        test: { host: 'test.example.com', port: 9999 },
      },
      schema,
    });

    const result = await config.resolve({
      env: { TRAILS_ENV: 'production' },
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().host).toBe('prod.example.com');
    expect(result.unwrap().port).toBe(443);
  });

  test('resolve() with explicit loadout option overrides TRAILS_ENV', async () => {
    const config = defineConfig({
      base: { host: 'example.com' },
      loadouts: {
        production: { host: 'prod.example.com' },
        test: { host: 'test.example.com' },
      },
      schema,
    });

    const result = await config.resolve({
      env: { TRAILS_ENV: 'production' },
      loadout: 'test',
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().host).toBe('test.example.com');
  });

  test('envFromNodeEnv maps NODE_ENV to TRAILS_ENV when unset', async () => {
    const config = defineConfig({
      base: { host: 'example.com' },
      envFromNodeEnv: true,
      loadouts: {
        production: { host: 'prod.example.com', port: 443 },
      },
      schema,
    });

    const result = await config.resolve({
      env: { NODE_ENV: 'production' },
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().host).toBe('prod.example.com');
    expect(result.unwrap().port).toBe(443);
  });

  test('envFromNodeEnv does not mutate process.env', async () => {
    const snapshot = readEnvSnapshot();
    setEnvVar('TRAILS_ENV', undefined);
    setEnvVar('NODE_ENV', 'production');

    try {
      const config = defineConfig({
        base: { host: 'example.com' },
        envFromNodeEnv: true,
        loadouts: {
          production: { host: 'prod.example.com', port: 443 },
        },
        schema,
      });

      const result = await config.resolve();

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().host).toBe('prod.example.com');
      expect(process.env.TRAILS_ENV).toBeUndefined();
    } finally {
      restoreEnv(snapshot);
    }
  });

  test('envFromNodeEnv does not override explicit TRAILS_ENV', async () => {
    const config = defineConfig({
      base: { host: 'example.com' },
      envFromNodeEnv: true,
      loadouts: {
        production: { host: 'prod.example.com' },
        test: { host: 'test.example.com' },
      },
      schema,
    });

    const result = await config.resolve({
      env: { NODE_ENV: 'production', TRAILS_ENV: 'test' },
    });

    expect(result.isOk()).toBe(true);
    expect(result.unwrap().host).toBe('test.example.com');
  });

  test('test loadout works when TRAILS_ENV=test', async () => {
    const config = defineConfig({
      base: { port: 8080 },
      loadouts: {
        test: { debug: true, port: 0 },
      },
      schema,
    });

    const result = await config.resolve({
      env: { TRAILS_ENV: 'test' },
    });

    expect(result.isOk()).toBe(true);
    const value = result.unwrap();
    expect(value.debug).toBe(true);
    expect(value.port).toBe(0);
  });

  describe('local overrides', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'trails-define-config-'));
    });

    afterEach(async () => {
      await rm(tempDir, { force: true, recursive: true });
    });

    test('applies local overrides from .trails/config/local.ts', async () => {
      const configDir = join(tempDir, '.trails', 'config');
      await mkdir(configDir, { recursive: true });
      await Bun.write(
        join(configDir, 'local.ts'),
        'export default { port: 4444 };'
      );

      const config = defineConfig({
        base: { host: 'example.com' },
        schema,
      });

      const result = await config.resolve({
        cwd: tempDir,
        env: {},
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().port).toBe(4444);
    });

    test('local overrides applied between loadout and env', async () => {
      const configDir = join(tempDir, '.trails', 'config');
      await mkdir(configDir, { recursive: true });
      await Bun.write(
        join(configDir, 'local.js'),
        'export default { port: 5555 };'
      );

      const config = defineConfig({
        base: { port: 8080 },
        loadouts: {
          dev: { port: 9090 },
        },
        schema,
      });

      // Local overrides should win over loadout (9090)
      const result = await config.resolve({
        cwd: tempDir,
        env: { TRAILS_ENV: 'dev' },
        loadout: 'dev',
      });

      expect(result.isOk()).toBe(true);
      expect(result.unwrap().port).toBe(5555);
    });

    test('skips local overrides when TRAILS_ENV=test', async () => {
      const configDir = join(tempDir, '.trails', 'config');
      await mkdir(configDir, { recursive: true });
      await Bun.write(
        join(configDir, 'local.ts'),
        'export default { port: 4444 };'
      );

      const config = defineConfig({
        base: { port: 8080 },
        schema,
      });

      const result = await config.resolve({
        cwd: tempDir,
        env: { TRAILS_ENV: 'test' },
      });

      expect(result.isOk()).toBe(true);
      // Should NOT apply local overrides, so port stays at base 8080
      expect(result.unwrap().port).toBe(8080);
    });
  });
});
