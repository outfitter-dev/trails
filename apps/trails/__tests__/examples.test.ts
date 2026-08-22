/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { topo } from '@ontrails/core';
import { testExamples } from '@ontrails/testing';

import { operatorApp } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');
const operatorAppDir = resolve(import.meta.dir, '..');
const trailsBinPath = resolve(operatorAppDir, 'bin', 'trails.ts');
const repoRoot = resolve(import.meta.dir, '..', '..', '..');

// These examples intentionally describe the caller's current app with stable
// relative paths. Their focused suites materialize the required files and
// exercise mutations; replaying them here would target this checkout.
const environmentTargetedExampleTrails = new Set([
  'compile',
  'dev.clean',
  'dev.reset',
  'dev.stats',
  'guide',
  'run',
  'run.example',
  'run.examples',
  'survey',
  'survey.brief',
  'survey.diff',
  'survey.resource',
  'survey.signal',
  'survey.surfaces',
  'survey.trail',
  'topo',
  'topo.history',
  'topo.pin',
  'topo.unpin',
  'warden',
]);

// These examples exercise the real fresh-app loader. Under the full parallel
// repo suite, package compilation can legitimately push a load past Bun's 5s
// unit-test default even though the same example completes quickly in isolation.
setDefaultTimeout(15_000);

const resetTrailsWorkspace = (): void => {
  rmSync(trailsWorkspaceDir, { force: true, recursive: true });
  mkdirSync(trailsWorkspaceDir, { recursive: true });
};

beforeAll(() => {
  resetTrailsWorkspace();
});

afterAll(() => {
  resetTrailsWorkspace();
});

const operatorExamplesApp = topo(
  'trails-examples',
  Object.fromEntries(
    operatorApp
      .list()
      .filter(
        (trail) =>
          !trail.id.startsWith('wayfind.') &&
          !environmentTargetedExampleTrails.has(trail.id)
      )
      .map((trail) => [trail.id, trail])
  )
);

// Wayfinder CLI dogfood trails depend on saved topo artifacts; the repo-level
// dogfood smoke covers them against exported operator artifacts.
testExamples(operatorExamplesApp, { cwd: repoRoot });

// Relative operator examples must be replayed with the same app-root context a
// caller receives. Assert the actual outcome because run.example also reports
// whether an expected error matched.
for (const exampleName of [
  'Diff against baseline',
  'Breaking changes',
  'Force audit events',
]) {
  test(`survey.diff > environment-targeted example: ${exampleName}`, () => {
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        trailsBinPath,
        'run',
        'example',
        'survey.diff',
        exampleName,
        '--json',
        '--permit',
        '{"id":"example-test","scopes":["trails:run"]}',
      ],
      cwd: operatorAppDir,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 15_000,
    });

    expect(proc.success).toBe(true);
    expect(JSON.parse(proc.stdout.toString())).toMatchObject({
      actual: { outcome: 'ok' },
      match: true,
    });
  });
}

for (const [trailId, exampleName, scopes] of [
  ['survey.brief', 'Brief capability report', ['trails:run']],
  [
    'compile',
    'Compile the current topo to trails.lock',
    ['topo:write', 'trails:run'],
  ],
  ['wayfind.outline', 'Outline a Trails source file', ['trails:run']],
  [
    'config.explain',
    'Explain project identity from the current app context',
    ['trails:run'],
  ],
  ['dev.stats', 'Show local dev state', ['trails:run']],
] as const) {
  test(`${trailId} > workspace-root --app example: ${exampleName}`, () => {
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        trailsBinPath,
        'run',
        'example',
        trailId,
        exampleName,
        '--app',
        'trails',
        '--json',
        '--permit',
        JSON.stringify({ id: 'workspace-example-test', scopes }),
      ],
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 15_000,
    });

    expect(proc.success).toBe(true);
    const envelope = JSON.parse(proc.stdout.toString()) as {
      readonly actual?: {
        readonly outcome?: string;
        readonly value?: unknown;
      };
      readonly match?: boolean;
    };
    expect(envelope).toMatchObject({
      actual: { outcome: 'ok' },
      match: true,
    });
    if (trailId === 'config.explain') {
      expect(envelope.actual?.value).toMatchObject({
        configPath: expect.stringContaining('trails.config.ts'),
        project: {
          app: { appId: 'trails', configured: true },
          selectedExtent: 'configured-app',
        },
      });
    }
    if (trailId === 'dev.stats') {
      expect(envelope.actual?.value).toMatchObject({
        lock: {
          path: expect.stringContaining('apps/trails/trails.lock'),
        },
      });
    }
  });
}
