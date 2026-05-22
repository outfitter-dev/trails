import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'bun:test';

const FIXTURE_ROOT = resolve('plugin/hooks/__fixtures__/detect-trails');
const HOOK_PATH = resolve('plugin/hooks/detect-trails.sh');

const runHookAt = async (
  projectDir: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> => {
  const proc = Bun.spawn(['/bin/bash', HOOK_PATH], {
    env: {
      CLAUDE_PROJECT_DIR: projectDir,
      PATH: '/usr/bin:/bin',
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stderr, stdout };
};

const runHook = (
  fixtureName: string
): Promise<{ exitCode: number; stderr: string; stdout: string }> =>
  runHookAt(join(FIXTURE_ROOT, fixtureName));

describe('detect-trails hook', () => {
  test('stays silent outside Trails projects', async () => {
    const result = await runHook('non-trails-package');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('');
  });

  test('detects @ontrails package dependencies', async () => {
    const result = await runHook('ontrails-dependency');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('@ontrails/* package dependency');
    expect(result.stdout).toContain('repo-bundled/current Trails skill');
    expect(result.stdout).toContain('No project-local or PATH `trails` CLI');
  });

  test('detects package.json trails.module', async () => {
    const result = await runHook('package-trails-module');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('package.json trails.module');
    expect(result.stdout).toContain('No project-local or PATH `trails` CLI');
    expect(result.stdout).not.toContain('bun run trails -- warden');
  });

  test('ignores unrelated trails objects with top-level module fields', async () => {
    const rootDir = await mkdtemp(
      join(tmpdir(), 'trails-hook-false-positive-')
    );
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        JSON.stringify(
          {
            module: 'dist/index.js',
            name: 'plain-module-app',
            trails: {
              enabled: false,
            },
          },
          null,
          2
        )
      );

      const result = await runHookAt(rootDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toBe('');
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test('detects root trails config files', async () => {
    const result = await runHook('trails-config');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('trails.config.ts');
  });

  test('detects root .trails directories', async () => {
    const result = await runHook('dot-trails');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('.trails/');
  });

  test('detects guarded topo source conventions', async () => {
    const result = await runHook('guarded-src-app');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('src/app.ts topo source');
  });

  test('uses project-local CLI guidance when a local Trails binary is present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'trails-hook-local-cli-'));
    try {
      await mkdir(join(rootDir, 'node_modules/.bin'), { recursive: true });
      await writeFile(
        join(rootDir, 'package.json'),
        JSON.stringify(
          {
            dependencies: {
              '@ontrails/core': '1.0.0-beta.18',
            },
            name: 'trails-local-cli-app',
          },
          null,
          2
        )
      );
      await writeFile(
        join(rootDir, 'node_modules/.bin/trails'),
        '#!/usr/bin/env sh\necho fixture trails cli\n'
      );
      await chmod(join(rootDir, 'node_modules/.bin/trails'), 0o755);

      const result = await runHookAt(rootDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        './node_modules/.bin/trails warden --lock cached --no-lock-mutation'
      );
      expect(result.stdout).toContain('plugin:installed-skill:check');
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });

  test('uses package script guidance when a trails script is present', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'trails-hook-script-cli-'));
    try {
      await writeFile(
        join(rootDir, 'package.json'),
        JSON.stringify(
          {
            dependencies: {
              '@ontrails/core': '1.0.0-beta.18',
            },
            name: 'trails-script-app',
            scripts: {
              trails: 'trails',
            },
          },
          null,
          2
        )
      );

      const result = await runHookAt(rootDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        'bun run trails -- warden --lock cached --no-lock-mutation'
      );
    } finally {
      await rm(rootDir, { force: true, recursive: true });
    }
  });
});
