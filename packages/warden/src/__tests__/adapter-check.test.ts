import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { runWardenAdapterChecks } from '../adapter-check.js';
import { parseWardenCommandArgs, runWardenCommand } from '../command.js';

const roots: string[] = [];

const writeFile = (root: string, path: string, value: string): void => {
  const filePath = join(root, path);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
};

const writeJson = (
  root: string,
  path: string,
  value: Record<string, unknown>
): void => {
  writeFile(root, path, `${JSON.stringify(value, null, 2)}\n`);
};

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'warden-adapter-check-'));
  roots.push(root);
  writeJson(root, 'package.json', {
    name: 'fixture-root',
    workspaces: ['packages/*', 'adapters/*'],
  });
  return root;
};

const writePackage = (
  root: string,
  workspacePath: string,
  manifest: Record<string, unknown>
): void => {
  writeJson(root, join(workspacePath, 'package.json'), manifest);
};

const writeHttpOwner = (root: string): void => {
  writePackage(root, 'packages/http', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    },
    name: '@ontrails/http',
    trails: {
      adapterTargets: {
        http: {
          placements: ['extracted'],
          testingImport: '@ontrails/http/testing',
        },
      },
    },
  });
  writeFile(root, 'packages/http/src/testing.ts', 'export {};\n');
};

const writeHonoAdapter = (root: string): void => {
  writePackage(root, 'adapters/hono', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    name: '@ontrails/hono',
    peerDependencies: {
      '@ontrails/http': 'workspace:^',
    },
    trails: {
      adapter: true,
    },
  });
  writeFile(
    root,
    'adapters/hono/src/index.ts',
    'export const honoAdapter = {};\n'
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Warden adapter checks', () => {
  test('maps shared adapter diagnostics into Warden diagnostics', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const diagnostics = runWardenAdapterChecks(root);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'invalid-adapter-metadata',
      rule: 'adapter-check',
      severity: 'warn',
    });
    expect(diagnostics[0]?.message).toContain('trails.adapter as an object');
  });

  test('rejects missing roots before reporting a clean adapter scan', () => {
    const root = makeRoot();
    const missingRoot = join(root, 'missing-root');

    const diagnostics = runWardenAdapterChecks(missingRoot);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: 'adapter-check-root',
      filePath: missingRoot,
      rule: 'adapter-check',
      severity: 'error',
    });
    expect(diagnostics[0]?.message).toContain('rootDir does not exist');
  });

  test('threads --adapter-check into the command runner as warnings', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const parsed = parseWardenCommandArgs(['--adapter-check']);
    expect(parsed.adapterCheck).toBe(true);

    const result = await runWardenCommand({
      args: [
        '--adapter-check',
        '--depth',
        'source',
        '--lock',
        'skip',
        '--format',
        'json',
      ],
      cwd: root,
      env: {},
    });
    const output = JSON.parse(result.output) as {
      readonly diagnostics: readonly {
        readonly code?: string | undefined;
        readonly rule: string;
        readonly severity: 'error' | 'warn';
      }[];
      readonly summary: {
        readonly errors: number;
        readonly warnings: number;
      };
    };

    expect(result.exitCode).toBe(0);
    expect(output.summary).toMatchObject({ errors: 0, warnings: 1 });
    expect(output.diagnostics[0]).toMatchObject({
      code: 'invalid-adapter-metadata',
      rule: 'adapter-check',
      severity: 'warn',
    });
  });

  test('threads missing adapter-check roots into the command runner as errors', async () => {
    const root = makeRoot();
    const missingRoot = join(root, 'missing-root');

    const result = await runWardenCommand({
      args: [
        '--adapter-check',
        '--root-dir',
        missingRoot,
        '--depth',
        'source',
        '--lock',
        'skip',
        '--format',
        'json',
      ],
      cwd: root,
      env: {},
    });
    const output = JSON.parse(result.output) as {
      readonly diagnostics: readonly {
        readonly code?: string | undefined;
        readonly message: string;
        readonly rule: string;
        readonly severity: 'error' | 'warn';
      }[];
      readonly summary: {
        readonly errors: number;
        readonly warnings: number;
      };
    };

    expect(result.exitCode).toBe(1);
    expect(output.summary).toMatchObject({ errors: 1, warnings: 0 });
    expect(output.diagnostics[0]).toMatchObject({
      code: 'adapter-check-root',
      rule: 'adapter-check',
      severity: 'error',
    });
    expect(output.diagnostics[0]?.message).toContain('rootDir does not exist');
  });

  test('--strict can fail the opt-in adapter warnings', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const result = await runWardenCommand({
      args: [
        '--adapter-check',
        '--depth',
        'source',
        '--lock',
        'skip',
        '--strict',
      ],
      cwd: root,
      env: {},
    });

    expect(result.exitCode).toBe(1);
    expect(result.report.diagnostics[0]).toMatchObject({
      code: 'invalid-adapter-metadata',
      rule: 'adapter-check',
      severity: 'warn',
    });
  });
});
