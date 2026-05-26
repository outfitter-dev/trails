import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir, '..', '..');
const repoRoot = resolve(import.meta.dir, '..', '..', '..', '..');

const tempDir = (name: string): string =>
  join(
    packageRoot,
    '.tmp-tests',
    `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

const writeJson = (path: string, value: unknown): void => {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const typecheckConsumer = (
  name: string,
  source: string,
  options: { readonly traceResolution?: boolean } = {}
): { readonly exitCode: number; readonly output: string } => {
  const dir = tempDir(name);
  const sourcePath = join(dir, 'consumer.ts');
  const tsconfigPath = join(dir, 'tsconfig.json');

  mkdirSync(dir, { recursive: true });
  writeFileSync(sourcePath, source);
  writeJson(tsconfigPath, {
    compilerOptions: {
      baseUrl: repoRoot,
      noEmit: true,
      paths: {
        '@ontrails/*': ['packages/*/src/index.ts', 'adapters/*/src/index.ts'],
        '@ontrails/testing': ['packages/testing/src/index.ts'],
        '@ontrails/testing/cli': ['packages/testing/src/cli.ts'],
        '@ontrails/testing/established': [
          'packages/testing/src/all-established.ts',
        ],
        '@ontrails/testing/http': ['packages/testing/src/http.ts'],
        '@ontrails/testing/mcp': ['packages/testing/src/mcp.ts'],
        '@ontrails/testing/surface-parity': [
          'packages/testing/src/surface-parity.ts',
        ],
      },
      rootDir: repoRoot,
      types: ['bun'],
    },
    extends: join(repoRoot, 'tsconfig.json'),
    include: [sourcePath],
  });

  try {
    const cmd = ['bunx', 'tsc', '-p', tsconfigPath];
    if (options.traceResolution === true) {
      cmd.push('--traceResolution');
    }

    const proc = Bun.spawnSync({
      cmd,
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
    });

    return {
      exitCode: proc.exitCode,
      output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

describe('@ontrails/testing public subpaths', () => {
  test('exports surface harnesses from explicit subpaths', () => {
    const packageJson = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8')
    ) as {
      readonly exports: Readonly<Record<string, string>>;
    };

    expect(packageJson.exports).toMatchObject({
      '.': './src/index.ts',
      './cli': './src/cli.ts',
      './established': './src/all-established.ts',
      './http': './src/http.ts',
      './mcp': './src/mcp.ts',
      './surface-parity': './src/surface-parity.ts',
    });
  });

  test('typechecks root contract helpers without resolving surface peers', () => {
    const result = typecheckConsumer(
      'root-import-boundary',
      `
        import {
          createComposeContext,
          createTestContext,
          ref,
          scenario,
          testAll,
          testContracts,
          testDetours,
          testExamples,
          testTrail,
        } from '@ontrails/testing';
        import type {
          ComposeScenario,
          RefToken,
          ScenarioStep,
          TestLogger,
          TestScenario,
          TestTrailContextOptions,
        } from '@ontrails/testing';

        export type RootTypes = [
          ComposeScenario,
          RefToken,
          ScenarioStep,
          TestLogger,
          TestScenario,
          TestTrailContextOptions,
        ];

        void [
          createComposeContext,
          createTestContext,
          ref,
          scenario,
          testAll,
          testContracts,
          testDetours,
          testExamples,
          testTrail,
        ];
      `,
      { traceResolution: true }
    );

    if (result.exitCode !== 0) {
      throw new Error(result.output);
    }
    expect(result.output).not.toContain('@ontrails/cli');
    expect(result.output).not.toContain('@ontrails/http');
    expect(result.output).not.toContain('@ontrails/mcp');
  }, 30_000);

  test('typechecks surface helpers through their public subpaths', () => {
    const result = typecheckConsumer(
      'surface-subpath-imports',
      `
        import { createCliHarness } from '@ontrails/testing/cli';
        import { testAllEstablished } from '@ontrails/testing/established';
        import { createHttpHarness } from '@ontrails/testing/http';
        import { createMcpHarness } from '@ontrails/testing/mcp';
        import {
          runSurfaceParityExample,
          testSurfaceParity,
        } from '@ontrails/testing/surface-parity';
        import type { CliHarnessOptions } from '@ontrails/testing/cli';
        import type { TestAllEstablishedOptions } from '@ontrails/testing/established';
        import type { HttpHarnessRequest } from '@ontrails/testing/http';
        import type { McpHarnessOptions } from '@ontrails/testing/mcp';
        import type { SurfaceParityOptions } from '@ontrails/testing/surface-parity';

        export type SurfaceSubpathTypes = [
          CliHarnessOptions,
          TestAllEstablishedOptions,
          HttpHarnessRequest,
          McpHarnessOptions,
          SurfaceParityOptions,
        ];

        void [
          createCliHarness,
          testAllEstablished,
          createHttpHarness,
          createMcpHarness,
          runSurfaceParityExample,
          testSurfaceParity,
        ];
      `
    );

    if (result.exitCode !== 0) {
      throw new Error(result.output);
    }
  }, 30_000);
});
