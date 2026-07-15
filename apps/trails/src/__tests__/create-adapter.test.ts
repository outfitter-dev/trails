import { deriveCliCommands } from '@ontrails/cli';
import type { Result } from '@ontrails/core';
import { ValidationError } from '@ontrails/core';
import { checkAdapters } from '@ontrails/adapter-kit';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { app } from '../app.js';
import { createAdapterTrail } from '../trails/create-adapter.js';

const roots: string[] = [];

const expectOk = <T>(result: Result<T, Error>): T => {
  if (result.isErr()) {
    throw result.error;
  }
  return result.value;
};

const expectValidationError = (
  result: Result<unknown, Error>
): ValidationError => {
  if (result.isOk()) {
    throw new Error('Expected validation error');
  }
  expect(result.error).toBeInstanceOf(ValidationError);
  return result.error as ValidationError;
};

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

const readText = (root: string, path: string): string =>
  readFileSync(join(root, path), 'utf8');

const readJson = (root: string, path: string): Record<string, unknown> =>
  JSON.parse(readText(root, path)) as Record<string, unknown>;

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'trails-create-adapter-'));
  roots.push(root);
  writeJson(root, 'package.json', {
    name: 'fixture-root',
    workspaces: ['packages/*', 'adapters/*'],
  });
  return root;
};

