/* oxlint-disable eslint-plugin-jest/require-hook -- testExamples registers tests at module scope */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { topo } from '@ontrails/core';
import { testExamples } from '@ontrails/testing';

import { operatorApp } from '../src/app.js';

const trailsWorkspaceDir = resolve(import.meta.dir, '..', '.trails');
const operatorAppDir = resolve(import.meta.dir, '..');
const trailsBinPath = resolve(operatorAppDir, 'bin', 'trails.ts');
const repoRoot = resolve(import.meta.dir, '..', '..', '..');
const operatorLockPath = resolve(operatorAppDir, 'trails.lock');

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

const runExampleCommand = (
  command: readonly string[],
  cwd: string,
  env?: Record<string, string>
): string => {
  const timeoutMs = 15_000;
  const proc = Bun.spawnSync({
    cmd: [...command],
    cwd,
    ...(env === undefined ? {} : { env }),
    stderr: 'pipe',
    stdout: 'pipe',
    timeout: timeoutMs,
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  const signalCode = proc.signalCode ?? undefined;

  if (!proc.success) {
    throw new Error(
      [
        'Trails example subprocess did not succeed.',
        `command: ${command.join(' ')}`,
        `cwd: ${cwd}`,
        `timeoutMs: ${timeoutMs}`,
        `exitedDueToTimeout: ${proc.exitedDueToTimeout === true}`,
        `exitCode: ${proc.exitCode ?? 'null'}`,
        `signal: ${signalCode ?? 'null'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
      ].join('\n')
    );
  }

  return stdout;
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
    const stdout = runExampleCommand(
      [
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
      operatorAppDir
    );

    expect(JSON.parse(stdout)).toMatchObject({
      actual: { outcome: 'ok' },
      match: true,
    });
  });
}

for (const [trailId, exampleName, scopes] of [
  ['survey.brief', 'Brief capability report', ['trails:run']],
  ['run', 'Run trail by ID', ['trails:run']],
  ['wayfind.outline', 'Outline a Trails source file', ['trails:run']],
  [
    'config.explain',
    'Explain project identity from the current app context',
    ['trails:run'],
  ],
  ['dev.stats', 'Show local dev state', ['trails:run']],
] as const) {
  test(`${trailId} > workspace-root --app example: ${exampleName}`, () => {
    const stdout = runExampleCommand(
      [
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
      repoRoot
    );

    const envelope = JSON.parse(stdout) as {
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
    if (trailId === 'run') {
      expect(envelope.actual?.value).toMatchObject({
        project: {
          app: { appId: 'trails', configured: true },
          configuredAppIds: expect.arrayContaining(['trails']),
          selectedExtent: 'configured-app',
        },
      });
    }
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

test('compile > isolated workspace-root --app example: Compile the current topo to trails.lock', () => {
  const workspaceRoot = mkdtempSync(
    join(tmpdir(), 'trails-example-workspace-')
  );
  const stateHome = mkdtempSync(join(tmpdir(), 'trails-example-state-'));
  const appRoot = join(workspaceRoot, 'apps', 'trails');
  const isolatedLockPath = join(appRoot, 'trails.lock');
  const operatorLock = readFileSync(operatorLockPath, 'utf8');

  try {
    mkdirSync(join(appRoot, 'src'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, 'trails.config.ts'),
      "export default { workspace: { apps: { trails: { root: 'apps/trails' } } } };\n"
    );
    writeFileSync(
      join(appRoot, 'src', 'app.ts'),
      `export { app } from ${JSON.stringify(pathToFileURL(resolve(operatorAppDir, 'src', 'app.ts')).href)};\n`
    );

    const stdout = runExampleCommand(
      [
        process.execPath,
        trailsBinPath,
        'run',
        'example',
        'compile',
        'Compile the current topo to trails.lock',
        '--root-dir',
        workspaceRoot,
        '--app',
        'trails',
        '--json',
        '--permit',
        JSON.stringify({
          id: 'workspace-example-test',
          scopes: ['topo:write', 'trails:run'],
        }),
      ],
      repoRoot,
      {
        ...process.env,
        TRAILS_STATE_HOME: stateHome,
      } as Record<string, string>
    );

    const envelope = JSON.parse(stdout) as {
      readonly actual?: {
        readonly outcome?: string;
        readonly value?: unknown;
      };
      readonly match?: boolean;
    };
    expect(envelope).toMatchObject({
      actual: {
        outcome: 'ok',
        value: {
          project: {
            appId: 'trails',
            configuredAppIds: ['trails'],
            selectedExtent: 'configured-app',
          },
        },
      },
      match: true,
    });
    expect(existsSync(isolatedLockPath)).toBe(true);
    expect(existsSync(join(stateHome, 'trails', 'projects'))).toBe(true);
    expect(readFileSync(operatorLockPath, 'utf8')).toBe(operatorLock);
  } finally {
    rmSync(workspaceRoot, { force: true, recursive: true });
    rmSync(stateHome, { force: true, recursive: true });
  }
});
