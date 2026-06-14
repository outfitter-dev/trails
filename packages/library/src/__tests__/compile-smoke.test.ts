import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'bun:test';

import { compile } from '../compile.js';
import type { CompileResult } from '../compile.js';
import { fixtureApp } from './fixtures/app.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const toImportPath = (fromDir: string, toFile: string): string => {
  const relativePath = relative(fromDir, toFile);
  const raw = (
    relativePath.endsWith('.ts')
      ? relativePath.slice(0, -'.ts'.length)
      : relativePath
  )
    .split(sep)
    .join('/');
  return raw.startsWith('.') ? raw : `./${raw}`;
};

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
      join(repoRoot, '.trails-life-library-smoke-')
    );
    try {
      const packageRoot = join(tempRoot, 'generated-widget');
      await mkdir(packageRoot, { recursive: true });
      const ontrailsModules = join(packageRoot, 'node_modules', '@ontrails');
      await mkdir(ontrailsModules, { recursive: true });
      await symlink(
        join(repoRoot, 'packages/library'),
        join(ontrailsModules, 'library'),
        'dir'
      );

      const fixtureSource = join(
        repoRoot,
        'packages/library/src/__tests__/fixtures/app.ts'
      );
      await writeFile(
        join(packageRoot, 'fixture-app.ts'),
        `export { fixtureApp } from '${toImportPath(packageRoot, fixtureSource)}';\n`
      );

      const result = compile(fixtureApp, {
        appExportName: 'fixtureApp',
        appImportPath: '../fixture-app',
        packageName: '@fixture/generated-widget',
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
