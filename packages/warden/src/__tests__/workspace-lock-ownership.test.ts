import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runWarden } from '../cli.js';
import { runProjectWardenRules } from '../trails/run.js';

const roots: string[] = [];

const makeWorkspace = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'warden-workspace-lock-'));
  roots.push(root);
  mkdirSync(join(root, 'apps/configured/src'), { recursive: true });
  writeFileSync(
    join(root, 'trails.config.ts'),
    `export default {
  workspace: { apps: { configured: { root: 'apps/configured' } } },
};
`
  );
  writeFileSync(join(root, 'apps/configured/src/app.ts'), 'export {}\n');
  return root;
};

const lockDiagnostics = async (rootDir: string) => {
  const report = await runWarden({
    rootDir,
    scope: { exclude: ['ignored/**'] },
    tier: 'project-static',
  });
  return report.diagnostics.filter(
    (diagnostic) => diagnostic.rule === 'workspace-lock-ownership'
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('workspace-lock-ownership', () => {
  test('runs once through the public project-rule dispatcher', () => {
    expect(
      runProjectWardenRules({
        unownedWorkspaceLocks: [
          {
            coaching:
              'Declare the lock-owning app root in workspace.apps, or remove the lock if it is stale.',
            kind: 'unconfigured-app-lock',
            path: 'apps/unknown/trails.lock',
            provenance: 'source-collection',
          },
        ],
      })
    ).toEqual([
      expect.objectContaining({
        code: 'unconfigured-app-lock',
        filePath: 'apps/unknown/trails.lock',
        rule: 'workspace-lock-ownership',
      }),
    ]);
  });

  test('warns on a nested unowned lock with path, provenance, and coaching', async () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'apps/unknown'), { recursive: true });
    writeFileSync(join(root, 'apps/unknown/trails.lock'), '{}\n');

    expect(await lockDiagnostics(root)).toEqual([
      expect.objectContaining({
        code: 'unconfigured-app-lock',
        filePath: 'apps/unknown/trails.lock',
        message: expect.stringMatching(
          /provenance: source-collection.*workspace\.apps.*remove/u
        ),
        severity: 'warn',
      }),
    ]);
  });

  test('rejects a workspace-root aggregate lock', async () => {
    const root = makeWorkspace();
    writeFileSync(join(root, 'trails.lock'), '{}\n');

    expect(await lockDiagnostics(root)).toEqual([
      expect.objectContaining({
        code: 'forbidden-workspace-aggregate',
        filePath: 'trails.lock',
        message: expect.stringContaining(
          'Remove the workspace-root trails.lock'
        ),
        severity: 'error',
      }),
    ]);
  });

  test('does not classify excluded paths or nested repositories as apps', async () => {
    const root = makeWorkspace();
    mkdirSync(join(root, 'ignored/app'), { recursive: true });
    mkdirSync(join(root, 'vendor/nested'), { recursive: true });
    writeFileSync(join(root, 'ignored/app/trails.lock'), '{}\n');
    writeFileSync(join(root, 'vendor/nested/trails.lock'), '{}\n');
    execFileSync('git', ['init', '--quiet', join(root, 'vendor/nested')]);

    expect(await lockDiagnostics(root)).toEqual([]);
  });
});
