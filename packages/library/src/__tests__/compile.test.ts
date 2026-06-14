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
      'src/client.ts',
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
      dependencies: Record<string, string>;
      exports: Record<string, string>;
      name: string;
    };
    expect(pkg.name).toBe('@fixture/widget');
    expect(pkg.dependencies).toEqual({
      '@ontrails/library': '^1.0.0',
      zod: '^4.3.5',
    });
    expect(JSON.stringify(pkg)).not.toContain('workspace:');
    expect(JSON.stringify(pkg)).not.toContain('catalog:');
    expect(Object.keys(pkg.exports)).toEqual(
      expect.arrayContaining(['.', './result', './schemas', './trails'])
    );
  });

  test('package.json dependency ranges can be overridden for workspace emission', () => {
    const result = compile(fixtureApp, {
      ...options,
      libraryDependency: 'workspace:^',
      zodDependency: 'catalog:',
    });
    const pkg = JSON.parse(fileContent(result, 'package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@ontrails/library']).toBe('workspace:^');
    expect(pkg.dependencies.zod).toBe('catalog:');
  });

  test('root index emits stateless functions and a resource factory', () => {
    const index = fileContent(compile(fixtureApp, options), 'src/index.ts');
    // Stateless trails project to top-level named functions.
    expect(index).toContain('Stateless echo; projects to a root named export.');
    expect(index).toContain('Projects trail `widget.ping`');
    expect(index).toContain('export const widgetPing = (\n  input: unknown');
    expect(index).toContain('export const widgetCheck = (\n  input: unknown');
    expect(index).toContain('export const widgetGreet = (\n  input: unknown');
    expect(index).toContain(
      'export const widgetAudited = (\n  input: Record<string, unknown>'
    );
    expect(index).toContain(
      'The runtime validates declared output schemas before this unwrap returns.'
    );
    // Resource-bearing trails project behind a createX factory.
    expect(index).toContain('import type { SurfaceLibraryOptions }');
    expect(index).toContain(
      "import { createClient, rootClient } from './client.js';"
    );
    expect(index).toContain('export const createLibraryFixture = async (');
    expect(index).toContain('options: SurfaceLibraryOptions = {}');
    expect(index).toContain('const client = await createClient(options);');
    expect(index).toContain('Get a widget by id.');
    expect(index).toContain('widgetGet: (\n      input: unknown');
    expect(index).toContain('widgetAdd: (\n      input: unknown');
    // The generated client shares one held surface through the local topo subpath.
    expect(
      fileContent(compile(fixtureApp, options), 'src/client.ts')
    ).toContain("import { app } from './trails.js';");
  });

  test('result subpath mirrors exports as no-throw methods', () => {
    const result = fileContent(compile(fixtureApp, options), 'src/result.ts');
    expect(result).toContain(
      "import { runLibraryResult } from '@ontrails/library';"
    );
    expect(result).toContain(
      'import type { LibraryError, Result, SurfaceLibraryOptions }'
    );
    expect(result).toContain(
      "import { createClient, rootClient } from './client.js';"
    );
    expect(result).toContain('const resultClient = rootClient;');
    expect(result).toContain('export const widgetPing = (');
    expect(result).toContain(
      'Returns the raw Result boundary for trail `widget.ping`.'
    );
    expect(result).toContain('): Promise<Result<unknown, LibraryError>> =>');
    expect(result).toContain(
      'resultClient.result.widgetPing(input) as Promise<Result<unknown, LibraryError>>;'
    );
    expect(result).toContain('input: Record<string, unknown>');
    expect(result).toContain('export const createLibraryFixture = async (');
    expect(result).toContain('client.result.widgetGet(input)');
    expect(result).toContain(') => runLibraryResult(app, id, input, options);');
  });

  test('client module owns the generated surface initialization', () => {
    const client = fileContent(compile(fixtureApp, options), 'src/client.ts');
    expect(client).toContain("import { surface } from '@ontrails/library';");
    expect(client).toContain("import { app } from './trails.js';");
    expect(client).toContain('export const rootClient = await surface(app);');
    expect(client).toContain(
      'export const createClient = (options: SurfaceLibraryOptions = {}) =>'
    );
  });

  test('schemas subpath fails loudly if projection drifts', () => {
    const schemas = fileContent(compile(fixtureApp, options), 'src/schemas.ts');
    expect(schemas).toContain('const requireExport = (name: string) => {');
    expect(schemas).toContain(
      "throw new Error('missing projected library export: ' + name);"
    );
    expect(schemas).toContain(
      'export const widgetPingInputSchema = requireExport'
    );
    expect(schemas).toContain(
      'export const widgetAuditedInputSchema = requireExport'
    );
    expect(schemas).toContain(
      'export const widgetPingOutputSchema = requireExport'
    );
    expect(schemas).toContain('input: widgetPingInputSchema');
    expect(schemas).toContain('output: widgetPingOutputSchema');
    expect(schemas).toContain('Authored input schema for `widget.ping`');
    expect(schemas).not.toContain('?.input');
    expect(schemas).not.toContain('?.output');
  });

  test('typed bindings project schema-owned public signatures', () => {
    const typed = compile(fixtureApp, {
      ...options,
      trailTypeExports: {
        'widget.get': 'get',
        'widget.ping': 'ping',
      },
      typeImportPath: '@fixture/trails',
    });

    const schemas = fileContent(typed, 'src/schemas.ts');
    expect(schemas).toContain(
      "import type { TrailInput, TrailOutput } from '@ontrails/library';"
    );
    expect(schemas).toContain(
      "import type { get, ping } from '@fixture/trails';"
    );
    expect(schemas).toContain(
      'export type WidgetPingInput = TrailInput<typeof ping>;'
    );
    expect(schemas).toContain(
      'export type WidgetPingOutput = TrailOutput<typeof ping>;'
    );
    expect(schemas).toContain(
      'export type WidgetGetInput = TrailInput<typeof get>;'
    );
    expect(schemas).toContain(
      'export type WidgetGetOutput = TrailOutput<typeof get>;'
    );

    const index = fileContent(typed, 'src/index.ts');
    expect(index).toContain(
      "import type { WidgetGetInput, WidgetGetOutput, WidgetPingInput, WidgetPingOutput } from './schemas.js';"
    );
    expect(index).toContain('input: WidgetPingInput');
    expect(index).toContain('): Promise<WidgetPingOutput> =>');
    expect(index).toContain(
      'rootClient.call.widgetPing(input) as Promise<WidgetPingOutput>;'
    );
    expect(index).toContain('input: WidgetGetInput');
    expect(index).toContain('): Promise<WidgetGetOutput> =>');
    expect(index).toContain('input: Record<string, unknown>');

    const result = fileContent(typed, 'src/result.ts');
    expect(result).toContain('input: WidgetPingInput');
    expect(result).toContain(
      '): Promise<Result<WidgetPingOutput, LibraryError>> =>'
    );
    expect(result).toContain('input: WidgetGetInput');
    expect(result).toContain(
      '): Promise<Result<WidgetGetOutput, LibraryError>> =>'
    );
  });

  test('typed bindings reject invalid source export names', () => {
    expect(() =>
      compile(fixtureApp, {
        ...options,
        trailTypeExports: { 'widget.ping': 'not-valid' },
      })
    ).toThrow('trailTypeExports["widget.ping"] must be an exported identifier');
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
    expect(result.projection.exports).toHaveLength(6);
    expect(result.projection.app).toBe('library-fixture');
  });
});
