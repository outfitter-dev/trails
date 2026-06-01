import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkAdapters } from '../check.js';
import type { AdapterCheckDiagnosticCode } from '../check.js';

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
  const root = mkdtempSync(join(tmpdir(), 'trails-adapter-check-'));
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

const writeHttpOwner = (
  root: string,
  targetOverrides: Record<string, unknown> = {}
): void => {
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
          conformance: {
            adapterType: 'HttpAdapterConformanceAdapter',
            casesFactory: 'createHttpAdapterConformanceCases',
            runner: 'runConformance',
          },
          placements: ['extracted'],
          testingImport: '@ontrails/http/testing',
          ...targetOverrides,
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
};

const writeHonoAdapter = (
  root: string,
  manifestOverrides: Record<string, unknown> = {}
): void => {
  writePackage(root, 'adapters/hono', {
    dependencies: {
      '@ontrails/core': 'workspace:^',
      hono: '^4.7.0',
    },
    exports: {
      '.': './src/index.ts',
      './package.json': './package.json',
    },
    name: '@ontrails/hono',
    peerDependencies: {
      '@ontrails/http': 'workspace:^',
    },
    trails: {
      adapter: {
        target: 'http',
      },
    },
    ...manifestOverrides,
  });
  writeFile(
    root,
    'adapters/hono/src/index.ts',
    'export const honoAdapter = {};\n'
  );
};

const writeHttpConformanceTest = (
  root: string,
  path = 'adapters/hono/src/__tests__/conformance.test.ts'
): void => {
  writeFile(
    root,
    path,
    "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';\n\nrunConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());\n"
  );
};

