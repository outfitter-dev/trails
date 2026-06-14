import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { compile } from '../compile.js';
import type { CompileResult } from '../compile.js';
import { fixtureApp } from './fixtures/app.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const writePlan = async (
  packageRoot: string,
  result: CompileResult
): Promise<void> => {
  for (const file of result.files) {
    const target = join(packageRoot, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
};

const run = async (
  cmd: readonly string[],
  cwd: string
): Promise<{ readonly stderr: string; readonly stdout: string }> => {
  const proc = Bun.spawn(cmd as string[], {
    cwd,
    env: {
      ...process.env,
      PATH: `${join(repoRoot, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `${cmd.join(' ')} failed with exit ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`
    );
  }
  return { stderr, stdout };
};

describe('generated library package smoke', () => {
  test('emitted package typechecks and dry-run packs', async () => {
    const tempRoot = await mkdtemp(
      join(tmpdir(), 'trails-life-library-smoke-')
    );
    try {
      const packageRoot = join(tempRoot, 'generated-widget');
      await mkdir(packageRoot, { recursive: true });
      const nodeModules = join(packageRoot, 'node_modules');
      const ontrailsModules = join(packageRoot, 'node_modules', '@ontrails');
      await mkdir(ontrailsModules, { recursive: true });
      await symlink(
        join(repoRoot, 'node_modules', '@types'),
        join(nodeModules, '@types'),
        'dir'
      );
      await symlink(
        join(repoRoot, 'packages/library'),
        join(ontrailsModules, 'library'),
        'dir'
      );
      await symlink(
        join(repoRoot, 'packages/core'),
        join(ontrailsModules, 'core'),
        'dir'
      );
      await symlink(
        join(repoRoot, 'node_modules', 'zod'),
        join(nodeModules, 'zod'),
        'dir'
      );

      const fixtureTrailSource = join(
        repoRoot,
        'packages/library/src/__tests__/fixtures/trails.ts'
      );
      await symlink(
        fixtureTrailSource,
        join(packageRoot, 'fixture-trails.ts'),
        'file'
      );
      await writeFile(
        join(packageRoot, 'fixture-app.ts'),
        [
          "import { topo } from '@ontrails/core';",
          "import * as trails from './fixture-trails.js';",
          '',
          "export const fixtureApp = topo('library-fixture', trails);",
          '',
        ].join('\n')
      );

      const result = compile(fixtureApp, {
        appExportName: 'fixtureApp',
        appImportPath: '../fixture-app',
        packageName: '@fixture/generated-widget',
        trailTypeExports: {
          'widget.get': 'get',
          'widget.ping': 'ping',
        },
        typeImportPath: '../fixture-trails',
        version: '0.0.0-smoke',
      });
      await writePlan(packageRoot, result);

      const manifest = JSON.parse(
        result.files.find((file) => file.path === 'package.json')?.content ??
          '{}'
      ) as { readonly dependencies?: Record<string, string> };
      expect(JSON.stringify(manifest)).not.toContain('workspace:');
      expect(JSON.stringify(manifest)).not.toContain('catalog:');

      await run(['tsc', '-p', 'tsconfig.json', '--noEmit'], packageRoot);
      const pack = await run(['bun', 'pm', 'pack', '--dry-run'], packageRoot);
      expect(pack.stdout).toContain('fixture-generated-widget-0.0.0-smoke.tgz');
    } finally {
      await rm(tempRoot, { force: true, recursive: true });
    }
  });
});
