import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createApp } from '../bun.js';
import { createFetchHandler } from '../fetch.js';
import {
  createHttpAdapterConformanceCases,
  runConformance,
} from '../testing.js';
import type { HttpAdapterConformanceAdapter } from '../testing.js';

const packageRoot = resolve(import.meta.dir, '..', '..');
const repoRoot = resolve(packageRoot, '..', '..');

let originalConsoleError = console.error;

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
  source: string
): { readonly exitCode: number; readonly output: string } => {
  const dir = tempDir(name);
  const sourcePath = join(dir, 'consumer.ts');
  const tsconfigPath = join(dir, 'tsconfig.json');

  mkdirSync(dir, { recursive: true });
  writeFileSync(sourcePath, source);
  writeJson(tsconfigPath, {
    compilerOptions: {
      noEmit: true,
      rootDir: repoRoot,
      types: ['bun'],
    },
    extends: join(repoRoot, 'tsconfig.json'),
    include: [sourcePath],
  });

  try {
    const proc = Bun.spawnSync({
      cmd: [
        process.execPath,
        join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
        '-p',
        tsconfigPath,
      ],
      cwd: repoRoot,
      stderr: 'pipe',
      stdout: 'pipe',
      timeout: 55_000,
    });

    return {
      exitCode: proc.exitCode,
      output: [
        proc.stdout.toString(),
        proc.stderr.toString(),
        proc.exitedDueToTimeout
          ? 'typecheck timed out after 55000ms'
          : undefined,
      ]
        .filter((line) => line !== undefined && line.length > 0)
        .join('\n'),
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
};

beforeEach(() => {
  originalConsoleError = console.error;
  console.error = mock(() => {});
});

afterEach(() => {
  console.error = originalConsoleError;
});

const fetchAdapter = {
  createApp: (graph, options) => ({
    fetch: createFetchHandler(graph, options),
  }),
  name: '@ontrails/http/fetch',
} satisfies HttpAdapterConformanceAdapter;

const bunAdapter = {
  createApp,
  name: '@ontrails/http/bun',
} satisfies HttpAdapterConformanceAdapter;

describe('@ontrails/http/testing public subpath', () => {
  test('exports the owner conformance factory', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(packageRoot, 'package.json'), 'utf8')
    ) as {
      readonly exports: Readonly<Record<string, string>>;
      readonly trails?: {
        readonly adapterTargets?: {
          readonly http?: { readonly testingImport?: string };
        };
      };
    };

    expect(packageJson.exports).toMatchObject({
      './testing': './src/testing.ts',
    });
    expect(packageJson.trails?.adapterTargets?.http?.testingImport).toBe(
      '@ontrails/http/testing'
    );
  });

  test('typechecks the public testing subpath', () => {
    const result = typecheckConsumer(
      'http-testing-subpath',
      `
        import {
          createHttpAdapterConformanceCases,
          runConformance,
        } from '@ontrails/http/testing';
        import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';

        const adapter: HttpAdapterConformanceAdapter = {
          createApp: () => ({
            fetch: async () => Response.json({ data: {} }),
          }),
          name: 'demo-http-adapter',
        };

        void [adapter, createHttpAdapterConformanceCases, runConformance];
      `
    );

    if (result.exitCode !== 0) {
      throw new Error(result.output);
    }
  }, 60_000);

  test('accepts record-backed headers in the request context conformance case', async () => {
    const contextCase = createHttpAdapterConformanceCases().find(
      (conformanceCase) =>
        conformanceCase.name === 'threads request context and abort signals'
    );
    const recordHeaderAdapter = {
      createApp: (_graph, options) => ({
        fetch: async (request) => {
          const url = new URL(request.url);
          if (url.pathname === '/permit/scope') {
            await options?.resolvePermit?.({
              headers: { 'X-Tenant-ID': 'tenant-1' },
              requestId: 'req-1',
            });
            return Response.json({
              data: { permitId: 'user-1', requestId: 'req-1' },
            });
          }

          if (url.pathname === '/abort/check') {
            return Response.json({
              data: { aborted: request.signal.aborted },
            });
          }

          return new Response(null, { status: 404 });
        },
      }),
      name: 'record-backed-header-test',
    } satisfies HttpAdapterConformanceAdapter;

    if (!contextCase) {
      throw new Error('request context conformance case was not found');
    }

    await contextCase.check(recordHeaderAdapter);
  });
});

runConformance(fetchAdapter, createHttpAdapterConformanceCases());
runConformance(bunAdapter, createHttpAdapterConformanceCases());