const codes = (
  diagnostics: readonly { readonly code: AdapterCheckDiagnosticCode }[]
): readonly AdapterCheckDiagnosticCode[] =>
  diagnostics.map((entry) => entry.code).toSorted();

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('checkAdapters', () => {
  test('accepts a valid extracted adapter package', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects).toHaveLength(1);
    expect(report.subjects[0]).toMatchObject({
      conformanceTestPaths: [
        expect.stringContaining(
          'adapters/hono/src/__tests__/conformance.test.ts'
        ),
      ],
      key: '@ontrails/hono',
      ownerPackage: '@ontrails/http',
      packageName: '@ontrails/hono',
      placement: 'extracted',
      target: 'http',
      targetKey: '@ontrails/http:http',
      testingImport: '@ontrails/http/testing',
    });
  });

  test('ignores extracted adapter packages until they declare target metadata', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, { trails: undefined });

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toEqual([]);
  });

  test('ignores existing adapter workspaces that have not opted into adapter metadata', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    for (const packageName of [
      '@ontrails/commander',
      '@ontrails/drizzle',
      '@ontrails/hono',
      '@ontrails/vite',
    ]) {
      const workspaceName = packageName.replace('@ontrails/', '');
      writePackage(root, `adapters/${workspaceName}`, {
        exports: {
          '.': './src/index.ts',
          './package.json': './package.json',
        },
        name: packageName,
      });
    }

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toEqual([]);
  });

  test('reports invalid adapter metadata once a package opts in', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, { trails: { adapter: true } });

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'invalid-adapter-metadata',
      packageName: '@ontrails/hono',
      placement: 'extracted',
    });
  });

  test('reports bad adapter package export maps', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      exports: {
        '.': { types: './src/index.ts' },
        './package.json': {},
      },
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual([
      'missing-package-export',
      'missing-package-export',
    ]);
    expect(report.diagnostics.map((entry) => entry.message)).toEqual([
      expect.stringContaining('export "."'),
      expect.stringContaining('export "./package.json"'),
    ]);
  });

  test('honors package export string shorthand for the root entrypoint', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      exports: './src/index.ts',
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-package-export',
      packageName: '@ontrails/hono',
    });
    expect(report.diagnostics[0]?.message).toContain('export "./package.json"');
  });

  test('honors package export conditional shorthand for the root entrypoint', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      exports: {
        import: './src/index.ts',
      },
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-package-export',
      packageName: '@ontrails/hono',
    });
    expect(report.diagnostics[0]?.message).toContain('export "./package.json"');
  });

  test('reports package exports that point at missing files', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      exports: {
        '.': './src/missing.ts',
        './package.json': './package.json',
      },
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-package-export',
      packageName: '@ontrails/hono',
    });
    expect(report.diagnostics[0]?.message).toContain('export "."');
  });

  test('reports package exports that point at directories', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      exports: {
        '.': './src',
        './package.json': './package.json',
      },
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-package-export',
      packageName: '@ontrails/hono',
    });
    expect(report.diagnostics[0]?.message).toContain('export "."');
  });

  test('reports dependency direction violations', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      dependencies: {
        '@ontrails/http': 'workspace:^',
        hono: '^4.7.0',
      },
      peerDependencies: {},
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual([
      'dependency-direction',
      'dependency-direction',
    ]);
    expect(
      report.diagnostics.map((entry) => entry.message).join('\n')
    ).toContain('runtime dependencies invert the adapter boundary');
    expect(
      report.diagnostics.map((entry) => entry.message).join('\n')
    ).toContain('peerDependencies');
  });

  test('reports optional owner dependencies as runtime boundary violations', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      optionalDependencies: {
        '@ontrails/http': 'workspace:^',
      },
    });
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual(['dependency-direction']);
    expect(report.diagnostics[0]?.message).toContain(
      'runtime dependencies invert the adapter boundary'
    );
  });

  test('reports missing adapter conformance coverage', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('requires declared conformance helper calls from owner testing imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      "import { createHttpAdapterConformanceCases } from '@ontrails/http/testing';\n\nvoid createHttpAdapterConformanceCases;\n"
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
    expect(report.diagnostics[0]?.message).toContain(
      'runConformance(adapter, createHttpAdapterConformanceCases(...))'
    );
  });

  test('requires conformance helper calls to use owner testing bindings', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import '@ontrails/http/testing';",
        "import { createHttpAdapterConformanceCases, runConformance } from '../fake-testing.js';",
        '',
        "runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('accepts aliased conformance helper calls from owner testing imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { describe } from 'bun:test';",
        "import { createHttpAdapterConformanceCases as cases, runConformance as run } from '@ontrails/http/testing';",
        '',
        'void describe;',
        "run({ name: '@ontrails/hono' }, cases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts namespace conformance helper calls from owner testing imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import * as httpTesting from '@ontrails/http/testing';",
        '',
        'httpTesting.runConformance(',
        "  { name: '@ontrails/hono' },",
        '  httpTesting.createHttpAdapterConformanceCases()',
        ');',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts named conformance helper calls after namespace imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import * as httpTesting from '@ontrails/http/testing';",
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        'void httpTesting;',
        "runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts runner calls when the owner runner defaults conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = (',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('requires adapter arguments when the owner runner defaults conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = (',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        'runConformance();',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('rejects sentinel adapter arguments when the owner runner defaults conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance = (',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        'runConformance(undefined);',
        'runConformance(null);',
        'runConformance(void 0);',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('accepts default conformance cases through owner testing re-exports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      "export * from './conformance.js';\n"
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export function runConformance(',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') {',
        '  void [adapter, cases];',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts default conformance cases through owner testing import-export barrels', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
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
      [
        'export function runConformance(',
        '  adapter: unknown,',
        '  cases = createHttpAdapterConformanceCases()',
        ') {',
        '  void [adapter, cases];',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('ignores string-literal owner re-exports when checking defaulted runner cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'const namedDocs = "export { runConformance } from \'./conformance.js\'";',
        'const starDocs = "export * from \'./conformance.js\'";',
        "export { runConformance } from './plain.js';",
        'void namedDocs;',
        'void starDocs;',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/plain.ts',
      [
        'export const runConformance = (adapter: unknown, cases: unknown) => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'packages/http/src/conformance.ts',
      [
        'export const runConformance = (',
        '  adapter: unknown,',
        '  cases = createHttpAdapterConformanceCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('accepts same-file aliased runners that default conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'const makeCases = () => [];',
        'const actualRunner = (',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = makeCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        'export {',
        '  actualRunner as runConformance,',
        '  makeCases as createHttpAdapterConformanceCases,',
        '  type HttpAdapterConformanceAdapter,',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts async runners that default conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export async function runConformance(',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') {',
        '  void [adapter, cases];',
        '}',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts typed runner variables that default conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'packages/http/src/testing.ts',
      [
        'export interface HttpAdapterConformanceAdapter {}',
        'type Runner = (',
        '  adapter: HttpAdapterConformanceAdapter,',
        '  cases?: readonly unknown[]',
        ') => void;',
        'export const createHttpAdapterConformanceCases = () => [];',
        'export const runConformance: Runner = (',
        '  adapter,',
        '  cases = createHttpAdapterConformanceCases()',
        ') => {',
        '  void [adapter, cases];',
        '};',
        '',
      ].join('\n')
    );
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { runConformance } from '@ontrails/http/testing';",
        '',
        "runConformance({ name: '@ontrails/hono' });",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('ignores commented-out adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "// import { createHttpAdapterConformanceCases } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores block-commented adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        '/*',
        " * import { createHttpAdapterConformanceCases } from '@ontrails/http/testing';",
        ' */',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores string-literal adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        '"from @ontrails/http/testing";',
        '"from \'@ontrails/http/testing\'";',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores regex-literal adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "const importPattern = /import('@ontrails\\/http\\/testing')/;",
        'void importPattern;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores type-only adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores commented type-only adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import /* erased */ type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores inline type-only adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { type HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores inline type-only adapter conformance imports split across whitespace', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { type\n HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores side-effect and empty adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import '@ontrails/http/testing';",
        "import {} from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('accepts mixed value and type adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, type HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        'void createHttpAdapterConformanceCases;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts dynamic adapter conformance imports until owners declare helper metadata', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "const testing = await import('@ontrails/http/testing');",
        'void testing.createHttpAdapterConformanceCases;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts dynamic adapter conformance imports after semicolonless type aliases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "type Adapter = import('@ontrails/http/testing').HttpAdapterConformanceAdapter",
        "const testing = await import('@ontrails/http/testing');",
        "testing.runConformance({ name: '@ontrails/hono' }, testing.createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts dynamic adapter conformance imports after function return types', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'async function loadTesting(): Promise<unknown> {',
        "  return await import('@ontrails/http/testing');",
        '}',
        'const testing = await loadTesting() as typeof import("@ontrails/http/testing");',
        "testing.runConformance({ name: '@ontrails/hono' }, testing.createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts destructured dynamic conformance helper imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "const { runConformance, createHttpAdapterConformanceCases } = await import('@ontrails/http/testing');",
        "runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts dynamic adapter conformance imports in object literal values', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'const modules = {',
        "  testing: await import('@ontrails/http/testing'),",
        '};',
        'void modules.testing.createHttpAdapterConformanceCases;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('accepts dynamic conditional imports until owners declare helper metadata', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'const cached = undefined as unknown;',
        'const useCached = false;',
        "const testing = useCached ? cached : await import('@ontrails/http/testing');",
        'void testing;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('ignores direct, type-argument, and nested type-query adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "type Adapter = import('@ontrails/http/testing').HttpAdapterConformanceAdapter;",
        "const adapter: import('@ontrails/http/testing').HttpAdapterConformanceAdapter = {} as never;",
        "const adapters: Array<import('@ontrails/http/testing').HttpAdapterConformanceAdapter> = [];",
        "const testing = {} as typeof import('@ontrails/http/testing');",
        "expectTypeOf<import('@ontrails/http/testing').HttpAdapterConformanceAdapter>();",
        "function acceptsGeneric<T extends import('@ontrails/http/testing').HttpAdapterConformanceAdapter>() {}",
        "class ImplementsAdapter implements import('@ontrails/http/testing').HttpAdapterConformanceAdapter {}",
        'void adapter;',
        'void adapters;',
        'void acceptsGeneric;',
        'void ImplementsAdapter;',
        'void testing;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores type-only conformance imports after semicolonless export markers', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'export {}',
        "import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        'type Adapter = HttpAdapterConformanceAdapter;',
        'const adapter = {} as Adapter;',
        'void adapter;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores import.meta before type-only conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'const here = import.meta.url;',
        "import type { HttpAdapterConformanceAdapter } from '@ontrails/http/testing';",
        'type Adapter = HttpAdapterConformanceAdapter;',
        'const adapter = {} as Adapter;',
        'void here;',
        'void adapter;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores member import calls as adapter conformance imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        'const loader = { import: async (_specifier: string) => ({}) };',
        "await loader.import('@ontrails/http/testing');",
        "await loader . import('@ontrails/http/testing');",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores re-export-only adapter conformance files', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "export { createHttpAdapterConformanceCases } from '@ontrails/http/testing';",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores commented-out conformance helper calls', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        "// runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores string-literal conformance helper calls', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        '"runConformance({ name: \'@ontrails/hono\' }, createHttpAdapterConformanceCases());";',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores string-literal conformance helper imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import '@ontrails/http/testing';",
        '',
        'const docs = `',
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        "const { createHttpAdapterConformanceCases, runConformance } = await import('@ontrails/http/testing');",
        "const testing = await import('@ontrails/http/testing');",
        '`;',
        'const createHttpAdapterConformanceCases = () => [];',
        'const runConformance = () => undefined;',
        'const testing = { createHttpAdapterConformanceCases, runConformance };',
        "runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        "testing.runConformance({ name: '@ontrails/hono' }, testing.createHttpAdapterConformanceCases());",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('requires the cases factory call inside the runner call', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        'const cases = createHttpAdapterConformanceCases();',
        "runConformance({ name: '@ontrails/hono' }, cases);",
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('requires runner calls to pass the adapter before conformance cases', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        'runConformance(createHttpAdapterConformanceCases());',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('rejects sentinel adapter arguments before explicit conformance cases', () => {
    for (const sentinel of ['undefined', 'null'] as const) {
      const root = makeRoot();
      writeHttpOwner(root);
      writeHonoAdapter(root);
      writeFile(
        root,
        'adapters/hono/src/__tests__/conformance.test.ts',
        [
          "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
          '',
          `runConformance(${sentinel}, createHttpAdapterConformanceCases());`,
          '',
        ].join('\n')
      );

      const report = checkAdapters(root);

      expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
      expect(report.diagnostics[0]).toMatchObject({
        code: 'missing-conformance',
        packageName: '@ontrails/hono',
        target: 'http',
      });
    }
  });

  test('ignores member calls that reuse the imported runner name', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        'const fake = { runConformance: () => undefined };',
        "fake.runConformance({ name: '@ontrails/hono' }, createHttpAdapterConformanceCases());",
        'void runConformance;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('ignores member calls that reuse the imported cases factory name', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      [
        "import { createHttpAdapterConformanceCases, runConformance } from '@ontrails/http/testing';",
        '',
        'const fake = { createHttpAdapterConformanceCases: () => [] };',
        "runConformance({ name: '@ontrails/hono' }, fake.createHttpAdapterConformanceCases());",
        'void createHttpAdapterConformanceCases;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.subjects[0]?.conformanceTestPaths).toEqual([]);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('accepts import-only conformance coverage until owners declare helper metadata', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined });
    writeHonoAdapter(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/conformance.test.ts',
      "import { createHttpAdapterConformanceCases } from '@ontrails/http/testing';\n\nvoid createHttpAdapterConformanceCases;\n"
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
    expect(report.subjects[0]?.conformanceTestPaths).toHaveLength(1);
  });

  test('reports missing owner conformance facts', () => {
    const root = makeRoot();
    writeHttpOwner(root, { conformance: undefined, testingImport: undefined });
    writeHonoAdapter(root);

    const report = checkAdapters(root);

    expect(report.subjects[0]?.testingImport).toBeUndefined();
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'missing-owner-conformance',
      packageName: '@ontrails/hono',
      target: 'http',
    });
  });

  test('reports invalid owner conformance export targets', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './package.json': './package.json',
        './testing': './src/missing-testing.ts',
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
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid-import',
        packageName: '@ontrails/http',
        target: 'http',
      })
    );
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unknown-adapter-target',
        packageName: '@ontrails/hono',
        target: 'http',
      })
    );
    expect(report.diagnostics[0]?.message).toContain(
      'missing or non-file target'
    );
  });

  test('reports invalid owner conformance export target directories', () => {
    const root = makeRoot();
    writePackage(root, 'packages/http', {
      exports: {
        '.': './src/index.ts',
        './package.json': './package.json',
        './testing': './src',
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
    writeFile(root, 'packages/http/src/index.ts', 'export {};\n');
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'invalid-import',
        packageName: '@ontrails/http',
        target: 'http',
      })
    );
    expect(report.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unknown-adapter-target',
        packageName: '@ontrails/hono',
        target: 'http',
      })
    );
    expect(report.diagnostics[0]?.message).toContain(
      'missing or non-file target'
    );
  });

  test('reports unsupported derived placement for a target', () => {
    const root = makeRoot();
    writeHttpOwner(root, { placements: ['subpath'] });
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);

    const report = checkAdapters(root);

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'unsupported-placement',
      packageName: '@ontrails/hono',
      placement: 'extracted',
      target: 'http',
    });
  });

  test('reports unknown adapter targets', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      trails: {
        adapter: {
          target: 'smtp',
        },
      },
    });

    const report = checkAdapters(root);

    expect(report.subjects).toEqual([]);
    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      code: 'unknown-adapter-target',
      packageName: '@ontrails/hono',
      target: 'smtp',
    });
  });

  test('keeps runtime adapters from depending on adapter kit', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      dependencies: {
        '@ontrails/adapter-kit': 'workspace:*',
        '@ontrails/core': 'workspace:^',
        hono: '^4.7.0',
      },
    });
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/index.ts',
      "import { checkAdapters } from '@ontrails/adapter-kit';\n\nvoid checkAdapters;\n"
    );

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual([
      'tooling-boundary',
      'tooling-boundary',
    ]);
  });

  test('ignores regex-literal adapter-kit mentions as runtime imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/index.ts',
      [
        "const importPattern = /import('@ontrails\\/adapter-kit')/;",
        'void importPattern;',
        '',
      ].join('\n')
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
  });

  test('counts empty named adapter-kit imports as runtime imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      dependencies: {
        '@ontrails/adapter-kit': 'workspace:*',
        '@ontrails/core': 'workspace:^',
        hono: '^4.7.0',
      },
    });
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/index.ts',
      "import {} from '@ontrails/adapter-kit';\n"
    );

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual([
      'tooling-boundary',
      'tooling-boundary',
    ]);
  });

  test('counts adapter-kit re-exports as runtime imports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/index.ts',
      "export { checkAdapters } from '@ontrails/adapter-kit';\n"
    );

    const report = checkAdapters(root);

    expect(codes(report.diagnostics)).toEqual(['tooling-boundary']);
  });

  test('allows adapter-kit imports from adapter authoring tests', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/adapter-check.test.ts',
      "import { checkAdapters } from '@ontrails/adapter-kit';\n\nvoid checkAdapters;\n"
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
  });

  test('allows adapter-kit dev dependencies for adapter authoring tests', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      devDependencies: {
        '@ontrails/adapter-kit': 'workspace:^',
      },
    });
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/__tests__/adapter-check.test.ts',
      "import { checkAdapters } from '@ontrails/adapter-kit';\n\nvoid checkAdapters;\n"
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
  });

  test('allows adapter-kit imports from declaration test files', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root, {
      devDependencies: {
        '@ontrails/adapter-kit': 'workspace:^',
      },
    });
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/public-api.test-d.ts',
      "import { checkAdapters } from '@ontrails/adapter-kit';\n\nexport type Check = typeof checkAdapters;\n"
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
  });

  test('ignores type-only adapter-kit re-exports', () => {
    const root = makeRoot();
    writeHttpOwner(root);
    writeHonoAdapter(root);
    writeHttpConformanceTest(root);
    writeFile(
      root,
      'adapters/hono/src/index.ts',
      "export type { AdapterCheckReport } from '@ontrails/adapter-kit';\n"
    );

    const report = checkAdapters(root);

    expect(report.diagnostics).toEqual([]);
  });
});
