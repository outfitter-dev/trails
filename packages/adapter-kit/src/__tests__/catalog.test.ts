import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { deriveAdapterTargetCatalog } from '../catalog.js';

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
  const root = mkdtempSync(join(tmpdir(), 'trails-adapter-catalog-'));
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('deriveAdapterTargetCatalog', () => {
  test('derives adapter target metadata from owner package manifests', () => {
    const root = makeRoot();
    writePackage(root, 'packages/store', {
      exports: {
        '.': './src/index.ts',
        './adapter-support': './src/adapter-support.ts',
        './testing': './src/testing.ts',
      },
      name: '@ontrails/store',
      trails: {
        adapterTargets: {
          store: {
            placements: ['extracted', 'subpath'],
            supportImport: '@ontrails/store/adapter-support',
            testingImport: '@ontrails/store/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/store/src/adapter-support.ts', 'export {};\n');
    writeFile(root, 'packages/store/src/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]).toMatchObject({
      key: '@ontrails/store:store',
      ownerPackage: '@ontrails/store',
      placements: ['extracted', 'subpath'],
      supportImport: '@ontrails/store/adapter-support',
      target: 'store',
      testingImport: '@ontrails/store/testing',
    });
    expect(catalog.targets[0]?.supportExportTarget).toEndWith(
      'packages/store/src/adapter-support.ts'
    );
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/store/src/testing.ts'
    );
  });

  test('derives owner imports from wildcard package export keys', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/http/adapter-support',
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/adapter-support.ts', 'export {};\n');
    writeFile(root, 'packages/http/src/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]).toMatchObject({
      supportImport: '@ontrails/http/adapter-support',
      testingImport: '@ontrails/http/testing',
    });
    expect(catalog.targets[0]?.supportExportTarget).toEndWith(
      'packages/http/src/adapter-support.ts'
    );
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/testing.ts'
    );
  });

  test('rejects wildcard imports excluded by a more specific null export', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        './private/*': null,
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    // The file exists, but the package explicitly blocks ./private/* so the
    // import must not fall through to the broader ./* wildcard.
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('resolves wildcard imports when default precedes conditional null export', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        './private/*': {
          default: './src/private/*.ts',
          import: null,
        },
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/private/testing.ts'
    );
  });

  test('resolves wildcard imports through Node import-compatible conditions', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './module-sync/*': {
          'module-sync': './src/module-sync/*.ts',
        },
        './node-addons/*': {
          'node-addons': './src/node-addons/*.ts',
        },
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/http/module-sync/support',
            testingImport: '@ontrails/http/node-addons/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/module-sync/support.ts', 'export {};\n');
    writeFile(root, 'packages/http/src/node-addons/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.supportExportTarget).toEndWith(
      'packages/http/src/module-sync/support.ts'
    );
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/node-addons/testing.ts'
    );
  });

  test('rejects wildcard imports when conditional null precedes default export', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        './private/*': Object.fromEntries([
          ['import', null],
          ['default', './src/private/*.ts'],
        ]),
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('rejects wildcard imports when conditional arrays exhaust before default export', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        './private/*': Object.fromEntries([
          ['import', [null]],
          ['default', './src/private/*.ts'],
        ]),
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('rejects wildcard imports with only require conditions', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './private/*': {
          require: './src/private/*.cjs',
        },
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/private/testing.cjs',
      'module.exports = {};\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('resolves wildcard imports exposed through node conditions', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './private/*': {
          node: './src/private/*.ts',
        },
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/private/testing.ts'
    );
  });

  test('resolves wildcard imports exposed through export target arrays', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': ['./src/*.ts'],
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

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/testing.ts'
    );
  });

  test('continues wildcard export arrays past invalid targets', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': ['../outside/*.ts', './src/*.ts'],
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

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/testing.ts'
    );
  });

  test('rejects wildcard imports with path-traversal captures', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/foo/../testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('rejects wildcard imports with encoded invalid captures', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          encoded: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/%2e%2e/testing',
          },
          reserved: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/node_modules/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/%2e%2e/testing.ts', 'export {};\n');
    writeFile(
      root,
      'packages/http/src/node_modules/testing.ts',
      'export {};\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.target)).toEqual([
      'encoded',
      'reserved',
    ]);
    expect(
      catalog.diagnostics.every(
        (diagnostic) => diagnostic.code === 'invalid-import'
      )
    ).toBe(true);
  });

  test('rejects wildcard imports with invalid export targets', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': '../outside/*.ts',
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
    writeFile(root, 'packages/outside/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('rejects wildcard imports shadowed by a more specific types-only entry', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        // A conditions object with no runtime target (types-only): Node treats
        // the matched subpath as not exported, so it must block, not fall back.
        './private/*': { types: './src/private/*.d.ts' },
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/private/testing',
          },
        },
      },
    });
    writeFile(root, 'packages/http/src/private/testing.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-import',
      message: expect.stringContaining('does not export that subpath'),
      target: 'http',
    });
  });

  test('resolves sibling wildcard imports when a null exclusion targets another subpath', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './*': './src/*.ts',
        './private/*': null,
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

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/testing.ts'
    );
  });

  test('resolves overlapping wildcards by Node prefix precedence, not key length', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        // Equal total key length; Node prefers the longer prefix before the
        // wildcard, so `@ontrails/http/bar/foo` must resolve through `./bar/*`.
        './*/foo': './src/generic/*.ts',
        './bar/*': './src/bar/*.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            testingImport: '@ontrails/http/bar/foo',
          },
        },
      },
    });
    // Only the Node-correct target exists; the leading-wildcard target does not.
    writeFile(root, 'packages/http/src/bar/foo.ts', 'export {};\n');

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets).toHaveLength(1);
    expect(catalog.targets[0]?.testingExportTarget).toEndWith(
      'packages/http/src/bar/foo.ts'
    );
  });

  test('derives optional owner conformance helper metadata', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]).toMatchObject({
      conformance: {
        adapterType: 'HttpAdapterConformanceAdapter',
        casesFactory: 'createHttpAdapterConformanceCases',
        runner: 'runConformance',
      },
      testingImport: '@ontrails/http/testing',
    });
  });

  test('rejects conformance adapter types backed only by runtime values', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export const HttpAdapterConformanceAdapter = {};',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-conformance',
      message: expect.stringContaining('conformance.adapterType'),
      target: 'http',
    });
  });

  test('accepts conformance adapter types backed by class exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export abstract class HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('accepts async conformance helper value exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export async function createHttpAdapterConformanceCases() { return []; }',
        'export async function runConformance() {}',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('accepts conformance helpers exported through local star re-exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      "export * from './testing-helpers.js';\n"
    );
    writeFile(
      root,
      'packages/http/src/testing-helpers.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('rejects named re-exports that point at erased conformance helpers', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        "export { createHttpAdapterConformanceCases, runConformance } from './types.js';",
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/types.ts',
      [
        'export declare function createHttpAdapterConformanceCases(): unknown[];',
        'export declare function runConformance(): void;',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
  });

  test('keeps looking for value exports after type-only star re-exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        "export type * from './types.js';",
        "export * from './conformance.js';",
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/types.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export type createHttpAdapterConformanceCases = () => unknown[];',
        'export interface runConformance {}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      [
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('reports conformance helpers missing from owner testing exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './testing': './src/testing.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            conformance: {
              adapterType: 'HttpAdapterConformanceAdapter',
              casesFactory: 'createHttpAdapterConformanceCases',
              runner: 'runConformanc',
            },
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-conformance',
      target: 'http',
    });
    expect(catalog.diagnostics[0]?.message).toContain('runConformanc');
  });

  test('ignores commented and string-literal conformance exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        "// export * from './testing-helpers.js';",
        'const docs = "export const runConformance = () => undefined";',
        'const starDocs = "export * from \'./testing-helpers.js\'";',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/testing-helpers.ts',
      [
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => undefined;',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
  });

  test('requires callable conformance helpers to be value exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export type createHttpAdapterConformanceCases = () => unknown[];',
        'export interface runConformance {}',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
    expect(catalog.diagnostics[0]?.message).toContain('value export');
  });

  test('rejects ambient conformance helper value declarations', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export declare const createHttpAdapterConformanceCases: () => unknown[];',
        'export declare function runConformance(): void;',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
  });

  test('validates conformance helpers against exported alias names', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './testing': './src/testing.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            conformance: {
              adapterType: 'HttpAdapterConformanceAdapter',
              casesFactory: 'createHttpAdapterConformanceCases',
              runner: 'actualRunner',
            },
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'const actualRunner = () => {};',
        'export { actualRunner as runConformance };',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-conformance',
      target: 'http',
    });
    expect(catalog.diagnostics[0]?.message).toContain('actualRunner');
  });

  test('accepts conformance helpers exported through alias names', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'interface HttpAdapterConformanceAdapter {}',
        'const actualRunner = () => {};',
        'const actualCasesFactory = () => [];',
        'export {',
        '  actualCasesFactory as createHttpAdapterConformanceCases,',
        '  actualRunner as runConformance,',
        '  type HttpAdapterConformanceAdapter,',
        '};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('accepts conformance helper aliases backed by local value imports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        "import { runConformance as importedRunner } from './conformance.js';",
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export { importedRunner as runConformance };',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      'export function runConformance() {}\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('accepts conformance helper aliases backed by local default imports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        "import importedCasesFactory from './cases.js';",
        "import importedRunner from './conformance.js';",
        'export interface HttpAdapterConformanceAdapter {}',
        'export {',
        '  importedCasesFactory as createHttpAdapterConformanceCases,',
        '  importedRunner as runConformance,',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/cases.ts',
      'export default function createHttpAdapterConformanceCases() { return []; }\n'
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      'export default function runConformance() {}\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('accepts conformance helpers exported through default aliases', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        "export { default as createHttpAdapterConformanceCases } from './cases.js';",
        "export { default as runConformance } from './conformance.js';",
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/cases.ts',
      'export default function createHttpAdapterConformanceCases() { return []; }\n'
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      'export default function runConformance() {}\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.conformance).toEqual({
      adapterType: 'HttpAdapterConformanceAdapter',
      casesFactory: 'createHttpAdapterConformanceCases',
      runner: 'runConformance',
    });
  });

  test('rejects conformance helper aliases backed only by string-literal imports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'const docs = "import { createHttpAdapterConformanceCases, runConformance } from \'./conformance.js\'";',
        'export { createHttpAdapterConformanceCases, runConformance };',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      [
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = () => {};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
  });

  test('rejects conformance helper aliases backed by erased local imports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        "import { runConformance as importedRunner } from './conformance.js';",
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export { importedRunner as runConformance };',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      'export declare function runConformance(): void;\n'
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]).toMatchObject({
      code: 'invalid-conformance',
      message: expect.stringContaining('conformance.runner'),
      target: 'http',
    });
  });

  test('rejects same-file conformance export aliases backed by type-only locals', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
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
            placements: ['extracted'],
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'interface HttpAdapterConformanceAdapter {}',
        'type actualCasesFactory = () => unknown[];',
        'interface actualRunner {}',
        'export {',
        '  actualCasesFactory as createHttpAdapterConformanceCases,',
        '  actualRunner as runConformance,',
        '  type HttpAdapterConformanceAdapter,',
        '};',
        '',
      ].join('\n')
    );

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.casesFactory'),
          target: 'http',
        }),
        expect.objectContaining({
          code: 'invalid-conformance',
          message: expect.stringContaining('conformance.runner'),
          target: 'http',
        }),
      ])
    );
  });

  test('ignores packages without adapter target metadata', () => {
    const root = makeRoot();
    writePackage(root, 'packages/core', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/core',
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog).toEqual({
      diagnostics: [],
      targets: [],
    });
  });

  test('reports invalid adapter target metadata without cataloging it', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          'Bad Target': {
            placements: ['extracted'],
          },
          http: {
            placements: ['extracted', 'portal'],
            supportImport: 42,
          },
          remote: {
            placements: ['extracted'],
            testingImport: '@other/http/testing',
          },
          syntax: {
            conformance: {
              adapterType: 'not-valid()',
              casesFactory: 'createCases',
              runner: 'runConformance',
            },
            placements: ['extracted'],
          },
        },
      },
    });
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

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics.map((entry) => entry.code).toSorted()).toEqual([
      'invalid-adapter-target',
      'invalid-conformance',
      'invalid-conformance',
      'invalid-import',
      'invalid-import',
      'invalid-placement',
    ]);
  });

  test('reports support and testing imports outside the owner package', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/store/adapter-support',
            testingImport: '@ontrails/testing',
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(
      catalog.diagnostics.every((entry) => entry.code === 'invalid-import')
    ).toBe(true);
    expect(catalog.diagnostics[0]?.message).toContain('inside @ontrails/http');
  });

  test('reports owner root support and testing imports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/http',
            testingImport: '@ontrails/http',
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(
      catalog.diagnostics.every((entry) => entry.code === 'invalid-import')
    ).toBe(true);
    expect(catalog.diagnostics[0]?.message).toContain('owner package subpath');
  });

  test('reports empty placements as invalid target metadata', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: [],
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0]?.code).toBe('invalid-placement');
    expect(catalog.diagnostics[0]?.message).toContain('at least one placement');
  });

  test('reports support and testing imports missing from owner exports', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/http/adapter-support',
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(
      catalog.diagnostics.every((entry) => entry.code === 'invalid-import')
    ).toBe(true);
    expect(catalog.diagnostics[0]?.message).toContain('does not export');
  });

  test('reports owner imports whose export targets do not exist', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './adapter-support': './src/missing-adapter-support.ts',
        './testing': './src/missing-testing.ts',
      },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
            supportImport: '@ontrails/http/adapter-support',
            testingImport: '@ontrails/http/testing',
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(
      catalog.diagnostics.every((entry) => entry.code === 'invalid-import')
    ).toBe(true);
    expect(catalog.diagnostics[0]?.message).toContain(
      'missing or non-file target'
    );
  });

  test('keeps extracted and subpath placements distinct and deterministic', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['subpath', 'extracted', 'subpath'],
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.diagnostics).toEqual([]);
    expect(catalog.targets[0]?.placements).toEqual(['extracted', 'subpath']);
  });

  test('rejects duplicate target ids across owner packages', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
          },
        },
      },
    });
    writePackage(root, 'packages/alt-http', {
      exports: { '.': './src/index.ts' },
      name: '@ontrails/alt-http',
      trails: {
        adapterTargets: {
          http: {
            placements: ['extracted'],
          },
        },
      },
    });

    const catalog = deriveAdapterTargetCatalog(root);

    expect(catalog.targets).toEqual([]);
    expect(catalog.diagnostics).toHaveLength(2);
    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'duplicate-adapter-target',
          packageName: '@ontrails/http',
          target: 'http',
        }),
        expect.objectContaining({
          code: 'duplicate-adapter-target',
          packageName: '@ontrails/alt-http',
          target: 'http',
        }),
      ])
    );
  });
});
