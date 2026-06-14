import { describe, expect, test } from 'bun:test';

import { compile } from '../compile.js';
import type { CompileResult } from '../compile.js';
import { fixtureApp } from './fixtures/app.js';

const options = {
  appExportName: 'fixtureApp',
  appImportPath: '@fixture/app',
  packageName: '@fixture/widget',
};

const fileContent = (result: CompileResult, path: string): string => {
  const file = result.files.find((entry) => entry.path === path);
  if (!file) {
    throw new Error(`expected generated file "${path}"`);
  }
  return file.content;
};

describe('compile', () => {
  test('emits the subpath-shaped package file set', () => {
    const result = compile(fixtureApp, options);
    expect(result.files.map((file) => file.path).toSorted()).toEqual([
      'package.json',
      'src/index.ts',
      'src/result.ts',
      'src/schemas.ts',
      'src/trails.ts',
      'tsconfig.json',
    ]);
  });

  test('package.json declares the consumer-facing subpath exports', () => {
    const result = compile(fixtureApp, options);
    const pkg = JSON.parse(fileContent(result, 'package.json')) as {
      name: string;
      exports: Record<string, string>;
    };
    expect(pkg.name).toBe('@fixture/widget');
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining(['.', './result', './schemas', './trails'])
    );
  });

  test('root index emits stateless functions and a resource factory', () => {
    const index = fileContent(compile(fixtureApp, options), 'src/index.ts');
    // Stateless trails project to top-level named functions.
    expect(index).toContain('export const widgetPing = (input: unknown)');
    expect(index).toContain('export const widgetCheck = (input: unknown)');
    expect(index).toContain('export const widgetGreet = (input: unknown)');
    // Resource-bearing trails project behind a createX factory.
    expect(index).toContain('import type { SurfaceLibraryOptions }');
    expect(index).toContain('const rootClient = await surface(fixtureApp);');
    expect(index).toContain('export const createLibraryFixture = async (');
    expect(index).toContain('options: SurfaceLibraryOptions = {}');
    expect(index).toContain(
      'const client = await surface(fixtureApp, options);'
    );
    expect(index).toContain('widgetGet: (input: unknown)');
    expect(index).toContain('widgetAdd: (input: unknown)');
    // The generated code imports the source topo by the configured specifier.
    expect(index).toContain("import { fixtureApp } from '@fixture/app';");
  });

  test('result subpath mirrors exports as no-throw methods', () => {
    const result = fileContent(compile(fixtureApp, options), 'src/result.ts');
    expect(result).toContain(
      "import { kernelRun, surface } from '@ontrails/library';"
    );
    expect(result).toContain('import type { Result, SurfaceLibraryOptions }');
    expect(result).toContain('const resultClient = await surface(fixtureApp);');
    expect(result).toContain('export const widgetPing = (');
    expect(result).toContain('): Promise<Result<unknown, Error>> =>');
    expect(result).toContain('resultClient.result.widgetPing(input);');
    expect(result).toContain('export const createLibraryFixture = async (');
    expect(result).toContain('client.result.widgetGet(input)');
    expect(result).toContain(') => kernelRun(fixtureApp, id, input, options);');
  });

  test('schemas subpath fails loudly if projection drifts', () => {
    const schemas = fileContent(compile(fixtureApp, options), 'src/schemas.ts');
    expect(schemas).toContain('const requireExport = (name: string) => {');
    expect(schemas).toContain(
      "throw new Error('missing projected library export: ' + name);"
    );
    expect(schemas).toContain("input: requireExport('widgetPing').input");
    expect(schemas).not.toContain('?.input');
    expect(schemas).not.toContain('?.output');
  });

  test('trails subpath re-exports the native topo', () => {
    const trails = fileContent(compile(fixtureApp, options), 'src/trails.ts');
    expect(trails).toContain(
      "export { fixtureApp as app } from '@fixture/app';"
    );
  });

  test('does not emit excluded (draft/internal/activation) trails', () => {
    const index = fileContent(compile(fixtureApp, options), 'src/index.ts');
    expect(index).not.toContain('diagnose');
    expect(index).not.toContain('experiment');
    expect(index).not.toContain('onCreated');
    expect(index).not.toContain('secret');
  });

  test('carries the resolved projection on the result', () => {
    const result = compile(fixtureApp, options);
    expect(result.projection.exports).toHaveLength(5);
    expect(result.projection.app).toBe('library-fixture');
  });
});