const writeHttpOwner = (
  root: string,
  targetOverrides: Record<string, unknown> = {}
): void => {
  writeJson(root, 'packages/http/package.json', {
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    },
    name: '@ontrails/http',
    trails: {
      adapterTargets: {
        http: {
          conformance: {
            adapterType: 'HttpAdapterConformanceAdapter',
            casesFactory: 'createHttpAdapterConformanceCases',
            runner: 'runConformance',
          },
          placements: ['extracted', 'subpath'],
          testingImport: '@ontrails/http/testing',
          ...targetOverrides,
        },
      },
    },
  });
  writeFile(
    root,
    'packages/http/src/fetch.ts',
    [
      'import type { Topo } from "@ontrails/core";',
      'export interface CreateFetchHandlerOptions {}',
      'export const createFetchHandler = (graph: Topo, options: CreateFetchHandlerOptions = {}) => {',
      '  void [graph, options];',
      '};',
      '',
    ].join('\n')
  );
  writeFile(
    root,
    'packages/http/src/index.ts',
    [
      'export {',
      '  createFetchHandler,',
      '  type CreateFetchHandlerOptions,',
      '} from "./fetch.js";',
      '',
    ].join('\n')
  );
  writeFile(
    root,
    'packages/http/src/testing.ts',
    [
      'export interface HttpAdapterConformanceAdapter {}',
      'export const createHttpAdapterConformanceCases = () => [];',
      'export const runConformance = () => undefined;',
      '',
    ].join('\n')
  );
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('trails create adapter', () => {
  test('renders as a nested CLI command', () => {
    const commands = deriveCliCommands(app);
    if (commands.isErr()) {
      throw commands.error;
    }

    const paths = commands.value.map((command) => command.path.join(' '));
    expect(paths).toContain('create adapter');
    const createAdapter = commands.value.find(
      (command) => command.path.join(' ') === 'create adapter'
    );
    expect(
      createAdapter?.flags.find((flag) => flag.name === 'placement')?.choices
    ).toEqual(['extracted', 'subpath']);
  });

  test('scaffolds an extracted HTTP adapter from catalog facts', async () => {
    const root = makeRoot();
    writeHttpOwner(root);

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-lite',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toEqual([
      'adapters/hono-lite/package.json',
      'adapters/hono-lite/tsconfig.json',
      'adapters/hono-lite/tsconfig.tests.json',
      'adapters/hono-lite/README.md',
      'adapters/hono-lite/src/index.ts',
      'adapters/hono-lite/src/__tests__/conformance.test.ts',
    ]);
    expect(result.adapterImport).toBe('@ontrails/hono-lite');
    expect(result.targetKey).toBe('@ontrails/http:http');

    const manifest = readJson(root, 'adapters/hono-lite/package.json');
    expect(manifest['trails']).toMatchObject({
      adapter: { target: 'http' },
    });
    expect(manifest['peerDependencies']).toMatchObject({
      '@ontrails/http': 'workspace:^',
    });
    expect(readText(root, 'adapters/hono-lite/src/index.ts')).toContain(
      'createFetchHandler'
    );
    expect(
      readText(root, 'adapters/hono-lite/src/__tests__/conformance.test.ts')
    ).toContain(
      'import {\n  createHttpAdapterConformanceCases,\n  runConformance,\n} from "@ontrails/http/testing";'
    );
    expect(
      readText(root, 'adapters/hono-lite/src/__tests__/conformance.test.ts')
    ).toContain(
      'import type { HttpAdapterConformanceAdapter } from "@ontrails/http/testing";'
    );
    expect(
      readText(root, 'adapters/hono-lite/src/__tests__/conformance.test.ts')
    ).toContain(
      'await runConformance(adapter, await createHttpAdapterConformanceCases());'
    );

    const report = checkAdapters(root);
    expect(report.subjects[0]).toMatchObject({
      packageName: '@ontrails/hono-lite',
      target: 'http',
      testingImport: '@ontrails/http/testing',
    });
    expect(report.diagnostics).toEqual([]);
  });

  test('accepts HTTP scaffold support through owner root star re-exports', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      "export * from './fetch.js';\n"
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-star',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain('adapters/hono-star/src/index.ts');
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts HTTP scaffold support through same-file value export lists', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'export interface CreateFetchHandlerOptions {}',
        'const createFetchHandler = () => undefined;',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-same-file',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain('adapters/hono-same-file/src/index.ts');
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts HTTP options that share type and value declarations', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'export interface CreateFetchHandlerOptions {}',
        'export const CreateFetchHandlerOptions = {};',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'merged-options',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain('adapters/merged-options/src/index.ts');
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts HTTP option type aliases that share a value name', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'export type CreateFetchHandlerOptions = { enabled?: boolean };',
        'export const CreateFetchHandlerOptions = { enabled: true };',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'aliased-options',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain('adapters/aliased-options/src/index.ts');
    expect(result.diagnostics).toEqual([]);
  });

  test('fails before writing when same-file HTTP support type exports resolve only to values', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'const createFetchHandler = () => undefined;',
        'const CreateFetchHandlerOptions = {};',
        'export { createFetchHandler, CreateFetchHandlerOptions };',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'value-only-type-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/value-only-type-support'))).toBe(
      false
    );
  });

  test('fails before writing when HTTP options are exported as an enum', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'export enum CreateFetchHandlerOptions {}',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'enum-options',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/enum-options'))).toBe(false);
  });

  test('accepts HTTP scaffold support through owner root import-export barrels', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'import { createFetchHandler } from "./fetch.js";',
        'export type { CreateFetchHandlerOptions } from "./fetch.js";',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-import-barrel',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain(
      'adapters/hono-import-barrel/src/index.ts'
    );
    expect(result.diagnostics).toEqual([]);
  });

  test('accepts HTTP scaffold type support through same-file import-export barrels', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'import { createFetchHandler } from "./fetch.js";',
        'import type { CreateFetchHandlerOptions } from "./fetch.js";',
        'export type { CreateFetchHandlerOptions };',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-type-import-barrel',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain(
      'adapters/hono-type-import-barrel/src/index.ts'
    );
    expect(result.diagnostics).toEqual([]);
  });

  test('rejects enum options hidden behind a type-only import-export barrel', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/fetch.ts',
      [
        'export enum CreateFetchHandlerOptions {}',
        'export const createFetchHandler = () => undefined;',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'import { createFetchHandler } from "./fetch.js";',
        'import type { CreateFetchHandlerOptions } from "./fetch.js";',
        'export type { CreateFetchHandlerOptions };',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'enum-type-import-barrel',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/enum-type-import-barrel'))).toBe(
      false
    );
  });

  test('fails before writing when HTTP support value re-exports resolve only to types', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'export {',
        '  createFetchHandler,',
        '  type CreateFetchHandlerOptions,',
        '} from "./types.js";',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/types.ts',
      [
        'export type createFetchHandler = () => void;',
        'export interface CreateFetchHandlerOptions {}',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'type-only-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('does not export createFetchHandler');
    expect(existsSync(join(root, 'adapters/type-only-support'))).toBe(false);
  });

  test('fails before writing when same-file HTTP support export lists are declare-only', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        'declare const createFetchHandler: () => unknown;',
        'export interface CreateFetchHandlerOptions {}',
        'export { createFetchHandler };',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'ambient-http-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('does not export createFetchHandler');
    expect(existsSync(join(root, 'adapters/ambient-http-support'))).toBe(false);
  });

  test('emits async-safe conformance invocation for async owner helpers', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export async function createHttpAdapterConformanceCases() {',
        '  return [];',
        '}',
        'export async function runConformance(',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases: unknown[]',
        ') {',
        '  void [adapter, cases];',
        '}',
        '',
      ].join('\n')
    );

    expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'async-http',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(
      readText(root, 'adapters/async-http/src/__tests__/conformance.test.ts')
    ).toContain(
      'await runConformance(adapter, await createHttpAdapterConformanceCases());'
    );
  });

  test('plans an extracted scaffold without touching disk', async () => {
    const root = makeRoot();
    writeHttpOwner(root);

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: true,
          name: 'dry-http',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.dryRun).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.plannedOperations).toEqual(
      expect.arrayContaining([
        { kind: 'write', path: 'adapters/dry-http/package.json' },
        {
          kind: 'write',
          path: 'adapters/dry-http/src/__tests__/conformance.test.ts',
        },
      ])
    );
    expect(existsSync(join(root, 'adapters/dry-http'))).toBe(false);
  });

  test('fails before writing when the extracted adapter directory already exists', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(root, 'adapters/hono-lite/src/index.ts', 'export {};\n');

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-lite',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('Adapter package already exists');
    expect(readText(root, 'adapters/hono-lite/src/index.ts')).toBe(
      'export {};\n'
    );
    expect(existsSync(join(root, 'adapters/hono-lite/package.json'))).toBe(
      false
    );
  });

  test('fails before writing when the adapter package name already exists', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeJson(root, 'packages/existing/package.json', {
      name: '@ontrails/hono-lite',
    });

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-lite',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain(
      'Workspace package name "@ontrails/hono-lite" already exists'
    );
    expect(existsSync(join(root, 'adapters/hono-lite'))).toBe(false);
  });

  test('fails before writing when extracted adapters are outside workspaces', async () => {
    const root = makeRoot();
    writeJson(root, 'package.json', {
      name: 'fixture-root',
      workspaces: ['packages/*'],
    });
    writeHttpOwner(root);

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'hono-lite',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('workspaces must include');
    expect(existsSync(join(root, 'adapters/hono-lite'))).toBe(false);
  });

  test('scaffolds an HTTP subpath adapter from owner catalog facts', async () => {
    const root = makeRoot();
    writeHttpOwner(root);

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'edge',
          placement: 'subpath',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toEqual([
      'packages/http/package.json',
      'packages/http/src/edge/index.ts',
      'packages/http/src/edge/__tests__/conformance.test.ts',
    ]);
    expect(result.adapterImport).toBe('@ontrails/http/edge');
    expect(result.packageName).toBe('@ontrails/http/edge');
    expect(result.placement).toBe('subpath');
    expect(result.targetKey).toBe('@ontrails/http:http');

    const { exports: packageExports } = readJson(
      root,
      'packages/http/package.json'
    );
    expect(packageExports).toMatchObject({
      '.': './src/index.ts',
      './edge': './src/edge/index.ts',
      './package.json': './package.json',
      './testing': './src/testing.ts',
    });
    expect(
      readJson(root, 'packages/http/package.json')['trails']
    ).toMatchObject({
      adapters: {
        './edge': { target: 'http' },
      },
    });
    expect(readText(root, 'packages/http/src/edge/index.ts')).toContain(
      'from "../index.js"'
    );
    expect(
      readText(root, 'packages/http/src/edge/__tests__/conformance.test.ts')
    ).toContain('import { createApp } from "../index.js";');

    const report = checkAdapters(root);
    expect(report.subjects[0]).toMatchObject({
      packageName: '@ontrails/http/edge',
      placement: 'subpath',
      target: 'http',
      testingImport: '@ontrails/http/testing',
    });
    expect(report.diagnostics).toEqual([]);
  });

  test('fails before writing when owner conformance metadata is missing', async () => {
    const root = makeRoot();
    writeHttpOwner(root, {
      conformance: undefined,
    });

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'missing-factory',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('conformance metadata');
    expect(existsSync(join(root, 'adapters/missing-factory'))).toBe(false);
  });

  test('fails before writing when the HTTP owner lacks scaffold support exports', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(root, 'packages/http/src/index.ts', 'export {};\n');

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'missing-http-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('does not export createFetchHandler');
    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/missing-http-support'))).toBe(false);
  });

  test('accepts HTTP root export conditional shorthand', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    const manifest = readJson(root, 'packages/http/package.json');
    writeJson(root, 'packages/http/package.json', {
      ...manifest,
      exports: {
        './package.json': './package.json',
        './testing': './src/testing.ts',
        import: './src/index.ts',
        types: './src/index.ts',
      },
    });

    const result = expectOk(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'conditional-http-root',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(result.created).toContain(
      'adapters/conditional-http-root/src/index.ts'
    );
    expect(result.diagnostics).toEqual([]);
  });

  test('fails before writing when HTTP root export only has a types condition', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    const manifest = readJson(root, 'packages/http/package.json');
    writeJson(root, 'packages/http/package.json', {
      ...manifest,
      exports: {
        '.': { types: './src/index.ts' },
        './package.json': './package.json',
        './testing': './src/testing.ts',
      },
    });

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'types-only-http-root',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('readable package root export');
    expect(existsSync(join(root, 'adapters/types-only-http-root'))).toBe(false);
  });

  test('fails before writing when HTTP support exports only appear in comments or strings', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      [
        '// export const createFetchHandler = () => undefined;',
        'const docs = "export interface CreateFetchHandlerOptions {}";',
        'export {};',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'masked-http-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('does not export createFetchHandler');
    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/masked-http-support'))).toBe(false);
  });

  test('fails before writing when HTTP support star re-exports only appear in strings', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeFile(
      root,
      'packages/http/src/index.ts',
      ['const docs = "export * from \'./fetch.js\';";', 'export {};', ''].join(
        '\n'
      )
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'masked-star-support',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('does not export createFetchHandler');
    expect(error.message).toContain('CreateFetchHandlerOptions');
    expect(existsSync(join(root, 'adapters/masked-star-support'))).toBe(false);
  });

  test('fails before writing when adapter target ids are ambiguous', async () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeJson(root, 'packages/alt-http/package.json', {
      exports: {
        '.': './src/index.ts',
        './package.json': './package.json',
        './testing': './src/testing.ts',
      },
      name: '@ontrails/alt-http',
      trails: {
        adapterTargets: {
          http: {
            conformance: {
              adapterType: 'AltHttpAdapterConformanceAdapter',
              casesFactory: 'createAltHttpAdapterConformanceCases',
              runner: 'runAltConformance',
            },
            placements: ['extracted'],
            testingImport: '@ontrails/alt-http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/alt-http/src/testing.ts',
      [
        'export interface AltHttpAdapterConformanceAdapter {}',
        'export const createAltHttpAdapterConformanceCases = () => [];',
        'export const runAltConformance = () => undefined;',
        '',
      ].join('\n')
    );

    const error = expectValidationError(
      await createAdapterTrail.implementation(
        {
          dryRun: false,
          name: 'ambiguous-http',
          placement: 'extracted',
          rootDir: root,
          target: 'http',
        },
        { cwd: root } as never
      )
    );

    expect(error.message).toContain('Adapter target catalog has diagnostics');
    expect(error.message).toContain('declared by multiple owner packages');
    expect(existsSync(join(root, 'adapters/ambiguous-http'))).toBe(false);
  });
});
